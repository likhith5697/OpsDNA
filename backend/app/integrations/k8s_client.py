"""Kubernetes client (shells out to kubectl).

Real implementation should eventually be reused by Agent 1 (SRE), per the
shared-principles ("Reuse Existing") rule.
"""

import json
import subprocess

from app.core.config import settings


def get_pods(service_name: str | None) -> dict:
    """Check live pod status for this service.

    Returns a dict with a `healthy` bool and the matching pod list. Returns
    a safe default ({"healthy": None, "pods": []}) if kubectl fails or no
    matching pods are found.
    """
    if not service_name:
        return {"healthy": None, "pods": []}

    try:
        result = subprocess.run(
            ["kubectl", "get", "pods", "-n", settings.k8s_namespace, "-o", "json"],
            capture_output=True,
            text=True,
            timeout=10,
        )

        if result.returncode != 0:
            return {"healthy": None, "pods": [], "error": result.stderr.strip()}

        data = json.loads(result.stdout)

        service_short = service_name.replace("-service", "")
        matching = []

        for item in data.get("items", []):
            pod_name = item["metadata"]["name"]
            if service_short in pod_name or service_name in pod_name:
                phase = item.get("status", {}).get("phase", "Unknown")
                restarts = sum(cs.get("restartCount", 0) for cs in item.get("status", {}).get("containerStatuses", []))
                matching.append(
                    {
                        "name": pod_name,
                        "phase": phase,
                        "restarts": restarts,
                        "ready": phase == "Running" and restarts == 0,
                    }
                )

        if not matching:
            return {"healthy": None, "pods": []}

        all_running = all(p["phase"] == "Running" for p in matching)
        any_restarts = any(p["restarts"] > 0 for p in matching)

        return {
            "healthy": all_running and not any_restarts,
            "pods": matching,
            "total": len(matching),
            "running": sum(1 for p in matching if p["phase"] == "Running"),
        }

    except FileNotFoundError:
        return {"healthy": None, "pods": [], "error": "kubectl not found"}
    except Exception as exc:
        return {"healthy": None, "pods": [], "error": str(exc)}
