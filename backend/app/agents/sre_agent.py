"""Agent 1: SRE Agent.

Monitors checkout-service health using Grafana Cloud metrics. Detects
incidents, classifies by tier, correlates with GitHub PRs and Jira tickets,
and recommends a fix. Never auto-executes anything against the cluster --
it recommends, a human approves and acts.

TIER 1   -- Infrastructure: agent recommends a fix
TIER 1.5 -- Cloud/Platform: escalate to cloud team
TIER 2   -- Code defect: escalate to dev team

Pipeline:
1. Collect live health data from Grafana Cloud
2. Detect active incidents (threshold breaches)
3. Check SNOW for existing incidents
4. Cross-reference GitHub PRs + the last Jira agent run
5. Classify incident tier
6. ONE LLM call for diagnosis + recommendation
7. Create a SNOW incident if needed
8. Return structured result for the dashboard
"""

import asyncio
import json
import subprocess
import uuid
from datetime import datetime, timezone

from app.core import state
from app.core.config import settings
from app.integrations import github_client, grafana_client, jira_client, k8s_client, loki_client, snow_client, sop_store
from app.schemas.sre_agent import (
    AskResponse,
    DetectedIncident,
    Diagnosis,
    ExecuteFixResult,
    HealthMetrics,
    RemediationProposal,
    SREAgentResult,
)

SERVICE_NAME = "checkout-service"


async def collect_health_data() -> HealthMetrics:
    """Collect all health signals from Grafana Cloud in parallel."""
    print(f"Collecting health data for {SERVICE_NAME}...")

    error_rate, request_rate, p99_latency, order_metrics = await asyncio.gather(
        grafana_client.get_error_rate(SERVICE_NAME),
        grafana_client.get_request_rate(SERVICE_NAME),
        grafana_client.get_p99_latency(SERVICE_NAME),
        grafana_client.get_order_metrics(SERVICE_NAME),
    )

    return HealthMetrics(
        service=SERVICE_NAME,
        timestamp=datetime.now(timezone.utc).isoformat(),
        error_rate_pct=error_rate,
        request_rate_per_min=request_rate,
        p99_latency_ms=p99_latency,
        orders_per_min=order_metrics["orders_per_min"],
        order_success_rate_pct=order_metrics["order_success_rate_pct"],
        active_orders=order_metrics["active_orders"],
        payment_failures_per_min=order_metrics["payment_failures_per_min"],
        metrics_available=error_rate > 0 or request_rate > 0,
    )


def detect_incidents(health: HealthMetrics) -> list[DetectedIncident]:
    """Rule-based incident detection from threshold breaches."""
    incidents = []

    if health.error_rate_pct > settings.sre_error_rate_threshold:
        incidents.append(
            DetectedIncident(
                type="high_error_rate",
                severity="CRITICAL" if health.error_rate_pct > 10 else "HIGH",
                title=f"[AUTO] High error rate on {SERVICE_NAME}: {health.error_rate_pct:.1f}%",
                value=health.error_rate_pct,
                threshold=settings.sre_error_rate_threshold,
                sop="SOP-K8S-002",
            )
        )

    if health.p99_latency_ms > settings.sre_p99_latency_threshold:
        incidents.append(
            DetectedIncident(
                type="high_latency",
                severity="HIGH",
                title=f"[AUTO] High P99 latency on {SERVICE_NAME}: {health.p99_latency_ms:.0f}ms",
                value=health.p99_latency_ms,
                threshold=settings.sre_p99_latency_threshold,
                sop="SOP-K8S-003",
            )
        )

    if 0 < health.order_success_rate_pct < settings.sre_order_success_threshold:
        incidents.append(
            DetectedIncident(
                type="low_order_success",
                severity="CRITICAL",
                title=f"[AUTO] Low order success rate: {health.order_success_rate_pct:.1f}%",
                value=health.order_success_rate_pct,
                threshold=settings.sre_order_success_threshold,
                sop="SOP-K8S-002",
            )
        )

    if health.payment_failures_per_min > 0.5:
        incidents.append(
            DetectedIncident(
                type="payment_failures",
                severity="CRITICAL",
                title=f"[AUTO] Payment failures spike: {health.payment_failures_per_min:.2f}/min",
                value=health.payment_failures_per_min,
                threshold=0.5,
                sop="SOP-K8S-002",
            )
        )

    return incidents


