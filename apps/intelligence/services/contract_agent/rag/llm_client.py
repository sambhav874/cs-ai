"""Structured model client wrapper for contract-agent calls.

Uses proper LangChain chat-model clients with Pydantic v2 structured outputs
instead of raw HTTP requests. Each provider is wired to its LangChain package:

  groq   → langchain_groq.ChatGroq
  openai → langchain_openai.ChatOpenAI
  claude → langchain_anthropic.ChatAnthropic
  gemini → langchain_google_genai.ChatGoogleGenerativeAI

Structured outputs use .with_structured_output(PydanticModel) so schema
validation is handled by LangChain + Pydantic, not manual JSON parsing.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from core.config import settings
from utils.text_cleanup import clean_text_encoding

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pydantic schemas for structured outputs
# ---------------------------------------------------------------------------


class ToolActionArgs(BaseModel):
    """Arguments passed to a contract agent tool."""

    query: Optional[str] = Field(default=None)
    limit: Optional[int] = Field(default=None)
    segment_ids: Optional[List[str]] = Field(default=None)
    text: Optional[str] = Field(default=None)


class ToolActionResponse(BaseModel):
    """Structured tool-action decision from the agent."""

    thought: str = Field(description="The agent's reasoning before choosing the tool.")
    tool: Literal[
        "list_documents",
        "outline_document",
        "search_evidence",
        "get_kpi_context",
        "calculate_from_evidence",
        "final_answer",
    ] = Field(description="The tool to invoke next.")
    args: ToolActionArgs = Field(default_factory=ToolActionArgs)


class CitationItem(BaseModel):
    """A single evidence citation in the final answer."""

    ref: int = Field(description="1-based citation reference number.")
    quote: str = Field(description="Verbatim quote from the contract.")
    page: int = Field(description="Page number where the quote appears.")


class FinalAnswerResponse(BaseModel):
    """Structured final answer returned to the user."""

    answer: str = Field(description="The complete answer in markdown.")
    confidence: Literal["high", "medium", "low"] = Field(
        description="Confidence level based on evidence quality."
    )
    tools_called: List[str] = Field(
        default_factory=list,
        description="Names of tools called during this reasoning chain.",
    )
    citations: List[CitationItem] = Field(
        default_factory=list,
        description="Evidence citations supporting the answer.",
    )


# ---------------------------------------------------------------------------
# Provider factory helpers
# ---------------------------------------------------------------------------


def _build_chat_model(provider: str, *, temperature: float = 0.0) -> Any:
    """Return a LangChain chat model for the given provider.

    Thin shim over the shared factory — imported lazily because
    services.contract_agent.graph pulls in the runner, which reaches back into
    this package.
    """
    from services.contract_agent.graph.model_factory import build_chat_model

    return build_chat_model(provider=provider, purpose="chat", temperature=temperature)


# ---------------------------------------------------------------------------
# Plain-text client (used for free-form markdown answers)
# ---------------------------------------------------------------------------


class ProviderLLMClient:
    """Provider-specific LangChain chat client for plain markdown responses."""

    def __init__(self, owner: Any):
        self.owner = owner
        self.logger = getattr(owner, "logger", None) or logger

    @property
    def provider(self) -> str:
        return str(getattr(self.owner, "ai_provider", "groq") or "groq").lower()

    def query_plain_markdown(self, prompt: str) -> str:
        """Return a free-text markdown answer from the active provider."""
        try:
            llm = _build_chat_model(self.provider, temperature=settings.temperature)
            from langchain_core.messages import HumanMessage  # type: ignore[import]

            result = llm.invoke([HumanMessage(content=prompt)])
            text = getattr(result, "content", "") or ""
            if isinstance(text, list):
                # Gemini / Anthropic may return list of content blocks
                text = " ".join(
                    block.get("text", "") if isinstance(block, dict) else str(block)
                    for block in text
                )
            return clean_text_encoding(str(text)).strip()
        except Exception as exc:
            self.logger.warning("Plain markdown LLM call failed (%s): %s", self.provider, exc)

        return (
            "No indexed documents are available in this project yet. "
            "You can still upload a contract or supporting file, and I can help "
            "plan what to review once it is ingested."
        )


# ---------------------------------------------------------------------------
# Structured client (tool actions + final answers via Pydantic schemas)
# ---------------------------------------------------------------------------


class StructuredLLMClient:
    """Dispatch structured prompts via LangChain .with_structured_output()."""

    def __init__(self, owner: Any):
        self.owner = owner
        self._logger = getattr(owner, "logger", None) or logger

    @property
    def provider(self) -> str:
        return str(getattr(self.owner, "ai_provider", "groq") or "groq").lower()

    # ------------------------------------------------------------------
    # Tool action
    # ------------------------------------------------------------------

    def query_tool_action(self, prompt: str) -> Dict[str, Any]:
        """Return the next tool-action decision as a validated dict."""
        try:
            llm = _build_chat_model(self.provider, temperature=0.0)
            structured = llm.with_structured_output(ToolActionResponse, method="json_schema")
            from langchain_core.messages import HumanMessage  # type: ignore[import]

            result: ToolActionResponse = structured.invoke([HumanMessage(content=prompt)])
            return {
                "thought": result.thought,
                "tool": result.tool,
                "args": result.args.model_dump(exclude_none=True),
            }
        except Exception as exc:
            self._logger.warning(
                "Structured tool-action failed (%s), falling back to plain parse: %s",
                self.provider,
                exc,
            )

        # Fallback — ask for free text then parse manually
        raw = self._plain_invoke(prompt)
        return self.parse_tool_action(raw)

    def parse_tool_action(self, raw_action: str) -> Dict[str, Any]:
        """Best-effort parse of free-text tool action (fallback path)."""
        import json
        import re

        text = str(raw_action or "").strip()
        if not text:
            return {"tool": "final_answer", "args": {}, "thought": "No action returned."}
        fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fenced:
            text = fenced.group(1).strip()
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"tool": "final_answer", "args": {}, "thought": "Invalid JSON action payload."}
        if not isinstance(parsed, dict):
            return {"tool": "final_answer", "args": {}, "thought": "Invalid action payload."}
        if not isinstance(parsed.get("args"), dict):
            parsed["args"] = {}
        return parsed

    # ------------------------------------------------------------------
    # Final answer
    # ------------------------------------------------------------------

    def query_final_answer(self, prompt: str) -> Dict[str, Any]:
        """Return a fully structured final answer as a validated dict."""
        try:
            llm = _build_chat_model(self.provider, temperature=0.0)
            structured = llm.with_structured_output(FinalAnswerResponse, method="json_schema")
            from langchain_core.messages import HumanMessage  # type: ignore[import]

            result: FinalAnswerResponse = structured.invoke([HumanMessage(content=prompt)])
            return result.model_dump()
        except Exception as exc:
            self._logger.warning(
                "Structured final-answer failed (%s), falling back to plain parse: %s",
                self.provider,
                exc,
            )

        raw = self._plain_invoke(prompt)
        return self.parse_final_answer(raw)

    def parse_final_answer(self, raw_text: str) -> Dict[str, Any]:
        """Best-effort parse of free-text final answer (fallback path)."""
        import json
        import re

        text = str(raw_text or "").strip()
        if not text:
            return {"answer": "", "confidence": "low", "tools_called": [], "citations": []}
        fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if fenced:
            text = fenced.group(1).strip()
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start : end + 1]
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"answer": text, "confidence": "low", "tools_called": [], "citations": []}
        if not isinstance(parsed, dict):
            return {"answer": text, "confidence": "low", "tools_called": [], "citations": []}
        parsed.setdefault("answer", "")
        parsed.setdefault("confidence", "low")
        parsed.setdefault("tools_called", [])
        parsed.setdefault("citations", [])
        return parsed

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _plain_invoke(self, prompt: str) -> str:
        """Invoke the LLM for a free-text response (used as fallback)."""
        try:
            llm = _build_chat_model(self.provider, temperature=0.0)
            from langchain_core.messages import HumanMessage  # type: ignore[import]

            result = llm.invoke([HumanMessage(content=prompt)])
            text = getattr(result, "content", "") or ""
            if isinstance(text, list):
                text = " ".join(
                    block.get("text", "") if isinstance(block, dict) else str(block)
                    for block in text
                )
            return clean_text_encoding(str(text)).strip()
        except Exception as exc:
            self._logger.warning("Plain fallback LLM invoke failed: %s", exc)
            return ""
