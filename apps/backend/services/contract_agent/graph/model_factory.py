"""Model factory — builds a LangChain chat model from the configured provider.

Extracted from react_runtime.py so providers can be added / removed / tuned
in a single place without touching the runtime loop.

Features enabled per provider
──────────────────────────────
• Claude   – streaming, stream_usage, thinking/effort (model-aware), temperature=1
             when thinking is on (Anthropic requirement)
• OpenAI   – streaming, stream_usage (token-level usage in chunks), reasoning_effort
             for o-series models
• Gemini   – streaming, thinking_budget / thinking_level (model-aware), include_thoughts
• Groq     – streaming, reasoning_effort + reasoning_format (gpt-oss models only)
"""

from __future__ import annotations

import re
from typing import Any, Dict, Optional

from core.config import settings

from .state import AgentRunState


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_chat_model(state: AgentRunState, *, task_type: str = "default") -> Any:
    """Build a LangChain chat model based on the configured provider."""
    provider = _normalize_provider_name(
        state.ai_provider or getattr(settings, "ai_provider", None) or "groq"
    )
    temperature = float(getattr(settings, "temperature", 0.1) or 0.1)
    max_tokens = int(getattr(settings, "max_tokens", 2048) or 2048)

    if provider == "gemini":
        return _build_gemini(temperature, max_tokens)
    if provider == "openai":
        return _build_openai(state, temperature, max_tokens, task_type)
    if provider == "claude":
        return _build_claude(temperature, max_tokens)

    # Default: Groq
    return _build_groq(state, temperature, max_tokens, task_type)


# ---------------------------------------------------------------------------
# Provider builders
# ---------------------------------------------------------------------------

