"""Seed ServiceNow with certificate inventory records.

Stores certs as incidents tagged with a "CERT: " short_description prefix --
this is the cert inventory source of truth that app/agents/cert_agent.py
reads from.
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402

base_url = f"https://{settings.snow_instance}"
auth = (settings.snow_user, settings.snow_pass)
headers = {"Content-Type": "application/json", "Accept": "application/json"}


def days_from_now(days: int) -> str:
    dt = datetime.now(timezone.utc) + timedelta(days=days)
    return dt.strftime("%Y-%m-%d")


CERTS = [
    {
        "cert_name": "api.checkout.internal",
        "expires_in_days": 5,
        "ci_name": "checkout-service",
        "environment": "production",
        "owner_team": "platform-team",
        "auto_renewal": "false",
        "sans": "api.checkout.internal,checkout.internal",
        "description": "Payment API TLS certificate",
    },
    {
        "cert_name": "db.checkout.internal",
        "expires_in_days": 12,
        "ci_name": "checkout-service",
        "environment": "production",
        "owner_team": "platform-team",
        "auto_renewal": "false",
        "sans": "db.checkout.internal",
        "description": "Database connection TLS certificate",
    },
    {
        "cert_name": "internal.auth.service",
        "expires_in_days": 25,
        "ci_name": "auth-service",
        "environment": "production",
        "owner_team": "auth-team",
        "auto_renewal": "true",
        "sans": "internal.auth.service",
        "description": "Auth service internal certificate",
    },
    {
        "cert_name": "monitoring.internal",
        "expires_in_days": 45,
        "ci_name": "monitoring",
        "environment": "production",
        "owner_team": "sre-team",
        "auto_renewal": "true",
        "sans": "monitoring.internal,grafana.internal",
        "description": "Monitoring stack certificate",
    },
]


def check_existing_cert(cert_name: str) -> bool:
    """Check if cert already exists in SNOW.

    Identified by a "CERT: " short_description prefix, not category --
    ServiceNow's incident.category is a fixed choice list and silently
    coerces unknown values (e.g. "certificate") to the default choice.
    """
    with httpx.Client(auth=auth, headers=headers, timeout=15) as client:
        r = client.get(
            f"{base_url}/api/now/table/incident",
            params={
                "sysparm_query": f"short_descriptionSTARTSWITHCERT: {cert_name}^state!=7",
                "sysparm_limit": "1",
                "sysparm_fields": "sys_id,number",
            },
        )
        return len(r.json().get("result", [])) > 0


def create_cert_record(cert: dict) -> dict:
    """Create cert as a SNOW incident record."""
    description = (
        f"cert_name={cert['cert_name']}\n"
        f"expires_at={days_from_now(cert['expires_in_days'])}\n"
        f"ci_name={cert['ci_name']}\n"
        f"environment={cert['environment']}\n"
        f"owner_team={cert['owner_team']}\n"
        f"auto_renewal={cert['auto_renewal']}\n"
        f"sans={cert['sans']}\n"
        f"description={cert['description']}"
    )

    with httpx.Client(auth=auth, headers=headers, timeout=15) as client:
        r = client.post(
            f"{base_url}/api/now/table/incident",
            json={
                "short_description": f"CERT: {cert['cert_name']}",
                "description": description,
                "priority": "2",
                "state": "1",
                "assignment_group": cert["owner_team"],
            },
        )

    if r.status_code in (200, 201):
        return r.json()["result"]
    raise Exception(f"Failed {r.status_code}: {r.text[:200]}")


def main():
    print("Creating cert records in ServiceNow...")
    print(f"Instance: {settings.snow_instance}\n")

    created = []
    skipped = []

    for cert in CERTS:
        name = cert["cert_name"]

        if check_existing_cert(name):
            print(f"  Skipped (exists): {name}")
            skipped.append(name)
            continue

        try:
            result = create_cert_record(cert)
            print(f"  Created: {result['number']} -- {name} (expires in {cert['expires_in_days']} days)")
            created.append(result)
        except Exception as e:
            print(f"  Failed: {name} -- {e}")

    print(f"\n{'=' * 50}")
    print(f"Done: {len(created)} created, {len(skipped)} skipped")
    print("\nQuery certs via SNOW API:")
    print(f"GET {base_url}/api/now/table/incident?sysparm_query=short_descriptionSTARTSWITHCERT: ^state!=7")


if __name__ == "__main__":
    main()
