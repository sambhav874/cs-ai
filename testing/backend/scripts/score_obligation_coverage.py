#!/usr/bin/env python3
"""Label-free obligation-coverage scorer.

Answers the question a gold set cannot answer cheaply: *in this long contract,
what did the extractor miss?*

The denominator is computed from the source document, not from hand labels.
Every currency amount, percentage, ``per <unit>`` rate basis, duration, and
clock deadline in the contract is a **quantitative span**. A span is covered
when at least one extracted record quotes it. Uncovered spans are either real
misses or genuinely non-operative text the extractor must justify — the
Rule 3 zero-omission sweep, computed in Python instead of trusted to the model.

No Mongo, no LLM, no backend imports. Standard library only.

Usage
-----
Denominator only (works today, no extraction needed)::

    python testing/backend/scripts/score_obligation_coverage.py \\
        --contract final_evaluation/datasets/kpi_contracts/01_*.md

Score an extraction dump against it::

    python testing/backend/scripts/score_obligation_coverage.py \\
        --contract <contract.md> --pred <records.json> --report out.json

Must-find anchor gate from the fixture manifest::

    python testing/backend/scripts/score_obligation_coverage.py \\
        --contract <contract.md> --pred <records.json> \\
        --manifest final_evaluation/datasets/kpi_contracts/manifest.json \\
        --contract-id full_eval_global_logistics
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# ── Span taxonomy ────────────────────────────────────────────────────────────
# Each pattern names a way contracts express a trackable quantity. Keep these
# shape-based: no domain words, so the sweep works on any contract family.
SPAN_PATTERNS: Dict[str, str] = {
    "currency": r"(?:USD|EUR|GBP|SEK|CHF|JPY|INR|\$|€|£|₹)\s?[\d,]+(?:\.\d+)?(?:\s?(?:million|billion|thousand|k|M|bn))?",
    "percent": r"\d+(?:\.\d+)?\s?(?:%|percent\b|percentage points?\b)",
    "per_unit": r"\bper\s+[A-Za-z][A-Za-z\-]{2,24}\b",
    "duration": r"\b\d+(?:\.\d+)?\s?(?:business\s+|calendar\s+)?(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|ms|bps|Gbps|Mbps|TB|GB)\b",
    "clocktime": r"\b\d{1,2}:\d{2}\s?(?:AM|PM|a\.m\.|p\.m\.)?(?:\s?[A-Z]{2,4})?\b",
    "ratio": r"\b\d+(?:\.\d+)?\s?[:/]\s?\d+(?:\.\d+)?\b",
}

# Spans that are almost never a trackable quantity. Kept deliberately tiny —
# an over-eager exclusion list is how a coverage metric flatters itself.
NOISE_SPANS = re.compile(
    r"^(?:per\s+(?:the|this|said|such|which|annum|cent|se))$",
    re.IGNORECASE,
)


# Contracts spell small numbers as words ("seven years", "four hours") while a
# manifest anchor writes the numeral ("7 years", "4 hours"). Matching the raw
# strings marked four correctly-extracted anchors as missing on 2026-09-07 and
# understated anchor recall as 75% when it was 100%. Normalize both sides.
_NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "ten": "10",
    "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14",
    "fifteen": "15", "sixteen": "16", "seventeen": "17", "eighteen": "18",
    "nineteen": "19", "twenty": "20", "thirty": "30", "forty": "40",
    "fifty": "50", "sixty": "60", "seventy": "70", "eighty": "80", "ninety": "90",
}
_COMPOUND = re.compile(
    r"\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](one|two|three|four|five|six|seven|eight|nine)\b"
)


def _digits_for_words(text: str) -> str:
    """Rewrite spelled-out numbers as digits so anchors match either form."""
    def _compound(match: re.Match) -> str:
        return str(int(_NUMBER_WORDS[match.group(1)]) + int(_NUMBER_WORDS[match.group(2)]))

    text = _COMPOUND.sub(_compound, text)
    for word, digit in _NUMBER_WORDS.items():
        text = re.sub(rf"\b{word}\b", digit, text)
    return text


def _norm(text: str) -> str:
    """Normalize for containment tests: NFKC, collapse space, casefold."""
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("’", "'").replace("“", '"').replace("”", '"')
    # Every Unicode dash folds to "-", and markdown emphasis is presentation,
    # not content: a quote of "Penalty Structure:" taken from source that reads
    # "**Penalty Structure:**" is verbatim. Comparing raw strings scored 20
    # correctly-quoted records on fixture 01 as ungrounded.
    text = text.translate(dict.fromkeys(map(ord, "\u2010\u2011\u2012\u2013\u2014\u2015\u2212"), "-"))
    text = text.replace("\xa0", " ")
    text = re.sub(r"[*_`~]+", "", text)
    return re.sub(r"\s+", " ", text).strip().casefold()


def _line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


def _context(text: str, start: int, end: int, width: int = 70) -> str:
    lo = max(0, start - width)
    hi = min(len(text), end + width)
    return re.sub(r"\s+", " ", text[lo:hi]).strip()


def sweep_spans(text: str) -> List[Dict[str, Any]]:
    """Return every quantitative span in the document, de-overlapped.

    Overlapping matches from different patterns (``$1.25 per shipment`` hits
    both ``currency`` and ``per_unit``) are kept as separate spans on purpose:
    a record that quotes the amount but drops the rate basis has lost half the
    obligation, and the metric should say so.
    """
    spans: List[Dict[str, Any]] = []
    seen: set[Tuple[int, int, str]] = set()
    for kind, pattern in SPAN_PATTERNS.items():
        for match in re.finditer(pattern, text, re.IGNORECASE):
            raw = match.group(0).strip()
            if NOISE_SPANS.match(raw):
                continue
            key = (match.start(), match.end(), kind)
            if key in seen:
                continue
            seen.add(key)
            spans.append({
                "span_id": f"{kind}_{match.start()}",
                "kind": kind,
                "text": raw,
                "start": match.start(),
                "end": match.end(),
                "line": _line_of(text, match.start()),
                "context": _context(text, match.start(), match.end()),
            })
    spans.sort(key=lambda s: (s["start"], s["kind"]))
    return spans


# ── Prediction loading ───────────────────────────────────────────────────────
def _quotes_from_record(record: Any) -> List[str]:
    """Pull every quote-like string out of one record, across schema shapes."""
    if not isinstance(record, dict):
        return []
    out: List[str] = []
    for key in ("quote", "source_quote", "clause_text"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            out.append(value)
    phase1 = record.get("phase1")
    if isinstance(phase1, dict):
        out.extend(_quotes_from_record(phase1))
    identity = record.get("identity")
    if isinstance(identity, dict):
        clause = identity.get("source_clause")
        if isinstance(clause, dict) and isinstance(clause.get("quote"), str):
            out.append(clause["quote"])
    for evidence in record.get("source_evidence") or []:
        if isinstance(evidence, dict) and isinstance(evidence.get("quote"), str):
            out.append(evidence["quote"])
    return out


def load_predictions(path: Path) -> List[Dict[str, Any]]:
    payload = json.loads(path.read_text())
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    for key in ("records", "kpis", "obligations", "extracted"):
        value = payload.get(key) if isinstance(payload, dict) else None
        if isinstance(value, list):
            return [r for r in value if isinstance(r, dict)]
    raise SystemExit(f"{path}: no records/kpis array found")


# ── Scoring ──────────────────────────────────────────────────────────────────
def score_coverage(
    text: str,
    spans: Sequence[Dict[str, Any]],
    records: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    quotes: List[Tuple[str, int]] = []
    ungrounded = 0
    normalized_source = _norm(text)
    for index, record in enumerate(records):
        for quote in _quotes_from_record(record):
            normalized = _norm(quote)
            if not normalized:
                continue
            quotes.append((normalized, index))
            if normalized not in normalized_source:
                ungrounded += 1

    covered: Dict[str, List[int]] = {}
    for span in spans:
        needle = _norm(span["text"])
        hits = [i for q, i in quotes if needle in q]
        if hits:
            covered[span["span_id"]] = sorted(set(hits))

    missed = [s for s in spans if s["span_id"] not in covered]
    by_kind: Dict[str, Dict[str, int]] = {}
    for span in spans:
        bucket = by_kind.setdefault(span["kind"], {"total": 0, "covered": 0})
        bucket["total"] += 1
        if span["span_id"] in covered:
            bucket["covered"] += 1
    for bucket in by_kind.values():
        bucket["recall"] = round(bucket["covered"] / bucket["total"], 4) if bucket["total"] else 1.0

    total = len(spans)
    return {
        "span_total": total,
        "span_covered": len(covered),
        "span_coverage": round(len(covered) / total, 4) if total else 1.0,
        "by_kind": by_kind,
        "record_count": len(records),
        "quote_count": len(quotes),
        "ungrounded_quotes": ungrounded,
        "grounding": round(1 - ungrounded / len(quotes), 4) if quotes else 1.0,
        "missed_spans": missed,
    }


def score_anchors(text: str, records: Sequence[Dict[str, Any]], anchors: Dict[str, str]) -> Dict[str, Any]:
    """Hard gate: every manifest anchor value must appear in some record quote."""
    quotes = [_digits_for_words(_norm(q)) for r in records for q in _quotes_from_record(r)]
    found, missing = {}, {}
    for name, value in anchors.items():
        needle = _digits_for_words(_norm(str(value)))
        if needle and any(needle in q for q in quotes):
            found[name] = value
        else:
            missing[name] = value
    total = len(anchors)
    return {
        "anchor_total": total,
        "anchor_found": len(found),
        "anchor_recall": round(len(found) / total, 4) if total else 1.0,
        "missing_anchors": missing,
    }


def _anchors_for(manifest: Path, contract_id: str) -> Dict[str, str]:
    payload = json.loads(manifest.read_text())
    for entry in payload.get("contracts") or []:
        if entry.get("contract_id") == contract_id:
            return dict(entry.get("evaluation_anchors") or {})
    raise SystemExit(f"contract_id {contract_id!r} not in {manifest}")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--contract", required=True, type=Path, help="Source contract (.md or .txt)")
    parser.add_argument("--pred", type=Path, help="Extraction dump (JSON). Omit to print the denominator only.")
    parser.add_argument("--manifest", type=Path, help="kpi_contracts/manifest.json, for the anchor gate")
    parser.add_argument("--contract-id", help="contract_id within the manifest")
    parser.add_argument("--report", type=Path, help="Write the full JSON report here")
    parser.add_argument("--min-coverage", type=float, help="Exit non-zero below this span coverage")
    parser.add_argument("--min-anchor-recall", type=float, default=1.0, help="Exit non-zero below this anchor recall")
    parser.add_argument("--show-missed", type=int, default=15, help="Missed spans to print (0 for none)")
    args = parser.parse_args(argv)

    text = args.contract.read_text(errors="ignore")
    spans = sweep_spans(text)

    report: Dict[str, Any] = {
        "contract": str(args.contract),
        "contract_chars": len(text),
        "span_total": len(spans),
        "span_kinds": {k: sum(1 for s in spans if s["kind"] == k) for k in SPAN_PATTERNS},
    }

    if not args.pred:
        report["spans"] = spans
        print(f"{args.contract.name}: {len(spans)} quantitative spans  {report['span_kinds']}")
        if args.report:
            args.report.write_text(json.dumps(report, indent=2))
            print(f"wrote {args.report}")
        return 0

    records = load_predictions(args.pred)
    coverage = score_coverage(text, spans, records)
    report.update(coverage)

    if args.manifest and args.contract_id:
        report.update(score_anchors(text, records, _anchors_for(args.manifest, args.contract_id)))

    print(f"contract          {args.contract.name}")
    print(f"records           {coverage['record_count']}")
    print(f"span coverage     {coverage['span_coverage']:.1%}  ({coverage['span_covered']}/{coverage['span_total']})")
    for kind, bucket in sorted(coverage["by_kind"].items()):
        print(f"  {kind:<11s}    {bucket['recall']:.1%}  ({bucket['covered']}/{bucket['total']})")
    print(f"grounding         {coverage['grounding']:.1%}  ({coverage['ungrounded_quotes']} quotes not verbatim in source)")
    if "anchor_recall" in report:
        print(f"anchor recall     {report['anchor_recall']:.1%}  ({report['anchor_found']}/{report['anchor_total']})")
        for name, value in report.get("missing_anchors", {}).items():
            print(f"  MISSING ANCHOR  {name} = {value}")

    if args.show_missed:
        print(f"\nuncovered spans (first {args.show_missed}):")
        for span in coverage["missed_spans"][: args.show_missed]:
            print(f"  L{span['line']:<5d} {span['kind']:<9s} {span['text']:<24s} … {span['context'][:90]}")

    if args.report:
        args.report.write_text(json.dumps(report, indent=2))
        print(f"\nwrote {args.report}")

    failed = False
    if args.min_coverage is not None and coverage["span_coverage"] < args.min_coverage:
        print(f"FAIL span coverage {coverage['span_coverage']:.4f} < {args.min_coverage}", file=sys.stderr)
        failed = True
    if "anchor_recall" in report and report["anchor_recall"] < args.min_anchor_recall:
        print(f"FAIL anchor recall {report['anchor_recall']:.4f} < {args.min_anchor_recall}", file=sys.stderr)
        failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
