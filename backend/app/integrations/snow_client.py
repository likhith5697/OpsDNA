"""ServiceNow client.

Real implementation should eventually be reused by Agent 1 (SRE) and
Agent 2 (Certificate) too, per the shared-principles ("Reuse Existing") rule.

Certificate inventory is also stored here, as incident records (see
scripts/create_certs_snow.py). They are tagged via a "CERT: " short_description
prefix rather than the category field -- ServiceNow's incident.category is a
fixed choice list and silently coerces unknown values (e.g. "certificate") to
the default choice, so it can't be used to identify these records reliably.
"""

import httpx

from app.core.config import settings


def _configured() -> bool:
    return bool(settings.snow_instance and settings.snow_user and settings.snow_pass)


async def _get(path: str, params: dict) -> list[dict]:
    if not _configured():
        return []
    try:
        async with httpx.AsyncClient(
            auth=(settings.snow_user, settings.snow_pass),
            timeout=15,
        ) as client:
            resp = await client.get(
                f"https://{settings.snow_instance}{path}",
                headers={"Accept": "application/json"},
                params=params,
            )
            if resp.status_code == 200:
                return resp.json().get("result", [])
    except Exception as exc:
        print(f"SNOW query failed: {exc}")
    return []


async def _create(fields: dict) -> dict:
    if not _configured():
        return {}
    try:
        async with httpx.AsyncClient(
            auth=(settings.snow_user, settings.snow_pass),
            timeout=15,
        ) as client:
            resp = await client.post(
                f"https://{settings.snow_instance}/api/now/table/incident",
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                json=fields,
            )
            if resp.status_code in (200, 201):
                return resp.json().get("result", {})
            print(f"SNOW create failed {resp.status_code}: {resp.text[:200]}")
    except Exception as exc:
        print(f"SNOW create failed: {exc}")
    return {}


async def get_open_incidents(service_name: str | None, exclude_cert_records: bool = False) -> list[dict]:
    """Query ServiceNow for open incidents mentioning this service name.

    Returns [] if service_name is empty or SNOW is not configured.
    """
    if not service_name:
        return []
    query = f"stateIN1,2^short_descriptionLIKE{service_name}"
    if exclude_cert_records:
        query += "^short_descriptionNOT LIKECERT: "
    return await _get(
        "/api/now/table/incident",
        {
            "sysparm_query": query,
            "sysparm_fields": "number,short_description,state,priority,opened_at",
            "sysparm_limit": "5",
        },
    )


async def create_ticket(short_description: str, description: str, urgency: str) -> dict:
    """Create a SNOW incident. Returns the created ticket reference."""
    return await _create(
        {
            "short_description": short_description,
            "description": description,
            "urgency": urgency,
        }
    )


async def get_certificate_records() -> list[dict]:
    """Fetch all active certificate inventory records (short_description prefixed "CERT: ")."""
    return await _get(
        "/api/now/table/incident",
        {
            "sysparm_query": "short_descriptionSTARTSWITHCERT: ^state!=7",
            "sysparm_fields": "sys_id,number,short_description,description,priority,state,opened_at",
            "sysparm_limit": "50",
        },
    )


async def check_existing_certificate(cert_name: str) -> bool:
    """Check if a certificate inventory record already exists for this name."""
    if not cert_name:
        return False
    results = await _get(
        "/api/now/table/incident",
        {
            "sysparm_query": f"short_descriptionSTARTSWITHCERT: {cert_name}^state!=7",
            "sysparm_fields": "sys_id,number",
            "sysparm_limit": "1",
        },
    )
    return len(results) > 0


async def check_duplicate_alert_ticket(cert_name: str) -> bool:
    """Check if an alert/action ticket (short_description prefixed "[CertExpiry]") already exists for this cert."""
    if not cert_name:
        return False
    results = await _get(
        "/api/now/table/incident",
        {
            "sysparm_query": f"short_descriptionSTARTSWITH[CertExpiry]^short_descriptionLIKE{cert_name}^stateIN1,2",
            "sysparm_fields": "number",
            "sysparm_limit": "1",
        },
    )
    return len(results) > 0


async def create_certificate_record(fields: dict) -> dict:
    """Create a certificate inventory record."""
    return await _create(fields)


async def create_certificate_alert(short_description: str, description: str, urgency: str, impact: str, assignment_group: str) -> dict:
    """Create an alert/action ticket for an expiring certificate.

    Sets urgency/impact rather than priority directly -- ServiceNow usually
    derives priority from those two via a business rule, so setting priority
    on the create call gets silently overridden.
    """
    return await _create(
        {
            "short_description": short_description,
            "description": description,
            "urgency": urgency,
            "impact": impact,
            "state": "1",
            "assignment_group": assignment_group,
        }
    )