async def get_related_prs() -> list[dict]:
    """Open PRs for the repo that may be related to current incidents."""
    raw_prs = await github_client.get_open_prs()
    now = datetime.now(timezone.utc)
    return [
        {
            "number": pr["number"],
            "title": pr["title"],
            "branch": pr["head"]["ref"],
            "url": pr["html_url"],
            "days_open": (now - datetime.fromisoformat(pr["created_at"].replace("Z", "+00:00"))).days,
        }
        for pr in raw_prs
    ]


def get_related_jira_tickets() -> list[dict]:
    """At-risk tickets from the last Jira agent run for this service."""
    if state.last_jira_result is None:
        return []
    return [t.model_dump() for t in state.last_jira_result.at_risk_tickets if t.service_name == SERVICE_NAME]


def classify_tier(incident: DetectedIncident, health: HealthMetrics, related_prs: list[dict]) -> str:
    """Classify an incident as TIER1 / TIER1.5 / TIER2.

    TIER1   -- Infrastructure, agent can recommend a fix
    TIER1.5 -- Cloud/Platform team needed
    TIER2   -- Code defect, dev team needed
    """
    if incident.type == "payment_failures" and related_prs:
        return "TIER2"

    if incident.type == "low_order_success" and health.error_rate_pct > 5 and related_prs:
        return "TIER2"

    if incident.type == "high_error_rate":
        for pr in related_prs:
            title_lower = pr["title"].lower()
            if any(kw in title_lower for kw in ("fix", "payment", "validation", "error")):
                return "TIER2"

    return "TIER1"


_INCIDENT_TYPE_TO_ISSUE_TYPE = {
    "high_error_rate": "High Error Rate",
    "high_latency": "High Latency",
    "low_order_success": "High Error Rate",
    "payment_failures": "High Error Rate",
}


async def run_llm_diagnosis(
    health: HealthMetrics,
    incidents: list[DetectedIncident],
    existing_snow: list[dict],
    related_prs: list[dict],
    related_jira: list[dict],
) -> Diagnosis:
    """ONE GPT-4o call for the full diagnosis, per the shared 'one call per agent' rule."""
    if not incidents:
        return Diagnosis(overall_health="HEALTHY")
    if not settings.openai_api_key:
        return Diagnosis(overall_health="DEGRADED", llm_used=False)

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)

    first_incident = incidents[0]
    query_text = f"{first_incident.type} {first_incident.title}"
    sop = await _find_sop(query_text, fallback_issue_type=_INCIDENT_TYPE_TO_ISSUE_TYPE.get(first_incident.type))
    sop_text = f"{sop['sop_number']}: {sop['title']} (match confidence: {sop['confidence']})\n\n{sop['text']}" if sop else "No matching SOP found in ServiceNow KB."

    snow_summary = "None" if not existing_snow else "\n".join(f"  - {i['number']}: {i['short_description'][:60]}" for i in existing_snow)
    pr_summary = "None" if not related_prs else "\n".join(f"  - PR #{pr['number']}: {pr['title']} ({pr['days_open']} days open)" for pr in related_prs)
    jira_summary = "None" if not related_jira else "\n".join(f"  - {t.get('key')}: {', '.join(t.get('reasons', []))} [{t.get('risk_level', '')}]" for t in related_jira)
    incidents_text = "\n".join(f"  - {i.type}: {i.title} (value={i.value}, threshold={i.threshold}, tier={i.tier})" for i in incidents)

    prompt = f"""You are a senior SRE diagnosing a production incident for checkout-service.

MATCHING SOP FROM SERVICENOW KB (real semantic search result -- use this
exact sop_number in your response, or null if it says "No matching SOP
found"; never invent a SOP number that isn't this one):
{sop_text}

LIVE METRICS (from Grafana Cloud):
  Error rate: {health.error_rate_pct}%
  Request rate: {health.request_rate_per_min} req/min
  P99 latency: {health.p99_latency_ms}ms
  Orders/min: {health.orders_per_min}
  Order success rate: {health.order_success_rate_pct}%
  Active orders: {health.active_orders}
  Payment failures/min: {health.payment_failures_per_min}

DETECTED INCIDENTS:
{incidents_text}

EXISTING SNOW INCIDENTS:
{snow_summary}

RELATED OPEN GITHUB PRs:
{pr_summary}

RELATED JIRA TICKETS:
{jira_summary}

Provide diagnosis in JSON format:
{{
  "overall_health": "CRITICAL|DEGRADED|HEALTHY",
  "root_cause": "specific root cause explanation",
  "evidence": "what metric/data proves this",
  "tier": "TIER1|TIER1.5|TIER2",
  "tier_reason": "why this tier",
  "recommended_fix": "exact action to take",
  "fix_command": "kubectl/curl command if applicable",
  "confidence": "HIGH|MEDIUM|LOW",
  "user_impact": "YES|NO -- description",
  "related_pr": "PR number if relevant or null",
  "related_jira": "ticket key if relevant or null",
  "escalate_to": "null|dev-team|cloud-team",
  "sop_referenced": "SOP number or null",
  "business_impact": "plain English dollar/order impact"
}}
"""

    try:
        response = client.chat.completions.create(
            model=settings.openai_model,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1000,
        )
        diagnosis = json.loads(response.choices[0].message.content)
        return Diagnosis(**diagnosis, llm_used=True)
    except Exception as exc:
        print(f"LLM diagnosis failed: {exc}")
        return Diagnosis(overall_health="DEGRADED", root_cause="LLM unavailable", llm_used=False)


