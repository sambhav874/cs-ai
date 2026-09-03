"""Tests for the obligation-extraction scorer.

The scorer is the instrument the rest of the accuracy work is measured with,
so its own behaviour needs to be pinned down first: a scorer that quietly
cross-matches ladder rows, or that scores a currency bug as correct, would
make every later number meaningless.
"""

import json
from pathlib import Path

import pytest

from scripts.score_obligation_extraction import (  # noqa: E402
    load_gold,
    load_predictions,
    match_records,
    quote_similarity,
    score_run,
    stability,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
GOLD_PATH = REPO_ROOT / "demo_data" / "baltia_jfk_ground_truth.json"


@pytest.fixture(scope="module")
def gold_rows():
    return json.loads(GOLD_PATH.read_text())["kpis"]


@pytest.fixture(scope="module")
def gold():
    return load_gold(GOLD_PATH)


def _prediction_from_gold(row, **overrides):
    """Echo a gold row back in the shape the extractor emits."""
    party = {"customer": "client", "supplier": "supplier", "mutual": "mutual"}[row["party_role"]]
    operator = {"=": "==", "n/a": None}.get(row["operator"], row["operator"])
    unit = None if str(row["unit"]).lower() in {"n/a", "none"} else row["unit"]
    currency = "USD" if unit and "USD" in unit else None
    record_type = {
        "fee_schedule": "trackable_operational_obligation",
        "payment_term": "trackable_operational_obligation",
        "obligation": "trackable_operational_obligation",
        "index_clause": "trackable_operational_obligation",
        "kpi": "supporting_measurement",
        "penalty": "financial_consequence",
        "remedy": "financial_consequence",
        "liability_clause": "financial_consequence",
        "reference_only": "reference_only",
    }[row["record_type"]]

    prediction = {
        "name": row["name"],
        "quote": row["quote"],
        "section_path": row["section"],
        "party_role": party,
        "record_type": record_type,
        "operator": operator,
        "value": row.get("value"),
        "unit": unit,
        "measurement": {"currency": currency, "unit": unit, "operator": operator},
        "target_schedule": row.get("target_schedule") or [],
    }
    prediction.update(overrides)
    return prediction


@pytest.fixture(scope="module")
def perfect_predictions(gold_rows):
    return [_prediction_from_gold(row) for row in gold_rows]


# ---------------------------------------------------------------------------
# Quote matching
# ---------------------------------------------------------------------------

def test_quote_similarity_is_one_when_prediction_contains_the_gold_line():
    gold_quote = "B747-200 series aircraft $2,395.00/turnaround"
    pred_quote = (
        "Ramp handling charges: B747-200 series aircraft $2,395.00/turnaround "
        "payable within thirty days of invoice."
    )
    assert quote_similarity(gold_quote, pred_quote) == 1.0


def test_ladder_rows_do_not_cross_match_on_shared_wording(gold_rows):
    """Three ladder rows share every word but the amount.

    A name- or wording-based matcher collapses them.  The scorer must keep
    them apart, otherwise a run that finds one row of a three-row ladder would
    score as if it found all three.
    """
    ladder = [row for row in gold_rows if row["quote"].startswith("B747-200 series aircraft")]
    assert len(ladder) >= 3

    gold = load_gold(GOLD_PATH)
    gold_indices = [i for i, record in enumerate(gold) if record.quote.startswith("B747-200 series aircraft")]

    # Predict only the *second* ladder row.
    predictions = load_predictions_from_rows([_prediction_from_gold(ladder[1])])
    matches, _, _ = match_records(gold, predictions)

    assert len(matches) == 1
    assert gold[matches[0].gold_index].quote == ladder[1]["quote"]
    assert matches[0].gold_index in gold_indices


def load_predictions_from_rows(rows, tmp_path=None):
    """load_predictions takes a path; keep the tests honest by round-tripping."""
    import tempfile

    directory = tmp_path or Path(tempfile.mkdtemp())
    path = Path(directory) / "pred.json"
    path.write_text(json.dumps(rows))
    return load_predictions(path)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def test_perfect_run_scores_one_across_the_board(gold, perfect_predictions):
    report = score_run(gold, load_predictions_from_rows(perfect_predictions))

    assert report["matched"] == len(gold) == 37
    assert report["recall"] == 1.0
    assert report["precision"] == 1.0
    for name, bucket in report["fields"].items():
        assert bucket["accuracy"] in (None, 1.0), f"{name} regressed on an exact echo: {bucket}"
    assert report["record_type_accuracy_undebatable"] == 1.0


def test_a_dropped_record_shows_up_as_a_miss(gold, perfect_predictions):
    report = score_run(gold, load_predictions_from_rows(perfect_predictions[:-1]))

    assert report["matched"] == 36
    assert report["missed"] == 1
    assert report["recall"] == pytest.approx(36 / 37, rel=1e-4)
    assert len(report["missed_records"]) == 1
    assert report["missed_records"][0]["quote"] == gold[-1].quote


def test_wrong_value_is_a_field_mismatch_not_a_miss(gold, gold_rows, perfect_predictions):
    rows = list(perfect_predictions)
    target = next(i for i, row in enumerate(gold_rows) if row.get("value") == 2395.0)
    rows[target] = {**rows[target], "value": 2359.0}

    report = score_run(gold, load_predictions_from_rows(rows))

    assert report["matched"] == 37, "a typo'd value must not hide the record"
    assert report["fields"]["value"]["mismatch"] == 1
    assert report["fields"]["value"]["accuracy"] < 1.0
    assert any(m["field"] == "value" and m["pred"] == 2359.0 for m in report["field_mismatches"])


def test_currency_rewrite_is_caught(gold, perfect_predictions):
    """The SEK cascade rewrites USD amounts on a USD contract.

    This is the exact failure the harness exists to make visible, so it gets
    its own test rather than relying on the field loop above.
    """
    rows = [
        {**row, "measurement": {**row["measurement"], "currency": "SEK"}} if row["measurement"]["currency"] else row
        for row in perfect_predictions
    ]

    report = score_run(gold, load_predictions_from_rows(rows))

    assert report["matched"] == 37
    assert report["fields"]["currency"]["accuracy"] == 0.0
    assert report["fields"]["currency"]["scored"] > 0


def test_party_role_vocabulary_is_mapped_not_compared_raw(gold, perfect_predictions):
    """Gold says 'customer', the extractor says 'client'. Same thing."""
    assert report_party_accuracy(gold, perfect_predictions) == 1.0

    flipped = [{**row, "party_role": "supplier"} for row in perfect_predictions]
    assert report_party_accuracy(gold, flipped) < 1.0


def report_party_accuracy(gold, rows):
    report = score_run(gold, load_predictions_from_rows(rows))
    return report["fields"]["party_role"]["accuracy"]


def test_extra_predictions_do_not_reduce_recall(gold, perfect_predictions):
    rows = perfect_predictions + [
        {"name": "Definitions", "quote": "This Annex forms part of the Standard Ground Handling Agreement.", "unit": None}
    ]
    report = score_run(gold, load_predictions_from_rows(rows))

    assert report["recall"] == 1.0
    assert report["unmatched_predictions"] == 1
    assert report["precision"] < 1.0


# ---------------------------------------------------------------------------
# Input shapes
# ---------------------------------------------------------------------------

def test_phase_aware_envelope_is_accepted(gold, gold_rows):
    envelope = {
        "schema_version": "2.1",
        "records": [
            {"record_id": "OBL-001", "status": "extracted", "phase1": _prediction_from_gold(gold_rows[0])}
        ],
    }
    predictions = load_predictions_from_rows(envelope)

    assert len(predictions) == 1
    assert predictions[0].quote == gold_rows[0]["quote"]
    assert predictions[0].party_role == "client"


# ---------------------------------------------------------------------------
# Stability
# ---------------------------------------------------------------------------

def test_stability_reports_the_records_that_come_and_go(gold, perfect_predictions):
    full = score_run(gold, load_predictions_from_rows(perfect_predictions))
    short = score_run(gold, load_predictions_from_rows(perfect_predictions[:-2]))

    result = stability([full, short, full])

    assert result["runs"] == 3
    assert result["matched_spread"] == 2
    assert result["min_pairwise_jaccard"] < 1.0
    assert len(result["sometimes_found"]) == 2
    assert len(result["always_found"]) == 35
