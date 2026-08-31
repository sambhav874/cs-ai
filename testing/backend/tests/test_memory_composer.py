"""Tests for the memory composer (Phase 2.1, F-17).

No Mongo. The composer reads the two managers through a small surface — a few
collection queries and four render methods — so the fakes below implement that
surface directly. That keeps these tests about composition order and budget,
which is all the composer actually decides.
"""

from __future__ import annotations

import pytest

from services.memory import MemoryComposer, MemoryScope, TOTAL_BUDGET_CHARS
from services.memory.composer import MAX_BUDGET_CHARS
from services.memory.composer import MIN_USEFUL_BLOCK_CHARS, MemoryBlock, _fit


# --------------------------------------------------------------------- fakes


class FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, key, direction=1):
        self._docs.sort(key=lambda d: d.get(key, 0), reverse=direction < 0)
        return self

    def limit(self, n):
        return self._docs[:n]

    def __iter__(self):
        return iter(self._docs)


class FakeCollection:
    def __init__(self, docs=()):
        self.docs = list(docs)

    def find(self, query=None, projection=None):
        return FakeCursor(self.docs)

    def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None


class FakeAgentMemory:
    def __init__(self, *, session=None, messages=(), recalled=(), episodes=()):
        self.sessions = FakeCollection([session] if session else [])
        self.messages = FakeCollection(messages)
        self._recalled = list(recalled)
        self._episodes = list(episodes)

    def _semantic_memories(self, *, contract_id, user_id, question):
        return self._recalled

    def recent_episodes(self, *, contract_id, user_id, exclude_session_id=None, limit=5):
        return self._episodes


class FakeProjectMemory:
    def __init__(self, *, index="", facts=(), rendered_facts="", notes=""):
        self._index = index
        self._facts = list(facts)
        self._rendered_facts = rendered_facts
        self._notes = notes

    def render_index(self, project_id):
        return self._index

    def list_facts(self, project_id, include_superseded=False):
        return self._facts

    def render_facts(self, project_id):
        return self._rendered_facts

    def get_notes(self, project_id):
        return {"content": self._notes}


def turn(role, content, at):
    return {"role": role, "content": content, "created_at": at}


def scope(**overrides):
    base = dict(
        user_id="u1",
        question="what are the payment terms?",
        session_id="s1",
        contract_id="c1",
        project_id="p1",
        surface="contract",
    )
    base.update(overrides)
    return MemoryScope(**base)


def a_session():
    return {"session_id": "s1", "contract_id": "c1", "user_id": "u1", "summary": ""}


# --------------------------------------------------------- the F-17 done-when


def test_a_contract_surface_run_is_given_project_facts_without_a_tool_call():
    """The finding this phase exists for.

    Before the composer, project facts reached a contract chat only if the
    model guessed to call get_project_timeline. Nothing about the question
    below suggests that call, so the facts have to already be in the context.
    """
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(
            index="Documents in this project (complete list):\n- MSA.pdf · id: c1",
            facts=[{"text": "Notice period is 60 days", "needs_review": False}],
            rendered_facts="Facts recorded for this project:\n\n## Notice period is 60 days",
        ),
    )

    composed = composer.compose(scope())

    assert "Notice period is 60 days" in composed.text
    assert "MSA.pdf" in composed.text
    assert {"project_index", "project_facts"} <= {b.name for b in composed.blocks}


def test_a_run_with_no_project_composes_only_conversation_memory():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session=a_session(),
            messages=[turn("user", "what are the SLAs?", 1)],
        ),
        project_memory=FakeProjectMemory(index="This project has no documents yet."),
    )

    composed = composer.compose(scope(project_id=None))

    assert [b.name for b in composed.blocks] == ["recent_turns"]


def test_an_empty_project_index_is_not_sent_as_a_block():
    """"This project has no documents yet" costs budget to say nothing."""
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(index="This project has no documents yet."),
    )

    composed = composer.compose(scope())

    assert composed.blocks == []


# ------------------------------------------------------------------ ordering


def test_a_real_index_is_kept_even_when_a_document_is_named_like_the_empty_sentinel():
    """Sniffing the rendered prose for "no documents" would drop the one block
    that tells the model the project has contents at all."""
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(
            index="Documents in this project (complete list):\n- No documents policy.pdf · id: c9",
        ),
    )

    composed = composer.compose(scope())

    assert "No documents policy.pdf" in composed.text


