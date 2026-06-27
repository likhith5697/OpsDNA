"""Grafana Cloud Loki client.

Queries logs pushed to Grafana Cloud Loki -- used by the SRE agent's ask
tool layer to inspect application logs (order_id, status, failure_reason).
"""

import time

import httpx

from app.core.config import settings

_DURATION_SECONDS = {"30m": 1800, "1h": 3600, "2h": 7200, "6h": 21600, "12h": 43200, "24h": 86400}


def _configured() -> bool:
    return bool(settings.grafana_loki_url and settings.grafana_loki_username and settings.grafana_cloud_api_key)


async def query_logs(loki_query: str, range: str = "1h", limit: int = 100) -> list[dict]:
    """Run a LogQL range query against Grafana Cloud Loki. Returns [] on failure or if not configured."""
    if not _configured():
        return []

    seconds = _DURATION_SECONDS.get(range, 3600)
    end_ns = int(time.time() * 1e9)
    start_ns = end_ns - int(seconds * 1e9)

    try:
        async with httpx.AsyncClient(
            auth=(settings.grafana_loki_username, settings.grafana_cloud_api_key),
            timeout=15,
        ) as client:
            resp = await client.get(
                f"{settings.grafana_loki_url}/loki/api/v1/query_range",
                params={"query": loki_query, "start": start_ns, "end": end_ns, "limit": limit},
            )
            resp.raise_for_status()
            streams = resp.json().get("data", {}).get("result", [])
            entries = []
            for stream in streams:
                for ts, line in stream.get("values", []):
                    entries.append({"timestamp": ts, "line": line, "labels": stream.get("stream", {})})
            return entries
    except Exception as exc:
        print(f"Loki query failed: {exc}")
        return []
