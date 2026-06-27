"""Agent 2: Certificate Agent.

Pipeline: fetch cert records from ServiceNow -> parse + rule-based urgency
-> filter to expiring within threshold -> enrich via SNOW/Prometheus -> ONE
LLM call for urgency/impact reasoning -> create SNOW alert tickets.
"""

import asyncio
import json
import re
from datetime import datetime, timezone

from app.core.config import settings
from app.integrations import prometheus_client, snow_client
from app.schemas.cert_agent import CertAgentResult, CertAssessment, CertSignals


def _extract_field(description: str, field: str) -> str:
    match = re.search(rf"^{field}=(.+)$", description, re.MULTILINE)
    return match.group(1).strip() if match else ""


def _rule_based_urgency(days_left: int) -> str:
    if days_left <= 7:
        return "CRITICAL"
    if days_left <= 14:
        return "HIGH"
    if days_left <= 30:
        return "MEDIUM"
    return "LOW"


def parse_cert_record(record: dict) -> CertSignals:
    """Parse a SNOW cert record's structured description back into metadata."""
    description = record.get("description", "")

    cert_name = _extract_field(description, "cert_name")
    if not cert_name:
        cert_name = record.get("short_description", "").replace("CERT: ", "").strip()

    expires_at = _extract_field(description, "expires_at")
    days_left = 999
    if expires_at:
        try:
            expires = datetime.strptime(expires_at, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            days_left = (expires - datetime.now(timezone.utc)).days
        except Exception:
            pass

    sans = _extract_field(description, "sans")

    return CertSignals(
        snow_number=record.get("number", ""),
        snow_sys_id=record.get("sys_id", ""),
        cert_name=cert_name,
        expires_at=expires_at,
        days_left=days_left,
        urgency=_rule_based_urgency(days_left),
        ci_name=_extract_field(description, "ci_name"),
        environment=_extract_field(description, "environment"),
        owner_team=_extract_field(description, "owner_team"),
        auto_renewal=_extract_field(description, "auto_renewal") == "true",
        sans=sans.split(",") if sans else [],
        description=_extract_field(description, "description"),
    )


async def enrich_cert(signals: CertSignals) -> CertSignals:
    """Cross-check live systems (SNOW incidents + Prometheus error rate)."""
    service = signals.ci_name
    if not service:
        return signals

    open_snow_incidents, error_rate, duplicate_ticket_exists = await asyncio.gather(
        snow_client.get_open_incidents(service, exclude_cert_records=True),
        prometheus_client.get_error_rate(service),
        snow_client.check_duplicate_alert_ticket(signals.cert_name),
    )

    return signals.model_copy(
        update={
            "open_snow_incidents": open_snow_incidents,
            "error_rate": error_rate,
            "duplicate_ticket_exists": duplicate_ticket_exists,
        }
    )


def _rule_based_assessment(signals: CertSignals) -> CertAssessment:
    skip_ticket = signals.duplicate_ticket_exists or (signals.auto_renewal and signals.days_left > 14)
    return CertAssessment(
        cert_name=signals.cert_name,
        days_left=signals.days_left,
        urgency=signals.urgency,
        skip_ticket=skip_ticket,
        business_impact=f"{signals.cert_name} ({signals.ci_name or 'unknown service'}) would fail TLS handshakes if it expires.",
        blast_radius=f"{len(signals.sans)} domain(s): {', '.join(signals.sans)}" if signals.sans else "unknown",
        recommended_action="Monitor auto-renewal" if signals.auto_renewal else "Renew certificate manually",
        notify=signals.owner_team,
        llm_used=False,
        expires_at=signals.expires_at,
        ci_name=signals.ci_name,
        owner_team=signals.owner_team,
        sans=signals.sans,
    )


def run_llm_reasoning(signals_list: list[CertSignals]) -> list[CertAssessment]:
    """ONE GPT-4o call for the whole batch, per the shared 'one call per agent' rule."""
    if not signals_list:
        return []
    if not settings.openai_api_key:
        return [_rule_based_assessment(s) for s in signals_list]

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    payload = [s.model_dump() for s in signals_list]
    try:
        response = client.chat.completions.create(
            model=settings.openai_model,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a senior SRE assessing certificate expiry risk for production "
                        "services. Given a JSON list of certificate signals (days left, environment, "
                        "owning service, auto-renewal, SANs, open SNOW incidents, error rate, whether "
                        "a renewal ticket already exists), assess each certificate. "
                        'Respond with JSON: {"certs": [{"cert_name": str, "urgency": '
                        '"CRITICAL"|"HIGH"|"MEDIUM"|"LOW", "skip_ticket": bool, "business_impact": str, '
                        '"blast_radius": str, "recommended_action": str, "notify": str}]}. '
                        "Rules: CRITICAL if <=7 days AND production AND no auto-renewal; HIGH if <=14 "
                        "days OR production service with open incidents; MEDIUM if <=30 days with "
                        "uncertain auto-renewal; LOW if >30 days OR auto-renewal confirmed. "
                        "skip_ticket=true if a renewal ticket already exists OR (auto_renewal=true AND "
                        "days_left > 14). business_impact should mention the actual service name and "
                        "what would break."
                    ),
                },
                {"role": "user", "content": json.dumps(payload)},
            ],
        )
        parsed = json.loads(response.choices[0].message.content)
        by_name = {c["cert_name"]: c for c in parsed.get("certs", [])}
        results = []
        for signals in signals_list:
            verdict = by_name.get(signals.cert_name)
            if not verdict:
                results.append(_rule_based_assessment(signals))
                continue
            results.append(
                CertAssessment(
                    cert_name=signals.cert_name,
                    days_left=signals.days_left,
                    urgency=verdict.get("urgency", signals.urgency),
                    skip_ticket=verdict.get("skip_ticket", False),
                    business_impact=verdict.get("business_impact", ""),
                    blast_radius=verdict.get("blast_radius", ""),
                    recommended_action=verdict.get("recommended_action", ""),
                    notify=verdict.get("notify", signals.owner_team),
                    llm_used=True,
                    expires_at=signals.expires_at,
                    ci_name=signals.ci_name,
                    owner_team=signals.owner_team,
                    sans=signals.sans,
                )
            )
        return results
    except Exception as exc:
        print(f"OpenAI call failed: {exc}")
        return [_rule_based_assessment(s) for s in signals_list]


