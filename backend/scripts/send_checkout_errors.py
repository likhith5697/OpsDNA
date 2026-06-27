"""Send 3 requests to checkout-service that are guaranteed to error.

Use this to generate real 4xx error traffic so the SRE agent's error-rate
detection has something real to find. Requires kubectl with access to the
incident-response-aks cluster -- port-forwards to the in-cluster service,
sends the requests, then tears the port-forward down.
"""

import subprocess
import sys
import time

import httpx

NAMESPACE = "checkout-service"
SERVICE = "checkout-service"
REMOTE_PORT = 8000
LOCAL_PORT = 18001
BASE_URL = f"http://127.0.0.1:{LOCAL_PORT}"

ERROR_CASES = [
    {
        "name": "unknown user (expect 404)",
        "request": lambda c: c.post(
            "/checkout",
            json={"user_id": "user_does_not_exist", "items": [{"product_id": "PROD-ABC123", "quantity": 1, "unit_price": 9.99}], "shipping_address": "x"},
        ),
    },
    {
        "name": "malformed product_id, fails regex validation (expect 422)",
        "request": lambda c: c.post(
            "/checkout",
            json={"user_id": "user_001", "items": [{"product_id": "not-a-valid-id", "quantity": 1, "unit_price": 9.99}], "shipping_address": "x"},
        ),
    },
    {
        "name": "missing required fields (expect 422)",
        "request": lambda c: c.post("/checkout", json={"user_id": "user_001"}),
    },
]


def wait_for_ready(client: httpx.Client, timeout: int = 15) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if client.get("/health").status_code == 200:
                return
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("checkout-service did not become reachable via port-forward in time")


def main() -> None:
    print(f"Port-forwarding {NAMESPACE}/svc/{SERVICE} {LOCAL_PORT}:{REMOTE_PORT}...")
    pf = subprocess.Popen(
        ["kubectl", "port-forward", "-n", NAMESPACE, f"svc/{SERVICE}", f"{LOCAL_PORT}:{REMOTE_PORT}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        with httpx.Client(base_url=BASE_URL, timeout=10) as client:
            wait_for_ready(client)
            print("Sending 3 error-triggering requests...\n")

            for i, case in enumerate(ERROR_CASES, start=1):
                resp = case["request"](client)
                print(f"  [{i}] {case['name']} -> {resp.status_code} {resp.json()}")

    finally:
        pf.terminate()
        pf.wait(timeout=5)
        print("\nPort-forward closed.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Failed: {exc}")
        sys.exit(1)