def _build_claude(temperature: float, max_tokens: int) -> Any:
    """Build ChatAnthropic with streaming, stream_usage, and thinking.

    Thinking / effort behaviour (from Anthropic docs):
    • Claude 3.x (e.g. claude-3-7-sonnet) → thinking={"type":"enabled","budget_tokens":N}
      temperature MUST be 1.0 when thinking is enabled.
    • Claude Opus 4.6 / 4.5 → effort via output_config (max/high/medium/low).
    • Claude Opus 4.7+       → effort="xhigh" in output_config; budget_tokens removed.
    We detect the model family from the name and route accordingly.
    """
    from langchain_anthropic import ChatAnthropic

    model_name: str = (
        getattr(settings, "anthropic_model_name", None)
        or getattr(settings, "claude_model_name", None)
        or "claude-sonnet-4-6"
    )

    thinking_enabled: bool = bool(getattr(settings, "claude_thinking_enabled", True))
    thinking_budget: int = int(getattr(settings, "claude_thinking_budget", 5000) or 5000)
    effort_level: str = str(getattr(settings, "claude_effort_level", "medium") or "medium")

    model_family = _claude_model_family(model_name)

    kwargs: Dict[str, Any] = dict(
        model=model_name,
        api_key=getattr(settings, "anthropic_api_key", None),
        max_tokens=max_tokens,
        # Token-level usage included in streaming chunks
        stream_usage=True,
    )

    if thinking_enabled:
        if model_family == "claude3":
            # temperature must be 1.0 when thinking is on (Anthropic requirement)
            kwargs["temperature"] = 1.0
            kwargs["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
        elif model_family in {"opus46", "opus45"}:
            # Effort API — Opus 4.6 supports "max"; 4.5 supports up to "high"
            max_effort = "max" if model_family == "opus46" else "high"
            resolved = effort_level if effort_level in {"low", "medium", "high", "max"} else "medium"
            if resolved == "max" and model_family != "opus46":
                resolved = "high"
            kwargs["temperature"] = temperature
            kwargs["output_config"] = {"effort": resolved}
        elif model_family == "opus47":
            # Opus 4.7+ uses adaptive thinking + xhigh effort
            kwargs["temperature"] = temperature
            kwargs["thinking"] = {"type": "adaptive"}
            kwargs["output_config"] = {"effort": "xhigh"}
        else:
            # Unknown / future model — use effort-style as safe default
            kwargs["temperature"] = temperature
            kwargs["output_config"] = {"effort": effort_level}
    else:
        kwargs["temperature"] = temperature

    return ChatAnthropic(**kwargs)


def _build_openai(
    state: AgentRunState, temperature: float, max_tokens: int, task_type: str
) -> Any:
    """Build ChatOpenAI with streaming, stream_usage, and reasoning_effort for o-series."""
    from langchain_openai import ChatOpenAI

    model_name: str = getattr(settings, "openai_model_name", None) or "gpt-4o-mini"

    kwargs: Dict[str, Any] = dict(
        model=model_name,
        api_key=getattr(settings, "openai_api_key", None),
        temperature=temperature,
        max_tokens=max_tokens,
        # Enable token-level streaming + per-chunk usage metadata
        streaming=True,
        stream_usage=True,
    )

    # reasoning_effort is only valid for o-series models (o1, o3, o4-mini, …)
    reasoning_effort = _openai_reasoning_effort(state.message, task_type=task_type, model_name=model_name)
    if reasoning_effort:
        kwargs["reasoning_effort"] = reasoning_effort

    return ChatOpenAI(**kwargs)


def _build_gemini(temperature: float, max_tokens: int) -> Any:
    """Build ChatGoogleGenerativeAI with streaming and thinking config.

    Thinking behaviour (from Google / LangChain docs):
    • Gemini 2.5 models  → thinking_budget (int, 0 = off, -1 = dynamic)
    • Gemini 3+ models   → thinking_level ("low" | "medium" | "high")
    Set include_thoughts=True to surface reasoning in the response.
    """
    from langchain_google_genai import ChatGoogleGenerativeAI

    model_name: str = getattr(settings, "gemini_model_name", None) or "gemini-2.0-flash"
    thinking_enabled: bool = bool(getattr(settings, "gemini_thinking_enabled", True))
    thinking_budget: int = int(getattr(settings, "gemini_thinking_budget", 1024) or 1024)
    thinking_level: str = str(getattr(settings, "gemini_thinking_level", "medium") or "medium")
    include_thoughts: bool = bool(getattr(settings, "gemini_include_thoughts", False))

    kwargs: Dict[str, Any] = dict(
        model=model_name,
        google_api_key=getattr(settings, "gemini_api_key", None),
        temperature=temperature,
        max_output_tokens=max_tokens,
        # Token-level streaming
        streaming=True,
    )

    if thinking_enabled:
        gemini_gen = _gemini_generation(model_name)
        if gemini_gen == "3plus":
            # Gemini 3+ uses thinking_level
            kwargs["thinking_level"] = thinking_level
            kwargs["include_thoughts"] = include_thoughts
        else:
            # Gemini 2.5 uses thinking_budget (-1 = dynamic, 0 = off)
            kwargs["thinking_budget"] = thinking_budget
            kwargs["include_thoughts"] = include_thoughts

    return ChatGoogleGenerativeAI(**kwargs)


def _build_groq(
    state: AgentRunState, temperature: float, max_tokens: int, task_type: str
) -> Any:
    """Build ChatGroq with streaming and conditional reasoning for gpt-oss models."""
    from langchain_groq import ChatGroq

    model_name: str = getattr(settings, "model_name", None) or "llama-3.3-70b-versatile"
    is_reasoning_model = "gpt-oss" in str(model_name).lower()

    kwargs: Dict[str, Any] = dict(
        model=model_name,
        groq_api_key=getattr(settings, "groq_api_key", None),
        temperature=temperature,
        max_tokens=max_tokens,
        # Token-level streaming
        streaming=True,
    )

    if is_reasoning_model:
        # reasoning_format and reasoning_effort only apply to gpt-oss variants
        kwargs["reasoning_format"] = "parsed"
        reasoning_effort = _groq_reasoning_effort(
            state.message, task_type=task_type, model_name=model_name
        )
        if reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort

    return ChatGroq(**kwargs)


# ---------------------------------------------------------------------------
# Provider / model detection helpers
# ---------------------------------------------------------------------------

def _normalize_provider_name(provider: Any) -> str:
    value = str(provider or "").strip().lower().replace("-", "_")
    if not value:
        return ""
    if "gemini" in value or "google_genai" in value or value in {"google", "genai"}:
        return "gemini"
    if value in {"openai", "gpt"} or value.startswith("gpt_"):
        return "openai"
    if value in {"anthropic", "claude"}:
        return "claude"
    return value


def _claude_model_family(model_name: str) -> str:
    """Detect Claude generation/variant from model name string.

    Returns one of: "claude3", "opus45", "opus46", "opus47", "unknown".
    """
    name = model_name.lower()
    if "opus-4-7" in name or "opus-4.7" in name:
        return "opus47"
    if "opus-4-6" in name or "opus-4.6" in name or "opus-4-20" in name:
        return "opus46"
    if "opus-4-5" in name or "opus-4.5" in name:
        return "opus45"
    if re.search(r"claude[-_]3", name):
        return "claude3"
    return "unknown"


def _gemini_generation(model_name: str) -> str:
    """Return 'gemini25' for 2.5 models, '3plus' for Gemini 3+, else 'other'."""
    name = model_name.lower()
    if re.search(r"gemini[-_]?3", name):
        return "3plus"
    if re.search(r"gemini[-_]?2\.5", name) or "2-5" in name:
        return "gemini25"
    return "other"


# ---------------------------------------------------------------------------
# Reasoning effort helpers
# ---------------------------------------------------------------------------

_COMPLEX_TERMS = frozenset({
    "compare", "comparison", "across", "risk", "extract", "kpi", "sla",
    "table", "tabular", "governing law", "change of control", "ip ownership",
    "liquidated damages", "assignment", "termination", "indemnification",
})


def _groq_reasoning_effort(
    message: str, *, task_type: str, model_name: str
) -> Optional[str]:
    """Return a Groq reasoning_effort value for gpt-oss models only."""
    if "gpt-oss" not in str(model_name or "").lower():
        return None

    configured = str(
        getattr(settings, "groq_reasoning_effort", "auto") or ""
    ).strip().lower()

    if configured in {"", "none", "off", "disabled", "false"}:
        return None
    if configured in {"low", "medium", "high"}:
        return configured
    if configured != "auto":
        return "medium"

    # "auto" → infer from message complexity
    normalized = f"{task_type or ''} {message or ''}".lower()
    return "high" if any(term in normalized for term in _COMPLEX_TERMS) else "medium"


def _openai_reasoning_effort(
    message: str, *, task_type: str, model_name: str
) -> Optional[str]:
    """Return reasoning_effort for OpenAI o-series models (o1, o3, o4-mini, …)."""
    name = str(model_name or "").lower()
    # Only o-series models support reasoning_effort
    if not re.search(r"\bo[134]", name):
        return None

    configured = str(
        getattr(settings, "openai_reasoning_effort", "auto") or ""
    ).strip().lower()

    if configured in {"", "none", "off", "disabled", "false"}:
        return None
    if configured in {"low", "medium", "high"}:
        return configured
    if configured != "auto":
        return "medium"

    normalized = f"{task_type or ''} {message or ''}".lower()
    return "high" if any(term in normalized for term in _COMPLEX_TERMS) else "medium"