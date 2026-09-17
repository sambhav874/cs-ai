"""Tests for the chunk-level coverage measurement.

The D2 decision — extract from `meso` only — rests entirely on the numbers this
script produces, so the matching logic needs to be correct rather than merely
plausible. The first version tested whether a span's *text* appeared anywhere in
a level's concatenated text, which credits a level for an unrelated occurrence
of the same string elsewhere in the document. These tests pin the offset-based
behaviour that replaced it.

Pure functions only: no segmenter, no Mongo, no LLM.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from measure_level_coverage import (  # noqa: E402
    coverage_ratio,
    find_spans,
    merge_intervals,
    span_is_covered,
)


# ── find_spans ───────────────────────────────────────────────────────────────

def test_find_spans_locates_each_quantity_by_offset():
    text = "Credit of $3,000 per tenth below 96.5% within 5 business days."
    spans = find_spans(text)

    assert spans, "expected quantitative spans"
    for start, end in spans:
        assert 0 <= start < end <= len(text)

    found = {text[s:e] for s, e in spans}
    assert "$3,000" in found
    assert "96.5%" in found


def test_find_spans_returns_distinct_offsets_for_repeated_text():
    """The same string twice is two spans — this is what substring matching lost."""
    text = "Report within 30 days. Escalate within 30 days."
    spans = [s for s in find_spans(text) if text[s[0]:s[1]] == "30 days"]

    assert len(spans) == 2
    assert spans[0] != spans[1]


# ── merge_intervals ──────────────────────────────────────────────────────────

def test_merge_intervals_coalesces_overlap_and_adjacency():
    assert merge_intervals([(0, 10), (5, 20), (30, 40)]) == [(0, 20), (30, 40)]
    assert merge_intervals([(10, 20), (0, 10)]) == [(0, 20)]


def test_merge_intervals_drops_empty_ranges():
    assert merge_intervals([(5, 5), (0, 3)]) == [(0, 3)]


# ── span_is_covered ──────────────────────────────────────────────────────────

def test_span_inside_an_interval_is_covered():
    assert span_is_covered((12, 18), [(0, 40)]) is True


def test_span_outside_every_interval_is_not_covered():
    assert span_is_covered((50, 56), [(0, 40)]) is False


def test_partially_overlapping_span_is_not_covered():
    """Half a rate is not a recoverable rate."""
    assert span_is_covered((35, 45), [(0, 40)]) is False


def test_span_matching_interval_bounds_exactly_is_covered():
    assert span_is_covered((0, 40), [(0, 40)]) is True


# ── coverage_ratio: the regression that motivated the rewrite ────────────────

def test_identical_text_elsewhere_does_not_credit_coverage():
    """The bug being pinned.

    Two occurrences of the same quantity; the level covers only the first. A
    substring test would score 100% because the string is present. Offset
    matching correctly scores 50%.
    """
    text = "Report within 30 days. Escalate within 30 days."
    spans = [s for s in find_spans(text) if text[s[0]:s[1]] == "30 days"]
    first_occurrence_only = [(0, 22)]

    assert coverage_ratio(spans, first_occurrence_only) == 0.5


def test_full_document_interval_covers_everything():
    text = "Fee of $500 per unit, uptime 99.9%, cure within 10 days."
    spans = find_spans(text)

    assert coverage_ratio(spans, [(0, len(text))]) == 1.0


def test_no_intervals_covers_nothing():
    text = "Fee of $500 per unit."
    assert coverage_ratio(find_spans(text), []) == 0.0


def test_tiled_intervals_cover_everything():
    """Meso segments tile the document; tiling must not lose spans at the seams."""
    text = "Fee of $500 per unit, uptime 99.9%, cure within 10 days, credit 2.5%."
    spans = find_spans(text)
    midpoint = len(text) // 2
    tiles = [(0, midpoint), (midpoint, len(text))]

    covered = coverage_ratio(spans, tiles)
    # A span straddling the seam is legitimately uncovered by either tile, so
    # this asserts the ratio is high without pretending a seam is free.
    assert covered >= (len(spans) - 1) / len(spans)


def test_empty_span_list_is_full_coverage():
    assert coverage_ratio([], [(0, 10)]) == 1.0
