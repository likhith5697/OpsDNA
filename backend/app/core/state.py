"""In-memory cache of each agent's last run result.

Shared by app/main.py (for the /results endpoints) and by agents that
cross-reference each other's findings (e.g. the SRE agent reads the Jira
agent's last result to correlate at-risk tickets with live incidents).
"""

from app.schemas.cert_agent import CertAgentResult
from app.schemas.github_agent import GitHubAgentResult
from app.schemas.jira_agent import JiraAgentResult
from app.schemas.sre_agent import RemediationProposal, SREAgentResult

last_jira_result: JiraAgentResult | None = None
last_cert_result: CertAgentResult | None = None
last_github_result: GitHubAgentResult | None = None
last_sre_result: SREAgentResult | None = None

# Tier-1 auto-remediation proposals, keyed by action_id. In-memory only --
# lost on backend restart, which is fine since proposals are short-lived
# (propose -> human approves/rejects -> execute, all within one session).
remediation_proposals: dict[str, RemediationProposal] = {}
