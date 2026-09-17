"""The coverage scorer must be honest in both directions.

A metric that cannot be trusted to report a bad number is worse than no metric,
so most of these tests are adversarial: they check that the scorer refuses to
flatter an extractor that cheats.
"""

import importlib.util
from pathlib import Path

import pytest

_SCORER = Path(__file__).resolve().parents[2] / "backend" / "scripts" / "score_obligation_coverage.py"
_spec = importlib.util.spec_from_file_location("score_obligation_coverage", _SCORER)
scorer = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(scorer)


CONTRACT = """# Services Agreement

Section 1. Provider shall pay a Monthly Management Fee of $450,000.
Section 2. Freight Audit Fee is $1.25 per shipment.
Section 3. On-time delivery target is 97.5% measured monthly.
Section 4. Reports are due by 8:00 AM Central Time each business day.
Section 5. Records are retained for 7 years.
"""


def _records(*quotes):
    return [{"phase1": {"quote": q}} for q in quotes]


def _score(records):
    spans = scorer.sweep_spans(CONTRACT)
    return scorer.score_coverage(CONTRACT, spans, records)


def test_the_sweep_finds_each_quantity_kind():
    kinds = {span["kind"] for span in scorer.sweep_spans(CONTRACT)}
    assert {"currency", "percent", "per_unit", "duration", "clocktime"} <= kinds


def test_an_empty_extractor_scores_zero_not_one():
    result = _score([])
    assert result["span_coverage"] == 0.0
    assert result["missed_spans"]


def test_quoting_a_clause_covers_the_quantities_inside_it():
    result = _score(_records("Freight Audit Fee is $1.25 per shipment."))
    covered = {s["text"] for s in scorer.sweep_spans(CONTRACT)} - {s["text"] for s in result["missed_spans"]}
    assert "$1.25" in covered
    assert "per shipment" in covered


def test_a_hallucinated_quote_lowers_grounding_and_covers_nothing():
    result = _score(_records("Provider shall maintain 99.99% uptime at all times."))
    assert result["ungrounded_quotes"] == 1
    assert result["grounding"] == 0.0
    assert result["span_coverage"] == 0.0


def test_grounding_is_unaffected_by_whitespace_and_smart_punctuation():
    result = _score(_records("Provider  shall pay a Monthly\nManagement Fee of $450,000."))
    assert result["ungrounded_quotes"] == 0


def test_quoting_the_whole_document_is_not_free():
    """Dumping the source as one record scores full coverage — which is why
    coverage is never gated alone. Record count and grounding sit beside it."""
    result = _score(_records(CONTRACT))
    assert result["span_coverage"] == 1.0
    assert result["record_count"] == 1  # the tell


def test_a_span_is_not_covered_by_a_different_amount():
    result = _score(_records("Provider shall pay a Monthly Management Fee of $450,001."))
    assert "$450,000" in {s["text"] for s in result["missed_spans"]}


def test_per_unit_noise_is_excluded():
    assert not scorer.sweep_spans("Payable per the terms of this Agreement.")


@pytest.mark.parametrize("shape", [
    [{"quote": "Records are retained for 7 years."}],
    [{"phase1": {"quote": "Records are retained for 7 years."}}],
    [{"source_evidence": [{"quote": "Records are retained for 7 years."}]}],
    [{"identity": {"source_clause": {"quote": "Records are retained for 7 years."}}}],
])
def test_every_stored_record_shape_yields_its_quote(shape):
    assert "7 years" not in {s["text"] for s in _score(shape)["missed_spans"]}


def test_anchors_are_a_hard_gate_on_exact_values():
    anchors = {"delivery_target": "97.5%", "report_deadline": "8:00 AM Central Time"}
    partial = scorer.score_anchors(CONTRACT, _records("On-time delivery target is 97.5% measured monthly."), anchors)
    assert partial["anchor_recall"] == 0.5
    assert "report_deadline" in partial["missing_anchors"]
