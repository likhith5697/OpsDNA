"""Agent 4: GitHub Agent.

Pipeline: fetch open PRs + recent CI runs + direct pushes to main -> analyze
each PR for risk signals (rule-based) -> filter to at-risk PRs -> enrich via
SNOW/Prometheus -> ONE LLM call for risk reasoning -> return structured
results for the dashboard.
"""

import asyncio
import json
import re
from datetime import datetime, timezone

from app.core.config import settings
from app.integrations import github_client, prometheus_client, snow_client
from app.schemas.github_agent import GitHubAgentResult, PRAssessment, PRSignals

_SERVICE_PATTERN = re.compile(r"[a-z0-9]+-service", re.IGNORECASE)
_JIRA_TICKET_PATTERN = re.compile(r"[A-Z]+-\d+")
_KEYWORD_SERVICES = {
    "checkout": "checkout-service",
    "payment": "checkout-service",
    "order": "checkout-service",
    "auth": "auth-service",
    "database": "checkout-service",
    "memory": "checkout-service",
    "db": "checkout-service",
}


def _extract_service(text: str) -> str:
    match = _SERVICE_PATTERN.search(text.lower())
    if match:
        return match.group(0)
    text_lower = text.lower()
    for keyword, service in _KEYWORD_SERVICES.items():
        if keyword in text_lower:
            return service
    return settings.github_repo


def _extract_jira_ticket(text: str) -> str:
    match = _JIRA_TICKET_PATTERN.search(text)
    return match.group(0) if match else ""


async def analyze_pr(raw_pr: dict, now: datetime) -> PRSignals:
    """Fetch per-PR review/CI data and compute rule-based risk signals."""
    created_at = datetime.fromisoformat(raw_pr["created_at"].replace("Z", "+00:00"))
    updated_at = datetime.fromisoformat(raw_pr["updated_at"].replace("Z", "+00:00"))
    days_open = (now - created_at).days
    days_since_update = (now - updated_at).days

    reviews, ci_status = await asyncio.gather(
        github_client.get_pr_reviews(raw_pr["number"]),
        github_client.get_pr_ci_status(raw_pr["head"]["sha"]),
    )
    has_approval = any(r.get("state") == "APPROVED" for r in reviews)

    title = raw_pr.get("title", "")
    body = (raw_pr.get("body") or "")[:500]
    combined = f"{title} {body}"

    signals = []
    if days_open > 7:
        signals.append(f"open {days_open} days")
    if days_since_update > 3:
        signals.append(f"no activity for {days_since_update} days")
    if not has_approval:
        signals.append("no reviewer approval")
    if ci_status == "failure":
        signals.append("CI failing")
    if len(reviews) == 0:
        signals.append("no reviews at all")
    if raw_pr.get("draft", False):
        signals.append("still in draft")

    return PRSignals(
        number=raw_pr["number"],
        title=title,
        body=body,
        author=raw_pr["user"]["login"],
        branch=raw_pr["head"]["ref"],
        created_at=raw_pr["created_at"],
        updated_at=raw_pr["updated_at"],
        days_open=days_open,
        days_since_update=days_since_update,
        has_approval=has_approval,
        review_count=len(reviews),
        ci_status=ci_status,
        ci_passing=ci_status == "success",
        service_name=_extract_service(combined),
        jira_ticket=_extract_jira_ticket(combined),
        url=raw_pr["html_url"],
        draft=raw_pr.get("draft", False),
        risk_signals=signals,
        has_risk=len(signals) > 0,
    )


async def enrich_pr(signals: PRSignals) -> PRSignals:
    """Cross-check live systems (SNOW incidents + Prometheus error rate)."""
    service = signals.service_name
    if not service:
        return signals

    open_snow_incidents, error_rate = await asyncio.gather(
        snow_client.get_open_incidents(service, exclude_cert_records=True),
        prometheus_client.get_error_rate(service),
    )

    return signals.model_copy(update={"open_snow_incidents": open_snow_incidents, "error_rate": error_rate})


def _rule_based_assessment(signals: PRSignals) -> PRAssessment:
    blocking_production = bool(signals.open_snow_incidents) and signals.error_rate > 0

    if (signals.ci_status == "failure" and signals.open_snow_incidents) or signals.days_open > 10:
        risk, recommendation = "HIGH", "MERGE_URGENT" if blocking_production else "NEEDS_REVIEW"
    elif not signals.has_approval and signals.ci_passing and 5 <= signals.days_open <= 10:
        risk, recommendation = "MEDIUM", "NEEDS_REVIEW"
    else:
        risk, recommendation = "LOW", "MONITOR"

    reason = "; ".join(signals.risk_signals) or "No risk signals detected"
    if signals.open_snow_incidents:
        reason += f"; {len(signals.open_snow_incidents)} open SNOW incident(s) for {signals.service_name}"

    return PRAssessment(
        number=signals.number,
        title=signals.title,
        url=signals.url,
        risk=risk,
        blocking_production=blocking_production,
        reason=reason,
        recommendation=recommendation,
        action="Merge urgently or escalate to lead" if risk == "HIGH" else "Continue monitoring",
        llm_used=False,
    )