_DEDUP_KEYWORDS = {
    "high_error_rate": ("error rate",),
    "high_latency": ("latency",),
    "low_order_success": ("order success", "order"),
    "payment_failures": ("payment",),
}


async def create_snow_incident_if_needed(diagnosis: Diagnosis, incidents: list[DetectedIncident], existing_snow: list[dict]) -> dict:
    """Create a SNOW incident only if there's a real detected incident and no
    existing [AUTO] ticket for this specific incident type.

    Only considers tickets the agent itself previously created (tagged
    "[AUTO]") -- pre-existing/manually-filed SNOW tickets that happen to
    mention "error" or "latency" for unrelated reasons must never block
    creation of a genuinely new auto-detected incident.
    """
    if not incidents:
        return {}

    first_incident = incidents[0]
    keywords = _DEDUP_KEYWORDS.get(first_incident.type, ())

    for existing in existing_snow:
        desc = existing.get("short_description", "").lower()
        if desc.startswith("[auto]") and any(kw in desc for kw in keywords):
            print(f"Existing [AUTO] SNOW incident already covers '{first_incident.type}' -- skipping creation")
            return {}

    urgency = "1" if first_incident.severity == "CRITICAL" else "2"

    return await snow_client.create_incident(
        {
            "short_description": first_incident.title,
            "description": (
                f"SRE Agent Auto-Detection\n\n"
                f"Root Cause: {diagnosis.root_cause}\n\n"
                f"Evidence: {diagnosis.evidence}\n\n"
                f"Tier: {diagnosis.tier}\n"
                f"Confidence: {diagnosis.confidence}\n\n"
                f"Recommended Fix:\n{diagnosis.recommended_fix}\n\n"
                f"SOP: {diagnosis.sop_referenced}\n\n"
                f"Business Impact:\n{diagnosis.business_impact}"
            ),
            "urgency": urgency,
            "impact": urgency,
            "state": "1",
            "category": "software",
            "assignment_group": "engineering-team" if diagnosis.tier == "TIER2" else "incident-response-agent",
        }
    )


