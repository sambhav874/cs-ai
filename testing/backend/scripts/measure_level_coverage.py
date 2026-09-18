#!/usr/bin/env python3
"""Decide which chunk level can carry obligation extraction on its own.

Extracting from every chunk level costs ~2.7x the document in candidate text
(see measure_chunk_redundancy.py). Cutting to one level is the Phase 3 saving —
but only if that level still carries the source. This measures, per level, the
share of the document's quantitative spans that fall inside a segment of that
level.

Coverage is **offset-based**, not substring-based. An earlier version asked
whether the span's *text* appeared anywhere in the level's concatenated text,
which counts a span as covered when an unrelated occurrence of the same string
("30 days", "per shipment") exists elsewhere in the level. That inflates every
level's score, and inflates it most for the levels that hold the least text.
Here a span counts only when some segment of that level actually spans the
document offsets the span occupies.

Usage::

    cd apps/intelligence && poetry run python ../../testing/backend/scripts/measure_level_coverage.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "apps" / "intelligence"))

# Same span taxonomy as score_obligation_coverage.py — shape-based, no domain words.
SPAN_PATTERNS: Dict[str, str] = {
    "currency": r"(?:USD|EUR|GBP|SEK|CHF|JPY|INR|\$|€|£|₹)\s?[\d,]+(?:\.\d+)?(?:\s?(?:million|billion|thousand|k|M|bn))?",
    "percent": r"\d+(?:\.\d+)?\s?(?:%|percent\b|percentage points?\b)",
    "per_unit": r"\bper\s+[A-Za-z][A-Za-z\-]{2,24}\b",
    "duration": r"\b\d+(?:\.\d+)?\s?(?:business\s+|calendar\s+)?(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|ms|bps|Gbps|Mbps|TB|GB)\b",
    "clocktime": r"\b\d{1,2}:\d{2}\s?(?:AM|PM|a\.m\.|p\.m\.)?(?:\s?[A-Z]{2,4})?\b",
    "ratio": r"\b\d+(?:\.\d+)?\s?[:/]\s?\d+(?:\.\d+)?\b",
}
SPAN_RE = re.compile("|".join(f"(?:{p})" for p in SPAN_PATTERNS.values()))

Interval = Tuple[int, int]


# ── Pure, testable core ──────────────────────────────────────────────────────

def find_spans(text: str) -> List[Interval]:
    """Every quantitative span in the document, as (start, end) offsets."""
    return [(m.start(), m.end()) for m in SPAN_RE.finditer(text)]


def merge_intervals(intervals: Iterable[Interval]) -> List[Interval]:
    """Coalesce overlapping/adjacent intervals so containment is a clean test."""
    ordered = sorted((s, e) for s, e in intervals if e > s)
    merged: List[Interval] = []
    for start, end in ordered:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def span_is_covered(span: Interval, covered: Sequence[Interval]) -> bool:
    """True when the whole span sits inside one covered interval.

    Partial overlap does not count: half a rate is not a recoverable rate.
    """
    start, end = span
    for c_start, c_end in covered:
        if c_start <= start and end <= c_end:
            return True
        if c_start > start:
            break  # sorted; no later interval can start at or before `start`
    return False


def coverage_ratio(spans: Sequence[Interval], intervals: Iterable[Interval]) -> float:
    """Share of spans fully contained in the (unmerged) intervals."""
    if not spans:
        return 1.0
    covered = merge_intervals(intervals)
    return sum(1 for span in spans if span_is_covered(span, covered)) / len(spans)


def level_intervals(segments, level: str) -> List[Interval]:
    """Document offsets occupied by segments of one chunk level."""
    out: List[Interval] = []
    for seg in segments:
        seg_level = getattr(seg, "chunk_level", None) or getattr(seg, "type", None)
        if seg_level != level:
            continue
        start, end = getattr(seg, "char_start", None), getattr(seg, "char_end", None)
        if start is not None and end is not None:
            out.append((int(start), int(end)))
    return out


# ── Report ───────────────────────────────────────────────────────────────────

def main() -> int:
    from services.contract_agent.rag.segmentation import DocumentSegmenter

    segmenter = DocumentSegmenter()
    fixtures = sorted((REPO / "final_evaluation" / "datasets" / "kpi_contracts").glob("0*.md"))
    levels = ["macro", "meso", "micro"]

    totals = {lv: 0 for lv in levels}
    totals["meso+micro"] = 0
    total_spans = 0

    header = f"{'fixture':<46}{'spans':>6}" + "".join(f"{lv:>12}" for lv in levels) + f"{'meso+micro':>12}"
    print(header)
    print("-" * len(header))

    for path in fixtures:
        text = path.read_text(encoding="utf-8")
        _clean, segments = segmenter.segment_text_with_page_markers(text)
        spans = find_spans(text)
        total_spans += len(spans)

        by_level = {lv: level_intervals(segments, lv) for lv in levels}
        cells = []
        for lv in levels:
            ratio = coverage_ratio(spans, by_level[lv])
            totals[lv] += round(ratio * len(spans))
            cells.append(f"{ratio * 100:>11.1f}%")
        combo = coverage_ratio(spans, by_level["meso"] + by_level["micro"])
        totals["meso+micro"] += round(combo * len(spans))

        print(f"{path.name[:44]:<46}{len(spans):>6}" + "".join(cells) + f"{combo * 100:>11.1f}%")

    print("-" * len(header))
    print(
        f"{'TOTAL':<46}{total_spans:>6}"
        + "".join(f"{totals[lv] / total_spans * 100:>11.1f}%" for lv in levels)
        + f"{totals['meso+micro'] / total_spans * 100:>11.1f}%"
    )
    print()
    print("A level's % is the share of quantitative spans that fall inside a segment of")
    print("that level. Anything under 100% is recall lost before the model is called.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
