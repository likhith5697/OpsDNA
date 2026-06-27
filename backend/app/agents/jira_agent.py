"""Agent 3: Jira Agent.

Pipeline: get open tickets -> analyze (age/blocked/unassigned/stuck/overdue)
-> extract service name -> enrich via SNOW/K8s/Prometheus -> ONE LLM call for
risk reasoning -> take actions (update Jira priority / comment).
"""

import asyncio
import json
import re
from datetime import datetime, timezone

from app.core.config import settings
from app.integrations import jira_client, k8s_client, prometheus_client, snow_client
from app.schemas.jira_agent import ActionTaken, JiraAgentResult, TicketRisk, TicketSignals

_SERVICE_PATTERN = re.compile(r"[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*-(?:service|gateway|api|worker)", re.IGNORECASE)


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.strptime(value[:23], "%Y-%m-%dT%H:%M:%S.%f").replace(tzinfo=timezone.utc)


def _extract_service_name(issue: dict) -> str | None:
    fields = issue["fields"]
    components = fields.get("components") or []
    if components:
        return components[0]["name"]
    labels = fields.get("labels") or []
    for label in labels:
        if _SERVICE_PATTERN.fullmatch(label):
            return label
    match = _SERVICE_PATTERN.search(fields.get("summary", ""))
    return match.group(0) if match else None


def _is_blocked(issue: dict) -> bool:
    fields = issue["fields"]
    status_name = fields["status"]["name"].lower()
    if "block" in status_name:
        return True
    if "blocked" in (fields.get("labels") or []):
        return True
    for link in fields.get("issuelinks") or []:
        link_type = link.get("type", {}).get("inward", "")
        blocking_issue = link.get("inwardIssue")
        if "is blocked by" in link_type and blocking_issue:
            blocking_status = blocking_issue["fields"]["status"]["statusCategory"]["key"]
            if blocking_status != "done":
                return True
    return False


def analyze_ticket(issue: dict, now: datetime) -> TicketSignals:
    """Compute rule-based signals from raw Jira fields (no enrichment yet)."""
    fields = issue["fields"]
    created = _parse_dt(fields["created"])
    updated = _parse_dt(fields["updated"])
    due_date = fields.get("duedate")
    days_open = (now - created).days
    days_since_update = (now - updated).days
    status_name = fields["status"]["name"]
    is_unassigned = fields.get("assignee") is None
    is_blocked = _is_blocked(issue)
    is_stuck = days_since_update > settings.stale_days_threshold and status_name.lower() not in ("to do", "backlog", "done")
    is_overdue = bool(due_date) and datetime.strptime(due_date, "%Y-%m-%d").replace(tzinfo=timezone.utc) < now

    return TicketSignals(
        key=issue["key"],
        summary=fields["summary"],
        status=status_name,
        assignee=(fields.get("assignee") or {}).get("displayName"),
        priority=(fields.get("priority") or {}).get("name"),
        created=fields["created"],
        updated=fields["updated"],
        due_date=due_date,
        days_open=days_open,
        days_since_update=days_since_update,
        is_unassigned=is_unassigned,
        is_blocked=is_blocked,
        is_stuck=is_stuck,
        is_overdue=is_overdue,
        service_name=_extract_service_name(issue),
        open_snow_incidents=[],
        pod_health={"healthy": None, "pods": []},
        error_rate=0.0,
    )


async def enrich_ticket(signals: TicketSignals) -> TicketSignals:
    """Enrich a single ticket's signals with live SNOW/K8s/Prometheus data."""
    service = signals.service_name
    if not service:
        return signals

    open_snow_incidents, error_rate = await asyncio.gather(
        snow_client.get_open_incidents(service),
        prometheus_client.get_error_rate(service),
    )
    pod_health = k8s_client.get_pods(service)  # sync subprocess call

    return signals.model_copy(
        update={
            "open_snow_incidents": open_snow_incidents,
            "pod_health": pod_health,
            "error_rate": error_rate,
        }
    )


def _rule_based_risk(signals: TicketSignals) -> TicketRisk:
    reasons = []
    score = 0
    if signals.is_blocked:
        reasons.append("Ticket is blocked")
        score += 2
    if signals.open_snow_incidents:
        reasons.append(f"{len(signals.open_snow_incidents)} open SNOW incident(s) for {signals.service_name}")
        score += 2
    if signals.error_rate and signals.error_rate > 0.05:
        reasons.append(f"Elevated error rate ({signals.error_rate:.1%}) on {signals.service_name}")
        score += 2
    if signals.is_overdue:
        reasons.append("Past due date")
        score += 1
    if signals.is_stuck:
        reasons.append(f"No update in {signals.days_since_update} days")
        score += 1
    if signals.is_unassigned:
        reasons.append("Unassigned")
        score += 1
    if signals.days_open > 14:
        reasons.append(f"Open for {signals.days_open} days")
        score += 1

    causing_live_impact = bool(signals.open_snow_incidents) and signals.error_rate > 0
    if causing_live_impact:
        score += 2

    if score >= 4:
        risk_level, recommendation = "HIGH", "ESCALATE"
    elif score >= 2:
        risk_level, recommendation = "MEDIUM", "REASSIGN" if signals.is_unassigned else "MONITOR"
    else:
        risk_level, recommendation = "LOW", "MONITOR"

    return TicketRisk(
        key=signals.key,
        service_name=signals.service_name,
        risk_level=risk_level,
        reasons=reasons or ["No risk signals detected"],
        recommendation=recommendation,
        causing_live_impact=causing_live_impact,
        llm_used=False,
        summary=signals.summary,
        status=signals.status,
        days_open=signals.days_open,
        is_unassigned=signals.is_unassigned,
        is_blocked=signals.is_blocked,
        open_snow_incidents=signals.open_snow_incidents,
        error_rate=signals.error_rate,
    )


