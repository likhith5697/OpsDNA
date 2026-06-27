from typing import Literal

from pydantic import BaseModel

RiskLevel = Literal["HIGH", "MEDIUM", "LOW"]
Recommendation = Literal["ESCALATE", "DESCOPE", "REASSIGN", "MONITOR"]


class TicketSignals(BaseModel):
    """Rule-based facts gathered about a ticket before LLM reasoning."""

    key: str
    summary: str
    status: str
    assignee: str | None
    priority: str | None
    created: str
    updated: str
    due_date: str | None
    days_open: int
    days_since_update: int
    is_unassigned: bool
    is_blocked: bool
    is_stuck: bool
    is_overdue: bool
    service_name: str | None
    open_snow_incidents: list[dict]
    pod_health: dict
    error_rate: float = 0.0


class TicketRisk(BaseModel):
    """LLM (or rule-based fallback) verdict for one ticket."""

    key: str
    service_name: str | None = None
    risk_level: RiskLevel
    reasons: list[str]
    recommendation: Recommendation
    causing_live_impact: bool = False
    llm_used: bool = False

    # Carried through from TicketSignals for UI display (not used in risk reasoning itself).
    summary: str = ""
    status: str = ""
    days_open: int = 0
    is_unassigned: bool = False
    is_blocked: bool = False
    open_snow_incidents: list[dict] = []
    error_rate: float = 0.0


class ActionTaken(BaseModel):
    key: str
    action: str
    detail: str


class JiraAgentResult(BaseModel):
    project_key: str
    tickets_scanned: int
    at_risk_tickets: list[TicketRisk]
    actions_taken: list[ActionTaken]
