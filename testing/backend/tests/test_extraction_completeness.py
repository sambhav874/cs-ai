"""P1–P5: completeness contract, safe failure, determinism, provenance.

Measured on three fixtures before P1 existed: 44–55% of Stage-1-accepted clause
instances produced no record, and **93% of that loss was the model silently
skipping clauses inside a batch it answered successfully** — the call returned,
the JSON parsed, rows came back, and most clauses simply had no row. Nothing in
the pipeline could distinguish that from "there was nothing to extract".
"""

from unittest.mock import MagicMock

from services.kpi_manager import ClauseLedger, ContractKPIManager


def _manager():
    return ContractKPIManager(database=MagicMock())


def _batch(*source_ids):
    return [{"source_id": sid, "text": f"clause text for {sid}, long enough to matter"} for sid in source_ids]


# ── P1: completeness contract ────────────────────────────────────────────────

def test_rows_are_accounted_reads_flat_and_phase_shapes():
    manager = _manager()
    rows = [{"source_id": "a"}, {"phase1": {"source_id": "b"}}, {"no_id": True}, "not a dict"]

    assert manager._rows_are_accounted(rows) == {"a", "b"}


def test_no_obligation_verdict_counts_as_accounted():
    """An explicit decline is an answer, not a silence."""
    manager = _manager()
    rows = [{"source_id": "a", "record_type": "no_obligation", "notes": "definition only"}]

    assert manager._rows_are_accounted(rows) == {"a"}


def test_omitted_clauses_are_re_prompted_and_recovered(monkeypatch):
    manager = _manager()
    batch = _batch("s1", "s2", "s3")
    calls = []

    def fake_extract(sub_batch, contract_name, provider, pack_block=""):
        calls.append([r["source_id"] for r in sub_batch])
        if len(calls) == 1:
            return [{"source_id": "s1", "name": "found"}], {r["source_id"]: r for r in sub_batch}
        return (
            [{"source_id": sid, "name": "recovered"} for sid in ("s2", "s3")],
            {r["source_id"]: r for r in sub_batch},
        )

    monkeypatch.setattr(manager, "_extract_batch_llm_rows", fake_extract)
    rows, _lookup, missing = manager._extract_batch_complete(batch, "c", "groq")

    assert calls[0] == ["s1", "s2", "s3"]
    assert calls[1] == ["s2", "s3"], "retry must be scoped to the gap, not the whole batch"
    assert missing == set()
    assert len(rows) == 3


def test_a_fully_answered_batch_costs_no_retry(monkeypatch):
    manager = _manager()
    batch = _batch("s1", "s2")
    calls = []

    def fake_extract(sub_batch, contract_name, provider, pack_block=""):
        calls.append(1)
        return ([{"source_id": r["source_id"]} for r in sub_batch], {})

    monkeypatch.setattr(manager, "_extract_batch_llm_rows", fake_extract)
    _rows, _lookup, missing = manager._extract_batch_complete(batch, "c", "groq")

    assert len(calls) == 1
    assert missing == set()


def test_an_unanswerable_batch_is_split_down_to_clauses_before_being_reported_lost(monkeypatch):
    """This used to assert the opposite: that a wholly empty answer was left to
    the inner retry and otherwise abandoned. Measured on a real MRO agreement,
    that lost 24 of 38 accepted clauses in one run — the inner retry re-sends
    the identical prompt, so an output-budget failure reproduces exactly.

    A batch that cannot be answered is now halved until it can be, and only a
    single clause that still returns nothing is reported lost.
    """
    manager = _manager()
    sizes = []

    def fake_extract(sub_batch, contract_name, provider, pack_block=""):
        sizes.append(len(sub_batch))
        return ([], {})

    monkeypatch.setattr(manager, "_extract_batch_llm_rows", fake_extract)
    _rows, _lookup, missing = manager._extract_batch_complete(_batch("s1", "s2"), "c", "groq")

    assert sizes == [2, 1, 1], "the batch is halved before its clauses are given up on"
    assert missing == {"s1", "s2"}


def test_still_missing_after_retry_is_reported(monkeypatch):
    manager = _manager()

    def fake_extract(sub_batch, contract_name, provider, pack_block=""):
        return ([{"source_id": "s1"}], {})

    monkeypatch.setattr(manager, "_extract_batch_llm_rows", fake_extract)
    _rows, _lookup, missing = manager._extract_batch_complete(_batch("s1", "s2"), "c", "groq")

    assert missing == {"s2"}