def test_blocks_are_ordered_by_priority_not_by_which_manager_ran_first():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session={**a_session(), "summary": "Earlier we discussed indemnities."},
            messages=[turn("user", "and the cap?", 2)],
            recalled=[{"memory_key": "payment_terms", "content": "Net 30."}],
        ),
        project_memory=FakeProjectMemory(
            index="Documents in this project (complete list):\n- MSA.pdf · id: c1",
            facts=[{"text": "Cap is 12 months of fees"}],
            rendered_facts="Facts recorded for this project:\n\n## Cap is 12 months of fees",
            notes="Renewal is contentious.",
        ),
    )

    composed = composer.compose(scope(), kpi_context="KPI: uptime 99.9%")

    assert [b.name for b in composed.blocks] == [
        "recent_turns",
        "project_index",
        "project_facts",
        "kpi_context",
        "session_summary",
        "project_notes",
        "semantic_recall",
    ]


def test_past_runs_from_earlier_sessions_are_composed_as_an_episodic_block():
    """2.2's run episodes. What the agent already checked on this contract,
    across sessions — answerable without re-reading every prior answer."""
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session=a_session(),
            episodes=[
                {"summary": "Asked: notice period · via search_evidence · 2 cited"},
                {"summary": "Asked: fee escalation · via read_document · uncited"},
            ],
        ),
    )

    composed = composer.compose(scope())

    past = next(b for b in composed.blocks if b.name == "past_runs")
    assert past.tier == "episodic"
    assert "notice period" in past.body
    assert "fee escalation" in past.body


def test_recent_turns_survive_when_the_budget_is_too_small_for_everything():
    """Priority is what the budget buys, and the last turns are the top of it.

    A follow-up like "list them" is unanswerable without the previous turn,
    while a project note is merely useful — so overflow has to cost the note.
    """
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session=a_session(),
            messages=[turn("user", "what are the SLAs?", 1), turn("assistant", "Four. " * 40, 2)],
        ),
        project_memory=FakeProjectMemory(notes="x" * 4000),
        budget_chars=900,
    )

    composed = composer.compose(scope())

    names = [b.name for b in composed.blocks]
    assert "recent_turns" in names
    assert "project_notes" in composed.dropped or "project_notes" not in names
    assert composed.total_chars <= 900 + len(composed.blocks) * 120


def test_a_cheap_high_priority_block_is_not_starved_by_an_expensive_one_above_it():
    """Tier reservations exist for this case.

    Recent turns are episodic and a huge document index is semantic. Without
    per-tier reservations the index would eat the whole budget first purely
    because a project has many documents.
    """
    big_index = "Documents in this project (complete list):\n" + "\n".join(
        f"- Document {i}.pdf · 2026-01-01 · other · relates to: none · id: c{i}" for i in range(200)
    )
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session=a_session(),
            messages=[turn("user", "what changed in the amendment?", 1)],
        ),
        project_memory=FakeProjectMemory(index=big_index),
        budget_chars=2000,
    )

    composed = composer.compose(scope())

    assert "what changed in the amendment?" in composed.text
    assert "project_index" in [b.name for b in composed.blocks]


def test_unclaimed_tier_budget_is_released_to_a_block_that_was_cut_short():
    """The bug this covers: a block trimmed in pass one was final.

    A project with no chat history claims none of the episodic reservation, so
    a run could report the facts as truncated while a third of the budget sat
    unspent. Measured on a real project: 2086 chars of facts kept, 4222
    available, 3043 of 6000 chars used.
    """
    facts = "\n\n".join(f"## Fact {i} about this project." for i in range(60))
    composer = MemoryComposer(
        # No session and no turns: the episodic tier has nothing to spend on.
        agent_memory=FakeAgentMemory(),
        project_memory=FakeProjectMemory(
            facts=[{"fact_id": "f1"}],
            rendered_facts=facts,
        ),
        budget_chars=2000,
    )

    composed = composer.compose(scope())
    block = next(b for b in composed.blocks if b.name == "project_facts")

    # Semantic alone reserves half the budget; the released episodic and
    # procedural share takes it past that.
    assert len(block.body) > int(2000 * 0.50)
    # `total_chars` counts headings and provenance too; the budget governs bodies.
    assert sum(len(b.body) for b in composed.blocks) <= 2000


