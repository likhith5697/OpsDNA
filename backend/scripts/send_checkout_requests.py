"""Send 4 successful checkout requests to the real checkout-service in AKS.

Use this to generate real traffic/metrics (request rate, p99 latency, order
counts) so the SRE agent has live data to report on. Requires kubectl with
access to the incident-response-aks cluster -- this script port-forwards to
the in-cluster service itself, sends the requests, then tears the
port-forward down.
"""

import subprocess
import sys
import time

import httpx

NAMESPACE = "checkout-service"
SERVICE = "checkout-service"
REMOTE_PORT = 8000
LOCAL_PORT = 18000
BASE_URL = f"http://127.0.0.1:{LOCAL_PORT}"

# Known-good seed data (from GET /orders on the live service).
REQUESTS = [
    {"user_id": "user_001", "items": [{"product_id": "PROD-ABC123", "quantity": 2, "unit_price": 19.99}], "shipping_address": "123 Main St"},
    {"user_id": "user_002", "items": [{"product_id": "PROD-DEF456", "quantity": 1, "unit_price": 49.5}], "shipping_address": "456 Oak Ave"},
    {"user_id": "user_003", "items": [{"product_id": "PROD-GHI012", "quantity": 3, "unit_price": 12.75}], "shipping_address": "789 Pine Rd"},
    {"user_id": "user_001", "items": [{"product_id": "PROD-XYZ789", "quantity": 1, "unit_price": 99.99}], "shipping_address": "123 Main St", "payment_method": "card", "coupon_code": "SAVE10"},
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
            print("Sending 4 successful checkout requests...\n")

            for i, payload in enumerate(REQUESTS, start=1):
                resp = client.post("/checkout", json=payload)
                print(f"  [{i}] POST /checkout -> {resp.status_code} {resp.json()}")

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