def test_completeness_is_enforced_in_code_not_in_the_prompt():
    """Guards a decision that measurement reversed.

    A completeness rule was added to the prompt, demanding a verdict for every
    source_id. Scored against 68 hand-labelled obligations it cut clause loss to
    near zero but cost 19 points of threshold accuracy — and the damage was on
    the *same* obligations both runs matched (83.7% -> 67.3% over 49 shared
    labels), not on newly recovered ones. The model, told it must answer for
    every clause, emitted renamed duplicates that bound no values. Instructing
    it to decline more often made it worse still (83 records -> 95).

    The retry in `_extract_batch_complete` recovers omitted clauses without
    touching how the model treats clauses it did answer, and beats the original
    baseline on all four correctness axes. So completeness lives in code.

    Re-adding the rule to the prompt should fail this test and be re-measured
    against the labels first.
    """
    manager = _manager()
    prompt = manager._build_kpi_llm_prompt(contract_name="c", records=_batch("s1"))

    assert "COMPLETENESS RULE" not in prompt
    assert hasattr(manager, "_extract_batch_complete")


# ── P3: a non-verbatim quote must not be laundered ───────────────────────────

def test_validated_quote_returns_none_when_not_in_source():
    """It used to return the whole source clause, which made a fabricated
    citation indistinguishable from a real one."""
    manager = _manager()

    assert manager._validated_quote("a quote the model invented", "the real source text") is None


def test_validated_quote_returns_the_quote_when_present():
    manager = _manager()
    source = "Provider shall respond within four hours of notice."

    assert manager._validated_quote("respond within four hours", source) == "respond within four hours"


def test_validated_quote_tolerates_whitespace_differences():
    manager = _manager()
    source = "Provider shall   respond\nwithin four hours."

    assert manager._validated_quote("Provider shall respond within four hours", source) is not None


# ── P5: provenance ───────────────────────────────────────────────────────────

def test_prompt_version_is_declared():
    assert ContractKPIManager.EXTRACTION_PROMPT_VERSION


# ── P2: the ledger distinguishes a decline from a silence ────────────────────

def test_explicit_decline_is_rejected_not_lost():
    ledger = ClauseLedger()
    ledger.accept(["s1", "s2"])
    ledger.reject(["s1"], "model_no_obligation")
    ledger.mark_extracted(["s2"])

    result = ledger.finalize()

    assert result["lost"] == 0
    assert result["rejected"] == 1
    assert result["accounted_ratio"] == 1.0


# ── Deterministic duplicate collapse ─────────────────────────────────────────

def test_renamed_duplicate_of_a_clause_is_dropped():
    """Same quote under two names is one obligation, not two.

    The completeness contract makes the model answer for every clause; asked
    about one whose duty it already emitted, it invents a renamed record rather
    than declining. Telling it not to made things worse (83 records to 95), so
    the rule is enforced here.
    """
    manager = _manager()
    items = [
        {"name": "Termination Trigger Thresholds", "quote": "Three Material Service Failures in any rolling six-month period.", "value": None},
        {"name": "Termination for Cause Triggers (Base)", "quote": "Three Material Service Failures in any rolling six-month period.", "value": 3, "unit": "failures"},
        {"name": "Unrelated duty", "quote": "Northstar shall retain records for seven years.", "value": 7, "unit": "years"},
    ]

    kept = manager._drop_renamed_duplicates(items)

    assert len(kept) == 2
    assert kept[0]["name"] == "Termination for Cause Triggers (Base)", "the record that binds a value must win"
    assert kept[1]["name"] == "Unrelated duty"


def test_duplicate_collapse_preserves_input_order():
    manager = _manager()
    items = [
        {"name": "a", "quote": "first clause text here", "value": 1},
        {"name": "b", "quote": "second clause text here", "value": 2},
        {"name": "c", "quote": "first clause text here", "value": None},
    ]

    kept = manager._drop_renamed_duplicates(items)

    assert [k["name"] for k in kept] == ["a", "b"]


