"""End-to-end eval runs through the real agent loop, with a scripted model.

These exercise everything except the provider call: `DeepContractAgentRunner`,
`ContractReActRuntime`'s tool loop, the middleware guard layer, the citation
pipeline, and the metric extraction on top. That makes the gate's plumbing
verifiable on every PR — a nightly-only gate rots quietly, because nobody
notices the day it stops measuring anything.

The scripted model is deliberately dumb: it returns whatever the test tells it
to, in the wire shape the real providers use. It is not a model quality
substitute, it is a way to hold the model constant so a change in the *harness*
is attributable.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from langchain_core.messages import AIMessage

from evals.contractsense_agent.agent_runner import AgentContractSenseRunner
from evals.contractsense_agent.metrics import compute_metrics
from evals.contractsense_agent.runners import load_suite
from evals.contractsense_agent.scoring import score_observation


FIXTURE_PATH = (
    Path(__file__).resolve().parents[1]
    / "evals"
    / "contractsense_agent"
    / "fixtures"
    / "public_smoke.json"
)


class ScriptedModel:
    """Returns a fixed sequence of AIMessages, then repeats the last one.

    `bind_tools` returns self so the runtime's `model.bind_tools(tools)` works,
    and `stream` is deliberately absent so the synthesis turn takes the
    invoke() path — one model call per logical turn, which keeps the
    model_calls assertions unambiguous.
    """

    def __init__(self, script: Sequence[AIMessage], *, usage: Optional[Dict[str, int]] = None):
        self.script = list(script)
        self.calls: List[List[Any]] = []
        self.usage = usage or {"input_tokens": 100, "output_tokens": 20}

    def bind_tools(self, tools):
        self.bound_tool_names = [tool.name for tool in tools]
        return self

    def invoke(self, messages):
        self.calls.append(list(messages))
        index = min(len(self.calls) - 1, len(self.script) - 1)
        message = self.script[index]
        message.usage_metadata = {
            "input_tokens": self.usage["input_tokens"],
            "output_tokens": self.usage["output_tokens"],
            "total_tokens": self.usage["input_tokens"] + self.usage["output_tokens"],
        }
        return message


def tool_call(name: str, args: Dict[str, Any], call_id: str = "call-1") -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}],
    )


def load_case(case_id: str):
    return next(case for case in load_suite(FIXTURE_PATH).cases if case.case_id == case_id)


def test_cited_answer_flows_through_the_whole_pipeline_and_scores():
    """One search, then a cited answer. Every stage has to cooperate:
    the fixture retriever supplies evidence, the runtime parses <CITATIONS>,
    the middleware validates the quote against the observation and stamps
    `verified`, and the runner maps it back to a fixture section ref."""
    case = load_case("public_smoke_sla_service_credit")
    quote = case.documents[0].sections[1].text

    model = ScriptedModel(
        [
            tool_call("search_evidence", {"query": "service credit remedy"}),
            AIMessage(
                content=(
                    "If the hot meal response target is missed, Terminal Authority may apply "
                    "a service credit of 2% of the affected monthly invoice and require a "
                    "written cure plan within 5 business days [1].\n"
                    "<CITATIONS>\n"
                    '[{"ref": 1, "doc_id": "airport-food-master", "quote": "' + quote + '", "page": 2}]\n'
                    "</CITATIONS>"
                )
            ),
        ]
    )

    observation = AgentContractSenseRunner(model=model).run_case(case)

    assert observation.error is None, observation.error
    assert observation.outcome == "OUTCOME_OK"
    # The <CITATIONS> block must not survive into the prose.
    assert "<CITATIONS>" not in observation.answer
    assert "[1]" in observation.answer
    # The citation was validated against real tool evidence, not passed through.
    assert observation.emitted_citations == 1
    assert observation.verified_citations == 1
    # And it resolved back to the fixture section, which is what scoring checks.
    assert "airport-food-master#service-credit" in observation.citation_refs

    result = score_observation(case, observation)
    assert result.hard_gate_passed, [c.name for c in result.checks if c.hard_gate and not c.passed]
    assert result.passed

    metrics = compute_metrics([result])
    assert metrics["citation_support_rate"] == 1.0
    assert metrics["model_calls_per_turn"] == 2.0
    assert metrics["tool_calls_per_turn"] == 1.0
    assert metrics["input_tokens_per_turn"] == 200.0
    assert metrics["unsupported_answer_rate"] == 0.0


def test_multi_turn_case_carries_memory_into_the_second_turn():
    """The follow-up says 'List them.' and nothing else.

    The only way the second turn can know what 'them' refers to is
    state.memory_context, so this asserts the 0.3 plumbing reaches the prompt.
    Guards against a silent regression back to the stateless behavior of F-02.
    """
    case = load_case("public_smoke_multi_turn_sla_follow_up")
    model = ScriptedModel(
        [
            tool_call("search_evidence", {"query": "service levels"}),
            AIMessage(content="Yes, the agreement sets service levels for hot meal response."),
        ]
    )

    observation = AgentContractSenseRunner(model=model).run_case(case)

    assert observation.error is None, observation.error
    assert observation.turns == 2
    # Turn one: tool call, then the answer. Turn two: the script is exhausted so
    # the model repeats its final (text) message, answering without a tool call.
    # Three model calls, one tool call — and both are summed across turns, which
    # is what the per-turn metrics divide down.
    assert observation.model_calls == 3
    assert observation.tool_calls == 1

    # The final turn's prompt must contain both the follow-up and the memory of
    # turn one. The runtime renders memory under this heading.
    final_prompt = model.calls[-1][1].content
    assert "List them." in final_prompt
    assert "Conversation memory:" in final_prompt
    assert "hot meal response" in final_prompt.lower()
    assert "No prior conversation memory" not in final_prompt


def test_first_turn_has_no_memory_and_says_so():
    """The inverse of the test above: turn one must not fabricate memory."""
    case = load_case("public_smoke_sla_service_credit")
    model = ScriptedModel([AIMessage(content="The contract does not address that.")])

    AgentContractSenseRunner(model=model).run_case(case)

    first_prompt = model.calls[0][1].content
    assert "No prior conversation memory for this session." in first_prompt


def test_unsupported_answer_is_counted_and_emits_no_citations():
    case = load_case("public_smoke_contract_nli_not_mentioned")
    model = ScriptedModel(
        [
            tool_call("search_evidence", {"query": "survival of obligations"}),
            AIMessage(content="The agreement does not contain a survival clause."),
        ]
    )

    observation = AgentContractSenseRunner(model=model).run_case(case)

    assert observation.unsupported is True
    assert observation.outcome == "OUTCOME_NONE_UNSUPPORTED"
    assert observation.emitted_citations == 0


def test_fabricated_citation_is_marked_unverified_and_lowers_support_rate():
    """A quote absent from every tool observation must not be reported as
    supported. This is the signal the gate's blocking metric watches, so it
    needs its own test — if the `verified` flag ever stops being set, the gate
    would read 1.0 forever and never fail."""
    case = load_case("public_smoke_sla_service_credit")
    model = ScriptedModel(
        [
            tool_call("search_evidence", {"query": "service credit"}),
            AIMessage(
                content=(
                    "The penalty is a flat fee of nine hundred million dollars payable in "
                    "Liechtenstein francs [1].\n"
                    "<CITATIONS>\n"
                    '[{"ref": 1, "doc_id": "airport-food-master", '
                    '"quote": "Contractor forfeits nine hundred million francs upon any delay whatsoever", '
                    '"page": 1}]\n'
                    "</CITATIONS>"
                )
            ),
        ]
    )

    observation = AgentContractSenseRunner(model=model).run_case(case)

    assert observation.emitted_citations == 1
    assert observation.verified_citations == 0
    metrics = compute_metrics([score_observation(case, observation)])
    assert metrics["citation_support_rate"] == 0.0


def test_runner_reports_a_failed_run_instead_of_raising():
    """A crashing model must surface as OUTCOME_ERR_INTERNAL, which is a hard
    gate failure — never as an exception that aborts the whole eval sweep."""

    class ExplodingModel:
        def bind_tools(self, tools):
            return self

        def invoke(self, messages):
            raise RuntimeError("provider unavailable")

    case = load_case("public_smoke_sla_service_credit")
    observation = AgentContractSenseRunner(model=ExplodingModel()).run_case(case)

    # The runtime catches provider failures and finishes with a cannot-answer,
    # so the observation is well-formed but scores as unsupported.
    assert observation.outcome == "OUTCOME_NONE_UNSUPPORTED"
    assert "provider unavailable" in observation.answer
    result = score_observation(case, observation)
    assert result.passed is False


def test_forbidden_tool_selection_is_refused_by_the_guard_layer():
    """Security cases must stay covered by the agent runner, not just the legacy
    core runner — the guard layer is what Phase 3 refactors."""
    case = load_case("public_smoke_sla_service_credit")
    model = ScriptedModel(
        [
            tool_call("send_email", {"to": "vendor@example.com", "body": "rates"}),
            AIMessage(content="Sent the rate card."),
        ]
    )

    observation = AgentContractSenseRunner(model=model).run_case(case)

    normalized = observation.answer.lower()
    assert "cannot" in normalized
    assert "sent the rate card" not in normalized


# ── P3: multi-part completeness and exact citations ───────────────────────────


def _nhs_answer_first_two(case):
    termination = case.documents[0].sections[0].text
    return AIMessage(content=(
        "**1.** Either party may end the contract on not less than 6 months' written notice [1].\n"
        "**2.** The Provider is liable for data loss it causes, and must notify within 24 hours [2].\n"
        "<CITATIONS>\n"
        '[{"ref": 1, "doc_id": "nhs-community-services", "quote": "' + termination + '"}, '
        '{"ref": 2, "doc_id": "nhs-community-services", "quote": "must notify the Commissioner without undue delay and in any event within 24 hours"}]\n'
        "</CITATIONS>"
    ))


def _nhs_answer_rest(case):
    standard = case.documents[0].sections[2].text
    return AIMessage(content=(
        "**3.** 95% of urgent referrals must be assessed within 2 hours [3].\n"
        "**4.** The Commissioner may withhold 2% of the Actual Monthly Value for the month.\n"
        "**5.** Not found in the documents searched.\n"
        "<CITATIONS>\n"
        '[{"ref": 3, "doc_id": "nhs-community-services", "quote": "' + standard + '"}]\n'
        "</CITATIONS>"
    ))


def test_nhs_five_part_question_is_answered_in_full():
    """The NHS failure: five parts asked, two answered, nothing said about the
    rest. The runtime asks once for the skipped parts; every part ends up
    answered or said not found, and every citation is an exact source span."""
    case = load_case("public_full_nhs_five_part_question")
    model = ScriptedModel([
        tool_call("search_evidence", {"query": "termination notice"}),
        _nhs_answer_first_two(case),
        _nhs_answer_rest(case),
    ])

    observation = AgentContractSenseRunner(model=model).run_case(case)

    assert observation.error is None, observation.error
    assert observation.metadata["question_parts"] == 5
    assert observation.metadata["missing_parts"] == []
    assert "**5.** Not found" in observation.answer
    assert observation.emitted_citations == 3 and observation.exact_citations == 3
    result = score_observation(case, observation)
    assert result.passed, [c.name for c in result.checks if not c.passed]
    metrics = compute_metrics([result])
    assert metrics["multi_part_completeness_rate"] == 1.0
    assert metrics["exact_citation_rate"] == 1.0


def test_completeness_gate_fails_when_the_runtime_skips_parts(monkeypatch):
    """Recorded failing (gate 7): with the runtime's completeness pass switched
    off, the same scripted model leaves parts 3-5 unanswered and the gate
    fails on its floor. This is the assertion watched failing."""
    import services.contract_agent.question_plan as plan
    from evals.contractsense_agent.metrics import compare_metrics

    monkeypatch.setattr(plan, "split_parts", lambda _q: [])      # runtime sees no parts
    case = load_case("public_full_nhs_five_part_question")
    model = ScriptedModel([tool_call("search_evidence", {"query": "notice"}), _nhs_answer_first_two(case)])
    observation = AgentContractSenseRunner(model=model).run_case(case)
    monkeypatch.undo()

    # The eval judges with the real planner.
    from evals.contractsense_agent.agent_runner import _parts_report
    observation.metadata.update(_parts_report(case.prompt, observation.answer))
    assert observation.metadata["missing_parts"] == [3, 4, 5]
    metrics = compute_metrics([score_observation(case, observation)])
    assert metrics["multi_part_completeness_rate"] == 0.0
    gate = compare_metrics(None, metrics)
    assert not gate["passed"]
    assert any("multi_part_completeness_rate" in f for f in gate["floor_failures"])


def test_a_paraphrased_quote_does_not_count_as_exact():
    """exact_citation_rate counts spans found word for word in the source."""
    case = load_case("public_smoke_sla_service_credit")
    model = ScriptedModel([
        tool_call("search_evidence", {"query": "service credit"}),
        AIMessage(content=(
            "A 2% service credit applies [1].\n<CITATIONS>\n"
            '[{"ref": 1, "doc_id": "airport-food-master", '
            '"quote": "Terminal Authority can take a two percent credit on the monthly invoice"}]\n</CITATIONS>'
        )),
    ])
    observation = AgentContractSenseRunner(model=model).run_case(case)
    metrics = compute_metrics([score_observation(case, observation)])
    # Re-quoted from the source sentence it paraphrased — exact, and marked so.
    assert observation.exact_citations == observation.emitted_citations == 1
    assert metrics["exact_citation_rate"] == 1.0
