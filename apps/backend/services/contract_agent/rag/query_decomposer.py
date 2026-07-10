"""Optional query decomposition for complex multi-facet contract questions.

Config-gated via QUERY_DECOMPOSITION_ENABLED. Uses each provider's lightweight
LangChain chat model with a structured Pydantic output to break a compound
question into focused sub-queries retrieved independently.

Provider → lightweight model mapping:
  groq   → llama-3.2-1b-preview
  gemini → gemini-2.0-flash-lite
  claude → claude-haiku-4-5
  openai → gpt-4o-mini
"""

from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

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


# ---------------------------------------------------------------------------
# Structured output schema
# ---------------------------------------------------------------------------


class SubQueryList(BaseModel):
    """Structured output for query decomposition."""

    sub_queries: List[str] = Field(
        description=(
            "2–4 focused search queries that can each be answered independently "
            "from contract text. Each sub-query targets ONE specific aspect "
            "(obligation, payment, deadline, termination, liability, rate, "
            "definition, etc.)."
        ),
        min_length=1,
        max_length=5,
    )


# ---------------------------------------------------------------------------
# Complexity heuristic
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# LangChain model factory for lightweight models
# ---------------------------------------------------------------------------


def _build_lightweight_llm(provider: str) -> Optional[object]:
    """Build a LangChain chat model using the lightweight variant for the provider."""
    provider = (provider or "groq").lower()
    model_name = _LIGHTWEIGHT_MODELS.get(provider, "llama-3.2-1b-preview")

    try:
        if provider == "groq":
            if not settings.groq_api_key:
                return None
            from langchain_groq import ChatGroq  # type: ignore[import]

            return ChatGroq(
                model=model_name,
                api_key=settings.groq_api_key,
                temperature=0.0,
                max_tokens=256,
            )

        if provider == "openai":
            if not settings.openai_api_key:
                return None
            from langchain_openai import ChatOpenAI  # type: ignore[import]

            return ChatOpenAI(
                model=model_name,
                api_key=settings.openai_api_key or "",
                temperature=0.0,
                max_tokens=256,
            )

        if provider == "claude":
            if not getattr(settings, "anthropic_api_key", None):
                return None
            from langchain_anthropic import ChatAnthropic  # type: ignore[import]

            return ChatAnthropic(
                model=model_name,
                api_key=getattr(settings, "anthropic_api_key", "") or "",
                temperature=0.0,
                max_tokens=256,
            )

        if provider == "gemini":
            if not getattr(settings, "gemini_api_key", None):
                return None
            from langchain_google_genai import ChatGoogleGenerativeAI  # type: ignore[import]

            return ChatGoogleGenerativeAI(
                model=model_name,
                google_api_key=getattr(settings, "gemini_api_key", "") or "",
                temperature=0.0,
            )

    except Exception as exc:
        logger.debug("Could not build lightweight LLM for %s: %s", provider, exc)

    return None


# ---------------------------------------------------------------------------
# Core decomposition function
# ---------------------------------------------------------------------------


def decompose_query(
    query: str,
    provider: str = "groq",
    max_subqueries: Optional[int] = None,
) -> List[str]:
    """Decompose a complex query into focused sub-queries using a structured LLM output.

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
        f"Question: {query}"
    )

    provider = (provider or "groq").lower()
    llm = _build_lightweight_llm(provider)
    if llm is None:
        logger.debug("No lightweight LLM available for %s; using original query.", provider)
        return [query]

    try:
        from langchain_core.messages import HumanMessage  # type: ignore[import]

        structured = llm.with_structured_output(SubQueryList, method="json_schema")
        result: SubQueryList = structured.invoke([HumanMessage(content=prompt)])
        sub_queries = result.sub_queries
    except Exception as exc:
        logger.debug("Structured decomposition LLM call failed; using original query: %s", exc)
        return [query]

    if not sub_queries:
        return [query]

    # Filter and deduplicate
    clean: List[str] = []
    seen: set[str] = set()
    for sq in sub_queries:
        sq = re.sub(r"\s+", " ", sq).strip().rstrip(".")
        if len(sq) < 8 or sq.lower() in seen:
            continue
        seen.add(sq.lower())
        clean.append(sq)
        if len(clean) >= max_subs:
            break

    return clean if clean else [query]
