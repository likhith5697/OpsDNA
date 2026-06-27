from typing import Literal

from pydantic import BaseModel, ConfigDict

OverallHealth = Literal["CRITICAL", "DEGRADED", "HEALTHY"]
Tier = Literal["TIER1", "TIER1.5", "TIER2"]


class HealthMetrics(BaseModel):
    service: str
    timestamp: str
    error_rate_pct: float
    request_rate_per_min: float
    p99_latency_ms: float
    orders_per_min: float
    order_success_rate_pct: float
    active_orders: int
    payment_failures_per_min: float
    metrics_available: bool


class DetectedIncident(BaseModel):
    type: str
    severity: Literal["CRITICAL", "HIGH"]
    title: str
    value: float
    threshold: float
    sop: str
    tier: Tier = "TIER1"


class Diagnosis(BaseModel):
    model_config = ConfigDict(extra="ignore")

    overall_health: OverallHealth = "HEALTHY"
    root_cause: str = ""
    evidence: str = ""
    tier: Tier | None = None
    tier_reason: str = ""
    recommended_fix: str = ""
    fix_command: str = ""
    confidence: str = ""
    user_impact: str = ""
    related_pr: str | None = None
    related_jira: str | None = None
    escalate_to: str | None = None
    sop_referenced: str | None = None
    business_impact: str = ""
    llm_used: bool = False


class SREAgentResult(BaseModel):
    service: str
    timestamp: str
    overall_health: OverallHealth
    health_metrics: HealthMetrics
    detected_incidents: list[DetectedIncident]
    diagnosis: Diagnosis
    existing_snow_incidents: list[dict]
    related_prs: list[dict]
    related_jira_tickets: list[dict]
    snow_incident_created: dict
    metrics_available: bool
    summary: str


class AskRequest(BaseModel):
    question: str


class AskResponse(BaseModel):
    answer: str
    tools_used: list[str]
    raw_data: dict


ProposedAction = Literal["rollout_restart", "rollout_undo", "increase_memory_limit", "escalate_no_safe_fix"]
ProposalStatus = Literal["proposed", "approved", "rejected", "executed"]


class RemediationProposal(BaseModel):
    """Tier-1 auto-remediation proposal. Never auto-executed -- requires
    explicit human approval via POST /agents/sre/execute-fix."""

    action_id: str
    pod_name: str
    namespace: str
    issue_type: str
    sop_number: str
    sop_used: str
    sop_match_confidence: str = ""
    root_cause_guess: str
    proposed_action: ProposedAction
    reasoning: str
    expected_outcome: str
    status: ProposalStatus = "proposed"


class ProposeFixRequest(BaseModel):
    pod_name: str
    namespace: str = "checkout-service"


class ExecuteFixRequest(BaseModel):
    action_id: str
    approved: bool


class ExecuteFixResult(BaseModel):
    action_id: str
    executed_command: str | None
    before_status: dict
    after_status: dict
    success: bool
    message: str = ""