async def run() -> SREAgentResult:
    print(f"SRE Agent starting for {SERVICE_NAME}...")

    health, existing_snow, related_prs = await asyncio.gather(
        collect_health_data(),
        snow_client.get_open_incidents(SERVICE_NAME, exclude_cert_records=True),
        get_related_prs(),
    )
    related_jira = get_related_jira_tickets()

    print(f"Health collected: error_rate={health.error_rate_pct}% p99={health.p99_latency_ms}ms")
    print(f"Cross-references: {len(existing_snow)} SNOW incidents, {len(related_prs)} open PRs, {len(related_jira)} Jira tickets")

    incidents = detect_incidents(health)
    print(f"Detected {len(incidents)} incidents")

    for incident in incidents:
        incident.tier = classify_tier(incident, health, related_prs)

    diagnosis = await run_llm_diagnosis(health, incidents, existing_snow, related_prs, related_jira)

    snow_incident = {}
    if incidents:
        snow_incident = await create_snow_incident_if_needed(diagnosis, incidents, existing_snow)

    result = SREAgentResult(
        service=SERVICE_NAME,
        timestamp=health.timestamp,
        overall_health=diagnosis.overall_health,
        health_metrics=health,
        detected_incidents=incidents,
        diagnosis=diagnosis,
        existing_snow_incidents=existing_snow,
        related_prs=related_prs,
        related_jira_tickets=related_jira,
        snow_incident_created=snow_incident,
        metrics_available=health.metrics_available,
        summary=(
            f"Service: {diagnosis.overall_health}. {len(incidents)} incidents detected. "
            f"Tier: {diagnosis.tier or 'N/A'}. {diagnosis.root_cause[:80]}"
        ),
    )

    print("\nSRE Agent complete:")
    print(f"  Health: {result.overall_health}")
    print(f"  Incidents: {len(incidents)}")
    print(f"  Tier: {diagnosis.tier}")
    print(f"  Root cause: {diagnosis.root_cause[:60]}")

    return result


####################################################################
# Tier-1 auto-remediation
#
# propose_remediation() detects the issue from live pod status, fetches the
# matching SOP from the real SNOW KB (never local files), and makes ONE
# GPT-4o call to propose a single whitelisted action. It NEVER executes
# anything itself -- execute_remediation() is the only function that runs a
# real kubectl command, and only after explicit human approval, and only for
# actions on the hardcoded whitelist below.
####################################################################

# Maps live pod symptoms -> one of the 6 canonical SOP-K8S issue types (see
# snow_client._SOP_SEARCH_TERMS). Equivalent to matching keywords like
# "crashloop"/"restart"/"oomkill" against an incident description, just
# applied directly to structured kubectl data instead of free text.
_CRASH_REASONS = {"crashloopbackoff", "oomkilled", "error"}
_DEPLOY_FAILURE_REASONS = {"imagepullbackoff", "errimagepull", "createcontainerconfigerror"}


def _detect_issue_type(pod: dict) -> str:
    reason = (pod.get("status_reason") or "").lower()
    phase = (pod.get("phase") or "").lower()
    restarts = pod.get("restarts", 0)

    if reason in _CRASH_REASONS or restarts >= 3:
        return "CrashLoopBackOff"
    if reason in _DEPLOY_FAILURE_REASONS or phase == "pending":
        return "Deployment Failure"
    if phase in ("failed", "unknown"):
        return "Service Unavailable"
    return "Service Unavailable"


# Whitelist: the ONLY commands execute_remediation() will ever run. Any
# proposed_action value not in this dict (other than "escalate_no_safe_fix",
# which runs nothing) is refused outright, even if it somehow passed the
# Literal-typed schema (e.g. a hand-crafted API request).
_ACTION_COMMANDS: dict[str, list[str]] = {
    "rollout_restart": ["kubectl", "rollout", "restart", "deployment/checkout-service", "-n", "checkout-service"],
    "rollout_undo": ["kubectl", "rollout", "undo", "deployment/checkout-service", "-n", "checkout-service"],
    "increase_memory_limit": ["kubectl", "set", "resources", "deployment/checkout-service", "--limits=memory=512Mi", "-n", "checkout-service"],
}


async def _find_sop(query_text: str, fallback_issue_type: str | None = None) -> dict | None:
    """Find the best-matching SOP via real ChromaDB semantic search over the
    SNOW KB. Falls back to exact issue_type keyword lookup (snow_client.fetch_sop)
    if semantic search has nothing -- not yet synced, OPENAI_API_KEY missing,
    or no result above the similarity threshold.
    """
    semantic_results = sop_store.search_sops(query_text, n_results=1)
    if semantic_results:
        top = semantic_results[0]
        full_text = await sop_store.get_sop_full_text(top["sys_id"])
        return {
            "sop_number": top["sop_number"],
            "title": top["title"],
            "text": full_text,
            "confidence": top["confidence"],
            "similarity_score": top["similarity_score"],
        }

    if fallback_issue_type:
        sop = await snow_client.fetch_sop(fallback_issue_type)
        if sop:
            return {**sop, "confidence": "EXACT_KEYWORD_MATCH", "similarity_score": 1.0}

    return None


