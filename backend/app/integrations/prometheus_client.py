"""Prometheus client.

Real implementation should eventually be reused by Agent 1 (SRE), per the
shared-principles ("Reuse Existing", "Dynamic Metrics = discover_metrics
(service) first") rules.
"""

import httpx

from app.core.config import settings


async def discover_metrics(service_name: str) -> list[str]:
    """Discover the metric names available for a given service (label values)."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                f"{settings.prometheus_url}/api/v1/label/__name__/values",
                params={"match[]": f'{{job="{service_name}"}}'},
            )
            if resp.status_code == 200:
                return resp.json().get("data", [])
    except Exception as exc:
        print(f"Prometheus discover_metrics failed: {exc}")
    return []


async def query_prometheus(query: str) -> dict:
    """Run a PromQL query and return the raw result."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(f"{settings.prometheus_url}/api/v1/query", params={"query": query})
            if resp.status_code == 200:
                return resp.json()
    except Exception as exc:
        print(f"Prometheus query failed: {exc}")
    return {"status": "error", "data": {"result": []}}


async def get_error_rate(service_name: str | None) -> float:
    """Query Prometheus for the current HTTP error rate (%) for a service.

    Returns 0.0 if Prometheus is not reachable or the service has no metrics.
    """
    if not service_name:
        return 0.0

    query = (
        f'rate(http_requests_total{{job="{service_name}",status_code=~"5.."}}[5m]) / '
        f'rate(http_requests_total{{job="{service_name}"}}[5m]) * 100'
    )

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(f"{settings.prometheus_url}/api/v1/query", params={"query": query})
            if resp.status_code == 200:
                results = resp.json().get("data", {}).get("result", [])
                if results:
                    val = float(results[0]["value"][1])
                    if val != val:  # NaN
                        return 0.0
                    return round(val, 2)
    except Exception as exc:
        print(f"Prometheus query failed: {exc}")

    return 0.0