def run_llm_risk_reasoning(signals_list: list[TicketSignals]) -> list[TicketRisk]:
    """ONE GPT-4o call for the whole batch, per the shared 'one call per agent' rule."""
    if not settings.openai_api_key:
        return [_rule_based_risk(s) for s in signals_list]

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
                        "You are an engineering lead doing sprint review. Given a JSON list of Jira "
                        "ticket signals (age, blocked status, assignee, linked SNOW incidents, pod "
                        "health, error rate), assess each ticket's delivery/live-impact risk. "
                        'Respond with JSON: {"tickets": [{"key": str, "risk_level": "HIGH"|"MEDIUM"|"LOW", '
                        '"reasons": [str], "recommendation": "ESCALATE"|"DESCOPE"|"REASSIGN"|"MONITOR", '
                        '"causing_live_impact": bool}]}. '
                        "Rules: HIGH if causing live production impact OR overdue AND unassigned/blocked; "
                        "MEDIUM if at risk of slipping with no live impact; LOW if minor and the team can "
                        "handle it. causing_live_impact=true only if open SNOW incidents exist AND error "
                        "rate > 0 for the same service."
                    ),
                },
                {"role": "user", "content": json.dumps(payload)},
            ],
        )
        parsed = json.loads(response.choices[0].message.content)
        signals_by_key = {s.key: s for s in signals_list}
        results = []
        for t in parsed["tickets"]:
            s = signals_by_key.get(t["key"])
            results.append(
                TicketRisk(
                    **t,
                    service_name=s.service_name if s else None,
                    llm_used=True,
                    summary=s.summary if s else "",
                    status=s.status if s else "",
                    days_open=s.days_open if s else 0,
                    is_unassigned=s.is_unassigned if s else False,
                    is_blocked=s.is_blocked if s else False,
                    open_snow_incidents=s.open_snow_incidents if s else [],
                    error_rate=s.error_rate if s else 0.0,
                )
            )
        return results
    except Exception as exc:
        print(f"OpenAI call failed: {exc}")
        return [_rule_based_risk(s) for s in signals_list]


def _take_actions(risks: list[TicketRisk]) -> list[ActionTaken]:
    actions: list[ActionTaken] = []
    for risk in risks:
        if risk.risk_level not in ("HIGH", "MEDIUM"):
            continue
        comment = f"[OpsDNA Jira Agent] Risk: {risk.risk_level}. " + "; ".join(risk.reasons) + f". Recommendation: {risk.recommendation}."
        try:
            jira_client.add_comment(risk.key, comment)
            actions.append(ActionTaken(key=risk.key, action="comment", detail=comment))
        except Exception as exc:
            actions.append(ActionTaken(key=risk.key, action="comment_failed", detail=str(exc)))

        if risk.risk_level == "HIGH" and risk.recommendation == "ESCALATE":
            try:
                jira_client.update_priority(risk.key, "Highest")
                actions.append(ActionTaken(key=risk.key, action="priority_updated", detail="Set to Highest"))
            except Exception as exc:
                actions.append(ActionTaken(key=risk.key, action="priority_update_failed", detail=str(exc)))
    return actions


async def run(project_key: str | None = None, take_actions: bool = True) -> JiraAgentResult:
    project_key = project_key or settings.jira_project_key
    now = datetime.now(timezone.utc)

    issues = jira_client.get_open_tickets(project_key)
    signals_list = [analyze_ticket(issue, now) for issue in issues]
    signals_list = list(await asyncio.gather(*[enrich_ticket(s) for s in signals_list]))
    risks = run_llm_risk_reasoning(signals_list)

    at_risk = [r for r in risks if r.risk_level in ("HIGH", "MEDIUM")]
    actions = _take_actions(at_risk) if take_actions else []

    return JiraAgentResult(
        project_key=project_key,
        tickets_scanned=len(issues),
        at_risk_tickets=at_risk,
        actions_taken=actions,
    )


if __name__ == "__main__":
    result = asyncio.run(run(take_actions=False))
    print(result.model_dump_json(indent=2))