async def propose_remediation(pod_name: str, namespace: str = "checkout-service") -> RemediationProposal:
    """Detect the issue, fetch the matching SOP from SNOW (real semantic
    search, not local files), and produce ONE GPT-4o-reasoned fix proposal.
    Read-only -- never executes anything."""
    pod_data = k8s_client.get_pods_in_namespace(namespace)
    pod = next((p for p in pod_data.get("pods", []) if p["name"] == pod_name), None)
    if pod is None:
        raise ValueError(f"Pod '{pod_name}' not found in namespace '{namespace}'")

    issue_type = _detect_issue_type(pod)
    query_text = f"{issue_type} pod {pod.get('status_reason', '')} restarts={pod.get('restarts', 0)}"
    sop, github_status = await asyncio.gather(_find_sop(query_text, fallback_issue_type=issue_type), _tool_get_github_status())

    action_id = str(uuid.uuid4())
    sop_number = sop["sop_number"] if sop else ""
    sop_title = sop["title"] if sop else "No matching SOP found in ServiceNow KB"
    sop_confidence = sop["confidence"] if sop else ""

    if not settings.openai_api_key:
        proposal = RemediationProposal(
            action_id=action_id,
            pod_name=pod_name,
            namespace=namespace,
            issue_type=issue_type,
            sop_number=sop_number,
            sop_used=sop_title,
            sop_match_confidence=sop_confidence,
            root_cause_guess="OpenAI is not configured",
            proposed_action="escalate_no_safe_fix",
            reasoning="LLM unavailable -- cannot safely propose an automated fix without it.",
            expected_outcome="",
        )
        state.remediation_proposals[action_id] = proposal
        return proposal

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    sop_text = f"{sop_number}: {sop_title}\n\n{sop['text']}" if sop else "No matching SOP found in ServiceNow KB."
    pr_summary = "\n".join(f"  - PR #{pr['number']}: {pr['title']}" for pr in github_status["open_prs"]) or "None"
    termination_detail = k8s_client.get_pod_termination_detail(pod_name, namespace)

    prompt = f"""You are a Tier-1 SRE remediation agent for checkout-service. A pod issue was detected.

POD STATUS:
{json.dumps(pod, indent=2)}

CONTAINER TERMINATION DETAIL (the real exit reason -- trust this over guesses from PR titles):
{json.dumps(termination_detail, indent=2)}

DETECTED ISSUE TYPE: {issue_type}

MATCHING SOP FROM SERVICENOW KB:
{sop_text}

RECENT OPEN GITHUB PRs (possible related code changes -- context only, do not assume
they caused this incident unless the termination detail actually supports it):
{pr_summary}

Based on the SOP and live pod/termination data, propose ONE safe Tier-1 (infrastructure-only) remediation action.
Respond in JSON:
{{
  "root_cause_guess": "specific root cause based on the actual termination reason/exit code + SOP",
  "proposed_action": "rollout_restart" | "rollout_undo" | "increase_memory_limit" | "escalate_no_safe_fix",
  "reasoning": "why this action, citing the SOP and the live pod/termination data",
  "expected_outcome": "what should happen after this action runs"
}}

Decision rules:
- terminated.reason "OOMKilled" -> increase_memory_limit.
- terminated.reason "Error" with a low/generic exit code -> this is a config or
  command problem baked into the CURRENT deployment revision's spec, not a
  transient runtime issue. rollout_restart only recreates pods from the SAME
  spec, so it will NOT fix a bad spec -- prefer rollout_undo (roll back to the
  prior working revision) in that case, especially if restarts keep recurring
  with the identical reason/exit code every time.
- Use "escalate_no_safe_fix" if the SOP indicates a code defect, requires data
  restoration, or otherwise has no safe Tier-1 fix an infrastructure action can resolve.
"""

    try:
        response = client.chat.completions.create(
            model=settings.openai_model,
            response_format={"type": "json_object"},
            messages=[{"role": "user", "content": prompt}],
            max_tokens=600,
        )
        parsed = json.loads(response.choices[0].message.content)
        proposal = RemediationProposal(
            action_id=action_id,
            pod_name=pod_name,
            namespace=namespace,
            issue_type=issue_type,
            sop_number=sop_number,
            sop_used=sop_title,
            sop_match_confidence=sop_confidence,
            root_cause_guess=parsed.get("root_cause_guess", ""),
            proposed_action=parsed.get("proposed_action", "escalate_no_safe_fix"),
            reasoning=parsed.get("reasoning", ""),
            expected_outcome=parsed.get("expected_outcome", ""),
        )
    except Exception as exc:
        print(f"Remediation proposal LLM call failed: {exc}")
        proposal = RemediationProposal(
            action_id=action_id,
            pod_name=pod_name,
            namespace=namespace,
            issue_type=issue_type,
            sop_number=sop_number,
            sop_used=sop_title,
            sop_match_confidence=sop_confidence,
            root_cause_guess="LLM call failed",
            proposed_action="escalate_no_safe_fix",
            reasoning=f"Could not generate a sound proposal: {exc}",
            expected_outcome="",
        )

    state.remediation_proposals[action_id] = proposal
    return proposal


