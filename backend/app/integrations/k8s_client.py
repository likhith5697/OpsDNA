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


def _kubectl_json(args: list[str]) -> dict:
    """Run a kubectl command and parse its JSON output. Returns {"error": ...} on failure."""
    try:
        result = subprocess.run(["kubectl", *args, "-o", "json"], capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            return {"error": result.stderr.strip()}
        return json.loads(result.stdout)
    except FileNotFoundError:
        return {"error": "kubectl not found"}
    except Exception as exc:
        return {"error": str(exc)}


def get_pods_in_namespace(namespace: str = "checkout-service") -> dict:
    """List all pods in a namespace with status/restarts/age. Used by the SRE ask-tool layer.

    Includes status_reason -- the container waiting/lastState-terminated
    reason (e.g. "CrashLoopBackOff", "ImagePullBackOff", "OOMKilled"). Pod
    `phase` alone is misleading for crash loops: Kubernetes reports phase as
    "Running" even mid-crash-loop, since the container has started at least
    once -- status_reason is the real signal.
    """
    data = _kubectl_json(["get", "pods", "-n", namespace])
    if "error" in data:
        return {"namespace": namespace, "pods": [], "error": data["error"]}

    pods = []
    for item in data.get("items", []):
        statuses = item.get("status", {}).get("containerStatuses", [])
        reason = None
        for cs in statuses:
            waiting = cs.get("state", {}).get("waiting")
            if waiting:
                reason = waiting.get("reason")
                break
            terminated = cs.get("lastState", {}).get("terminated")
            if terminated and not reason:
                reason = terminated.get("reason")
        pods.append(
            {
                "name": item["metadata"]["name"],
                "phase": item.get("status", {}).get("phase", "Unknown"),
                "ready": f"{sum(1 for cs in statuses if cs.get('ready'))}/{len(statuses)}",
                "restarts": sum(cs.get("restartCount", 0) for cs in statuses),
                "age": item["metadata"].get("creationTimestamp", ""),
                "status_reason": reason,
            }
        )
    return {"namespace": namespace, "pods": pods}


def get_pod_termination_detail(pod_name: str, namespace: str = "checkout-service") -> dict:
    """Fetch the last termination reason/exitCode/message for a pod's container(s).

    Used by Tier-1 remediation to ground the LLM's root-cause guess in the
    real exit reason (e.g. "Error" exitCode=1 vs "OOMKilled") rather than
    just the umbrella status_reason ("CrashLoopBackOff") -- otherwise the
    model has no way to distinguish a config/command problem from an actual
    memory issue.
    """
    data = _kubectl_json(["get", "pod", pod_name, "-n", namespace])
    if "error" in data:
        return {"error": data["error"]}

    statuses = data.get("status", {}).get("containerStatuses", [])
    details = []
    for cs in statuses:
        terminated = cs.get("lastState", {}).get("terminated") or cs.get("state", {}).get("terminated")
        if terminated:
            details.append(
                {
                    "container": cs.get("name", ""),
                    "reason": terminated.get("reason", ""),
                    "exit_code": terminated.get("exitCode"),
                    "message": terminated.get("message", ""),
                }
            )
    return {"containers": details}


def get_deployments_in_namespace(namespace: str = "checkout-service") -> dict:
    """List all deployments in a namespace with replica status. Used by the SRE ask-tool layer."""
    data = _kubectl_json(["get", "deployments", "-n", namespace])
    if "error" in data:
        return {"namespace": namespace, "deployments": [], "error": data["error"]}

    deployments = [
        {
            "name": item["metadata"]["name"],
            "ready_replicas": item.get("status", {}).get("readyReplicas", 0),
            "replicas": item.get("status", {}).get("replicas", 0),
            "updated_replicas": item.get("status", {}).get("updatedReplicas", 0),
            "available_replicas": item.get("status", {}).get("availableReplicas", 0),
        }
        for item in data.get("items", [])
    ]
    return {"namespace": namespace, "deployments": deployments}