def run_llm_reasoning(signals_list: list[PRSignals], ci_runs: list[dict], direct_pushes: list[dict]) -> tuple[list[PRAssessment], str, str]:
    """ONE GPT-4o call for the whole batch, per the shared 'one call per agent' rule."""
    if not signals_list:
        return [], "UNKNOWN", ""
    if not settings.openai_api_key:
        return [_rule_based_assessment(s) for s in signals_list], "UNKNOWN", ""

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    payload = {
        "prs": [s.model_dump() for s in signals_list],
        "failing_ci_runs": [r for r in ci_runs if r.get("failing")][:3],
        "direct_pushes": direct_pushes[:3],
    }
    try:
        response = client.chat.completions.create(
            model=settings.openai_model,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a senior engineering lead doing a code review health check. Given a "
                        "JSON object with open PRs (age, approval, CI status, SNOW incidents, error "
                        "rate), recent failing CI runs, and direct pushes to main, assess each PR's "
                        "delivery/live-impact risk and the overall repo health. "
                        'Respond with JSON: {"prs": [{"number": int, "risk": "HIGH"|"MEDIUM"|"LOW", '
                        '"blocking_production": bool, "reason": str, "recommendation": '
                        '"MERGE_URGENT"|"NEEDS_REVIEW"|"CLOSE"|"MONITOR", "action": str}], '
                        '"repo_health": "CRITICAL"|"DEGRADED"|"HEALTHY", "repo_summary": str}. '
                        "Rules: HIGH if CI failing AND service has live incidents, OR open > 10 days "
                        "unreviewed; MEDIUM if no review, CI passing, open 5-10 days; LOW if recent, "
                        "has review, CI passing. blocking_production=true only if SNOW incidents exist "
                        "AND error rate > 0 for the same service."
                    ),
                },
                {"role": "user", "content": json.dumps(payload)},
            ],
        )
        parsed = json.loads(response.choices[0].message.content)
        by_number = {p["number"]: p for p in parsed.get("prs", [])}
        results = []
        for signals in signals_list:
            verdict = by_number.get(signals.number)
            if not verdict:
                results.append(_rule_based_assessment(signals))
                continue
            results.append(
                PRAssessment(
                    number=signals.number,
                    title=signals.title,
                    url=signals.url,
                    risk=verdict.get("risk", "LOW"),
                    blocking_production=verdict.get("blocking_production", False),
                    reason=verdict.get("reason", ""),
                    recommendation=verdict.get("recommendation", "MONITOR"),
                    action=verdict.get("action", ""),
                    llm_used=True,
                )
            )
        return results, parsed.get("repo_health", "UNKNOWN"), parsed.get("repo_summary", "")
    except Exception as exc:
        print(f"OpenAI call failed: {exc}")
        return [_rule_based_assessment(s) for s in signals_list], "UNKNOWN", ""


async def run() -> GitHubAgentResult:
    print("GitHub Agent starting scan...")
    print(f"Repo: {settings.github_owner}/{settings.github_repo}")

    raw_prs, ci_runs, direct_pushes = await asyncio.gather(
        github_client.get_open_prs(),
        github_client.get_recent_ci_runs(),
        github_client.get_direct_pushes(),
    )
    print(f"Found: {len(raw_prs)} open PRs, {len(ci_runs)} CI runs, {len(direct_pushes)} direct pushes")

    now = datetime.now(timezone.utc)
    all_prs = list(await asyncio.gather(*[analyze_pr(pr, now) for pr in raw_prs]))
    at_risk = [pr for pr in all_prs if pr.has_risk]
    print(f"{len(at_risk)} at-risk PRs found")

    enriched = list(await asyncio.gather(*[enrich_pr(pr) for pr in at_risk]))
    analyzed, repo_health, repo_summary = run_llm_reasoning(enriched, ci_runs, direct_pushes)

    failing_ci = [r for r in ci_runs if r.get("failing")]
    high_risk = [pr for pr in analyzed if pr.risk == "HIGH"]
    blocking = [pr for pr in analyzed if pr.blocking_production]

    result = GitHubAgentResult(
        repo=f"{settings.github_owner}/{settings.github_repo}",
        prs_scanned=len(raw_prs),
        at_risk_prs=analyzed,
        ci_runs=ci_runs[:5],
        failing_ci_count=len(failing_ci),
        direct_pushes=direct_pushes[:5],
        direct_push_count=len(direct_pushes),
        high_risk_count=len(high_risk),
        blocking_production_count=len(blocking),
        repo_health=repo_health if repo_health in ("CRITICAL", "DEGRADED", "HEALTHY") else "UNKNOWN",
        repo_summary=repo_summary,
        summary=(
            f"{len(raw_prs)} PRs scanned. {len(high_risk)} high risk. "
            f"{len(failing_ci)} CI failing. {len(direct_pushes)} direct pushes."
        ),
    )

    print("\nGitHub Agent complete:")
    print(f"  PRs scanned: {result.prs_scanned}")
    print(f"  At-risk: {len(analyzed)}")
    print(f"  High risk: {result.high_risk_count}")
    print(f"  CI failing: {result.failing_ci_count}")
    print(f"  Direct pushes: {result.direct_push_count}")
    print(f"  Repo health: {result.repo_health}")

    return result


if __name__ == "__main__":
    result = asyncio.run(run())
    print("\n=== RESULTS ===")
    print(f"Repo health: {result.repo_health}")
    print(f"Summary: {result.repo_summary}")
    print("\nAt-risk PRs:")
    for pr in result.at_risk_prs:
        print(f"\n  PR #{pr.number}: {pr.title[:50]}")
        print(f"  Risk: {pr.risk}")
        print(f"  Blocking: {pr.blocking_production}")
        print(f"  Reason: {pr.reason[:80]}")
        print(f"  Action: {pr.action[:80]}")
