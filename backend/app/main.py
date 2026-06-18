from fastapi import FastAPI, HTTPException

from app.agents import cert_agent, github_agent, jira_agent
from app.schemas.cert_agent import CertAgentResult
from app.schemas.github_agent import GitHubAgentResult
from app.schemas.jira_agent import JiraAgentResult

app = FastAPI(title="OpsDNA")

_last_cert_result: CertAgentResult | None = None
_last_github_result: GitHubAgentResult | None = None


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/agents/jira/run", response_model=JiraAgentResult)
async def run_jira_agent(project_key: str | None = None, take_actions: bool = True) -> JiraAgentResult:
    return await jira_agent.run(project_key=project_key, take_actions=take_actions)


@app.post("/agents/cert/run", response_model=CertAgentResult)
async def run_cert_agent() -> CertAgentResult:
    global _last_cert_result
    _last_cert_result = await cert_agent.run()
    return _last_cert_result


@app.get("/agents/cert/results", response_model=CertAgentResult)
def get_cert_results() -> CertAgentResult:
    if _last_cert_result is None:
        raise HTTPException(status_code=404, detail="Cert agent has not run yet. POST /agents/cert/run first.")
    return _last_cert_result


@app.post("/agents/github/run", response_model=GitHubAgentResult)
async def run_github_agent() -> GitHubAgentResult:
    global _last_github_result
    _last_github_result = await github_agent.run()
    return _last_github_result


@app.get("/agents/github/results", response_model=GitHubAgentResult)
def get_github_results() -> GitHubAgentResult:
    if _last_github_result is None:
        raise HTTPException(status_code=404, detail="GitHub agent has not run yet. POST /agents/github/run first.")
    return _last_github_result
