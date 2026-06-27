import asyncio
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.agents import cert_agent, github_agent, jira_agent, sre_agent
from app.core import state
from app.integrations import grafana_client, k8s_client, sop_store
from app.schemas.cert_agent import CertAgentResult
from app.schemas.github_agent import GitHubAgentResult
from app.schemas.jira_agent import JiraAgentResult
from app.schemas.sre_agent import (
    AskRequest,
    AskResponse,
    ExecuteFixRequest,
    ExecuteFixResult,
    ProposeFixRequest,
    RemediationProposal,
    SREAgentResult,
)

app = FastAPI(title="OpsDNA")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def sync_sop_embeddings() -> None:
    """Embed the real SNOW KB SOPs into ChromaDB once at boot. Non-fatal."""
    try:
        await sop_store.sync_sops_from_snow()
    except Exception as exc:
        print(f"SOP sync failed at startup (agent will still run): {exc}")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/agents/jira/run", response_model=JiraAgentResult)
async def run_jira_agent(project_key: str | None = None, take_actions: bool = True) -> JiraAgentResult:
    state.last_jira_result = await jira_agent.run(project_key=project_key, take_actions=take_actions)
    return state.last_jira_result


@app.get("/agents/jira/results", response_model=JiraAgentResult)
def get_jira_results() -> JiraAgentResult:
    if state.last_jira_result is None:
        raise HTTPException(status_code=404, detail="Jira agent has not run yet. POST /agents/jira/run first.")
    return state.last_jira_result


@app.post("/agents/cert/run", response_model=CertAgentResult)
async def run_cert_agent() -> CertAgentResult:
    state.last_cert_result = await cert_agent.run()
    return state.last_cert_result


@app.get("/agents/cert/results", response_model=CertAgentResult)
def get_cert_results() -> CertAgentResult:
    if state.last_cert_result is None:
        raise HTTPException(status_code=404, detail="Cert agent has not run yet. POST /agents/cert/run first.")
    return state.last_cert_result


@app.post("/agents/github/run", response_model=GitHubAgentResult)
async def run_github_agent() -> GitHubAgentResult:
    state.last_github_result = await github_agent.run()
    return state.last_github_result


@app.get("/agents/github/results", response_model=GitHubAgentResult)
def get_github_results() -> GitHubAgentResult:
    if state.last_github_result is None:
        raise HTTPException(status_code=404, detail="GitHub agent has not run yet. POST /agents/github/run first.")
    return state.last_github_result


@app.post("/agents/sre/run", response_model=SREAgentResult)
async def run_sre_agent() -> SREAgentResult:
    state.last_sre_result = await sre_agent.run()
    return state.last_sre_result


@app.get("/agents/sre/results", response_model=SREAgentResult)
def get_sre_results() -> SREAgentResult:
    if state.last_sre_result is None:
        raise HTTPException(status_code=404, detail="SRE agent has not run yet. POST /agents/sre/run first.")
    return state.last_sre_result


@app.post("/agents/sre/ask", response_model=AskResponse)
async def ask_sre_agent(request: AskRequest) -> AskResponse:
    return await sre_agent.ask(request.question)


@app.post("/agents/sre/propose-fix", response_model=RemediationProposal)
async def propose_fix(request: ProposeFixRequest) -> RemediationProposal:
    try:
        return await sre_agent.propose_remediation(request.pod_name, request.namespace)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/agents/sre/execute-fix", response_model=ExecuteFixResult)
async def execute_fix(request: ExecuteFixRequest) -> ExecuteFixResult:
    try:
        return await sre_agent.execute_remediation(request.action_id, request.approved)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.get("/agents/sre/pods")
def get_sre_pods(namespace: str = "checkout-service") -> dict:
    """Raw pod list for a namespace -- used by the dashboard's pod table."""
    return k8s_client.get_pods_in_namespace(namespace)


@app.get("/agents/sre/health")
async def get_service_health() -> dict:
    """Quick health check without full diagnosis -- used for live dashboard health cards."""
    error_rate, request_rate, p99_latency = await asyncio.gather(
        grafana_client.get_error_rate(),
        grafana_client.get_request_rate(),
        grafana_client.get_p99_latency(),
    )
    return {
        "service": "checkout-service",
        "error_rate_pct": error_rate,
        "request_rate_per_min": request_rate,
        "p99_latency_ms": p99_latency,
        "healthy": error_rate < 5.0,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
