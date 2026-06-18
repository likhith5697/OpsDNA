from typing import Literal

from pydantic import BaseModel

Risk = Literal["HIGH", "MEDIUM", "LOW"]
Recommendation = Literal["MERGE_URGENT", "NEEDS_REVIEW", "CLOSE", "MONITOR"]
RepoHealth = Literal["CRITICAL", "DEGRADED", "HEALTHY", "UNKNOWN"]


class PRSignals(BaseModel):
    """Rule-based facts gathered about a PR before LLM reasoning."""

    number: int
    title: str
    body: str
    author: str
    branch: str
    created_at: str
    updated_at: str
    days_open: int
    days_since_update: int
    has_approval: bool
    review_count: int
    ci_status: str
    ci_passing: bool
    service_name: str
    jira_ticket: str
    url: str
    draft: bool
    risk_signals: list[str]
    has_risk: bool
    open_snow_incidents: list[dict] = []
    error_rate: float = 0.0


class PRAssessment(BaseModel):
    """LLM (or rule-based fallback) verdict for one PR."""

    number: int
    title: str
    url: str
    risk: Risk
    blocking_production: bool
    reason: str
    recommendation: Recommendation
    action: str
    llm_used: bool = False


class GitHubAgentResult(BaseModel):
    repo: str
    prs_scanned: int
    at_risk_prs: list[PRAssessment]
    ci_runs: list[dict]
    failing_ci_count: int
    direct_pushes: list[dict]
    direct_push_count: int
    high_risk_count: int
    blocking_production_count: int
    repo_health: RepoHealth
    repo_summary: str
    summary: str
