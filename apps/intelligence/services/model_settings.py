"""Team-scoped model settings: catalog, storage, and request-scoped resolution.

The model factory is called deep in the RAG stack — inside evidence retrieval,
query decomposition, the ReAct loop — where there is no user or team in scope.
Threading a team_id through every one of those layers would touch a dozen
signatures for a value none of them care about, so the active settings are
published as a context variable at the request boundary instead and read by
`build_chat_model` alone.

Only provider/model/tuning knobs live here. API keys stay in server config and
are never stored per team, never accepted from a client, and never returned by
the API — `configured_providers()` exposes which providers *have* a key, which
is all a settings UI needs to disable the ones that would fail.
"""

from __future__ import annotations

import contextvars
from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId

from core.config import settings


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------

# Suggested models per provider. Deliberately *suggestions*, not a closed
# allow-list: providers ship new model IDs constantly and a hardcoded list goes
# stale between releases, stranding a team on an old model until someone edits
# this file. The API accepts any model name the provider accepts; these are what
# the settings UI offers up front.
PROVIDER_CATALOG: Dict[str, Dict[str, Any]] = {
    "groq": {
        "label": "Groq",
        "models": [
            {"id": "openai/gpt-oss-120b", "label": "GPT-OSS 120B (reasoning)"},
            {"id": "llama-3.3-70b-versatile", "label": "Llama 3.3 70B"},
            {"id": "llama-3.2-1b-preview", "label": "Llama 3.2 1B (fast)"},
        ],
    },
    "claude": {
        "label": "Anthropic Claude",
        "models": [
            {"id": "claude-opus-5", "label": "Claude Opus 5"},
            {"id": "claude-sonnet-5", "label": "Claude Sonnet 5"},
            {"id": "claude-opus-4-8", "label": "Claude Opus 4.8"},
            {"id": "claude-haiku-4-5", "label": "Claude Haiku 4.5 (fast)"},
        ],
    },
    "openai": {
        "label": "OpenAI",
        "models": [
            {"id": "gpt-4o", "label": "GPT-4o"},
            {"id": "gpt-4o-mini", "label": "GPT-4o mini (fast)"},
        ],
    },
    "gemini": {
        "label": "Google Gemini",
        "models": [
            {"id": "gemini-2.0-flash", "label": "Gemini 2.0 Flash"},
            {"id": "gemini-2.0-flash-lite", "label": "Gemini 2.0 Flash Lite (fast)"},
        ],
    },
}

# Which engine turns an uploaded PDF into the markdown everything else reads.
# This is a closed list, unlike PROVIDER_CATALOG: each entry needs its own code
# path in the ingestion worker, so an unrecognised name has nothing to run.
PARSER_CATALOG: Dict[str, Dict[str, Any]] = {
    "liteparse": {
        "label": "LiteParse",
        "description": (
            "Runs locally, no per-document cost, roughly instant. Weaker on layout: "
            "tables sharing column positions can be merged into one, and multi-column "
            "blocks such as signature panels may be flattened."
        ),
        "requires_key": False,
    },
    "marker": {
        "label": "Marker",
        "description": (
            "External API. Stronger table and layout detection — keeps neighbouring "
            "tables apart, preserves merged cells and reading order. Adds roughly "
            "10-35 seconds per document, most of it queue rather than compute."
        ),
        "requires_key": True,
    },
}

def default_parser() -> str:
    """The engine to use when an account has not chosen one.

    Marker when it is configured, because the local parser measurably loses
    tables on real contracts: on the AHM 810 corpus it found 19 of 40, fusing
    neighbouring tables into one grid, while reporting a healthy quality score
    — the text is fine, it is the structure that is wrong. A knowledge base
    built on half the tables is confidently incomplete, which is worse than
    slow.

    Falls back to the local parser with no key, so a deployment that has not
    configured Marker never sends contract text anywhere by default.
    """
    return "marker" if _parser_configured("marker") else "liteparse"

REASONING_EFFORTS = ["auto", "low", "medium", "high"]

# Bounds mirror what the providers accept; the API validates against these so a
# malformed settings write can't produce a request that 400s at generation time.
TEMPERATURE_RANGE = (0.0, 1.0)
MAX_TOKENS_RANGE = (256, 128000)


def _api_key_configured(provider: str) -> bool:
    if provider == "openai":
        return bool((getattr(settings, "openai_api_key", "") or "").strip())
    if provider == "claude":
        return bool((getattr(settings, "anthropic_api_key", "") or "").strip())
    if provider == "gemini":
        return bool((getattr(settings, "gemini_api_key", "") or "").strip())
    return bool((getattr(settings, "groq_api_key", "") or "").strip())


def configured_providers() -> Dict[str, bool]:
    """Which providers have a server-side key. Booleans only — never the keys."""
    return {provider: _api_key_configured(provider) for provider in PROVIDER_CATALOG}


def _parser_configured(parser: str) -> bool:
    if not PARSER_CATALOG.get(parser, {}).get("requires_key"):
        return True
    return bool((getattr(settings, "marker_api_key", "") or "").strip())


def configured_parsers() -> Dict[str, bool]:
    """Which extraction engines are usable on this deployment."""
    return {parser: _parser_configured(parser) for parser in PARSER_CATALOG}


