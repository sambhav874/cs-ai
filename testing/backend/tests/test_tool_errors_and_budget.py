"""Typed tool errors and the per-run budget (plan 1.5, F-16).

Two behaviours under test.

**Classification actually changes what the model is told.** Before, every failure
arrived as `"Tool execution error: <str(exc)>"`, so a scope denial, a no-match,
bad arguments and a provider timeout were indistinguishable. The model's only
strategy was to retry whatever it just did.

**One budget for the run.** `READ_TOOL_REPEAT_LIMITS` capped each tool name
separately, so a run could make twelve calls across five tools and stay under
every cap.
"""

from __future__ import annotations

import pytest

from services.contract_agent.graph.middleware import UnauthorizedAccessError
from services.contract_agent.graph.state import (
    AgentContext,
    AgentRunState,
    AgentSurface,
    ToolCallRecord,
)
from services.contract_agent.graph.tools import errors
from services.contract_agent.graph.tools.errors import ToolErrorKind
from services.contract_agent.graph.tools.langchain_tools import build_langchain_tools


def make_state(**context_kwargs) -> AgentRunState:
    defaults = {
        "surface": AgentSurface.CONTRACT,
        "contract_id": "doc-1",
        "selected_document_ids": ["doc-1"],
    }
    defaults.update(context_kwargs)
    return AgentRunState(user_id="u", message="what are the payment terms?", context=AgentContext(**defaults))


def tools_for(state, executor):
    return {tool.name: tool for tool in build_langchain_tools(state=state, tool_executor=executor)}


# ── Classification ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "exc,expected",
    [
        (UnauthorizedAccessError("Access to document x is out of scoped context!"), ToolErrorKind.OUT_OF_SCOPE),
        (TimeoutError("read timed out"), ToolErrorKind.TRANSIENT),
        (ConnectionError("connection reset by peer"), ToolErrorKind.TRANSIENT),
        (RuntimeError("HTTP 503 service unavailable"), ToolErrorKind.TRANSIENT),
        (RuntimeError("429 Too Many Requests"), ToolErrorKind.TRANSIENT),
        # The real driver class names carry an "Error" suffix, which a trailing
        # \b anchor refuses to match. Getting these wrong filed every Mongo
        # connection failure as INTERNAL, so it was never retried.
        (RuntimeError("ServerSelectionTimeoutError: localhost:27017"), ToolErrorKind.TRANSIENT),
        (RuntimeError("AutoReconnect: connection closed"), ToolErrorKind.TRANSIENT),
        (RuntimeError("ReadTimeoutError while contacting provider"), ToolErrorKind.TRANSIENT),
        (ValueError("validation error: top_k must be an integer"), ToolErrorKind.INVALID_ARGS),
        (TypeError("unexpected keyword argument 'documentid'"), ToolErrorKind.INVALID_ARGS),
        (KeyError("document_id"), ToolErrorKind.NOT_FOUND),
        (RuntimeError("document does not exist"), ToolErrorKind.NOT_FOUND),
        (RuntimeError("something inexplicable happened"), ToolErrorKind.INTERNAL),
    ],
)
def test_classification(exc, expected):
    assert errors.classify(exc) is expected


def test_scope_denial_is_classified_by_type_not_message():
    """A scope denial must never be reclassified by string matching.

    Its message contains "not found"-adjacent wording, and downgrading it to
    NOT_FOUND would tell the model to rephrase and try again against a document
    it is not allowed to read.
    """
    exc = UnauthorizedAccessError("document not found in scope, does not exist for this user")
    assert errors.classify(exc) is ToolErrorKind.OUT_OF_SCOPE
    assert errors.is_retryable(ToolErrorKind.OUT_OF_SCOPE) is False


def test_only_transient_failures_are_retryable():
    for kind in ToolErrorKind:
        assert errors.is_retryable(kind) is (kind is ToolErrorKind.TRANSIENT)


def test_every_kind_has_a_recovery_hint():
    """An error the model cannot act on is just spent context budget."""
    for kind in ToolErrorKind:
        hint = errors.RECOVERY_HINTS[kind]
        assert hint and len(hint) > 20


def test_rendered_message_names_the_kind_the_tool_and_the_next_step():
    rendered = errors.render_for_model(
        ToolErrorKind.OUT_OF_SCOPE, tool="read_document", detail="document zzz is out of scope"
    )
    assert "read_document" in rendered
    assert "out_of_scope" in rendered
    assert "Do not request this document again" in rendered


def test_envelope_carries_structure_for_the_trace_and_prose_for_the_model():
    envelope = errors.envelope(ToolErrorKind.NOT_FOUND, tool="search_evidence", detail="no results")
    assert envelope["error"]["kind"] == "not_found"
    assert envelope["error"]["retryable"] is False
    assert envelope["error"]["recovery_hint"]
    assert envelope["tool_failed"] is True
    assert "search_evidence" in envelope["summary"]


# ── The wrapper: retry and envelopes end to end ───────────────────────────────


def test_transient_failure_is_retried_once_and_succeeds_without_the_model_seeing_it():
    """A timeout that fixes itself should cost one extra tool call, not a whole
    model turn spent reading an error."""
    state = make_state()
    attempts = {"n": 0}

    def executor(record, run_state):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise TimeoutError("read timed out")
        return {"summary": "1 snippet.", "matches": [{"quote": "Payment within 45 days."}]}

    result = tools_for(state, executor)["search_evidence"].invoke({"query": "payment"})

    assert attempts["n"] == 2
    assert result["summary"] == "1 snippet."
    assert "error" not in result
    assert state.tools[-1].status == "done"
    assert any(trace.event == "tool_retry" for trace in state.traces)


