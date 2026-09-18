"""The synthesis-turn capability flag (F-04 / plan 1.2).

The plan asks for the flag to be measured both ways rather than assumed, and for
the measurement to be recorded beside it. These tests are that measurement, held
against a constant scripted model so the difference is attributable to the flag
and not to model drift.

The finding, which contradicts the flag's framing as a pure cost win:

  * In the simple one-retrieval case the model-call count is identical either
    way (2). A tool-calling loop needs one call to request the tool and one to
    consume its result; the synthesis turn just relabels the second call.
  * The synthesis turn RETURNS as soon as it produces text. So a question needing
    a second retrieval round is answered from the first round's evidence — and
    that is a correctness loss, not a cost one.
  * With the flag off, the model keeps tools bound and can retrieve again.

Hence the default is off, and the cost metric in the eval report stays roughly
flat rather than halving.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

import pytest
from langchain_core.messages import AIMessage

from services.contract_agent.graph.react_runtime import (
    DEFAULT_SYNTHESIS_TURN_PROVIDERS,
    _synthesis_turn_enabled,
)


EVIDENCE = (
    "[1] Airport Food Services Agreement.md p.2 (airport-food-master#service-credit)\n"
    "Evidence ID: airport-food-master::service-credit\n"
    "Terminal Authority may apply a service credit equal to 2% of the affected monthly invoice."
)

SECOND_EVIDENCE = (
    "[1] Second Vendor Agreement.md p.1 (vendor-b#termination)\n"
    "Evidence ID: vendor-b::termination\n"
    "Either party may terminate on 60 days notice."
)


class CountingModel:
    """Scripted model that records how many calls it received."""

    def __init__(self, script: Sequence[AIMessage]):
        self.script = list(script)
        self.call_count = 0
        self.last_messages: List[Any] = []

    def bind_tools(self, tools):
        return self

    def invoke(self, messages):
        self.last_messages = list(messages)
        index = min(self.call_count, len(self.script) - 1)
        self.call_count += 1
        return self.script[index]


def tool_call(name: str, args: Dict[str, Any], call_id: str) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}],
    )


def run_loop(script, *, observations, provider="groq"):
    """Drive the real ContractReActRuntime with a scripted model and canned tools."""
    from services.contract_agent.graph.react_runtime import ContractReActRuntime
    from services.contract_agent.graph.state import (
        AgentContext,
        AgentRunState,
        AgentSurface,
    )

    queue = list(observations)

    def executor(record, state):
        return queue.pop(0) if queue else {"summary": "No further evidence.", "matches": []}

    model = CountingModel(script)
    state = AgentRunState(
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
        ai_provider=provider,
    )
    runtime = ContractReActRuntime(tool_executor=executor, model=model, max_iterations=6)
    return runtime.run(state), model


# ── The flag itself ───────────────────────────────────────────────────────────


def test_synthesis_turn_is_off_for_every_provider_by_default():
    assert DEFAULT_SYNTHESIS_TURN_PROVIDERS == frozenset()
    for provider in ("groq", "openai", "claude", "gemini"):
        assert _synthesis_turn_enabled(provider) is False


def test_env_override_accepts_a_provider_list(monkeypatch):
    monkeypatch.setenv("AGENT_SYNTHESIS_TURN_PROVIDERS", "groq, gemini")
    assert _synthesis_turn_enabled("groq") is True
    assert _synthesis_turn_enabled("gemini") is True
    assert _synthesis_turn_enabled("openai") is False


@pytest.mark.parametrize("value,expected", [("all", True), ("none", False), ("", False)])
def test_env_override_accepts_all_and_none(monkeypatch, value, expected):
    monkeypatch.setenv("AGENT_SYNTHESIS_TURN_PROVIDERS", value)
    assert _synthesis_turn_enabled("groq") is expected


def test_flag_is_keyed_on_the_normalized_provider_name(monkeypatch):
    """A flag set for "anthropic" must apply to the run that model_factory
    resolves to "claude", or the two would silently disagree."""
    from services.contract_agent.graph.react_runtime import ContractReActRuntime
    from services.contract_agent.graph.state import AgentRunState

    state = AgentRunState(user_id="u", message="hi", ai_provider="anthropic")
    assert ContractReActRuntime()._provider_name(state) == "claude"


# ── What the flag actually changes ────────────────────────────────────────────


def test_with_the_flag_off_the_model_keeps_tools_and_can_retrieve_again(monkeypatch):
    """The correctness win. Two retrieval rounds, then an answer.

    With the synthesis turn on, this same script would be cut off after the
    first round — the case below proves it.
    """
    monkeypatch.setenv("AGENT_SYNTHESIS_TURN_PROVIDERS", "none")
    state, model = run_loop(
        [
            tool_call("search_evidence", {"query": "service credit"}, "c1"),
            tool_call("search_evidence", {"query": "termination notice"}, "c2"),
            AIMessage(content="Service credit is 2%, and termination needs 60 days notice."),
        ],
        observations=[
            {"summary": "1 snippet.", "search_results": EVIDENCE, "matches": [{"quote": EVIDENCE}]},
            {"summary": "1 snippet.", "search_results": SECOND_EVIDENCE, "matches": [{"quote": SECOND_EVIDENCE}]},
        ],
    )

    assert model.call_count == 3
    assert state.model_calls == 3
    assert len(state.tools) == 2, "both retrieval rounds must run"
    assert "60 days" in state.answer


def test_with_the_flag_on_the_second_retrieval_round_is_dropped(monkeypatch):
    """The behavior 1.2 removes, on the same script and fixtures as above.

    The synthesis call is made with tools unbound (or, on Groq, with the model
    told to write), so the model's second retrieval request is discarded rather
    than executed: one tool call instead of two, and a model call spent
    producing nothing. The wasted call is why the cost metric does not improve
    when the flag is turned off — it was already being paid here.
    """
    monkeypatch.setenv("AGENT_SYNTHESIS_TURN_PROVIDERS", "all")
    state, model = run_loop(
        [
            tool_call("search_evidence", {"query": "service credit"}, "c1"),
            tool_call("search_evidence", {"query": "termination notice"}, "c2"),
            AIMessage(content="Service credit is 2%, and termination needs 60 days notice."),
        ],
        observations=[
            {"summary": "1 snippet.", "search_results": EVIDENCE, "matches": [{"quote": EVIDENCE}]},
            {"summary": "1 snippet.", "search_results": SECOND_EVIDENCE, "matches": [{"quote": SECOND_EVIDENCE}]},
        ],
    )

    assert len(state.tools) == 1, "the requested second search was discarded"
    # Three model calls for one round of evidence: the synthesis call in the
    # middle returned a tool request that the synthesis path cannot honour.
    assert state.model_calls == 3
    assert "vendor-b" not in str(state.react_scratchpad), (
        "the second document's evidence was never retrieved"
    )


def test_model_call_count_is_unchanged_in_the_simple_one_retrieval_case(monkeypatch):
    """The measurement that keeps the commit message honest.

    Both settings make exactly two model calls when one retrieval round answers
    the question. Removing the synthesis turn is therefore not a 2x cost saving,
    and the eval's cost metrics should be expected to stay flat.
    """
    script = [
        tool_call("search_evidence", {"query": "service credit"}, "c1"),
        AIMessage(content="Terminal Authority may apply a service credit of 2%."),
    ]
    observations = [
        {"summary": "1 snippet.", "search_results": EVIDENCE, "matches": [{"quote": EVIDENCE}]}
    ]

    monkeypatch.setenv("AGENT_SYNTHESIS_TURN_PROVIDERS", "all")
    with_synthesis, _ = run_loop(list(script), observations=list(observations))

    monkeypatch.setenv("AGENT_SYNTHESIS_TURN_PROVIDERS", "none")
    without_synthesis, _ = run_loop(list(script), observations=list(observations))

    assert with_synthesis.model_calls == 2
    assert without_synthesis.model_calls == 2
    # Same answer content reached by both paths.
    assert "2%" in with_synthesis.answer
    assert "2%" in without_synthesis.answer


def test_citations_still_resolve_with_the_flag_off(monkeypatch):
    """The gate's blocking metric must not move. A cited answer produced on the
    plain loop path has to go through the same citation pipeline the synthesis
    path used."""
    monkeypatch.setenv("AGENT_SYNTHESIS_TURN_PROVIDERS", "none")
    quote = "Terminal Authority may apply a service credit equal to 2% of the affected monthly invoice."
    state, _ = run_loop(
        [
            tool_call("search_evidence", {"query": "service credit"}, "c1"),
            AIMessage(
                content=(
                    "The remedy is a service credit of 2% of the affected monthly invoice [1].\n"
                    "<CITATIONS>\n"
                    '[{"ref": 1, "doc_id": "airport-food-master", "quote": "' + quote + '", "page": 2}]\n'
                    "</CITATIONS>"
                )
            ),
        ],
        observations=[
            {
                "summary": "1 snippet.",
                "search_results": EVIDENCE,
                "matches": [
                    {
                        "quote": quote,
                        "context": quote,
                        "document_id": "airport-food-master",
                        "filename": "Airport Food Services Agreement.md",
                        "page": 2,
                        "evidence_id": "airport-food-master::service-credit",
                    }
                ],
            }
        ],
    )

    assert "<CITATIONS>" not in state.answer
    assert "[1]" in state.answer
    assert state.citation_annotations
    assert state.citation_annotations[0]["quote"].startswith("Terminal Authority")
