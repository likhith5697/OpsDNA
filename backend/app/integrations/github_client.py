"""Plain-function GitHub REST API client (api.github.com). No MCP."""

from datetime import datetime, timedelta, timezone

import httpx

from app.core.config import settings


def _configured() -> bool:
    return bool(settings.github_token and settings.github_owner)


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.github_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


async def _get(path: str, params: dict | None = None) -> dict | list:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"https://api.github.com/repos/{settings.github_owner}/{settings.github_repo}{path}",
                headers=_headers(),
                params=params or {},
            )
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        print(f"GitHub query failed: {exc}")
        return []


async def get_open_prs() -> list[dict]:
    """Fetch all open PRs for the repo. Returns [] if not configured or on failure."""
    if not _configured():
        return []
    result = await _get("/pulls", {"state": "open", "per_page": 50, "sort": "created", "direction": "asc"})
    return result if isinstance(result, list) else []


async def get_pr_reviews(pr_number: int) -> list[dict]:
    """Fetch reviews for a specific PR."""
    result = await _get(f"/pulls/{pr_number}/reviews")
    return result if isinstance(result, list) else []


async def get_pr_ci_status(sha: str) -> str:
    """Get CI status for a commit SHA: success/failure/pending/unknown."""
    result = await _get(f"/commits/{sha}/check-runs")
    runs = result.get("check_runs", []) if isinstance(result, dict) else []
    if not runs:
        return "unknown"

    statuses = [run.get("conclusion") or run.get("status", "") for run in runs]
    if any(s == "failure" for s in statuses):
        return "failure"
    if all(s == "success" for s in statuses):
        return "success"
    if any(s in ("in_progress", "queued") for s in statuses):
        return "pending"
    return "unknown"


async def get_recent_ci_runs(branch: str = "main") -> list[dict]:
    """Fetch recent CI workflow runs on a branch."""
    if not _configured():
        return []
    result = await _get("/actions/runs", {"branch": branch, "per_page": 10})
    runs = result.get("workflow_runs", []) if isinstance(result, dict) else []

    return [
        {
            "id": run["id"],
            "name": run["name"],
            "status": run["status"],
            "conclusion": run.get("conclusion", ""),
            "branch": run["head_branch"],
            "commit_message": (run.get("head_commit") or {}).get("message", "")[:100],
            "created_at": run["created_at"],
            "url": run["html_url"],
            "failing": run.get("conclusion") == "failure",
        }
        for run in runs
    ]


async def get_direct_pushes(days_back: int = 7) -> list[dict]:
    """Detect commits pushed directly to main without going through a PR merge."""
    if not _configured():
        return []
    since = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
    result = await _get("/commits", {"sha": "main", "since": since, "per_page": 20})
    commits = result if isinstance(result, list) else []

    direct_pushes = []
    for commit in commits:
        msg = commit["commit"]["message"][:100]
        is_merge = msg.startswith("Merge pull request") or msg.startswith("Merge branch")
        if not is_merge:
            direct_pushes.append(
                {
                    "sha": commit["sha"][:7],
                    "message": msg,
                    "author": commit["commit"]["author"]["name"],
                    "date": commit["commit"]["author"]["date"],
                    "url": commit["html_url"],
                }
            )
    return direct_pushes