async def _create_alert_tickets(assessments: list[CertAssessment], signals_by_name: dict[str, CertSignals]) -> list[str]:
    tickets_created: list[str] = []
    for assessment in assessments:
        if assessment.urgency not in ("CRITICAL", "HIGH") or assessment.skip_ticket:
            continue

        signals = signals_by_name[assessment.cert_name]
        urgency_value = "1" if assessment.urgency == "CRITICAL" else "2"
        description = (
            f"Certificate expiry alert\n\n"
            f"Cert: {signals.cert_name}\n"
            f"Expires: {signals.expires_at} ({signals.days_left} days)\n"
            f"Service: {signals.ci_name}\n"
            f"Environment: {signals.environment}\n"
            f"Auto-renewal: {signals.auto_renewal}\n\n"
            f"Business Impact:\n{assessment.business_impact}\n\n"
            f"Recommended Action:\n{assessment.recommended_action}\n\n"
            f"Notify: {assessment.notify or signals.owner_team}"
        )
        ticket = await snow_client.create_certificate_alert(
            short_description=f"[CertExpiry] {signals.cert_name} expires in {signals.days_left} days",
            description=description,
            urgency=urgency_value,
            impact=urgency_value,
            assignment_group=signals.owner_team,
        )
        if ticket:
            assessment.alert_ticket = ticket.get("number", "")
            tickets_created.append(ticket.get("number", ""))
    return tickets_created


async def run() -> CertAgentResult:
    print("Cert Agent starting scan...")

    raw_records = await snow_client.get_certificate_records()
    print(f"Found {len(raw_records)} cert records")

    all_certs = [parse_cert_record(r) for r in raw_records]

    if not all_certs:
        return CertAgentResult(
            certs_scanned=0,
            expiring_soon=[],
            tickets_created=[],
            critical_count=0,
            high_count=0,
            summary="No cert records found in SNOW",
        )

    expiring = [c for c in all_certs if c.days_left <= settings.cert_expiry_threshold_days]
    print(f"{len(expiring)} certs expiring within {settings.cert_expiry_threshold_days} days")

    if not expiring:
        return CertAgentResult(
            certs_scanned=len(all_certs),
            expiring_soon=[],
            tickets_created=[],
            critical_count=0,
            high_count=0,
            summary=f"All {len(all_certs)} certs healthy -- none expiring within {settings.cert_expiry_threshold_days} days",
        )

    enriched = list(await asyncio.gather(*[enrich_cert(c) for c in expiring]))
    signals_by_name = {c.cert_name: c for c in enriched}

    analyzed = run_llm_reasoning(enriched)
    tickets_created = await _create_alert_tickets(analyzed, signals_by_name)

    analyzed.sort(key=lambda c: c.days_left)

    result = CertAgentResult(
        certs_scanned=len(all_certs),
        expiring_soon=analyzed,
        tickets_created=tickets_created,
        critical_count=sum(1 for c in analyzed if c.urgency == "CRITICAL"),
        high_count=sum(1 for c in analyzed if c.urgency == "HIGH"),
        summary=f"{len(analyzed)} certs expiring soon. {len(tickets_created)} alert tickets created.",
    )

    print("\nCert Agent complete:")
    print(f"  Scanned: {result.certs_scanned}")
    print(f"  Expiring: {len(analyzed)}")
    print(f"  Critical: {result.critical_count}")
    print(f"  Tickets: {len(tickets_created)}")

    return result


if __name__ == "__main__":
    result = asyncio.run(run())
    print("\n=== RESULTS ===")
    for cert in result.expiring_soon:
        print(f"\n{cert.cert_name}")
        print(f"  Days left: {cert.days_left}")
        print(f"  Urgency: {cert.urgency}")
        print(f"  Skip ticket: {cert.skip_ticket}")
        print(f"  Business impact: {cert.business_impact[:80]}")
        print(f"  Action: {cert.recommended_action}")
