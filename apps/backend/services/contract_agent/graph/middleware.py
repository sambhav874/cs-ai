"""Middleware descriptors and import-safe LangChain middleware wiring."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from .state import AgentRunState, AgentStatus, AgentWorkflow
from .tools.registry import APPROVAL_REQUIRED_TOOLS, FORBIDDEN_TOOL_NAMES, READ_ONLY_TOOLS, tool_specs


@dataclass(frozen=True)
class MiddlewareDescriptor:
    """Advertised middleware capability and how it is applied at runtime."""

    name: str
    enabled: bool
    config: Dict[str, Any]
    runtime: str = "local"
    enforced: bool = True


def middleware_descriptors() -> List[MiddlewareDescriptor]:
    return [
        MiddlewareDescriptor("HumanInTheLoopMiddleware", True, {"approval_required_tools": [
            "create_tabular_review",
            "generate_tabular_review",
            "create_draft_artifact",
            "create_redline_artifact",
            "create_editable_copy",
            "duplicate_document_copy",
            "edit_document",
            "extract_kpis",
            "generate_docx",
            "replicate_document",
        ]}, runtime="local"),
        MiddlewareDescriptor("ModelRetryMiddleware", True, {"max_retries": 2}, runtime="langchain"),
        MiddlewareDescriptor("ToolRetryMiddleware", True, {"max_retries": 1}, runtime="trace", enforced=False),
        MiddlewareDescriptor("ModelFallbackMiddleware", True, {}, runtime="trace", enforced=False),
        MiddlewareDescriptor("ModelCallLimitMiddleware", True, {"run_limit": 12}, runtime="langchain"),
        MiddlewareDescriptor("ToolCallLimitMiddleware", True, {"run_limit": 16}, runtime="langchain"),
        MiddlewareDescriptor("PIIMiddleware", True, {"strategy": "redact"}, runtime="trace", enforced=False),
        MiddlewareDescriptor("SummarizationMiddleware", True, {"when": "long_session"}, runtime="trace", enforced=False),
        MiddlewareDescriptor("ContextEditingMiddleware", True, {"mode": "prune_large_tool_results"}, runtime="local"),
        MiddlewareDescriptor("ScopeGuardMiddleware", True, {}, runtime="trace", enforced=False),
        MiddlewareDescriptor("ToolPolicyMiddleware", True, {}, runtime="local"),
        MiddlewareDescriptor("CitationGuardMiddleware", True, {}, runtime="local", enforced=True),
        MiddlewareDescriptor("ConfidentialityGuardMiddleware", True, {}, runtime="trace", enforced=False),
        MiddlewareDescriptor("PromptInjectionGuardMiddleware", True, {}, runtime="local"),
        MiddlewareDescriptor("BudgetMiddleware", True, {}, runtime="trace", enforced=False),
        MiddlewareDescriptor("TraceMiddleware", True, {}, runtime="trace", enforced=False),
    ]


def load_langchain_middleware(*, model: Any | None = None) -> List[Any]:
    """Return LangChain middleware that is safe to compose with local guards.

    Human approval, tool retry, PII handling, and summarization are enforced by
    ContractSense-specific guard code because those behaviors need access to
    the local approval payload and citation/confidentiality state.
    """
    del model
    try:
        from langchain.agents.middleware import (  # type: ignore
            ModelCallLimitMiddleware,
            ModelRetryMiddleware,
            ToolCallLimitMiddleware,
        )
    except Exception:
        return []

    return [
        ModelRetryMiddleware(max_retries=2, on_failure="error", initial_delay=0, jitter=False),
        ModelCallLimitMiddleware(run_limit=12, exit_behavior="error"),
        ToolCallLimitMiddleware(run_limit=16, exit_behavior="continue"),
    ]


class ActiveMiddlewareEngine:
    """Runtime guard layer used by the LangGraph runner.

    LangChain middleware imports are version-dependent, so production-critical
    gates are enforced here as explicit graph middleware nodes.
    """

    unsafe_phrases = (
        "ignore previous instructions",
        "reveal secret",
        "override confidentiality",
        "bypass",
        "send externally",
        "email this to",
    )

    def input_guard(self, state: AgentRunState) -> AgentRunState:
        state.add_trace("middleware:TraceMiddleware", phase="input", enforced=False)
        state.add_trace("middleware:BudgetMiddleware", message_length=len(state.message), max_length=4000, enforced=False)
        state.add_trace("middleware:ScopeGuardMiddleware", surface=state.context.surface.value, enforced=False)

        normalized = " ".join((state.message or "").lower().split())
        if any(phrase in normalized for phrase in self.unsafe_phrases):
            state.workflow = AgentWorkflow.SECURITY_DENIAL
            state.status = AgentStatus.COMPLETED
            state.answer = (
                "I cannot help with requests that bypass confidentiality, reveal protected information, "
                "or follow instruction-like text from documents. I can still review the authorized contract "
                "record and provide a cited answer."
            )
            state.reason = "PromptInjectionGuardMiddleware denied an unsafe request."
            state.add_trace("middleware:PromptInjectionGuardMiddleware", decision="deny")
        else:
            state.add_trace("middleware:PromptInjectionGuardMiddleware", decision="allow")

        return state

    def model_guard(self, state: AgentRunState) -> AgentRunState:
        state.add_trace("middleware:ModelCallLimitMiddleware", limit=12)
        state.add_trace("middleware:ModelRetryMiddleware", max_retries=2)
        state.add_trace("middleware:ModelFallbackMiddleware", enabled=False, enforced=False, reason="No fallback model is configured.")
        state.add_trace("middleware:PIIMiddleware", strategy="redact", enforced=False, reason="PII redaction is not applied by the local guard.")
        return state

    def tool_guard(self, state: AgentRunState) -> AgentRunState:
        known_tools = tool_specs()
        allowed_names = READ_ONLY_TOOLS | APPROVAL_REQUIRED_TOOLS | set(FORBIDDEN_TOOL_NAMES)
        already_rejected = [tool for tool in state.tools if tool.status == "rejected"]
        forbidden = [
            tool for tool in state.tools
            if tool.status != "rejected"
            and (tool.name in FORBIDDEN_TOOL_NAMES or tool.name.startswith("send_") or tool.name not in allowed_names)
        ]
        for tool in state.tools:
            if tool.name in APPROVAL_REQUIRED_TOOLS and tool.status == "planned":
                tool.reason = tool.reason or "Side-effecting tool must wait for human approval."
            if tool.name in READ_ONLY_TOOLS and tool.status == "planned":
                tool.reason = tool.reason or "Read-only scoped tool."
            if tool.name in known_tools:
                tool.args = dict(tool.args or {})
        if forbidden or already_rejected:
            for tool in forbidden:
                tool.status = "rejected"
                tool.reason = "ToolPolicyMiddleware rejected an unknown or forbidden tool."
            rejected_names = list(dict.fromkeys([tool.name for tool in [*already_rejected, *forbidden]]))
            state.add_trace("middleware:ToolPolicyMiddleware", decision="reject", tools=rejected_names)
        else:
            state.add_trace("middleware:ToolPolicyMiddleware", decision="allow", tools=[tool.name for tool in state.tools])
        state.add_trace("middleware:ToolCallLimitMiddleware", limit=16, planned_tools=len(state.tools))
        state.add_trace("middleware:ToolRetryMiddleware", max_retries=1, enforced=False, reason="Tool calls return structured errors instead of retryable exceptions.")
        return state

    def approval_guard(self, state: AgentRunState) -> AgentRunState:
        if state.approval_request:
            state.add_trace(
                "middleware:HumanInTheLoopMiddleware",
                action=state.approval_request.action,
                decision="interrupt",
            )
        return state

    def answer_guard(self, state: AgentRunState) -> AgentRunState:
        citation_report = _validate_citations(state)
        state.citation_annotations = citation_report["annotations"]
        if state.citation_details:
            state.citation_details["annotations"] = state.citation_annotations
            state.citation_details["citation_guard"] = citation_report
        elif state.citation_annotations:
            state.citation_details = {
                "annotations": state.citation_annotations,
                "citation_style": "react_tool_observation",
                "citation_guard": citation_report,
            }
        if citation_report["issues"]:
            state.verifier_issues.extend(
                issue for issue in citation_report["issues"] if issue not in state.verifier_issues
            )
        state.add_trace(
            "middleware:CitationGuardMiddleware",
            citation_count=len(state.citation_annotations),
            issue_count=len(citation_report["issues"]),
            issues=citation_report["issues"][:8],
            enforced=True,
        )
        state.add_trace("middleware:ConfidentialityGuardMiddleware", decision="allow", enforced=False)
        state.add_trace("middleware:ContextEditingMiddleware", mode="prune_large_tool_results")
        memory_summary = _conversation_summary_from_memory(state.memory_context)
        if memory_summary:
            state.add_trace(
                "middleware:SummarizationMiddleware",
                enabled=True,
                enforced=False,
                summary=memory_summary,
                source="agent_memory",
            )
        else:
            state.add_trace("middleware:SummarizationMiddleware", enabled=False, enforced=False, reason="No conversation summarizer is configured.")
        return state


def _conversation_summary_from_memory(memory_context: str) -> str:
    if not memory_context:
        return ""
    match = re.search(
        r"Prior conversation summary:\s*(.+?)(?:\n\n(?:Recent turns:|Useful remembered topics:)|\Z)",
        memory_context.strip(),
        flags=re.DOTALL,
    )
    if not match:
        return ""
    return re.sub(r"\s+", " ", match.group(1)).strip()[:1200]


def _validate_citations(state: AgentRunState) -> Dict[str, Any]:
    observed_texts, _read_evidence_ids, _requires_read = _observed_evidence(state)
    answer_tokens = set(_citation_tokens(state.answer))
    issues: List[str] = []
    valid_annotations: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()

    # When there are no tool observations at all (e.g. the model answered from its
    # system-prompt context alone) we should not discard citations — just let them
    # through with a note.
    no_observations = len(observed_texts) == 0

    for annotation in state.citation_annotations:
        quote = str(annotation.get("quote") or "").strip()
        doc_id = str(annotation.get("doc_id") or annotation.get("document_id") or "").strip()
        if not doc_id:
            issues.append("invalid_citation_missing_document_id")
            continue
        if not quote:
            issues.append("invalid_citation_missing_quote")
            continue

        normalized_quote = _normalize_citation_text(quote)

        # ── Support check ──────────────────────────────────────────────────
        # Use token-overlap instead of substring containment so that:
        #   • minor paraphrasing, punctuation differences, extra whitespace
        #   • quotes slightly longer/shorter than the retrieved snippet
        # …do not cause false rejections.
        if no_observations:
            # No tool evidence at all — pass through; note it.
            supported = True
            issues.append("citation_no_evidence_passthrough")
        else:
            quote_tokens = set(_citation_tokens(normalized_quote))
            supported = False
            if quote_tokens:
                for obs_text in observed_texts:
                    if not obs_text:
                        continue
                    obs_tokens = set(_citation_tokens(obs_text))
                    if not obs_tokens:
                        continue
                    overlap = quote_tokens & obs_tokens
                    # Accept if ≥40% of the quote's content tokens appear in evidence,
                    # OR the evidence contains a significant multi-word fragment of the quote.
                    overlap_ratio = len(overlap) / len(quote_tokens)
                    if overlap_ratio >= 0.40:
                        supported = True
                        break
                    # Also accept direct substring containment (original behaviour)
                    if normalized_quote in obs_text or obs_text in normalized_quote:
                        supported = True
                        break
            else:
                # Quote has no meaningful tokens — treat as unsupported
                supported = False

        if not supported:
            issues.append("invalid_or_unsupported_citation")

        dedupe_key = (doc_id, normalized_quote[:180])
        if dedupe_key in seen:
            issues.append("duplicate_citation_removed")
            continue
        seen.add(dedupe_key)

        cleaned = dict(annotation)
        cleaned["verified"] = supported

        if len(quote) > 520:
            cleaned["quote"] = quote[:520].rsplit(" ", 1)[0].rstrip() + " ..."
            issues.append("broad_citation_trimmed")

        quote_tokens_check = set(_citation_tokens(cleaned.get("quote") or ""))
        if answer_tokens and quote_tokens_check and not (answer_tokens & quote_tokens_check):
            issues.append("weak_claim_citation_overlap")

        cleaned["ref"] = len(valid_annotations) + 1
        valid_annotations.append(cleaned)

    return {
        "annotations": valid_annotations,
        "issues": list(dict.fromkeys(issues)),
    }


def _observed_evidence(state: AgentRunState) -> Tuple[List[str], set, bool]:
    texts: List[str] = []
    for scratch in state.react_scratchpad:
        observation = scratch.get("observation")
        if not isinstance(observation, dict):
            continue
        candidates: List[Dict[str, Any]] = []
        if isinstance(observation.get("matches"), list):
            candidates.extend(item for item in observation["matches"] if isinstance(item, dict))
        if observation.get("snippet") or observation.get("quote") or observation.get("search_results"):
            candidates.append(observation)
        for candidate in candidates:
            for key in ("context", "quote", "snippet", "search_results", "text"):
                value = _normalize_citation_text(str(candidate.get(key) or ""))
                if value:
                    texts.append(value)
    return texts, set(), False


def _normalize_citation_text(value: str) -> str:
    """Lowercase, collapse whitespace, and strip punctuation noise."""
    normalized = re.sub(r"\s+", " ", value or "").strip().lower()
    # Remove common punctuation that varies between source and model output
    normalized = re.sub(r"[\"'""''\[\](){}]", "", normalized)
    return normalized


def _citation_tokens(value: str) -> List[str]:
    """Return significant content words from a text, excluding stop words."""
    _STOP = {
        "a", "an", "and", "are", "as", "at", "be", "been", "but",
        "by", "contract", "document", "for", "from", "had", "has",
        "have", "if", "in", "into", "is", "it", "its", "no", "not",
        "of", "on", "or", "shall", "such", "than", "that", "the",
        "their", "this", "to", "was", "were", "which", "will", "with",
    }
    return [
        token
        for token in re.findall(r"[a-z][a-z0-9_$%.-]{2,}", (value or "").lower())
        if token not in _STOP
    ]

