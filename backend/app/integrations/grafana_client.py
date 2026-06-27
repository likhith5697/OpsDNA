"""Grafana Cloud Prometheus client.

Queries metrics directly from Grafana Cloud's hosted query API over HTTPS --
used by the SRE agent to monitor checkout-service. Metrics are scraped and
pushed into Grafana Cloud by an agent running in the AKS cluster itself, not
by anything in this repo; this client only ever reads, never pushes.
"""

import asyncio
import time

import httpx

from app.core.config import settings


def _configured() -> bool:
    return bool(settings.grafana_cloud_username and settings.grafana_cloud_api_key)


async def query_prometheus(query: str) -> list[dict]:
    """Run an instant PromQL query against Grafana Cloud. Returns [] on failure."""
    if not _configured():
        return []
    try:
        async with httpx.AsyncClient(
            auth=(settings.grafana_cloud_username, settings.grafana_cloud_api_key),
            timeout=15,
        ) as client:
            resp = await client.get(f"{settings.grafana_cloud_prom_url}/api/v1/query", params={"query": query})
            resp.raise_for_status()
            return resp.json().get("data", {}).get("result", [])
    except Exception as exc:
        print(f"Grafana Cloud query failed: {exc}")
        return []


async def query_prometheus_range(query: str, duration: str = "1h", step: str = "5m") -> list[dict]:
    """Run a range PromQL query. duration: '30m', '1h', '2h', '6h', '12h', '24h'."""
    if not _configured():
        return []
    duration_map = {"30m": 1800, "1h": 3600, "2h": 7200, "6h": 21600, "12h": 43200, "24h": 86400}
    seconds = duration_map.get(duration, 3600)
    end = time.time()
    start = end - seconds

    try:
        async with httpx.AsyncClient(
            auth=(settings.grafana_cloud_username, settings.grafana_cloud_api_key),
            timeout=15,
        ) as client:
            resp = await client.get(
                f"{settings.grafana_cloud_prom_url}/api/v1/query_range",
                params={"query": query, "start": start, "end": end, "step": step},
            )
            resp.raise_for_status()
            return resp.json().get("data", {}).get("result", [])
    except Exception as exc:
        print(f"Grafana Cloud range query failed: {exc}")
        return []


def _extract_value(results: list[dict]) -> float:
    if results:
        try:
            val = float(results[0]["value"][1])
            return 0.0 if val != val else val  # NaN check
        except Exception:
            pass
    return 0.0


async def get_error_rate(service: str = "checkout-service") -> float:
    """Current HTTP error rate % for a service.

    http_requests_total has separate series per endpoint/method/status_code,
    so both sides must be sum()'d -- otherwise this divides two arbitrary
    per-endpoint series against each other instead of true totals.
    """
    results = await query_prometheus(
        f'sum(rate(http_requests_total{{job="{service}",status_code=~"4..|5.."}}[5m])) / '
        f'sum(rate(http_requests_total{{job="{service}"}}[5m])) * 100'
    )
    return round(_extract_value(results), 2)


async def get_request_rate(service: str = "checkout-service") -> float:
    """Current requests per minute, summed across all endpoints/status codes."""
    results = await query_prometheus(f'sum(rate(http_requests_total{{job="{service}"}}[1m])) * 60')
    return round(_extract_value(results), 1)


async def get_p99_latency(service: str = "checkout-service") -> float:
    """P99 latency in milliseconds, aggregated across endpoints (grouped by le)."""
    results = await query_prometheus(
        f'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{{job="{service}"}}[5m])) by (le)) * 1000'
    )
    return round(_extract_value(results), 1)


async def get_order_metrics(service: str = "checkout-service") -> dict:
    """Business metrics for checkout-service."""
    # checkout_orders_total has a "status" label (success/failed) -- sum() is
    # required to collapse both series into one combined rate, otherwise the
    # query returns two separate per-status series and _extract_value()
    # silently picks whichever one happens to come first.
    success_results, total_results, active_results, failure_results = await asyncio.gather(
        query_prometheus(f'sum(rate(checkout_orders_total{{job="{service}",status="success"}}[5m])) * 60'),
        query_prometheus(f'sum(rate(checkout_orders_total{{job="{service}"}}[5m])) * 60'),
        query_prometheus(f'checkout_active_orders{{job="{service}"}}'),
        query_prometheus(f'sum(rate(payment_failures_total{{job="{service}"}}[5m])) * 60'),
    )

    success_rate = _extract_value(success_results)
    total_rate = _extract_value(total_results)
    active_orders = _extract_value(active_results)
    payment_failures = _extract_value(failure_results)

    order_success_pct = round(success_rate / total_rate * 100, 1) if total_rate > 0 else 0.0

    return {
        "orders_per_min": round(total_rate, 1),
        "order_success_rate_pct": order_success_pct,
        "active_orders": int(active_orders),
        "payment_failures_per_min": round(payment_failures, 2),
    }


async def discover_metrics(service: str = "checkout-service") -> list[str]:
    """Discover all metric names for a service, excluding standard runtime metrics."""
    if not _configured():
        return []
    try:
        async with httpx.AsyncClient(
            auth=(settings.grafana_cloud_username, settings.grafana_cloud_api_key),
            timeout=15,
        ) as client:
            resp = await client.get(f"{settings.grafana_cloud_prom_url}/api/v1/series", params={"match[]": f'{{job="{service}"}}'})
            resp.raise_for_status()
            data = resp.json().get("data", [])
            excluded_prefixes = ("go_", "process_", "promhttp_", "up", "scrape_")
            return sorted({m["__name__"] for m in data if not m["__name__"].startswith(excluded_prefixes)})
    except Exception as exc:
        print(f"Metric discovery failed: {exc}")
        return []
