"""Optional query decomposition for complex multi-facet questions.

Config-gated via QUERY_DECOMPOSITION_ENABLED. Uses each provider's lightweight
model to break a compound question into focused sub-queries, which are then
retrieved independently.

Provider → lightweight model mapping:
  groq   → llama-3.2-1b-preview
  gemini → gemini-2.0-flash-lite
  claude → claude-haiku-4-5
  openai → gpt-4o-mini
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, Dict, List, Optional

from core.config import settings

logger = logging.getLogger(__name__)

__all__ = ["decompose_query", "is_complex_query"]

# ---------------------------------------------------------------------------
# Provider → lightweight model mapping
# ---------------------------------------------------------------------------
_LIGHTWEIGHT_MODELS: Dict[str, str] = {
    "groq": "llama-3.2-1b-preview",
    "gemini": "gemini-2.0-flash-lite",
    "claude": "claude-haiku-4-5",
    "openai": "gpt-4o-mini",
}

# Thresholds for when decomposition is worth the extra LLM call
_MIN_COMPLEX_WORDS = 12
_MAX_SIMPLE_SUBQUERIES = 5


def is_complex_query(query: str) -> bool:
    """Heuristic: is this query multi-faceted enough to benefit from decomposition?"""
    normalized = (query or "").strip().lower()
    word_count = len(normalized.split())
    if word_count < _MIN_COMPLEX_WORDS:
        return False
    conjunction_indicators = (
        " and ",
        " also ",
        " compare",
        " across ",
        " between ",
        " each contract",
        " all contract",
        " multiple",
        " versus ",
        " vs ",
    )
    return any(indicator in normalized for indicator in conjunction_indicators)


def _call_lightweight_model(
    provider: str,
    api_key: Optional[str],
    prompt: str,
    max_tokens: int = 256,
) -> Optional[str]:
    """Call the lightweight model for the given provider.

    Returns the text content on success, None on failure.
    """
    import requests

    provider = (provider or "groq").lower()

    if provider == "groq":
        if not settings.groq_api_key:
            return None
        resp = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.groq_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _LIGHTWEIGHT_MODELS.get(provider, "llama-3.2-1b-preview"),
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0,
                "max_completion_tokens": max_tokens,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    if provider == "gemini":
        if not settings.gemini_api_key:
            return None
        model = _LIGHTWEIGHT_MODELS.get(provider, "gemini-2.0-flash-lite")
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}"
            f":generateContent?key={settings.gemini_api_key}"
        )
        resp = requests.post(
            url,
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0},
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        parts = (resp.json().get("candidates", [{}])[0].get("content", {}).get("parts") or [])
        return parts[0].get("text", "") if parts else ""

    if provider == "claude":
        if not getattr(settings, "anthropic_api_key", None):
            return None
        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": getattr(settings, "anthropic_api_key", ""),
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": _LIGHTWEIGHT_MODELS.get(provider, "claude-haiku-4-5"),
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0,
                "max_tokens": max_tokens,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        blocks = resp.json().get("content") or []
        return "".join(block.get("text", "") for block in blocks if block.get("type") == "text")

    if provider == "openai":
        if not settings.openai_api_key:
            return None
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openai_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": _LIGHTWEIGHT_MODELS.get(provider, "gpt-4o-mini"),
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0,
                "max_tokens": max_tokens,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    return None


def _extract_json_array(text: str) -> Optional[List[str]]:
    """Extract a JSON array of strings from model output."""
    text = (text or "").strip()

    # Direct JSON parse
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(item) for item in parsed if str(item).strip()]
    except json.JSONDecodeError:
        pass

    # Code block
    match = re.search(r"```(?:json)?\s*(\[[\s\S]*?\])\s*```", text)
    if match:
        try:
            return [str(item) for item in json.loads(match.group(1))]
        except json.JSONDecodeError:
            pass

    # Bare array
    match = re.search(r"\[([\s\S]*?)\]", text)
    if match:
        try:
            return [str(item) for item in json.loads(match.group(0))]
        except json.JSONDecodeError:
            pass

    return None


def decompose_query(
    query: str,
    provider: str = "groq",
    max_subqueries: Optional[int] = None,
) -> List[str]:
    """Decompose a complex query into focused sub-queries.

    Returns the original query unchanged if decomposition fails or is not needed.
    """
    if not getattr(settings, "query_decomposition_enabled", False):
        return [query]

    if not is_complex_query(query):
        return [query]

    max_subs = min(
        max_subqueries or getattr(settings, "query_decomposition_max_subqueries", 4),
        _MAX_SIMPLE_SUBQUERIES,
    )

    prompt = (
        "Break this contract analysis question into 2-4 focused search queries "
        "that can be answered independently from contract text. Each sub-query "
        "should target ONE specific aspect (obligation, payment, deadline, "
        "termination, liability, rate, definition, etc.).\n\n"
        f"Question: {query}\n\n"
        "Return ONLY a JSON array of strings, like: [\"subquery 1\", \"subquery 2\"]"
    )

    provider = (provider or "groq").lower()
    try:
        response = _call_lightweight_model(provider, None, prompt)
    except Exception:
        logger.debug("Query decomposition LLM call failed; using original query.")
        return [query]

    if not response:
        return [query]

    sub_queries = _extract_json_array(response)
    if not sub_queries:
        return [query]

    # Filter and deduplicate
    clean = []
    seen = set()
    for sq in sub_queries:
        sq = re.sub(r"\s+", " ", sq).strip().rstrip(".")
        if len(sq) < 8 or sq.lower() in seen:
            continue
        seen.add(sq.lower())
        clean.append(sq)
        if len(clean) >= max_subs:
            break

    return clean if clean else [query]
