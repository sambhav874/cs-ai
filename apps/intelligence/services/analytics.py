import logging
import re
from typing import Any, Optional

import requests

from core.config import settings

logger = logging.getLogger(__name__)

_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9._-]{6,128}$")


def _clean_client_id(client_id: Optional[str]) -> Optional[str]:
    if not client_id:
        return None

    client_id = client_id.strip()
    if _CLIENT_ID_RE.match(client_id):
        return client_id

    return None


def track_ga_event(
    event_name: str,
    *,
    client_id: Optional[str],
    user_id: Optional[str] = None,
    params: Optional[dict[str, Any]] = None,
) -> None:
    """Send a GA4 Measurement Protocol event without exposing the API secret client-side."""
    measurement_id = settings.ga_measurement_id
    api_secret = settings.ga_api_secret
    cleaned_client_id = _clean_client_id(client_id)

    if not measurement_id or not api_secret or not cleaned_client_id:
        return

    payload: dict[str, Any] = {
        "client_id": cleaned_client_id,
        "events": [
            {
                "name": event_name,
                "params": params or {},
            }
        ],
    }

    if user_id:
        payload["user_id"] = user_id

    try:
        requests.post(
            "https://www.google-analytics.com/mp/collect",
            params={"measurement_id": measurement_id, "api_secret": api_secret},
            json=payload,
            timeout=2,
        )
    except requests.RequestException as exc:
        logger.warning("Failed to send GA4 event %s: %s", event_name, exc)
