"""Plain-function Jira REST API client (Jira Cloud API v3). No MCP."""

import httpx

from app.core.config import settings

_FIELDS = [
    "summary",
    "status",
    "assignee",
    "created",
    "updated",
    "duedate",
    "priority",
    "labels",
    "components",
    "issuelinks",
]


def _client() -> httpx.Client:
    return httpx.Client(
        base_url=settings.jira_base_url,
        auth=(settings.jira_email, settings.jira_api_token),
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        timeout=30.0,
    )


def get_open_tickets(project_key: str | None = None) -> list[dict]:
    """Fetch open (not Done/Closed/Resolved) tickets for a project via JQL search."""
    project_key = project_key or settings.jira_project_key
    jql = f'project = "{project_key}" AND statusCategory != Done ORDER BY updated ASC'
    issues: list[dict] = []
    next_page_token: str | None = None
    with _client() as client:
        while True:
            body = {"jql": jql, "fields": _FIELDS, "maxResults": 50}
            if next_page_token:
                body["nextPageToken"] = next_page_token
            resp = client.post("/rest/api/3/search/jql", json=body)
            resp.raise_for_status()
            data = resp.json()
            issues.extend(data.get("issues", []))
            next_page_token = data.get("nextPageToken")
            if not next_page_token or not data.get("issues"):
                break
    return issues


def get_issue(issue_key: str) -> dict:
    with _client() as client:
        resp = client.get(f"/rest/api/3/issue/{issue_key}", params={"fields": ",".join(_FIELDS)})
        resp.raise_for_status()
        return resp.json()


def update_priority(issue_key: str, priority_name: str) -> None:
    with _client() as client:
        resp = client.put(
            f"/rest/api/3/issue/{issue_key}",
            json={"fields": {"priority": {"name": priority_name}}},
        )
        resp.raise_for_status()


def add_comment(issue_key: str, body: str) -> None:
    with _client() as client:
        resp = client.post(
            f"/rest/api/3/issue/{issue_key}/comment",
            json={
                "body": {
                    "type": "doc",
                    "version": 1,
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": body}],
                        }
                    ],
                }
            },
        )
        resp.raise_for_status()