def test_releasing_budget_never_overspends_it():
    facts = "\n\n".join(f"## Fact {i} about this project." for i in range(80))
    index = "Documents in this project (complete list):\n" + "\n".join(
        f"- Document {i}.pdf · 2026-01-01 · other · relates to: none · id: c{i}" for i in range(80)
    )
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session=a_session(),
            messages=[turn("user", "x" * 400, 1)],
        ),
        project_memory=FakeProjectMemory(
            index=index, facts=[{"fact_id": "f1"}], rendered_facts=facts
        ),
        budget_chars=2400,
    )

    composed = composer.compose(scope())

    assert sum(len(b.body) for b in composed.blocks) <= 2400


def test_a_block_that_fits_is_left_alone_by_the_release_pass():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(),
        project_memory=FakeProjectMemory(
            facts=[{"fact_id": "f1"}],
            rendered_facts="## One short fact.",
        ),
    )

    composed = composer.compose(scope())
    block = next(b for b in composed.blocks if b.name == "project_facts")

    assert block.body == "## One short fact."
    assert block.truncated is False


def test_a_truncated_index_withdraws_its_claim_to_be_complete():
    """The index is the one block that asserts completeness.

    A project large enough to overflow the budget is exactly when that
    assertion becomes false, and a model told a partial list is the whole list
    will state that a document is not in the project when it is.
    """
    big_index = "Documents in this project (complete list):\n" + "\n".join(
        f"- Document {i}.pdf · 2026-01-01 · other · relates to: none · id: c{i}"
        for i in range(300)
    )
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(index=big_index),
        budget_chars=2000,
    )

    composed = composer.compose(scope())
    block = next(b for b in composed.blocks if b.name == "project_index")

    assert block.truncated is True
    assert "complete" not in block.describe_provenance()
    assert "PARTIAL" in block.describe_provenance()
    assert "list_documents" in block.describe_provenance()
    # The claim has to be withdrawn in what the model actually reads, not only
    # on the object.
    assert "PARTIAL" in composed.text


def test_a_truncated_block_says_how_much_is_missing():
    big_index = "Documents in this project (complete list):\n" + "\n".join(
        f"- Document {i}.pdf · 2026-01-01 · other · relates to: none · id: c{i}"
        for i in range(300)
    )
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(index=big_index),
        budget_chars=2000,
    )

    composed = composer.compose(scope())
    block = next(b for b in composed.blocks if b.name == "project_index")

    assert block.total_units == 301  # 300 documents plus the header line
    assert 0 < block.kept_units < block.total_units
    assert f"showing {block.kept_units} of {block.total_units}" in block.render()


def test_an_untruncated_index_keeps_its_completeness_claim():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(
            index="Documents in this project (complete list):\n- A.pdf · id: c1"
        ),
    )

    composed = composer.compose(scope())
    block = next(b for b in composed.blocks if b.name == "project_index")

    assert block.truncated is False
    assert "complete" in block.describe_provenance()
    assert "PARTIAL" not in composed.text
    assert block.kept_units == 0 and block.total_units == 0


def test_the_budget_stretches_toward_what_a_large_project_actually_has():
    """6000 was sized for a curated fact set and a short document list. A
    project now carries an index that grows with every document and facts that
    grow with every schedule revision; holding it to the size of a small
    project starves it for no benefit."""
    facts = "\n\n".join(f"## Fact {i} about this project." for i in range(200))
    index = "Documents in this project (complete list):\n" + "\n".join(
        f"- Document {i}.pdf · 2026-01-01 · other · relates to: none · id: c{i}"
        for i in range(200)
    )
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(
            index=index, facts=[{"fact_id": "f1"}], rendered_facts=facts
        ),
    )

    composed = composer.compose(scope())

    assert composed.budget_chars > TOTAL_BUDGET_CHARS
    assert composed.budget_chars <= MAX_BUDGET_CHARS
    assert sum(len(b.body) for b in composed.blocks) <= MAX_BUDGET_CHARS


def test_a_small_project_still_costs_what_it_always_did():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(
            index="Documents in this project (complete list):\n- A.pdf · id: c1"
        ),
    )

    composed = composer.compose(scope())

    assert composed.budget_chars == TOTAL_BUDGET_CHARS


