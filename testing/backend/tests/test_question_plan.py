"""Multi-part questions are answered in full, and comparisons see every document.

The NHS evaluation asked five things and got two answers with nothing to say
the other three were skipped. The planner finds the parts; the runtime asks
once for any it missed and then says, per part, what was not found. Retrieval
for a comparison keeps a share of its evidence for each document in scope.
"""
from typing import Any, List

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from services.contract_agent import citations
from services.contract_agent.graph.runner import DeepContractAgentRunner
from services.contract_agent.graph.state import AgentContext, AgentRunState, AgentSurface
from services.contract_agent.question_plan import missing_parts, plan_block, split_parts
from services.contract_agent.rag.evidence_service import apply_document_quota

NHS = ("Under the NHS Standard Contract: 1) what is the notice period for termination? "
       "2) who bears liability for data breaches; 3) what are the KPIs for A&E waiting times? "
       "4) how are service credits calculated? 5) what is the governing law?")


@pytest.mark.parametrize("question,expected", [
    (NHS, 5),
    ("(a) the payment terms (b) the liability cap (c) the renewal notice", 3),
    ("- the payment terms\n- the liability cap\n", 2),
    ("What is the cap? And who pays for audits?", 2),
    ("What is the liability cap under section 12.1?", 0),
    ("Summarise the agreement.", 0),
])
def test_parts_are_found_in_how_people_ask(question, expected):
    assert len(split_parts(question)) == expected


def test_a_part_counts_as_answered_by_its_number_or_its_words():
    parts = split_parts(NHS)
    answer = "**1.** Six months.\n**2.** The provider.\nService credits are 2% per point below target."
    assert missing_parts(parts, answer) == [3, 5]
    assert "5 parts" in plan_block(parts) and "Not found in the documents searched" in plan_block(parts)


class Scripted:
    def __init__(self, script: List[AIMessage]):
        self.script, self.calls = script, []

    def bind_tools(self, tools):
        return self

    def invoke(self, messages):
        self.calls.append(list(messages))
        return self.script[min(len(self.calls) - 1, len(self.script) - 1)]


def run(question: str, script: List[AIMessage]):
    model = Scripted(script)
    state = AgentRunState(user_id="u", message=question,
                          context=AgentContext(surface=AgentSurface.CONTRACT, contract_id="d1", selected_document_ids=["d1"]))
    events: List[Any] = []
    response = DeepContractAgentRunner(store=None, tool_executor=lambda t, s: {"summary": "none"}, model=model).run(
        state, on_event=lambda kind, payload: events.append((kind, payload)))
    return response, model, events


QUESTION = "1) What is the notice period? 2) Who pays for audits? 3) What is the governing law?"


def test_the_plan_reaches_the_model_and_skipped_parts_are_asked_for_once():
    response, model, events = run(QUESTION, [
        AIMessage(content="**1.** Ninety days.\n**2.** The supplier pays for audits."),
        AIMessage(content="**3.** English law."),
    ])
    first_user = [m for m in model.calls[0] if isinstance(m, HumanMessage)][-1].content
    assert "This question has 3 parts" in first_user
    follow = model.calls[1][-1]
    assert isinstance(follow, HumanMessage) and "3. What is the governing law?" in follow.content
    assert "1. What is the notice period" not in follow.content
    assert "**1.** Ninety days." in response.answer and "**3.** English law." in response.answer
    assert "Not found" not in response.answer
    assert any(k == "status" and "remaining parts" in p["message"] for k, p in events)


def test_a_part_still_missing_is_said_to_be_not_found():
    response, model, events = run(QUESTION, [
        AIMessage(content="**1.** Ninety days."),
        AIMessage(content="**2.** The supplier pays for audits."),
    ])
    assert len(model.calls) == 2  # one follow-up, not a loop
    assert "**3.** What is the governing law? — Not found in the documents searched." in response.answer
    streamed = "".join(p["text"] for k, p in events if k == "delta")
    assert "Not found in the documents searched" in streamed


def test_a_single_question_gets_no_plan_and_no_follow_up():
    response, model, _ = run("What is the notice period?", [AIMessage(content="Ninety days.")])
    assert len(model.calls) == 1 and "parts" not in model.calls[0][-1].content


def test_two_turns_citations_merge_into_one_block():
    merged = citations.merge_answers(
        'A [1].\n<CITATIONS>[{"ref": 1, "doc_id": "doc-0", "quote": "a"}]</CITATIONS>',
        'B [2].\n<CITATIONS>[{"ref": 2, "doc_id": "doc-0", "quote": "b"}]</CITATIONS>',
    )
    assert merged.startswith("A [1].\n\nB [2].")
    assert [c["ref"] for c in citations.parse_citation_block(merged)] == [1, 2]
    assert citations.max_ref(merged) == 2


class Hit:
    def __init__(self, doc, n):
        self.document_id, self.n = doc, n


def test_a_comparison_keeps_evidence_from_every_document():
    ranked = [Hit("msa", i) for i in range(10)] + [Hit("sow", 100), Hit("sow", 101)]
    picked = apply_document_quota(ranked, 6, ["msa", "sow"])
    assert [(h.document_id, h.n) for h in picked] == [
        ("msa", 0), ("msa", 1), ("msa", 2), ("msa", 3), ("sow", 100), ("sow", 101),
    ]
    # One document in scope: plain top-k.
    assert [h.n for h in apply_document_quota(ranked, 3, ["msa"])] == [0, 1, 2]
