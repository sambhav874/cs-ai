"""Tests for ClauseLedger — the loss accounting behind the Phase 1 gate.

Measured once this existed: of the clauses the Stage-1 screen accepted as genuine
obligation candidates, **46.6% produced no record** on an 18k contract, 54.7% on a
62k one, and 44.2% on a duties-heavy 14k DPA. Span coverage stayed near 97%
throughout, so roughly half of every contract was vanishing behind a healthy-looking
metric.

The ledger's whole job is that a clause can never quietly disappear: it is
extracted, explicitly rejected, or counted as lost.
"""

import threading

from services.kpi_manager import ClauseLedger


def test_accepted_clause_that_produces_a_record_is_extracted():
    ledger = ClauseLedger()
    ledger.accept(["src_1", "src_2"])
    ledger.mark_extracted(["src_1", "src_2"])

    result = ledger.finalize()

    assert result["extracted"] == 2
    assert result["lost"] == 0
    assert result["accounted_ratio"] == 1.0


def test_accepted_clause_that_produces_nothing_is_lost():
    """The core case: silence must not read as success."""
    ledger = ClauseLedger()
    ledger.accept(["src_1", "src_2", "src_3"])
    ledger.mark_extracted(["src_1"])

    result = ledger.finalize()

    assert result["extracted"] == 1
    assert result["lost"] == 2
    assert sorted(result["lost_source_ids"]) == ["src_2", "src_3"]


def test_rejected_clauses_are_accounted_not_lost():
    """A Stage-1 rejection is a decision, not a disappearance."""
    ledger = ClauseLedger()
    ledger.accept(["src_1"])
    ledger.reject(["src_2", "src_3"])
    ledger.mark_extracted(["src_1"])

    result = ledger.finalize()

    assert result["rejected"] == 2
    assert result["lost"] == 0
    assert result["accounted_ratio"] == 1.0


def test_accounted_ratio_reflects_partial_loss():
    ledger = ClauseLedger()
    ledger.accept([f"src_{i}" for i in range(10)])
    ledger.mark_extracted([f"src_{i}" for i in range(6)])

    assert ledger.finalize()["accounted_ratio"] == 0.6


def test_reasons_explain_why_clauses_went_unresolved():
    ledger = ClauseLedger()
    ledger.accept(["src_1", "src_2"])
    ledger.note(["src_1", "src_2"], "empty_batch_response")

    result = ledger.finalize()

    assert result["lost"] == 2
    assert result["lost_reasons"] == {"empty_batch_response": 2}


def test_unexplained_loss_is_labelled_as_such():
    """A clause lost with no recorded reason must still be visible."""
    ledger = ClauseLedger()
    ledger.accept(["src_1"])

    assert ledger.finalize()["lost_reasons"] == {"unexplained": 1}


def test_first_reason_wins_and_extraction_clears_the_loss():
    ledger = ClauseLedger()
    ledger.accept(["src_1"])
    ledger.note(["src_1"], "empty_batch_response")
    ledger.mark_extracted(["src_1"])

    result = ledger.finalize()

    assert result["lost"] == 0
    assert result["lost_reasons"] == {}


def test_mark_extracted_ignores_ids_never_accepted():
    """A record citing an unknown source_id must not invent a ledger entry."""
    ledger = ClauseLedger()
    ledger.accept(["src_1"])
    ledger.mark_extracted(["src_1", "src_999"])

    result = ledger.finalize()

    assert result["total"] == 1
    assert result["extracted"] == 1


def test_finalize_is_stable_when_called_twice():
    ledger = ClauseLedger()
    ledger.accept(["src_1", "src_2"])
    ledger.mark_extracted(["src_1"])

    assert ledger.finalize() == ledger.finalize()


def test_empty_ledger_is_fully_accounted():
    """A contract with no candidate clauses is not a loss."""
    result = ClauseLedger().finalize()

    assert result["total"] == 0
    assert result["lost"] == 0
    assert result["accounted_ratio"] == 1.0


def test_concurrent_marking_is_safe():
    """The merge loop marks from six worker threads."""
    ledger = ClauseLedger()
    ids = [f"src_{i}" for i in range(600)]
    ledger.accept(ids)

    def worker(chunk):
        ledger.mark_extracted(chunk)

    threads = [
        threading.Thread(target=worker, args=(ids[i::6],))
        for i in range(6)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    result = ledger.finalize()
    assert result["extracted"] == 600
    assert result["lost"] == 0


def test_lost_id_listing_is_capped_but_count_is_not():
    """A pathological run must not put thousands of ids in the run document."""
    ledger = ClauseLedger()
    ledger.accept([f"src_{i}" for i in range(500)])

    result = ledger.finalize()

    assert result["lost"] == 500
    assert len(result["lost_source_ids"]) == 200


def test_duplicate_row_still_counts_its_clause_as_extracted():
    """A deduplicated record is not a lost clause.

    The merge loop drops a row whose (clause_ref, quote, name) signature was
    already seen. That row's clause was still processed and still yielded a
    record — marking only the surviving row counted the duplicate's clause as
    lost. Marking happens before the dedup guard for this reason. (Moving it did
    not change the fixture numbers — the loss there has a different cause, still
    being traced — but the ordering is correct on its own terms.)
    """
    ledger = ClauseLedger()
    ledger.accept(["src_1", "src_2"])

    # Both rows produced a record; the second was a duplicate of the first.
    ledger.mark_extracted(["src_1"])
    ledger.mark_extracted(["src_2"])  # deduped away downstream, still extracted

    result = ledger.finalize()

    assert result["lost"] == 0
    assert result["extracted"] == 2
