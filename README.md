# OpsDNA

An operations dashboard that connects Jira, GitHub, Kubernetes, ServiceNow, and Grafana/Prometheus behind four GPT-4o-powered agents, so a checkout-service incident, a stale PR, an expiring certificate, and a stuck Jira ticket can be reasoned about as one story instead of five separate dashboards.

## Why

A backlog ticket, a restarting pod, and an expiring certificate can be the same problem viewed from three different tools — and none of those tools know they're connected. OpsDNA's agents each pull from the system they own, enrich their findings with the other systems' data, and use one LLM call to reason about urgency and impact.

## Architecture

```
frontend/   React + TypeScript + Tailwind dashboard (Vite)
backend/    FastAPI service exposing 4 agents over REST
  app/agents/        agent pipelines (one LLM call each, rule-based pre-filtering)
  app/integrations/  REST clients for Jira, GitHub, Kubernetes, ServiceNow, Grafana/Prometheus/Loki
  app/schemas/       Pydantic response models
  app/core/          settings, in-memory state
  scripts/           demo helpers to simulate incidents against a local cluster
```

Agents call Jira/GitHub/Kubernetes/ServiceNow/Grafana through plain REST clients (`httpx`) and OpenAI function-calling — there are no separate MCP servers in this build.

## The Agents

| Agent | File | What it does |
|---|---|---|
| **SRE Agent** | `agents/sre_agent.py` | Monitors checkout-service via Grafana Cloud metrics, detects incidents, classifies severity, correlates with GitHub PRs and Jira tickets, and proposes a fix. Never executes against the cluster without human approval (`propose-fix` / `execute-fix`). |
| **Certificate Agent** | `agents/cert_agent.py` | Pulls certificate records from ServiceNow, flags ones expiring within a threshold, enriches with ServiceNow/Prometheus context, and opens SNOW alert tickets for at-risk certs. |
| **Jira Agent** | `agents/jira_agent.py` | Finds open tickets that are stale, blocked, unassigned, or overdue, maps them to a service, enriches with ServiceNow/Kubernetes/Prometheus signals, and re-prioritizes or comments on the ticket. |
| **GitHub Agent** | `agents/github_agent.py` | Scans open PRs, recent CI runs, and direct pushes to main for risk signals, enriches with ServiceNow/Prometheus data, and surfaces at-risk PRs. |

Each pipeline is: fetch → rule-based pre-filter → enrich from other integrations → one LLM call for reasoning → structured result for the dashboard. The frontend composes all four agents' results into one "unified summary" view — there's no separate backend orchestrator endpoint.

Remediation is backed by a real SOP store (`integrations/sop_store.py`): ServiceNow KB articles are embedded into a local ChromaDB collection on startup, so a free-text incident description matches the closest runbook even without exact keyword overlap.

## Tech Stack

- **Backend:** FastAPI, OpenAI GPT-4o (function-calling), ChromaDB, httpx
- **Frontend:** React, TypeScript, Tailwind, Vite, WebSockets
- **Integrations:** Jira Cloud API, GitHub REST API, Kubernetes API, ServiceNow, Grafana Cloud (Prometheus + Loki)

## Running locally

Requires Docker, a kubeconfig pointed at the cluster you want the SRE agent to read, and API credentials for the integrations you want enabled (all are optional except OpenAI — agents degrade gracefully when an integration isn't configured).

```bash
cp backend/.env.example backend/.env
# fill in JIRA_*, OPENAI_API_KEY, SNOW_*, GITHUB_TOKEN, GRAFANA_CLOUD_*, etc.

docker compose up --build
```

- Backend: http://localhost:8000 (docs at `/docs`)
- Frontend: http://localhost:5173

`backend/scripts/` contains helpers (`break_checkout_pod.sh`, `send_checkout_errors.py`, `create_certs_snow.py`, ...) to simulate an incident end-to-end against a demo `checkout-service` deployment.

## API

| Endpoint | Description |
|---|---|
| `GET /health` | Service health |
| `POST/GET /agents/jira/run`, `/agents/jira/results` | Run / fetch Jira agent |
| `POST/GET /agents/cert/run`, `/agents/cert/results` | Run / fetch Certificate agent |
| `POST/GET /agents/github/run`, `/agents/github/results` | Run / fetch GitHub agent |
| `POST/GET /agents/sre/run`, `/agents/sre/results` | Run / fetch SRE agent |
| `POST /agents/sre/ask` | Ask the SRE agent a free-text question (tool-calling) |
| `POST /agents/sre/propose-fix` | Get a proposed remediation for an incident |
| `POST /agents/sre/execute-fix` | Execute an approved remediation |
| `GET /agents/sre/pods`, `/agents/sre/health` | Live pod / health snapshot |

## Status

Built over two weekends as a working prototype, not a production system. The four agents and their integrations are real and run against a live demo cluster; cross-agent orchestration currently happens in the frontend rather than a dedicated backend workflow engine.
