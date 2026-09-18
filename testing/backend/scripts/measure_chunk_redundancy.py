#!/usr/bin/env python3
"""Settle the chunk-level redundancy estimate without Mongo or an LLM.

`_load_candidate_chunks` pulls every chunk for a contract with no level filter,
so macro + meso + micro all enter extraction. Micro segments are substrings of
meso, which are substrings of the section — the same clause is fed to the model
at up to three granularities, and the dedup at `_candidate_clause_records`
hashes `normalized[:800]`, which catches identical text but not overlapping
text.

The plan estimated the resulting token amplification at 2.5-4x and marked it
"needs verification". This runs the real segmenter over the fixtures and reports
the actual multiple.
"""

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]

sys.path.insert(0, str(REPO / "apps" / "intelligence"))

from services.contract_agent.rag.segmentation import DocumentSegmenter  # noqa: E402

FIXTURES = sorted((REPO / "final_evaluation" / "datasets" / "kpi_contracts").glob("0*.md"))

segmenter = DocumentSegmenter()

print(f"{'fixture':<50}{'doc':>8}{'macro':>9}{'meso':>9}{'micro':>9}{'table':>8}{'total':>9}{'x':>7}")
print("-" * 109)

grand_doc = grand_total = 0
level_totals: dict[str, int] = {}

for path in FIXTURES:
    text = path.read_text(encoding="utf-8")
    _clean, segments = segmenter.segment_text_with_page_markers(text)

    by_level: dict[str, int] = {}
    for seg in segments:
        level = (getattr(seg, "chunk_level", None) or getattr(seg, "type", None) or "other")
        by_level[level] = by_level.get(level, 0) + len(seg.text or "")

    for level, chars in by_level.items():
        level_totals[level] = level_totals.get(level, 0) + chars

    doc_chars = len(text)
    total = sum(by_level.values())
    grand_doc += doc_chars
    grand_total += total

    print(
        f"{path.name[:48]:<50}{doc_chars:>8,}"
        f"{by_level.get('macro', 0):>9,}{by_level.get('meso', 0):>9,}"
        f"{by_level.get('micro', 0):>9,}{by_level.get('table', 0):>8,}"
        f"{total:>9,}{total / doc_chars:>6.2f}x"
    )

print("-" * 109)
print(f"{'TOTAL':<50}{grand_doc:>8,}{'':>35}{grand_total:>9,}{grand_total / grand_doc:>6.2f}x")
print()
print("chars by level across all fixtures:")
for level, chars in sorted(level_totals.items(), key=lambda kv: -kv[1]):
    print(f"  {level:<10} {chars:>9,}  ({chars / grand_total * 100:5.1f}% of candidate text)")
print()
print(f"Extracting from ONE level instead of all would cut candidate text to:")
for level, chars in sorted(level_totals.items(), key=lambda kv: -kv[1]):
    print(f"  {level:<10} {chars / grand_total * 100:5.1f}% of today  ({1 - chars / grand_total:.0%} reduction)")

# ── Coverage: which source characters no chunk covers at all ─────────────────
# The segmenter logs "Legal chunk coverage gap" warnings. Anything uncovered is
# lost before the LLM ever sees it — the earliest possible recall hole.
print()
print("Source coverage per level (uncovered = never reaches extraction):")
print(f"{'fixture':<50}{'doc':>8}{'uncovered':>11}{'%':>7}  first gaps")
print("-" * 109)
for path in FIXTURES:
    text = path.read_text(encoding="utf-8")
    _clean, segments = segmenter.segment_text_with_page_markers(text)
    covered = [False] * len(text)
    for seg in segments:
        start, end = getattr(seg, "char_start", None), getattr(seg, "char_end", None)
        if start is None or end is None:
            continue
        for i in range(max(0, start), min(len(text), end)):
            covered[i] = True
    gaps, run_start = [], None
    for i, flag in enumerate(covered):
        if not flag and run_start is None:
            run_start = i
        elif flag and run_start is not None:
            gaps.append((run_start, i))
            run_start = None
    if run_start is not None:
        gaps.append((run_start, len(text)))
    uncovered = sum(e - s for s, e in gaps)
    sample = "; ".join(
        repr(text[s:e].strip()[:40]) for s, e in sorted(gaps, key=lambda g: g[1] - g[0], reverse=True)[:2]
    )
    print(f"{path.name[:48]:<50}{len(text):>8,}{uncovered:>11,}{uncovered / len(text) * 100:>6.1f}%  {sample}")
