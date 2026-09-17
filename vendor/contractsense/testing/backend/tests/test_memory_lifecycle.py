"""Tests for memory lifecycle: decay TTL, consolidation, provenance
propagation (Phase 2.6, F-23).

No Mongo — every function here is a pure transform over records the caller
already fetched.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from services.memory.lifecycle import apply_ttl, consolidate, flag_memories_for_amended_document


NOW = datetime(2026, 8, 18, 12, 0, 0)


def _memory(**overrides):
    base = {
        "memory_id": "mem-1",
        "memory_key": "payment terms",
        "content": "Invoices are payable net 30 days after receipt.",
        "origin": "contract",
        "confidence": None,
        "last_verified_at": NOW,
    }
    base.update(overrides)
    return base


# --------------------------------------------------------------------- TTL


def test_a_fresh_memory_survives_ttl():
    memories = [_memory(last_verified_at=NOW - timedelta(days=10))]
    assert apply_ttl(memories, now=NOW, ttl_days=180) == memories


def test_a_memory_past_ttl_is_dropped():
    memories = [_memory(last_verified_at=NOW - timedelta(days=200))]
    assert apply_ttl(memories, now=NOW, ttl_days=180) == []


def test_a_memory_exactly_at_ttl_boundary_survives():
    memories = [_memory(last_verified_at=NOW - timedelta(days=180))]
    assert apply_ttl(memories, now=NOW, ttl_days=180) == memories


def test_user_requested_memories_never_expire():
    memories = [_memory(origin="user", last_verified_at=NOW - timedelta(days=5000))]
    assert apply_ttl(memories, now=NOW, ttl_days=180) == memories


def test_ttl_falls_back_to_updated_at_when_last_verified_at_is_missing():
    memories = [_memory(last_verified_at=None, updated_at=NOW - timedelta(days=200))]
    assert apply_ttl(memories, now=NOW, ttl_days=180) == []


def test_a_memory_with_no_timestamp_at_all_is_treated_as_fresh():
    # Zero age, not expired — an unknown age must not be scored as infinitely
    # old, or a record missing a field would be silently deleted from recall.
    memories = [_memory(last_verified_at=None)]
    assert apply_ttl(memories, now=NOW, ttl_days=180) == memories


# ------------------------------------------------------------- consolidation


def test_two_unrelated_memories_both_survive():
    memories = [
        _memory(memory_id="mem-1", content="Invoices are payable net 30 days after receipt."),
        _memory(memory_id="mem-2", content="Termination requires 60 days written notice."),
    ]
    kept = consolidate(memories)
    assert {r["memory_id"] for r in kept} == {"mem-1", "mem-2"}


def test_two_near_duplicate_memories_merge_into_the_first():
    memories = [
        _memory(memory_id="mem-1", content="Invoices are payable net 30 days after receipt."),
        _memory(memory_id="mem-2", content="Invoices are payable net 30 days after receipt of invoice."),
    ]
    kept = consolidate(memories)
    assert len(kept) == 1
    assert kept[0]["memory_id"] == "mem-1"


def test_merging_two_agreeing_memories_raises_confidence_to_high():
    memories = [
        _memory(memory_id="mem-1", content="Notice period is 60 days.", confidence="medium"),
        _memory(memory_id="mem-2", content="Notice period is 60 days written.", confidence="medium"),
    ]
    kept = consolidate(memories)
    assert kept[0]["confidence"] == "high"
    assert kept[0]["confirmed_count"] == 2


def test_a_single_memory_keeps_its_original_confidence():
    memories = [_memory(memory_id="mem-1", confidence="low")]
    kept = consolidate(memories)
    assert kept[0]["confidence"] == "low"
    assert kept[0]["confirmed_count"] == 1


def test_two_facts_differing_only_by_a_number_do_not_merge():
    # Same bug class as the composer's dedup (F-17): the number is usually the
    # whole fact for a contract memory, so two different figures must survive
    # as two records, not collapse into whichever came first.
    memories = [
        _memory(memory_id="mem-1", memory_key="notice period", content="Notice period is 30 days."),
        _memory(memory_id="mem-2", memory_key="notice period", content="Notice period is 60 days."),
    ]
    kept = consolidate(memories)
    assert {r["memory_id"] for r in kept} == {"mem-1", "mem-2"}


# ------------------------------------------------------- provenance propagation


class FakeUpdateResult:
    def __init__(self, modified_count):
        self.modified_count = modified_count


class FakeCollection:
    def __init__(self, docs):
        self.docs = docs
        self.last_query = None

    def update_many(self, query, update):
        self.last_query = query
        matched = [
            doc for doc in self.docs
            if doc.get("source_contract_id") == query.get("source_contract_id")
        ]
        for doc in matched:
            doc.update(update["$set"])
        return FakeUpdateResult(len(matched))


def test_flagging_marks_only_memories_from_the_amended_contract():
    docs = [
        {"memory_id": "mem-1", "source_contract_id": "contract-a", "needs_review": False},
        {"memory_id": "mem-2", "source_contract_id": "contract-b", "needs_review": False},
    ]
    collection = FakeCollection(docs)
    flagged = flag_memories_for_amended_document(collection, contract_id="contract-a")
    assert flagged == 1
    assert docs[0]["needs_review"] is True
    assert docs[1]["needs_review"] is False