async def execute_remediation(action_id: str, approved: bool) -> ExecuteFixResult:
    """Execute a previously proposed remediation -- ONLY if approved=True and
    ONLY via the _ACTION_COMMANDS whitelist. Polls pod status after running
    to verify recovery."""
    proposal = state.remediation_proposals.get(action_id)
    if proposal is None:
        raise ValueError(f"No proposal found for action_id '{action_id}'")

    before = k8s_client.get_pods_in_namespace("checkout-service")
    before_pod = next((p for p in before.get("pods", []) if p["name"] == proposal.pod_name), {})

    if not approved:
        proposal.status = "rejected"
        return ExecuteFixResult(
            action_id=action_id,
            executed_command=None,
            before_status=before_pod,
            after_status=before_pod,
            success=False,
            message="Rejected by human reviewer -- no action taken.",
        )

    action = proposal.proposed_action

    if action == "escalate_no_safe_fix":
        proposal.status = "executed"
        return ExecuteFixResult(
            action_id=action_id,
            executed_command=None,
            before_status=before_pod,
            after_status=before_pod,
            success=False,
            message="No safe Tier-1 fix available -- escalated for human intervention.",
        )

    command = _ACTION_COMMANDS.get(action)
    if command is None:
        # Defense in depth: refuse anything not on the whitelist outright,
        # even if it somehow bypassed the Literal-typed schema.
        proposal.status = "rejected"
        return ExecuteFixResult(
            action_id=action_id,
            executed_command=None,
            before_status=before_pod,
            after_status=before_pod,
            success=False,
            message=f"Action '{action}' is not on the execution whitelist -- refused.",
        )

    print(f"Executing remediation: {' '.join(command)}")
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        proposal.status = "executed"
        return ExecuteFixResult(
            action_id=action_id,
            executed_command=" ".join(command),
            before_status=before_pod,
            after_status=before_pod,
            success=False,
            message=f"kubectl command failed: {result.stderr.strip()}",
        )

    # Poll up to 30s for the workload to recover: Running, fully ready, no
    # lingering crash reason. rollout_restart/rollout_undo replace the pod
    # with a new name, so match by deployment prefix and take the newest.
    after_pod = before_pod
    for _ in range(6):
        await asyncio.sleep(5)
        after = k8s_client.get_pods_in_namespace("checkout-service")
        candidates = [p for p in after.get("pods", []) if p["name"].startswith("checkout-service-")]
        if not candidates:
            continue
        after_pod = max(candidates, key=lambda p: p.get("age", ""))
        ready_num, _, ready_den = after_pod.get("ready", "0/0").partition("/")
        if after_pod.get("phase") == "Running" and ready_num == ready_den and not after_pod.get("status_reason"):
            break

    success = after_pod.get("phase") == "Running" and not after_pod.get("status_reason")
    proposal.status = "executed"

    return ExecuteFixResult(
        action_id=action_id,
        executed_command=" ".join(command),
        before_status=before_pod,
        after_status=after_pod,
        success=success,
        message="Remediation executed and pod verified Running." if success else "Remediation executed but pod did not recover within 30s -- needs manual investigation.",
    )


