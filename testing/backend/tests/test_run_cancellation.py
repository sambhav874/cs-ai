"""Cooperative cancellation of the ReAct loop (Phase 3.5, F-10).

`cancel_check` cannot abort a model call already in flight — there is no
preemption inside a blocking provider request — but it must stop the loop
from starting another iteration once set, and still produce whatever answer
the evidence gathered so far supports rather than an empty response.
"""

from __future__ import annotations

from typing import Any, Dict, List, Sequence

from langchain_core.messages import AIMessage

from services.contract_agent.graph.react_runtime import ContractReActRuntime
from services.contract_agent.graph.state import AgentContext, AgentRunState, AgentSurface


EVIDENCE = (
    "[1] Airport Food Services Agreement.md p.2 (airport-food-master#service-credit)\n"
    "Evidence ID: airport-food-master::service-credit\n"
    "Terminal Authority may apply a service credit equal to 2% of the affected monthly invoice."
)


class LoopingModel:
    """Always requests another tool call — never terminates on its own.

    Stands in for a run that would otherwise run to the full iteration
    budget; only `cancel_check` should be able to stop it early.
    """

    def __init__(self):
        self.call_count = 0

    def bind_tools(self, tools):
        return self

    def invoke(self, messages):
        self.call_count += 1
        return AIMessage(
            content="",
            tool_calls=[{
                "name": "search_evidence",
                "args": {"query": "service credit"},
                "id": f"c{self.call_count}",
                "type": "tool_call",
            }],
        )


def _make_state() -> AgentRunState:
    return AgentRunState(
        user_id="u",
        message="What remedy applies if the hot meal target is missed?",
        context=AgentContext(
            surface=AgentSurface.CONTRACT,
            contract_id="airport-food-master",
            selected_document_ids=["airport-food-master"],
            attached_documents=[
                {"document_id": "airport-food-master", "filename": "Airport Food Services Agreement.md"}
            ],
        ),
        ai_provider="groq",
    )


def _executor(record, state) -> Dict[str, Any]:
    return {"summary": "1 snippet.", "search_results": EVIDENCE, "matches": [{"quote": EVIDENCE}]}


def test_cancel_check_stops_the_loop_before_the_iteration_budget():
    model = LoopingModel()
    state = _make_state()

    calls_before_cancel = 2
    cancelled = {"flag": False}

    def cancel_check() -> bool:
        # Trip after the model has already been asked a couple of times —
        # cancellation arriving mid-run, not before the first iteration.
        if model.call_count >= calls_before_cancel:
            cancelled["flag"] = True
        return cancelled["flag"]

    runtime = ContractReActRuntime(tool_executor=_executor, model=model, max_iterations=10)
    result = runtime.run(state, cancel_check=cancel_check)

    assert model.call_count == calls_before_cancel
    assert result.react_iterations < 10


def test_cancelled_run_still_answers_from_observed_evidence():
    model = LoopingModel()
    state = _make_state()

    def cancel_check() -> bool:
        return model.call_count >= 1

    runtime = ContractReActRuntime(tool_executor=_executor, model=model, max_iterations=10)
    result = runtime.run(state, cancel_check=cancel_check)

    assert result.answer
    assert "2%" in result.answer


def test_cancel_check_that_never_trips_does_not_change_behavior():
    model = LoopingModel()
    state = _make_state()

    runtime = ContractReActRuntime(tool_executor=_executor, model=model, max_iterations=3)
    result = runtime.run(state, cancel_check=lambda: False)

    # Falls through to the ordinary step-limit path — same outcome as today,
    # cancel_check being present and false must not alter it.
    assert model.call_count == 3
    assert result.react_iterations == 3


def test_no_cancel_check_behaves_exactly_as_before():
    model = LoopingModel()
    state = _make_state()

    runtime = ContractReActRuntime(tool_executor=_executor, model=model, max_iterations=3)
    result = runtime.run(state)

    assert model.call_count == 3
