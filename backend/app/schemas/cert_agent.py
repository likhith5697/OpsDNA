from typing import Literal

from pydantic import BaseModel

Urgency = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW"]


class CertSignals(BaseModel):
    """Parsed cert record plus rule-based facts, before LLM reasoning."""

    snow_number: str
    snow_sys_id: str
    cert_name: str
    expires_at: str
    days_left: int
    urgency: Urgency
    ci_name: str
    environment: str
    owner_team: str
    auto_renewal: bool
    sans: list[str]
    description: str
    open_snow_incidents: list[dict] = []
    error_rate: float = 0.0
    duplicate_ticket_exists: bool = False


class CertAssessment(BaseModel):
    """LLM (or rule-based fallback) verdict for one certificate."""

    cert_name: str
    days_left: int
    urgency: Urgency
    skip_ticket: bool = False
    business_impact: str = ""
    blast_radius: str = ""
    recommended_action: str = ""
    notify: str = ""
    llm_used: bool = False
    alert_ticket: str | None = None

    # Carried through from CertSignals for UI display.
    expires_at: str = ""
    ci_name: str = ""
    owner_team: str = ""
    sans: list[str] = []


class CertAgentResult(BaseModel):
    certs_scanned: int
    expiring_soon: list[CertAssessment]
    tickets_created: list[str]
    critical_count: int
    high_count: int
    summary: str