def resolve_parser(values: Optional[Dict[str, Any]]) -> str:
    """The engine to parse with, falling back whenever the choice is unusable.

    Ingestion must not fail because a team selected an engine whose key was
    later removed, so an unconfigured or unknown choice degrades to the default
    rather than raising.
    """
    chosen = str((values or {}).get("parser") or "").strip().lower()
    if chosen in PARSER_CATALOG and _parser_configured(chosen):
        return chosen
    return default_parser()


# ---------------------------------------------------------------------------
# Request-scoped active settings
# ---------------------------------------------------------------------------

_active_model_settings: contextvars.ContextVar[Optional[Dict[str, Any]]] = contextvars.ContextVar(
    "active_model_settings", default=None
)


def active_model_settings() -> Optional[Dict[str, Any]]:
    """The settings published for the current request, or None to use env."""
    return _active_model_settings.get()


def set_active_model_settings(values: Optional[Dict[str, Any]]):
    """Publish settings for this request. Returns the token to reset with.

    contextvars are per-task, so a value set here is visible to everything
    downstream in the same request (including anything awaited) and invisible to
    other concurrent requests — which a module-level global would not be.
    """
    return _active_model_settings.set(values or None)


def reset_active_model_settings(token) -> None:
    _active_model_settings.reset(token)


class use_model_settings:
    """Context manager form, so the reset can't be skipped on an error path."""

    def __init__(self, values: Optional[Dict[str, Any]]):
        self._values = values
        self._token = None

    def __enter__(self):
        self._token = set_active_model_settings(self._values)
        return self._values

    def __exit__(self, *_exc):
        if self._token is not None:
            reset_active_model_settings(self._token)
        return False


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _sanitize(values: Dict[str, Any]) -> Dict[str, Any]:
    """Keep only known keys, coerced and clamped.

    Applied on both read and write: a document stored before a field was added
    (or hand-edited in the database) must not be able to push an out-of-range
    value into a provider request.
    """
    clean: Dict[str, Any] = {}

    provider = str(values.get("provider") or "").strip().lower()
    if provider in PROVIDER_CATALOG:
        clean["provider"] = provider

    models = values.get("models")
    if isinstance(models, dict):
        picked = {
            key: str(name).strip()[:200]
            for key, name in models.items()
            if key in PROVIDER_CATALOG and str(name or "").strip()
        }
        if picked:
            clean["models"] = picked

    if values.get("temperature") is not None:
        try:
            low, high = TEMPERATURE_RANGE
            clean["temperature"] = min(max(float(values["temperature"]), low), high)
        except (TypeError, ValueError):
            pass

    if values.get("max_tokens") is not None:
        try:
            low, high = MAX_TOKENS_RANGE
            clean["max_tokens"] = min(max(int(values["max_tokens"]), low), high)
        except (TypeError, ValueError):
            pass

    effort = str(values.get("reasoning_effort") or "").strip().lower()
    if effort in REASONING_EFFORTS:
        clean["reasoning_effort"] = effort

    parser = str(values.get("parser") or "").strip().lower()
    if parser in PARSER_CATALOG:
        clean["parser"] = parser

    return clean


class ModelSettingsManager:
    """Reads and writes the per-team model settings document."""

    def __init__(self, mongo_db):
        self.teams = mongo_db["teams"]

    def get_for_team(self, team_id: str) -> Dict[str, Any]:
        try:
            oid = ObjectId(team_id)
        except Exception:
            return {}
        team = self.teams.find_one({"_id": oid}, {"model_settings": 1}) or {}
        return _sanitize(team.get("model_settings") or {})

    def save_for_team(self, team_id: str, values: Dict[str, Any]) -> Dict[str, Any]:
        clean = _sanitize(values)
        self.teams.update_one(
            {"_id": ObjectId(team_id)},
            {"$set": {"model_settings": clean, "model_settings_updated_at": datetime.utcnow()}},
        )
        return clean


def resolve_for_team(mongo_db, team_id: Optional[str]) -> Dict[str, Any]:
    """Team settings if any, else `{}` meaning "fall back to env everywhere"."""
    if not team_id:
        return {}
    try:
        return ModelSettingsManager(mongo_db).get_for_team(team_id)
    except Exception:
        # Settings are an override, not a dependency — a lookup failure must
        # degrade to the env defaults rather than fail the request.
        return {}


def team_id_for_user(current_user) -> Optional[str]:
    """The account whose model settings apply to this user's requests."""
    team_id = getattr(current_user, "ownedAccountId", None) or next(
        iter(getattr(current_user, "teamIds", None) or []), None
    )
    return str(team_id) if team_id else None


def catalog_payload() -> Dict[str, Any]:
    """Everything a settings UI needs to render, minus anything secret."""
    configured = configured_providers()
    parsers = configured_parsers()
    return {
        "providers": [
            {
                "id": provider,
                "label": entry["label"],
                "models": entry["models"],
                "configured": configured.get(provider, False),
            }
            for provider, entry in PROVIDER_CATALOG.items()
        ],
        "parsers": [
            {
                "id": parser,
                "label": entry["label"],
                "description": entry["description"],
                "configured": parsers.get(parser, False),
            }
            for parser, entry in PARSER_CATALOG.items()
        ],
        "default_parser": default_parser(),
        "reasoning_efforts": REASONING_EFFORTS,
        "temperature_range": list(TEMPERATURE_RANGE),
        "max_tokens_range": list(MAX_TOKENS_RANGE),
    }