def test_an_explicitly_set_budget_is_honoured_exactly():
    """A caller that pins a size is asking for a fixed number, not a floor."""
    facts = "\n\n".join(f"## Fact {i} about this project." for i in range(200))
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(facts=[{"fact_id": "f1"}], rendered_facts=facts),
        budget_chars=1500,
    )

    composed = composer.compose(scope())

    assert composed.budget_chars == 1500
    assert sum(len(b.body) for b in composed.blocks) <= 1500


# -------------------------------------------------------------------- dedupe


def test_a_fact_restated_in_the_session_summary_is_sent_once():
    """Duplication is not just cost. The same claim arriving from two blocks
    reads as two independent sources confirming it."""
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session={
                **a_session(),
                "summary": "The termination notice period is 60 days.",
            },
        ),
        project_memory=FakeProjectMemory(
            facts=[{"text": "Termination notice period is 60 days"}],
            rendered_facts="Facts recorded for this project:\n\n## Termination notice period is 60 days",
        ),
    )

    composed = composer.compose(scope())

    assert composed.text.count("60 days") == 1
    assert "session_summary" not in [b.name for b in composed.blocks]


def test_two_facts_differing_only_by_a_number_are_both_kept():
    """The regression this module's own dedup nearly introduced.

    The shared word tokenizer discards bare numerals, so "notice is 30 days"
    and "notice is 60 days" have identical token sets. Deduping on words alone
    would delete one notice period and leave the model stating the other with
    no sign the first existed.
    """
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session={**a_session(), "summary": "Termination notice is 30 days."},
        ),
        project_memory=FakeProjectMemory(
            facts=[{"text": "a"}],
            rendered_facts="## Termination notice is 60 days",
        ),
    )

    composed = composer.compose(scope())

    assert "60 days" in composed.text
    assert "30 days" in composed.text


def test_two_different_facts_sharing_a_subject_are_both_kept():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(
            facts=[{"text": "a"}],
            rendered_facts=(
                "## Termination notice period is 60 days\n\n"
                "## Termination requires written notice to the registered address"
            ),
        ),
    )

    composed = composer.compose(scope())

    assert "60 days" in composed.text
    assert "registered address" in composed.text


# ---------------------------------------------------------------- provenance


def test_every_block_states_its_tier_and_where_it_came_from():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session=a_session(),
            recalled=[{"memory_key": "payment_terms", "content": "Net 30."}],
        ),
        project_memory=FakeProjectMemory(notes="Renewal is contentious."),
    )

    composed = composer.compose(scope())

    assert composed.blocks
    for block in composed.blocks:
        assert block.tier
        assert block.provenance
        assert block.provenance in composed.text


def test_recall_written_before_the_write_gate_is_labelled_unverified():
    """These rows were written unreviewed on every turn matching a keyword
    bucket (F-20). The label is the only thing stopping the model reading one
    as established."""
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session=a_session(),
            recalled=[{"memory_key": "payment_terms", "content": "Net 30."}],
        ),
    )

    composed = composer.compose(scope())

    recall = next(b for b in composed.blocks if b.name == "semantic_recall")
    assert "unverified" in recall.provenance


def test_recall_written_under_the_gate_is_labelled_as_cited():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session=a_session(),
            recalled=[
                {"memory_key": "payment", "content": "Net 30.", "origin": "contract"},
            ],
        ),
    )

    composed = composer.compose(scope())

    recall = next(b for b in composed.blocks if b.name == "semantic_recall")
    assert "cited" in recall.provenance
    assert "unverified" not in recall.provenance


def test_a_mixed_recall_block_is_not_labelled_as_uniformly_trustworthy():
    """Migrated rows and gated rows can appear together. Labelling the mixture
    as either one is how an unreviewed fragment reads as an established fact."""
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session=a_session(),
            recalled=[
                {"memory_key": "payment", "content": "Net 30.", "origin": "contract"},
                {"memory_key": "old", "content": "Something older.", "origin": "legacy"},
            ],
        ),
    )

    composed = composer.compose(scope())

    recall = next(b for b in composed.blocks if b.name == "semantic_recall")
    assert "1 older unverified record" in recall.provenance