####################################################################
# Ask-anything Q&A tool layer
#
# In-process OpenAI function-calling tools (no separate MCP server).
# Each tool reuses the existing low-level integration clients directly
# (not the full agent pipelines, to stay read-only/fast/side-effect-free).
####################################################################

_ASK_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "query_metrics",
            "description": "Run a PromQL query against Grafana Cloud Prometheus for checkout-service metrics.",
            "parameters": {
                "type": "object",
                "properties": {
                    "promql_query": {"type": "string", "description": "A PromQL query, e.g. rate(http_requests_total{job=\"checkout-service\"}[5m])"},
                    "range": {"type": "string", "description": "'instant' for a point-in-time value, or a duration like '1h'/'6h'/'24h' for a range query.", "default": "instant"},
                },
                "required": ["promql_query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "query_logs",
            "description": "Run a LogQL query against Grafana Cloud Loki for checkout-service application logs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "loki_query": {"type": "string", "description": "A LogQL query, e.g. {job=\"checkout-service\"} |= \"error\""},
                    "range": {"type": "string", "description": "Duration to look back, e.g. '1h'/'6h'/'24h'.", "default": "1h"},
                },
                "required": ["loki_query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_pods",
            "description": "List Kubernetes pods and their status/restarts in a namespace. Common namespaces: checkout-service, production, monitoring, default.",
            "parameters": {
                "type": "object",
                "properties": {"namespace": {"type": "string", "default": "checkout-service"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_deployments",
            "description": "List Kubernetes deployments and their replica status in a namespace.",
            "parameters": {
                "type": "object",
                "properties": {"namespace": {"type": "string", "default": "checkout-service"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_orders_summary",
            "description": "Get recent order success/failure counts and rates for checkout-service (Prometheus business metrics + Loki order logs).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_jira_status",
            "description": "Get open Jira tickets for the project (key, summary, status, assignee, blocked).",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_github_status",
            "description": "Get open GitHub PRs and recent CI run status for the repo.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_snow_incidents",
            "description": "Get open ServiceNow incidents for checkout-service.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


async def _tool_query_metrics(promql_query: str, range: str = "instant") -> dict:
    if range == "instant":
        return {"result": await grafana_client.query_prometheus(promql_query)}
    return {"result": await grafana_client.query_prometheus_range(promql_query, duration=range)}


async def _tool_query_logs(loki_query: str, range: str = "1h") -> dict:
    return {"result": await loki_client.query_logs(loki_query, range=range)}


async def _tool_get_pods(namespace: str = "checkout-service") -> dict:
    return k8s_client.get_pods_in_namespace(namespace)


async def _tool_get_deployments(namespace: str = "checkout-service") -> dict:
    return k8s_client.get_deployments_in_namespace(namespace)


async def _tool_get_orders_summary() -> dict:
    order_metrics, logs = await asyncio.gather(
        grafana_client.get_order_metrics(SERVICE_NAME),
        loki_client.query_logs(f'{{job="{SERVICE_NAME}"}} | json | status="failed"', range="1h", limit=20),
    )
    return {**order_metrics, "recent_failed_order_logs": logs}


async def _tool_get_jira_status() -> dict:
    tickets = jira_client.get_open_tickets()
    return {
        "tickets": [
            {
                "key": t["key"],
                "summary": t["fields"]["summary"],
                "status": t["fields"]["status"]["name"],
                "assignee": (t["fields"].get("assignee") or {}).get("displayName"),
            }
            for t in tickets
        ]
    }


async def _tool_get_github_status() -> dict:
    prs, ci_runs = await asyncio.gather(github_client.get_open_prs(), github_client.get_recent_ci_runs())
    return {
        "open_prs": [{"number": pr["number"], "title": pr["title"], "branch": pr["head"]["ref"]} for pr in prs],
        "recent_ci_runs": ci_runs,
    }


async def _tool_get_snow_incidents() -> dict:
    return {"incidents": await snow_client.get_open_incidents(SERVICE_NAME, exclude_cert_records=True)}


_TOOL_DISPATCH = {
    "query_metrics": _tool_query_metrics,
    "query_logs": _tool_query_logs,
    "get_pods": _tool_get_pods,
    "get_deployments": _tool_get_deployments,
    "get_orders_summary": _tool_get_orders_summary,
    "get_jira_status": _tool_get_jira_status,
    "get_github_status": _tool_get_github_status,
    "get_snow_incidents": _tool_get_snow_incidents,
}


async def ask(question: str) -> AskResponse:
    """Answer a free-text question about checkout-service using GPT-4o tool calling.

    Up to 3 tool-call rounds; degrades gracefully (still answers from
    whatever data it could gather) if a tool fails or returns no data.
    """
    if not settings.openai_api_key:
        return AskResponse(answer="OpenAI is not configured, so I can't answer questions right now.", tools_used=[], raw_data={})

    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    messages = [
        {
            "role": "system",
            "content": (
                "You are OpsDNA's SRE assistant for checkout-service. Answer the user's question by "
                "calling the available tools to gather real, current data -- never guess or make up "
                "numbers. If a tool returns no data or an error, say so plainly rather than inventing "
                "an answer. Be concise and specific (cite actual numbers/names from tool results). "
                "When asked about 'errors' or 'error rate' without the user specifying a status code, "
                "query BOTH 4xx and 5xx (e.g. status_code=~\"4..|5..\") and report both -- do not check "
                "5xx alone and call it 'no errors' if 4xx traffic exists. Similarly, when checking pod "
                "health, check the namespace the user asked about; if none was specified, check both "
                "'checkout-service' and 'production' namespaces, since checkout-service workloads run "
                "in both. "
                "checkout-service logs are structured JSON with a 'level' field of INFO/WARNING/ERROR -- "
                "validation failures and business-logic failures (e.g. user not found, invalid product "
                "id) are logged at WARNING, not ERROR. When searching logs for errors/failures/issues, "
                "use a broad text filter (e.g. |~ \"(?i)warn|error|fail|invalid|not found\") rather than "
                "filtering on level=\"ERROR\" alone, or you will miss real WARNING-level failures and "
                "incorrectly report 'no errors found'."
            ),
        },
        {"role": "user", "content": question},
    ]

    tools_used: list[str] = []
    raw_data: dict = {}

    for _ in range(3):
        try:
            response = client.chat.completions.create(
                model=settings.openai_model,
                messages=messages,
                tools=_ASK_TOOLS,
                tool_choice="auto",
            )
        except Exception as exc:
            return AskResponse(answer=f"I couldn't reach the LLM to answer that: {exc}", tools_used=tools_used, raw_data=raw_data)

        message = response.choices[0].message
        if not message.tool_calls:
            return AskResponse(answer=message.content or "", tools_used=tools_used, raw_data=raw_data)

        messages.append({"role": "assistant", "content": message.content, "tool_calls": [tc.model_dump() for tc in message.tool_calls]})

        for tool_call in message.tool_calls:
            name = tool_call.function.name
            try:
                args = json.loads(tool_call.function.arguments or "{}")
            except Exception:
                args = {}

            tool_fn = _TOOL_DISPATCH.get(name)
            try:
                result = await tool_fn(**args) if tool_fn else {"error": f"unknown tool {name}"}
            except Exception as exc:
                result = {"error": str(exc)}

            tools_used.append(name)
            raw_data[name] = result
            messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": json.dumps(result, default=str)})

    # Ran out of tool-call rounds -- ask for a final answer with whatever we gathered.
    try:
        response = client.chat.completions.create(model=settings.openai_model, messages=messages)
        return AskResponse(answer=response.choices[0].message.content or "", tools_used=tools_used, raw_data=raw_data)
    except Exception as exc:
        return AskResponse(answer=f"Gathered data but couldn't produce a final answer: {exc}", tools_used=tools_used, raw_data=raw_data)


if __name__ == "__main__":
    result = asyncio.run(run())
    print("\n=== RESULT ===")
    print(
        json.dumps(
            {
                "health": result.overall_health,
                "incidents": len(result.detected_incidents),
                "tier": result.diagnosis.tier,
                "root_cause": result.diagnosis.root_cause[:100],
                "fix": result.diagnosis.recommended_fix[:100],
                "metrics_available": result.metrics_available,
            },
            indent=2,
        )
    )
