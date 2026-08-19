"""Tests for rolling session summarization and run episodes (Phase 2.2, F-19).

The summarizer takes an injected model, so the fold is driven here by scripted
models rather than a provider. That is what makes the 40-turn test a real test:
the model is held constant, so what it proves is the fold's *behaviour* —
bounded length, and the oldest content surviving because each fold carries it —
rather than some provider's summarization quality.
"""

from __future__ import annotations

from typing import Any, Dict, List

import pytest

from services.memory.summarizer import (
    SUMMARY_BUDGET_CHARS,
    extractive_summary,
    summarize_run_outcome,
    summarize_session,
)


class Reply:
    def __init__(self, content):
        self.content = content


class ScriptedModel:
    """Folds by concatenating carried facts, so provenance is checkable."""

    def __init__(self):
        self.calls: List[str] = []

    def invoke(self, messages):
        prompt = messages[0].content
        self.calls.append(prompt)
        prior = prompt.split("EXISTING SUMMARY:\n", 1)[1].split("\n\nNEWLY AGED", 1)[0].strip()
        aged = prompt.split("NEWLY AGED MESSAGES:\n", 1)[1].split("\n\nNEW SUMMARY:", 1)[0]
        facts = [] if prior.startswith("(none") else [prior]
        facts.extend(
            line.split("User: ", 1)[1].strip()
            for line in aged.splitlines()
            if line.startswith("User: ")
        )
        return Reply(" | ".join(facts))


class ExplodingModel:
    def invoke(self, messages):
        raise RuntimeError("provider is down")


def msg(role, content):
    return {"role": role, "content": content}


# ------------------------------------------------------------- the done-when