def test_transient_failure_is_retried_only_once():
    state = make_state()
    attempts = {"n": 0}

    def executor(record, run_state):
        attempts["n"] += 1
        raise TimeoutError("read timed out")

    result = tools_for(state, executor)["search_evidence"].invoke({"query": "payment"})

    assert attempts["n"] == 2, "one initial call plus one retry"
    assert result["error"]["kind"] == "transient"
    assert result["error"]["retried"] is True
    assert state.tools[-1].status == "error"


def test_a_non_retryable_failure_is_not_retried():
    state = make_state()
    attempts = {"n": 0}

    def executor(record, run_state):
        attempts["n"] += 1
        raise RuntimeError("document does not exist")

    result = tools_for(state, executor)["search_evidence"].invoke({"query": "payment"})

    assert attempts["n"] == 1
    assert result["error"]["kind"] == "not_found"
    assert result["error"]["retryable"] is False


def test_the_failure_kind_reaches_the_trace():
    state = make_state()

    def executor(record, run_state):
        raise ValueError("validation error: top_k must be an integer")

    tools_for(state, executor)["search_evidence"].invoke({"query": "payment"})

    error_traces = [trace for trace in state.traces if trace.event == "tool_error"]
    assert error_traces
    assert error_traces[-1].detail["kind"] == "invalid_args"
    # The recovery hint is recorded on the call, so the UI's activity log can
    # explain the failure without re-deriving it.
    assert "Fix the arguments" in state.tools[-1].reason


def test_scope_is_not_partially_enforced_by_the_langchain_wrapper():
    state = make_state(selected_document_ids=["doc-1"])
    called = {"n": 0}

    def executor(record, run_state):
        called["n"] += 1
        return {"summary": "should not happen"}

    result = tools_for(state, executor)["read_document"].invoke({"document_id": "doc-forbidden"})
    assert called["n"] == 1
    assert result["summary"] == "should not happen"


# ── The run budget ────────────────────────────────────────────────────────────


def test_budget_counts_calls_across_every_tool_not_per_tool_name():
    """The gap in READ_TOOL_REPEAT_LIMITS: spreading calls across tools used to
    evade every individual cap."""
    from core.config import settings

    limit = settings.contract_agent_tool_call_budget
    state = make_state()
    # Fill the run with calls to a variety of tools, all under any per-tool cap.
    names = ["search_evidence", "read_document", "outline_document", "list_documents", "get_kpi_context"]
    for index in range(limit):
        state.tools.append(
            ToolCallRecord(name=names[index % len(names)], status="done", iteration=index + 1)
        )
    # budget_exceeded discounts the current (just-appended) call, so add one more
    # to represent it.
    state.tools.append(ToolCallRecord(name="search_evidence", status="planned", iteration=limit + 1))

    reason = errors.budget_exceeded(state)
    assert reason is not None
    assert str(limit) in reason


def test_budget_is_not_exceeded_on_an_early_call():
    state = make_state()
    state.tools.append(ToolCallRecord(name="search_evidence", status="planned", iteration=1))
    assert errors.budget_exceeded(state) is None


def test_exhausted_budget_returns_the_evidence_already_gathered():
    """Cutting the model off empty-handed would force an "I don't know" on a run
    that already had what it needed."""
    state = make_state()
    state.react_scratchpad = [
        {
            "iteration": 1,
            "tool": "search_evidence",
            "status": "done",
            "observation": {
                "summary": "1 snippet.",
                "matches": [
                    {
                        "quote": "Terminal Authority shall pay each undisputed invoice within 45 days.",
                        "document_id": "doc-1",
                        "filename": "Agreement.md",
                        "page": 1,
                    }
                ],
            },
        }
    ]
    for index in range(errors.budget_limits()["max_tool_calls"] + 1):
        state.tools.append(ToolCallRecord(name="search_evidence", status="done", iteration=index + 1))

    def executor(record, run_state):
        raise AssertionError("the executor must not run once the budget is spent")

    result = tools_for(state, executor)["search_evidence"].invoke({"query": "payment"})

    assert result["error"]["kind"] == "budget_exhausted"
    assert result["tool_budget_exhausted"] is True
    assert result["matches"], "observed evidence must be handed back"
    assert "45 days" in result["matches"][0]["quote"]
    assert any(trace.event == "tool_budget_exhausted" for trace in state.traces)


def test_budget_hint_tells_the_model_to_answer_rather_than_retry():
    hint = errors.RECOVERY_HINTS[ToolErrorKind.BUDGET_EXHAUSTED]
    assert "final answer" in hint
    assert "does not contain" in hint


def test_cost_budget_is_off_by_default_and_enforced_when_set():
    state = make_state()
    state.tools.append(ToolCallRecord(name="search_evidence", status="planned", iteration=1))
    state.cost.cost_usd = 5.0

    class NoCostBudget:
        contract_agent_tool_call_budget = 16
        contract_agent_tool_cost_budget_usd = 0.0

    assert errors.budget_exceeded(state, settings=NoCostBudget()) is None

    class WithCostBudget:
        contract_agent_tool_call_budget = 16
        contract_agent_tool_cost_budget_usd = 1.0

    reason = errors.budget_exceeded(state, settings=WithCostBudget())
    assert reason is not None and "spent" in reason


def test_per_tool_repeat_limits_are_gone():
    from services.contract_agent.graph.tools import langchain_tools

    assert not hasattr(langchain_tools, "READ_TOOL_REPEAT_LIMITS")
    assert not hasattr(langchain_tools, "_read_tool_loop_result")


def test_budget_settings_are_configurable():
    from core.config import settings

    assert settings.contract_agent_tool_call_budget == 16
    assert settings.contract_agent_tool_cost_budget_usd == 0.0
