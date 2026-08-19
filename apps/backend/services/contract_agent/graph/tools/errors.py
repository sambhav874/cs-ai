"""Typed tool-failure envelopes and the per-run tool budget (plan 1.5, F-16).

Two problems this replaces.

**Untyped errors.** The loop handed the model
`"Tool execution error: <first 500 chars of str(exc)>"` for everything. An
out-of-scope document, a document that simply has no matching clause, a
malformed argument, and a provider timeout all arrived looking identical, so the
model could not tell which of them was worth another attempt. The common outcome
was a retry loop against an error that would never succeed, or giving up on one
that would have worked on the second call.

**A per-tool repeat counter as a budget.** `READ_TOOL_REPEAT_LIMITS` hardcoded a
separate cap per tool name (search_evidence 5, read_document 3, ...). Nothing
bounded the run as a whole, so twelve calls spread across five tools stayed
under every individual cap. The replacement is one budget over the whole run.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Dict, Optional


class ToolErrorKind(str, Enum):
    """Why a tool call failed, in terms the model can act on."""

    #: The requested document is outside the authorized scope. Never retryable —
    #: and never softened, because the model must not read it as "try harder".
    OUT_OF_SCOPE = "out_of_scope"
    #: The tool worked; there is simply nothing matching. A real answer.
    NOT_FOUND = "not_found"
    #: The arguments were malformed. Retryable, but only with different arguments.
    INVALID_ARGS = "invalid_args"
    #: An infrastructure blip — timeout, connection reset, rate limit. Retried
    #: once automatically before the model ever sees it.
    TRANSIENT = "transient"
    #: The run has spent its tool budget. Answer from what was already observed.
    BUDGET_EXHAUSTED = "budget_exhausted"
    #: Anything unclassified. Treated as non-retryable, since retrying an unknown
    #: failure is how a loop burns its budget.
    INTERNAL = "internal"


#: One line telling the model what to do next. Written as instructions, not
#: apologies — an error the model cannot act on is just noise in the context.
RECOVERY_HINTS: Dict[ToolErrorKind, str] = {
    ToolErrorKind.OUT_OF_SCOPE: (
        "Do not request this document again. Only the documents listed in your "
        "authorized scope are available; answer from those or say the document is "
        "not in scope."
    ),
    ToolErrorKind.NOT_FOUND: (
        "Nothing matched. Either rephrase the query with different terms, or state "
        "that the scoped evidence does not contain it — do not repeat the same query."
    ),
    ToolErrorKind.INVALID_ARGS: (
        "Fix the arguments and call the tool once more. Check required fields and "
        "the expected types in the tool description."
    ),
    ToolErrorKind.TRANSIENT: (
        "This was an infrastructure failure and has already been retried once. "
        "Continue with another tool or answer from what you have."
    ),
    ToolErrorKind.BUDGET_EXHAUSTED: (
        "No tool calls remain in this run. Produce the final answer from the "
        "evidence already observed. If it is not supported, say the scoped "
        "evidence does not contain it."
    ),
    ToolErrorKind.INTERNAL: (
        "This tool is unavailable. Try a different tool or answer from what you have."
    ),
}

#: Kinds worth an automatic second attempt. Only genuine infrastructure blips —
#: retrying a scope denial or a no-match wastes budget and changes nothing.
RETRYABLE_KINDS = frozenset({ToolErrorKind.TRANSIENT})

#: Driver class names are matched unanchored, because the real ones bury the
#: keyword inside a CamelCase identifier: `ServerSelectionTimeoutError`,
#: `ReadTimeoutError`, `ServiceUnavailableError`. Anchoring "timeout" with `\b` on
#: either side matches none of them, which filed every Mongo and provider
#: connection failure as INTERNAL — never retried, despite being the one kind
#: that a retry actually fixes.
_TRANSIENT_PATTERNS = (
    r"\btimed?\s*out\b",
    r"timeout",
    r"\bconnection (?:reset|refused|aborted|closed|error)\b",
    r"\btemporarily unavailable\b",
    r"\brate limit",
    r"\btoo many requests\b",
    r"\b429\b",
    r"\b50[0234]\b",
    r"serviceunavailable",
    r"serverselection",
    r"autoreconnect",
    r"\bbroken pipe\b",
)

_NOT_FOUND_PATTERNS = (
    r"\bnot found\b",
    r"\bno such\b",
    r"\bdoes not exist\b",
    r"\bno matching\b",
    r"\bno results\b",
    r"\bempty\b",
)

_INVALID_ARGS_PATTERNS = (
    r"\bvalidation error\b",
    r"\binvalid\b",
    r"\bmissing required\b",
    r"\bunexpected keyword\b",
    r"\bmust be a\b",
    r"\bcould not (?:parse|coerce)\b",
)


def classify(exc: BaseException) -> ToolErrorKind:
    """Map an exception to a kind.

    Exception type first — a scope denial has its own class and must never be
    reclassified by string matching. Message patterns are the fallback, because
    the underlying drivers raise their own hierarchies (pymongo, requests, the
    provider SDKs) and normalising all of them here would be a bigger surface
    than reading their messages.
    """
    from services.contract_agent.graph.middleware import UnauthorizedAccessError

    if isinstance(exc, UnauthorizedAccessError):
        return ToolErrorKind.OUT_OF_SCOPE
    if isinstance(exc, (TimeoutError, ConnectionError)):
        return ToolErrorKind.TRANSIENT
    if isinstance(exc, (KeyError, IndexError)):
        return ToolErrorKind.NOT_FOUND
    if isinstance(exc, (TypeError, ValueError)):
        # Pydantic's ValidationError subclasses ValueError.
        return ToolErrorKind.INVALID_ARGS

    text = f"{type(exc).__name__}: {exc}".lower()
    for patterns, kind in (
        (_TRANSIENT_PATTERNS, ToolErrorKind.TRANSIENT),
        (_INVALID_ARGS_PATTERNS, ToolErrorKind.INVALID_ARGS),
        (_NOT_FOUND_PATTERNS, ToolErrorKind.NOT_FOUND),
    ):
        if any(re.search(pattern, text) for pattern in patterns):
            return kind
    return ToolErrorKind.INTERNAL


def is_retryable(kind: ToolErrorKind) -> bool:
    return kind in RETRYABLE_KINDS


def envelope(
    kind: ToolErrorKind,
    *,
    tool: str,
    detail: str = "",
    retried: bool = False,
) -> Dict[str, Any]:
    """The observation dict a failed tool call records.

    `summary` is what reaches the model; the rest is for the trace and the UI.
    """
    hint = RECOVERY_HINTS[kind]
    return {
        "summary": render_for_model(kind, tool=tool, detail=detail),
        "error": {
            "kind": kind.value,
            "tool": tool,
            "detail": detail[:500],
            "recovery_hint": hint,
            "retryable": is_retryable(kind),
            "retried": retried,
        },
        # Consumed by langchain_tools to mark the record's status.
        "tool_failed": True,
        "tool_budget_exhausted": kind is ToolErrorKind.BUDGET_EXHAUSTED,
    }


def render_for_model(kind: ToolErrorKind, *, tool: str, detail: str = "") -> str:
    """One compact line: what kind of failure, on which tool, and what to do.

    Kept short on purpose — a long stack trace in the message stack costs context
    budget and tells the model nothing it can use.
    """
    parts = [f"{tool} failed ({kind.value})."]
    if detail:
        parts.append(detail.strip()[:280])
    parts.append(RECOVERY_HINTS[kind])
    return " ".join(parts)


# ── The run budget ────────────────────────────────────────────────────────────

#: Tool calls allowed per run, across every tool. Replaces the per-tool-name
#: repeat table, which never bounded a run that spread its calls around.
DEFAULT_TOOL_CALL_BUDGET = 16

#: Estimated USD a run may spend on tool-side work before the budget closes.
#: Zero disables the cost half of the budget, which is the default until the
#: executor reports real per-call costs.
DEFAULT_TOOL_COST_BUDGET_USD = 0.0


def budget_limits(settings: Any = None) -> Dict[str, float]:
    if settings is None:
        from core.config import settings as configured

        settings = configured
    return {
        "max_tool_calls": int(
            getattr(settings, "contract_agent_tool_call_budget", DEFAULT_TOOL_CALL_BUDGET)
            or DEFAULT_TOOL_CALL_BUDGET
        ),
        "max_cost_usd": float(
            getattr(settings, "contract_agent_tool_cost_budget_usd", DEFAULT_TOOL_COST_BUDGET_USD)
            or DEFAULT_TOOL_COST_BUDGET_USD
        ),
    }


def budget_exceeded(state: Any, *, settings: Any = None) -> Optional[str]:
    """Has this run spent its budget? Returns the reason, or None.

    Counts calls that were actually attempted — a call rejected by the budget
    itself does not consume more of it.
    """
    limits = budget_limits(settings)

    attempted = sum(
        1
        for tool in state.tools
        if not (
            isinstance(tool.observation, dict)
            and tool.observation.get("tool_budget_exhausted")
        )
    )
    # The current call is already appended to state.tools by the wrapper, so the
    # budget is checked against the calls before it.
    attempted = max(attempted - 1, 0)
    if attempted >= limits["max_tool_calls"]:
        return (
            f"{attempted} tool calls used of {int(limits['max_tool_calls'])} allowed for this run"
        )

    max_cost = limits["max_cost_usd"]
    if max_cost > 0:
        spent = float(getattr(getattr(state, "cost", None), "cost_usd", 0.0) or 0.0)
        if spent >= max_cost:
            return f"${spent:.4f} spent of ${max_cost:.4f} allowed for this run"
    return None
