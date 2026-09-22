"""Retrieval over an org's linked contracts, served to the lifecycle API.

Replaces draftLegal's pgvector clause search, which cannot run on MongoDB.
Scope is the org's own analysed, non-deleted copies; hits come back keyed by
the platform contract id.
"""
import mongomock
from bson import ObjectId

from core.platform_identity import derive_object_id
from services.platform_retrieval import MIN_SCORE, search_platform_contracts

ORG, OTHER = "cmorg00000000000000000001", "cmorg00000000000000000002"

TERMINATION = (
    "1. Definitions. The Carrier and the Handler agree as follows.\n\n"
    "12. Termination. Either party may terminate this Agreement for convenience "
    "on ninety (90) days' written notice to the other party. The Handler may "
    "terminate immediately if the Carrier fails to pay any undisputed invoice "
    "within thirty (30) days of its due date.\n\n"
    "13. Governing law. This Agreement is governed by the laws of England."
)


def _copy(contracts, org, pid, content, **extra):
    doc = {
        "_id": ObjectId(), "ownerType": "team", "ownerId": derive_object_id("org", org),
        "platformContractId": pid, "contract_name": pid, "platformDeleted": False,
        "index": {"status": "done", "content": content}, **extra,
    }
    contracts.insert_one(doc)
    return doc


def fake_search(record):
    def run(collection, documents, queries, top_k):
        record["docs"] = [d["platformContractId"] for d in documents]
        return ([{"document_id": str(d["_id"]), "segment_id": f"s{i}", "quote": "q",
                  "score": 90 - i * 30} for i, d in enumerate(documents)], "fake", {})
    return run


def test_scope_is_the_orgs_live_analysed_copies_only():
    c = mongomock.MongoClient().cs.contracts
    _copy(c, ORG, "mine", "text")
    _copy(c, ORG, "deleted", "text", platformDeleted=True)
    _copy(c, ORG, "not-ingested", "")
    _copy(c, OTHER, "theirs", "text")
    c.insert_one({"_id": ObjectId(), "ownerType": "team", "ownerId": derive_object_id("org", ORG),
                  "index": {"content": "uploaded straight to ContractSense"}})
    seen = {}
    search_platform_contracts(ORG, "termination", limit=5, contracts=c, search=fake_search(seen))
    assert seen["docs"] == ["mine"]


def test_restricting_to_named_contracts():
    c = mongomock.MongoClient().cs.contracts
    for pid in ("a", "b", "c"):
        _copy(c, ORG, pid, "text")
    seen = {}
    search_platform_contracts(ORG, "q", limit=5, contracts=c, platform_contract_ids=["b"], search=fake_search(seen))
    assert seen["docs"] == ["b"]


def test_weak_hits_are_dropped_and_the_rest_ranked():
    c = mongomock.MongoClient().cs.contracts
    for pid in ("a", "b", "c"):
        _copy(c, ORG, pid, "text")
    hits = search_platform_contracts(ORG, "q", limit=5, contracts=c, search=fake_search({}))
    assert [h["score"] for h in hits] == [90, 60]  # 30 is below MIN_SCORE
    assert all(h["score"] >= MIN_SCORE for h in hits)
    assert hits[0]["platformContractId"] == "a"


def test_nothing_linked_means_no_hits_and_no_search():
    c = mongomock.MongoClient().cs.contracts
    seen = {}
    assert search_platform_contracts(ORG, "q", limit=5, contracts=c, search=fake_search(seen)) == []
    assert "docs" not in seen


def test_real_pipeline_finds_the_termination_clause():
    # The real ContractSense retrieval, not a stub: the passage about notice
    # periods must come back for a termination question, keyed to its contract.
    c = mongomock.MongoClient().cs.contracts
    _copy(c, ORG, "gha", TERMINATION)
    _copy(c, ORG, "nda", "Confidential Information means any information disclosed by either party.")
    hits = search_platform_contracts(ORG, "How much notice is needed to terminate for convenience?", limit=5, contracts=c)
    assert hits, "no hits from the real pipeline"
    assert hits[0]["platformContractId"] == "gha"
    assert "ninety" in (hits[0]["quote"] + hits[0]["context"]).lower()


def test_lexical_fallback_keeps_hits_relative_to_the_best():
    # With no vector index the scores sit far below the hybrid bar; an absolute
    # cut-off would drop the right answer (seen live: the right passage at 24).
    c = mongomock.MongoClient().cs.contracts
    for pid in ("a", "b", "c"):
        _copy(c, ORG, pid, "text")

    def fallback(collection, documents, queries, top_k):
        scores = [24.0, 20.0, 9.0]
        return ([{"document_id": str(d["_id"]), "quote": "q", "score": s}
                 for d, s in zip(documents, scores)], "fallback_index", {})

    hits = search_platform_contracts(ORG, "q", limit=5, contracts=c, search=fallback)
    assert [h["score"] for h in hits] == [24.0, 20.0]  # 9 < 0.6 × 24
