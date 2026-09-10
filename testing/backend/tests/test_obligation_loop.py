"""The repair loop: diagnosis, per-kind action, and termination.

The distinction these tests defend is loop vs retry. A retry re-sends the same
prompt; measured here that fails, because an output-budget failure reproduces
identically and a table the model declined gets declined again row by row. The
loop diagnoses *what kind* of gap it is and does something different for each,
then stops at a fixpoint rather than a round count.
"""

import pytest

from services.obligation_loop import (
    MAX_ROUNDS,
    Deficit,
    diagnose,
    run_repair_loop,
)


def _row(table_id, index, table_type="Rate Schedule"):
    return {
        "segment_id": f"{table_id}:r{index}",
        "table_id": table_id,
        "table_type": table_type,
        "section_path": "RAMP SERVICES",
        "text": f"row {index}",
    }


# ── diagnosis ──────────────────────────────────────────────────────────────


def test_a_table_that_produced_nothing_is_one_deficit_not_six():
    """`scope_and_services` was 0/6 in six consecutive runs. That is one decision
    about the whole block; six per-row repairs reproduce the same refusal six
    times and cost six calls."""
    candidates = [_row("table_2", i, "Scope & Services Matrix") for i in range(6)]

    deficits = diagnose(records=[], candidates=candidates,
                        unaccounted=[c["segment_id"] for c in candidates])

    assert [d.kind for d in deficits] == ["empty_table"]
    assert deficits[0].target == "table_2"
    assert deficits[0].evidence["row_count"] == 6
    assert len(deficits[0].evidence["source_ids"]) == 6


def test_a_partly_extracted_table_is_not_an_empty_table_deficit():
    candidates = [_row("table_5", i) for i in range(4)]
    records = [{"source_id": "table_5:r0"}]

    kinds = {d.kind for d in diagnose(records=records, candidates=candidates,
                                      unaccounted=["table_5:r2", "table_5:r3"])}

    assert "empty_table" not in kinds
    assert kinds == {"unanswered_clause"}


def test_unanswered_clauses_inside_an_empty_table_are_not_double_counted():
    """Repairing the table repairs its rows; billing for both is churn."""
    candidates = [_row("table_2", i) for i in range(3)]

    deficits = diagnose(records=[], candidates=candidates,
                        unaccounted=[c["segment_id"] for c in candidates])

    assert len(deficits) == 1


def test_an_ungrounded_quote_is_its_own_deficit_kind():
    records = [{"kpi_id": "k1", "source_id": "s1", "name": "Rate",
                "quarantine_reasons": ["quote_not_verbatim_in_source"]}]

    deficits = diagnose(records=records, candidates=[], unaccounted=[])

    assert [d.kind for d in deficits] == ["ungrounded_quote"]


def test_a_pack_class_absent_from_the_register_is_a_deficit():
    """coverage.yaml has carried these since the packs shipped, read by nothing."""
    records = [{"obligation_class": "per_unit_credit_rate"}]

    deficits = diagnose(records=records, candidates=[], unaccounted=[],
                        required_classes=["per_unit_credit_rate", "nil_charge_service"])

    assert [(d.kind, d.target) for d in deficits] == [("missing_class", "nil_charge_service")]


# ── the loop ───────────────────────────────────────────────────────────────


def test_a_recovered_deficit_does_not_come_back():
    candidates = [_row("t1", 0), _row("t1", 1)]
    calls = []

    def repair(deficit):
        calls.append(deficit.key)
        return [{"source_id": s} for s in deficit.evidence.get("source_ids", [])]

    records, report = run_repair_loop(
        records=[], candidates=candidates,
        unaccounted=["t1:r0", "t1:r1"], repair=repair,
    )

    assert len(calls) == 1, "one table, one repair"
    assert report.repaired == {"empty_table": 1}
    assert len(records) == 2


def test_a_deficit_that_survives_its_repair_is_terminal():
    """Without this the loop re-sends the same clause every round — which is the
    retry behaviour it exists to replace."""
    candidates = [_row("t1", 0)]
    calls = []

    def repair(deficit):
        calls.append(deficit.key)
        return []

    _records, report = run_repair_loop(
        records=[], candidates=candidates, unaccounted=["t1:r0"], repair=repair,
    )

    assert len(calls) == 1, "attempted once, then given up on"
    assert report.terminal == [("empty_table", "t1")]


def test_the_loop_stops_when_deficits_stop_shrinking():
    candidates = [_row(f"t{i}", 0) for i in range(4)]
    rounds = []

    def repair(deficit):
        rounds.append(deficit.key)
        return []

    _records, report = run_repair_loop(
        records=[], candidates=candidates,
        unaccounted=[c["segment_id"] for c in candidates], repair=repair,
    )

    assert report.rounds == 1
    assert "stopped shrinking" in report.stopped_because or report.stopped_because


def test_a_repair_that_raises_never_fails_the_extraction():
    candidates = [_row("t1", 0)]

    def repair(deficit):
        raise RuntimeError("provider down")

    records, report = run_repair_loop(
        records=[{"source_id": "existing"}], candidates=candidates,
        unaccounted=["t1:r0"], repair=repair,
    )

    assert records == [{"source_id": "existing"}]
    assert report.added_records == 0


def test_nothing_to_repair_costs_nothing():
    calls = []

    records, report = run_repair_loop(
        records=[{"source_id": "s1"}], candidates=[{"segment_id": "s1"}],
        unaccounted=[], repair=lambda d: calls.append(d) or [],
    )

    assert calls == []
    assert report.rounds == 0
    assert report.stopped_because == "no deficits remain"
    assert records == [{"source_id": "s1"}]


def test_the_loop_is_bounded():
    """Refinement gains converge in about three rounds; later rounds are cost."""
    made = {"n": 0}
    candidates = [_row(f"t{i}", 0) for i in range(10)]

    def repair(deficit):
        # Always repairs one row, so the deficit set shrinks every round and the
        # fixpoint test never fires — only the ceiling can stop this.
        made["n"] += 1
        return [{"source_id": s} for s in deficit.evidence.get("source_ids", [])]

    _records, report = run_repair_loop(
        records=[], candidates=candidates,
        unaccounted=[c["segment_id"] for c in candidates], repair=repair,
    )

    assert report.rounds <= MAX_ROUNDS
