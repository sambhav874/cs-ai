"""Tests for embedded recall and the memory write gate (Phase 2.3, F-18, F-20).

Embeddings are injected as plain vectors rather than called, so these tests
exercise the ranking and the gate rather than a provider's embedding quality.
The one thing they do assert about embeddings is the property the old lexical
scan could not have: that a paraphrase sharing no tokens still recalls.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from services.memory import semantic


def record(content, *, vector=None, key="k", updated_days_ago=0, origin="contract", **extra):
    doc = {
        "memory_key": key,
        "content": content,
        "origin": origin,
        "updated_at": datetime.utcnow() - timedelta(days=updated_days_ago),
    }
    if vector is not None:
        doc["embedding"] = vector
    doc.update(extra)
    return doc


# ------------------------------------------------------------------- recall


def test_a_paraphrase_sharing_no_tokens_still_recalls_the_right_memory():
    """The F-18 done-when.

    "what do we owe them each month?" and a memory about invoicing share no
    content words. The old scan counted query tokens present in the string and
    scored this zero, so recall failed silently — indistinguishable from
    having no memory at all.
    """
    invoicing = record("Invoices are issued monthly, net 30.", vector=[1.0, 0.0, 0.0])
    termination = record("Either party may terminate on 60 days notice.", vector=[0.0, 1.0, 0.0])

    ranked = semantic.rank(
        "what do we owe them each month?",
        [termination, invoicing],
        query_vector=[0.95, 0.05, 0.0],
    )

    assert ranked and ranked[0] is invoicing


def test_an_unrelated_memory_is_not_recalled_just_because_it_ranks_highest():
    """Top-k with no floor always returns something, however unrelated. A
    confidently-presented irrelevant memory is worse than an empty block."""
    unrelated = record("The parking allocation is four spaces.", vector=[0.0, 0.0, 1.0])

    ranked = semantic.rank("payment terms?", [unrelated], query_vector=[1.0, 0.0, 0.0])

    assert ranked == []


def test_recency_breaks_ties_without_burying_older_knowledge():
    old = record("Fee is 10k.", vector=[1.0, 0.0, 0.0], updated_days_ago=200)
    new = record("Fee is 12k.", vector=[1.0, 0.0, 0.0], updated_days_ago=1)

    ranked = semantic.rank("what is the fee?", [old, new], query_vector=[1.0, 0.0, 0.0], limit=2)

    assert [r["content"] for r in ranked] == ["Fee is 12k.", "Fee is 10k."]
    assert len(ranked) == 2, "the older memory was buried rather than ranked lower"


def test_a_much_more_relevant_old_memory_still_beats_a_barely_relevant_new_one():
    """Recency is a weight, not a filter. A contract term learned six months
    ago is usually still true."""
    relevant_old = record("Notice period is 60 days.", vector=[1.0, 0.0, 0.0], updated_days_ago=180)
    marginal_new = record("Parking is four spaces.", vector=[0.6, 0.8, 0.0], updated_days_ago=0)

    ranked = semantic.rank(
        "how much notice?", [marginal_new, relevant_old], query_vector=[1.0, 0.0, 0.0], limit=1
    )

    assert ranked[0] is relevant_old


def test_a_record_with_no_embedding_falls_back_to_lexical_rather_than_vanishing():
    """Pre-2.3 rows carry no vector. They are still the user's memory; 2.6's
    decay is what should retire them, not how they happened to be written."""
    legacy = record("Payment terms are net 30.", origin=None)

    ranked = semantic.rank("what are the payment terms?", [legacy], query_vector=[1.0, 0.0])

    assert ranked == [legacy]


def test_recall_with_no_embeddings_backend_at_all_still_returns_matches():
    legacy = record("Payment terms are net 30.", origin=None)

    ranked = semantic.rank("what are the payment terms?", [legacy], query_vector=[])

    assert ranked == [legacy]


def test_an_unknown_timestamp_is_not_treated_as_ancient():
    """A row with no updated_at predates the field far more often than it is
    genuinely old, and scoring it as maximally stale hides exactly the migrated
    records that most need review."""
    assert semantic.recency_weight(None) == 1.0


def test_recency_weight_halves_at_the_half_life():
    now = datetime.utcnow()
    weight = semantic.recency_weight(
        now - timedelta(days=90), now=now, half_life_days=90
    )

    assert weight == pytest.approx(0.5, abs=0.01)


def test_cosine_handles_mismatched_and_empty_vectors():
    assert semantic.cosine([1.0, 0.0], [1.0, 0.0, 0.0]) == 0.0
    assert semantic.cosine([], [1.0]) == 0.0
    assert semantic.cosine([0.0, 0.0], [1.0, 1.0]) == 0.0
    assert semantic.cosine([1.0, 0.0], [1.0, 0.0]) == pytest.approx(1.0)


def test_ranking_an_empty_store_returns_nothing():
    assert semantic.rank("anything", []) == []


# --------------------------------------------------------------- write gate


def test_an_uncited_answer_is_not_written_to_durable_memory():
    """The whole of F-20. The old rule was "the question mentioned one of five
    keywords", which is not evidence that anything is worth keeping."""
    assert not semantic.is_durable_answer(
        citation_count=0, confidence="high", answer="Payment is probably monthly."
    )


