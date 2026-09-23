"""The platform org's AI settings, applied to ContractSense's model calls.

An org's admin chooses models per tier and may bring their own keys in the
platform's Admin → AI; the lifecycle API resolves (org, tier) to a provider,
model and key at POST /api/internal/ai/resolve, applying BYOK and the daily
cost cap. draftLegal's agent routes already asked it. ContractSense's own
calls — obligation extraction, Q&A, retrieval helpers — did not: they used
this tier's env key and default provider, so the setting an admin changed had
no effect on extraction, and a BYOK org was billed to the platform key.

`build_chat_model` now asks here first whenever a platform org is in scope.
The org is published the same way team settings are (a context variable),
by the request dependency for users and by the worker for a linked contract.

Failure policy:
  • cost cap reached  → raise; the caller must not spend the platform key the
    cap just declined
  • API unreachable, org unknown, no provider → None; the caller falls back to
    this tier's env configuration, as before
"""
from __future__ import annotations

import contextvars
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# The platform's tiers, and which one each model-factory purpose uses.
PURPOSE_TIER: Dict[str, str] = {"chat": "default", "classify": "default", "light": "fast"}
CACHE_SECONDS = 30.0

_active_org: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("active_platform_org", default=None)


class PlatformCostCapExceeded(RuntimeError):
    """The org's daily AI spend cap refused the call."""


@dataclass(frozen=True)
class PlatformModel:
    provider: str
    model: str
    api_key: str
    source: str  # "byok" | "platform"
    tier: str


def active_platform_org() -> Optional[str]:
    return _active_org.get()


class use_platform_org:
    """Publish the platform org for everything downstream in this context."""

    def __init__(self, org_id: Optional[str]):
        self._org_id = org_id or None
        self._token = None

    def __enter__(self):
        self._token = _active_org.set(self._org_id)
        return self._org_id

    def __exit__(self, *_exc):
        if self._token is not None:
            try:
                _active_org.reset(self._token)
            except ValueError:
                pass  # reset from another context (threadpool copy); nothing leaks
        return False


_cache: Dict[Tuple[str, str], Tuple[float, Optional[PlatformModel]]] = {}
_cache_lock = threading.Lock()
_last_logged: Dict[Tuple[str, str], Tuple[str, str, str]] = {}


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
        _last_logged.clear()


def resolve_platform_model(org_id: Optional[str], tier: str, *, post=None) -> Optional[PlatformModel]:
    """The org's (provider, model, key) for `tier`, or None to use env config.

    Cached for CACHE_SECONDS per (org, tier): an extraction run makes hundreds
    of calls and must not make hundreds of resolves, and a settings change is
    picked up within the window. The key is held in memory only, never logged.
    """
    if not org_id:
        return None
    api_url = (os.getenv("API_URL") or "").rstrip("/")
    secret = os.getenv("INTERNAL_SERVICE_SECRET") or ""
    if not api_url or not secret:
        return None

    now = time.monotonic()
    key = (org_id, tier)
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]

    if post is None:
        import httpx

        post = httpx.post
    try:
        response = post(
            f"{api_url}/api/internal/ai/resolve",
            json={"orgId": org_id, "tier": tier},
            headers={"x-internal-secret": secret},
            timeout=5.0,
        )
    except Exception as exc:
        logger.warning("[platform-models] resolve failed for org=%s tier=%s: %s", org_id, tier, exc)
        return None

    status = getattr(response, "status_code", 500)
    if status == 429:
        raise PlatformCostCapExceeded("The organisation's daily AI spend cap has been reached.")
    resolved: Optional[PlatformModel] = None
    if status < 300:
        try:
            data = response.json()
            resolved = PlatformModel(
                provider=str(data["provider"]), model=str(data["model"]), api_key=str(data["apiKey"]),
                source=str(data.get("source") or "platform"), tier=tier,
            )
        except Exception as exc:
            logger.warning("[platform-models] unreadable resolve response for org=%s: %s", org_id, exc)
    elif status != 503:
        # 503 is the router's "no provider for this tier": expected on a
        # no-key install, and the env fallback decides what happens next.
        logger.warning("[platform-models] resolve refused for org=%s tier=%s (%s)", org_id, tier, status)

    with _cache_lock:
        _cache[key] = (now, resolved)
        if resolved is not None:
            # One line whenever the effective model for an org changes: the
            # behavioural check for "change the setting, see it in the logs".
            shown = (resolved.provider, resolved.model, resolved.source)
            if _last_logged.get(key) != shown:
                _last_logged[key] = shown
                logger.info("[platform-models] org=%s tier=%s → %s/%s (%s)", org_id, tier, *shown)
    return resolved
