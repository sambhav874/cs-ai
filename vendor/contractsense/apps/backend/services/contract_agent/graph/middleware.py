"""Middleware descriptors and import-safe LangChain middleware wiring."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

from services.contract_agent import citations

from .state import AgentRunState, AgentStatus, AgentWorkflow
from .tools import errors as tool_errors
from .tools.registry import APPROVAL_REQUIRED_TOOLS, FORBIDDEN_TOOL_NAMES, READ_ONLY_TOOLS, tool_specs


class UnauthorizedAccessError(Exception):
    """Raised when document access is outside of authorized contract scope."""
    pass


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
            "propose_tabular_review",
            "generate_tabular_review",
            "extract_kpis",
            "remember_fact",
            "correct_fact",
            "replicate_document",
        ]}, runtime="local"),
        MiddlewareDescriptor("ModelRetryMiddleware", True, {"max_retries": 2}, runtime="langchain"),
        MiddlewareDescriptor("ModelCallLimitMiddleware", True, {"run_limit": 12}, runtime="langchain"),
        MiddlewareDescriptor("ToolCallLimitMiddleware", True, {"run_limit": 16}, runtime="langchain"),
        MiddlewareDescriptor("PIIMiddleware", True, {"strategy": "redact"}, runtime="langchain", enforced=True),
        MiddlewareDescriptor("ScopeGuardMiddleware", True, {}, runtime="trace", enforced=False),
        MiddlewareDescriptor("ToolPolicyMiddleware", True, {}, runtime="local"),
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
            PIIMiddleware,
        )
    except Exception:
        return []

    return [
        ModelRetryMiddleware(max_retries=2, on_failure="error", initial_delay=0, jitter=False),
        ModelCallLimitMiddleware(run_limit=12, exit_behavior="error"),
        ToolCallLimitMiddleware(run_limit=16, exit_behavior="continue"),
        PIIMiddleware(pii_type="email", strategy="redact", apply_to_input=True, apply_to_output=True),
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
        # The real budget, not a hardcoded 16 that no longer matched anything.
        limits = tool_errors.budget_limits()
        state.add_trace(
            "middleware:ToolCallLimitMiddleware",
            limit=limits["max_tool_calls"],
            max_cost_usd=limits["max_cost_usd"],
            planned_tools=len(state.tools),
            enforced=True,
        )
        state.add_trace(
            "middleware:ToolRetryMiddleware",
            max_retries=1,
            enforced=True,
            reason=(
                "Transient tool failures are retried once in the tool wrapper; every other "
                "failure returns a typed error envelope with a recovery hint."
            ),
        )
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
        # Steps 3-5 of the citation pipeline: validate each quote against what
        # the tools returned, renumber the survivors, then rewrite the inline
        # markers. The rewrite is last so that dropping an unsupported citation
        # cannot leave the prose pointing at the wrong evidence (F-05).
        citation_report = citations.validate_and_finalize(state)
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
        return state


# `_conversation_summary_from_memory` lived here: a regex that recovered the
# session summary by re-parsing the rendered memory prose. It had no callers,
# and MemoryComposer now hands out the summary as a labelled block, so parsing
# it back out of the text would be a second source of truth for what was sent —
# and one that returns "" against the composer's headings without saying so.
# Re-exported from services.contract_agent.citations, which owns the single
# implementation. Kept here as aliases because other modules already import them
# from this path; two copies of the normalisation rules would let the support
# check and the marker matching disagree about what counts as the same quote.
_normalize_citation_text = citations.normalize_text
_citation_tokens = citations.content_tokens