def test_a_forty_turn_session_still_references_turn_three_and_stays_flat():
    """The F-19 done-when.

    The old implementation appended each batch of aged messages to the prior
    summary and truncated the result from the front, so by turn 40 the earliest
    turns — the only ones nothing else remembered — were exactly what had been
    cut. Folding carries them instead.
    """
    model = ScriptedModel()
    summary = ""
    lengths = []

    for turn in range(1, 41):
        aged = [msg("user", f"turn {turn} topic"), msg("assistant", f"answer {turn}")]
        summary = summarize_session(summary, aged, model=model, budget=400)
        lengths.append(len(summary))

    assert "turn 3 topic" in summary, "the oldest folded turn did not survive"
    assert max(lengths) <= 400, "summary grew past its budget"
    assert lengths[-1] <= lengths[len(lengths) // 2] + 100, "summary grew monotonically"


def test_the_fold_replaces_the_prior_summary_rather_than_appending_to_it():
    model = ScriptedModel()

    first = summarize_session("", [msg("user", "alpha")], model=model)
    second = summarize_session(first, [msg("user", "beta")], model=model)

    assert second.count("alpha") == 1
    assert "beta" in second


def test_the_prior_summary_is_given_to_the_model_as_the_only_earlier_record():
    model = ScriptedModel()

    summarize_session("Notice is 60 days.", [msg("user", "and the cap?")], model=model)

    prompt = model.calls[0]
    assert "Notice is 60 days." in prompt
    assert "ONLY record" in prompt


def test_the_first_fold_tells_the_model_there_is_no_prior_summary():
    model = ScriptedModel()

    summarize_session("", [msg("user", "alpha")], model=model)

    assert "(none — this is the first fold)" in model.calls[0]


# ------------------------------------------------------------------ failures


def test_a_failing_provider_falls_back_instead_of_losing_the_summary():
    """A summary is an enhancement to a chat turn. Losing the turn to save the
    summary is the wrong trade, and losing the accumulated history because one
    call failed is worse than either."""
    result = summarize_session(
        "Notice is 60 days.",
        [msg("user", "what about the cap?")],
        model=ExplodingModel(),
    )

    assert "Notice is 60 days." in result
    assert "cap" in result


def test_an_empty_model_response_falls_back_rather_than_wiping_the_summary():
    class Empty:
        def invoke(self, messages):
            return Reply("   ")

    result = summarize_session("Notice is 60 days.", [msg("user", "hi there")], model=Empty())

    assert "Notice is 60 days." in result


def test_no_new_messages_returns_the_prior_summary_without_calling_the_model():
    model = ScriptedModel()

    result = summarize_session("Notice is 60 days.", [], model=model)

    assert result == "Notice is 60 days."
    assert model.calls == []


def test_the_fallback_protects_history_and_squeezes_the_new_material():
    """The prior summary represents many more turns per character than any one
    message does, so when the two compete the new material is what gives."""
    prior = "P" * 380

    result = extractive_summary(prior, [msg("user", "a brand new question")], budget=400)

    assert prior in result


def test_the_fallback_is_not_the_old_append_and_truncate():
    prior = "P" * 400

    result = extractive_summary(prior, [msg("user", "x" * 500)], budget=400)

    assert len(result) <= 400
    assert result.startswith("P")


# ---------------------------------------------------------------- truncation


def test_a_long_fold_is_cut_at_a_sentence_boundary():
    class Verbose:
        def invoke(self, messages):
            return Reply("First sentence here. Second sentence here. " + "Third " * 200)

    result = summarize_session("", [msg("user", "hi")], model=Verbose(), budget=60)

    assert len(result) <= 60
    assert result.endswith(".")


# ----------------------------------------------------------------- episodes


def test_a_run_episode_records_the_tool_sequence_in_order():
    """Order, not a set. 2.4 mines these for which *sequence* resolved a kind
    of question, and a set cannot answer that."""
    line = summarize_run_outcome(
        question="compare the notice periods",
        tools_called=["search_evidence", "read_document", "calculate_from_evidence"],
        citation_count=3,
    )

    assert "search_evidence → read_document → calculate_from_evidence" in line
    assert "3 cited" in line


def test_an_episode_distinguishes_no_evidence_from_no_citations():
    unsupported = summarize_run_outcome(question="q", tools_called=["search_evidence"], citation_count=0, unsupported=True)
    uncited = summarize_run_outcome(question="q", tools_called=["search_evidence"], citation_count=0)

    assert "no supporting evidence found" in unsupported
    assert "uncited" in uncited


def test_an_episode_records_a_toolless_answer_as_such():
    line = summarize_run_outcome(question="what can you do?", tools_called=[], citation_count=0)

    assert "answered without tools" in line


@pytest.mark.parametrize("correction", ["notice is 60 days, not 30", ""])
def test_a_user_correction_is_carried_into_the_episode_when_present(correction):
    line = summarize_run_outcome(
        question="q", tools_called=["search_evidence"], citation_count=1, correction=correction
    )

    assert ("user corrected" in line) is bool(correction)


# ------------------------------------------------- the stride and the manager


class FakeMessages:
    def __init__(self, docs):
        self.docs = docs

    def count_documents(self, query):
        return len(self.docs)

    def find(self, query, projection=None):
        return self

    def sort(self, key, direction=1):
        return self

    def limit(self, n):
        return list(self.docs[:n])


class FakeSessions:
    def __init__(self, doc):
        self.doc = doc
        self.updates: List[Dict[str, Any]] = []

    def find_one(self, query, projection=None):
        return self.doc

    def update_one(self, query, update):
        self.updates.append(update)
        self.doc.update(update.get("$set", {}))


class Manager:
    """AgentMemoryManager's summarization path without a Mongo client.

    The real method is called unbound against this stand-in rather than being
    reimplemented, so these tests exercise the shipped stride and windowing
    logic, not a copy of it.
    """

    def __init__(self, messages, session):
        self.messages = FakeMessages(messages)
        self.sessions = FakeSessions(session)

    def summarize(self, **kwargs):
        from services.agent_memory import AgentMemoryManager

        return AgentMemoryManager._summarize_session_if_needed(
            self, session_id="s", contract_id="c", user_id="u", **kwargs
        )


def build_manager(message_count, *, already_summarized=0, summary=""):
    messages = [msg("user" if i % 2 == 0 else "assistant", f"message {i}") for i in range(message_count)]
    return Manager(messages, {"summary": summary, "summarized_message_count": already_summarized})


def test_a_short_session_is_not_summarized_at_all():
    model = ScriptedModel()
    manager = build_manager(10)

    manager.summarize(model=model)

    assert model.calls == []
    assert manager.sessions.updates == []


def test_the_stride_stops_a_fold_running_on_every_single_turn():
    """Without it this is one LLM call per turn, re-expressing material that
    has not changed."""
    model = ScriptedModel()
    manager = build_manager(20, already_summarized=10)

    manager.summarize(model=model)

    assert model.calls == [], "folded again after only two messages aged out"


def test_a_fold_reads_only_the_messages_that_aged_out_since_the_last_one():
    """Re-reading everything would cost a full transcript per fold and let each
    pass paraphrase the previous pass's paraphrase."""
    model = ScriptedModel()
    manager = build_manager(30, already_summarized=10)

    manager.summarize(model=model)

    aged = model.calls[0].split("NEWLY AGED MESSAGES:\n", 1)[1]
    assert "message 9" not in aged
    assert "message 10" in aged
    assert manager.sessions.doc["summarized_message_count"] == 22