def test_facts_needing_review_after_an_amendment_are_flagged_in_the_label():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(
            facts=[{"text": "Fee is $10k", "needs_review": True}],
            rendered_facts="## Fee is $10k",
        ),
    )

    composed = composer.compose(scope())

    facts = next(b for b in composed.blocks if b.name == "project_facts")
    assert "flagged for review" in facts.provenance


def test_the_preamble_forbids_citing_memory():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(notes="Renewal is contentious."),
    )

    composed = composer.compose(scope())

    assert "never cite it" in composed.text


# ------------------------------------------------------------------ failures


def test_a_broken_memory_store_degrades_the_answer_instead_of_failing_the_run():
    class Exploding:
        def render_index(self, project_id):
            raise RuntimeError("mongo is down")

        def list_facts(self, project_id, include_superseded=False):
            raise RuntimeError("mongo is down")

        def get_notes(self, project_id):
            raise RuntimeError("mongo is down")

    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(
            session=a_session(),
            messages=[turn("user", "what are the SLAs?", 1)],
        ),
        project_memory=Exploding(),
    )

    composed = composer.compose(scope())

    assert "what are the SLAs?" in composed.text
    assert [b.name for b in composed.blocks] == ["recent_turns"]


def test_no_managers_at_all_composes_an_empty_block_list():
    composed = MemoryComposer().compose(scope())

    assert composed.blocks == []


def test_an_archived_or_missing_session_contributes_no_conversation_blocks():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=None, messages=[turn("user", "hi", 1)]),
    )

    composed = composer.compose(scope())

    assert composed.blocks == []


# ---------------------------------------------------------------- truncation


def test_truncation_cuts_between_facts_not_inside_one():
    """Half a fact is worse than no fact — it keeps the claim and drops the
    qualifier, and nothing downstream can tell it was cut."""
    body = "## Notice is 60 days\n\n## Fees escalate 3% annually\n\n## Cap is 12 months"

    fitted, truncated = _fit(body, 45)

    assert truncated
    assert fitted == "## Notice is 60 days"


def test_a_block_that_cannot_fit_usefully_is_dropped_rather_than_stubbed():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(notes="\n".join(f"note line {i}" for i in range(200))),
        budget_chars=MIN_USEFUL_BLOCK_CHARS - 20,
    )

    composed = composer.compose(scope())

    assert "project_notes" in composed.dropped
    assert not composed.blocks


def test_truncated_blocks_are_reported_not_silently_shortened():
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session()),
        project_memory=FakeProjectMemory(notes="\n".join(f"note line {i}" for i in range(400))),
        budget_chars=1200,
    )

    composed = composer.compose(scope())

    assert composed.truncated == ["project_notes"]
    assert composed.as_trace()["truncated"] == ["project_notes"]


# ----------------------------------------------------------- the UI contract


def test_compose_returns_structure_the_panel_can_render_not_only_a_string():
    """4.5 shows the user what the model was told, by tier. Re-parsing the
    prose to rebuild that would be a second source of truth for it."""
    composer = MemoryComposer(
        agent_memory=FakeAgentMemory(session=a_session(), messages=[turn("user", "hi", 1)]),
        project_memory=FakeProjectMemory(notes="Renewal is contentious."),
    )

    composed = composer.compose(scope())
    trace = composed.as_trace()

    assert {entry["name"] for entry in trace["blocks"]} == {"recent_turns", "project_notes"}
    assert all(entry["tier"] for entry in trace["blocks"])
    assert trace["budget_chars"] == TOTAL_BUDGET_CHARS


def test_extra_blocks_compose_alongside_the_managers():
    """The extension point 2.5's preferences block uses."""
    extra = MemoryBlock(
        name="preferences",
        tier="semantic",
        heading="How this user works",
        body="- Jurisdiction: England and Wales",
        priority=80,
        provenance="account settings",
    )
    composer = MemoryComposer(agent_memory=FakeAgentMemory(session=a_session()))

    composed = composer.compose(scope(), extra_blocks=[extra])

    assert [b.name for b in composed.blocks] == ["preferences"]
    assert "England and Wales" in composed.text


@pytest.mark.parametrize("kpi", ["", "   ", "\n"])
def test_blank_kpi_context_adds_no_block(kpi):
    composer = MemoryComposer(agent_memory=FakeAgentMemory(session=a_session()))

    composed = composer.compose(scope(), kpi_context=kpi)

    assert "kpi_context" not in [b.name for b in composed.blocks]