def test_a_cited_high_confidence_answer_is_written():
    assert semantic.is_durable_answer(
        citation_count=2, confidence="high", answer="Payment is net 30."
    )


def test_a_cited_but_low_confidence_answer_is_not_written():
    assert not semantic.is_durable_answer(
        citation_count=2, confidence="low", answer="Payment might be net 30."
    )


def test_an_explicit_user_request_is_written_regardless_of_citations():
    """The user asking to remember something is the strongest signal there is,
    and it does not need a citation to be worth keeping."""
    assert semantic.is_durable_answer(
        citation_count=0, confidence=None, answer="", explicit_request=True
    )


def test_an_empty_answer_is_never_written_even_when_cited():
    assert not semantic.is_durable_answer(citation_count=3, confidence="high", answer="   ")


@pytest.mark.parametrize("confidence", ["High", "MEDIUM", "medium"])
def test_confidence_matching_is_case_insensitive(confidence):
    assert semantic.is_durable_answer(citation_count=1, confidence=confidence, answer="x")


@pytest.mark.parametrize("confidence", [None, "", "unknown", "low"])
def test_a_missing_or_weak_confidence_does_not_qualify(confidence):
    assert not semantic.is_durable_answer(citation_count=1, confidence=confidence, answer="x")


def test_the_keyword_bucket_router_is_gone():
    """`_question_memory_key` forced every question into one of five buckets
    and made that bucket the key a memory overwrote."""
    import services.agent_memory as agent_memory

    assert not hasattr(agent_memory, "_question_memory_key")
    assert not hasattr(agent_memory.AgentMemoryManager, "remember_turn")


# ------------------------------------------------------------ the write path


class FakeMemories:
    def __init__(self):
        self.inserted = []

    def insert_one(self, doc):
        self.inserted.append(doc)


class Manager:
    """AgentMemoryManager's write path without a Mongo client."""

    def __init__(self):
        self.memories = FakeMemories()

    def write(self, **kwargs):
        from services.agent_memory import AgentMemoryManager

        base = dict(
            contract_id="c1",
            user_id="u1",
            session_id="s1",
            question="what are the payment terms?",
            answer="Payment is net 30.",
        )
        base.update(kwargs)
        return AgentMemoryManager.remember_answer_if_durable(self, **base)


def test_a_gated_write_stores_provenance_not_just_content(monkeypatch):
    monkeypatch.setattr(semantic, "embed", lambda text: [0.1, 0.2])
    manager = Manager()

    written = manager.write(citation_count=2, confidence="high", quote="net thirty days")

    assert written is not None
    assert written["origin"] == "contract"
    assert written["source_contract_id"] == "c1"
    assert written["quote"] == "net thirty days"
    assert written["citation_count"] == 2
    assert written["embedding"] == [0.1, 0.2]
    assert written["last_verified_at"]


def test_writes_append_rather_than_overwrite_the_same_key(monkeypatch):
    """Overwriting meant a contract could remember exactly one thing about
    payment, and it was whichever answer came last."""
    monkeypatch.setattr(semantic, "embed", lambda text: None)
    manager = Manager()

    manager.write(question="payment terms?", answer="Net 30.", citation_count=1, confidence="high")
    manager.write(question="payment terms?", answer="Net 45 after amendment.", citation_count=1, confidence="high")

    assert len(manager.memories.inserted) == 2
    assert {doc["content"] for doc in manager.memories.inserted} == {"Net 30.", "Net 45 after amendment."}


def test_an_ungated_turn_writes_nothing_at_all(monkeypatch):
    monkeypatch.setattr(semantic, "embed", lambda text: None)
    manager = Manager()

    assert manager.write(citation_count=0, confidence="high") is None
    assert manager.memories.inserted == []


def test_a_write_survives_the_embeddings_backend_being_unavailable(monkeypatch):
    monkeypatch.setattr(semantic, "embed", lambda text: None)
    manager = Manager()

    written = manager.write(citation_count=1, confidence="high")

    assert written is not None
    assert written["embedding"] is None