def test_records_without_a_quote_are_not_merged_together():
    """An empty quote is not evidence that two records are the same duty."""
    manager = _manager()
    items = [{"name": "a", "quote": ""}, {"name": "b", "quote": ""}]

    assert len(manager._drop_renamed_duplicates(items)) == 2


def test_duplicate_collapse_on_empty_input():
    assert _manager()._drop_renamed_duplicates([]) == []


# ── Call budget ──────────────────────────────────────────────────────────────

def test_batches_are_sized_for_the_current_output_cap():
    """Batch sizes were tuned for an 8192-token cap that no longer applies.

    At 8000 chars / 10 records a contract cost 29 LLM calls (14 Stage-1 +
    15 Stage-2) while asking the model for only ~3,500 output tokens per call.
    With EXTRACTION_MAX_TOKENS at 32000 the same contract fits in 11 calls.
    """
    manager = _manager()
    records = [{"source_id": f"s{i}", "text": "x" * 600} for i in range(147)]

    batches = manager._batch_clause_records(records)

    assert len(batches) <= 8, f"expected <=8 Stage-2 batches, got {len(batches)}"
    assert max(len(b) for b in batches) <= 24


def test_batch_output_stays_within_the_extraction_cap():
    """A batch must not ask for more output than the cap allows."""
    manager = _manager()
    records = [{"source_id": f"s{i}", "text": "x" * 600} for i in range(147)]

    largest = max(len(b) for b in manager._batch_clause_records(records))
    estimated_output_tokens = largest * 350

    assert estimated_output_tokens < ContractKPIManager.EXTRACTION_MAX_TOKENS * 0.6


def test_the_family_pack_reaches_the_retry_as_well_as_the_first_attempt(monkeypatch):
    """A retry prompted without the pack would extract under different context
    than the attempt it is repairing, so the two halves of a batch would not be
    comparable."""
    manager = _manager()
    seen_blocks = []

    def fake_extract(sub_batch, contract_name, provider, pack_block=""):
        seen_blocks.append(pack_block)
        if len(seen_blocks) == 1:
            return [{"source_id": "s1"}], {r["source_id"]: r for r in sub_batch}
        return [{"source_id": "s2"}], {r["source_id"]: r for r in sub_batch}

    monkeypatch.setattr(manager, "_extract_batch_llm_rows", fake_extract)
    manager._extract_batch_complete(_batch("s1", "s2"), "c", "groq", "<CONTRACT_TYPE_PACK>x</CONTRACT_TYPE_PACK>")

    assert seen_blocks == ["<CONTRACT_TYPE_PACK>x</CONTRACT_TYPE_PACK>"] * 2


def test_an_empty_batch_is_split_rather_than_abandoned(monkeypatch):
    """A wholly empty answer is an output-budget failure, not a verdict.

    Measured on a two-page MRO agreement: 24 of 38 accepted clauses lost, every
    one to `empty_batch_response`. Re-prompting the same batch reproduces it;
    halving it fits the provider's output cap.
    """
    manager = _manager()
    batch = _batch("s1", "s2", "s3", "s4")
    calls = []

    def fake_extract(sub_batch, contract_name, provider, pack_block=""):
        ids = [r["source_id"] for r in sub_batch]
        calls.append(ids)
        if len(ids) > 2:
            return [], {r["source_id"]: r for r in sub_batch}       # too big to answer
        return [{"source_id": sid} for sid in ids], {r["source_id"]: r for r in sub_batch}

    monkeypatch.setattr(manager, "_extract_batch_llm_rows", fake_extract)
    rows, _lookup, missing = manager._extract_batch_complete(batch, "c", "groq")

    assert calls[0] == ["s1", "s2", "s3", "s4"]
    assert ["s1", "s2"] in calls and ["s3", "s4"] in calls
    assert missing == set(), "every clause is recovered by splitting"
    assert len(rows) == 4


def test_a_single_clause_that_returns_nothing_is_not_split_forever():
    """The recursion has to bottom out, or one unanswerable clause hangs a run."""
    manager = _manager()
    manager._extract_batch_llm_rows = lambda *a, **k: ([], {a[0][0]["source_id"]: a[0][0]})

    rows, _lookup, missing = manager._extract_batch_complete(_batch("s1"), "c", "groq")

    assert rows == []
    assert missing == {"s1"}
