#!/usr/bin/env python3
"""Score extracted obligations against the AHM 810 corpus ground truth.

`sample_projects/corpus/ground_truth.json` states every table row of five real
SGHA Annex B documents — description, unit, price — because the corpus was
generated from those rows. That makes it a recall denominator nobody had to
hand-label: 223 rows, 197 of them carrying a number.

Recall here is row recall: of the rows the document actually states, how many
does the register contain? A row counts as found only when an extracted record
carries its number *and* enough of its description to be the same row —
substring matching on either alone is how a scorer flatters itself.

    python3 testing/backend/scripts/score_corpus_recall.py \
        --document A --records extracted.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

REPO = Path(__file__).resolve().parents[3]
GROUND_TRUTH = REPO / "sample_projects" / "corpus" / "ground_truth.json"

#: Words that appear in nearly every row and so cannot identify one.
_STOPWORDS = {
    "the", "and", "or", "of", "per", "a", "an", "for", "to", "in", "at", "on",
    "charge", "charges", "fee", "fees", "rate", "rates", "service", "services",
    "price", "unit", "description", "free", "n/a", "none",
}

_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*")

#: Tables that are document furniture, not duties: who signed, what the parties
#: are called, which station. Extraction is not supposed to emit obligations for
#: these, so counting them in the denominator would understate recall by a fixed
#: 12% and make every future comparison wrong in the same direction.
_NON_OBLIGATION_TABLES = {"contract_metadata", "contact_and_signature"}


def _numbers(text: str) -> set:
    """Numbers in a string, normalised so 1,850.00 == 1850 == 1850.0."""
    found = set()
    for raw in _NUMBER_RE.findall(text or ""):
        cleaned = raw.replace(",", "")
        try:
            value = float(cleaned)
        except ValueError:
            continue
        # Trailing-zero decimals are the same quantity as the integer.
        found.add(value)
    return found


def _tokens(text: str) -> set:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {w for w in words if w not in _STOPWORDS and len(w) > 2}


def _record_text(record: Dict[str, Any]) -> str:
    parts = [
        record.get("name"),
        record.get("quote") or record.get("source_quote") or record.get("clause_text"),
        record.get("description"),
        str(record.get("value") or ""),
        record.get("unit"),
    ]
    measurement = record.get("measurement")
    if isinstance(measurement, dict):
        parts += [str(measurement.get("threshold") or ""), measurement.get("unit")]
    return " ".join(str(p) for p in parts if p)


def load_rows(document_id: str) -> List[Tuple[str, str]]:
    """(table_key, row text) for every ground-truth row of one document."""
    data = json.loads(GROUND_TRUTH.read_text(encoding="utf-8"))
    document = next((d for d in data["documents"] if d["document_id"] == document_id), None)
    if document is None:
        raise SystemExit(f"No document '{document_id}' in the corpus ground truth")
    rows = []
    for table in document["tables"]:
        for row in table["rows"]:
            rows.append((table["table_key"], " | ".join(str(cell) for cell in row)))
    return rows


def score(rows: List[Tuple[str, str]], records: List[Dict[str, Any]]) -> Dict[str, Any]:
    texts = [_record_text(r) for r in records]
    record_numbers = [_numbers(t) for t in texts]
    record_tokens = [_tokens(t) for t in texts]

    found: List[Tuple[str, str]] = []
    missed: List[Tuple[str, str]] = []
    by_table: Dict[str, List[int]] = {}

    for table_key, row_text in rows:
        row_numbers = _numbers(row_text)
        row_tokens = _tokens(row_text)
        hit = False
        for numbers, tokens in zip(record_numbers, record_tokens):
            # A row with numbers must match on a number; a row without one
            # (FREE, at cost, on request) can only be matched on its words, and
            # then only on a strong overlap.
            if row_numbers:
                if not (row_numbers & numbers):
                    continue
                if row_tokens and not (row_tokens & tokens):
                    continue
                hit = True
                break
            if row_tokens and len(row_tokens & tokens) >= max(2, len(row_tokens) // 2):
                hit = True
                break
        (found if hit else missed).append((table_key, row_text))
        bucket = by_table.setdefault(table_key, [0, 0])
        bucket[0] += 1
        bucket[1] += 1 if hit else 0

    total = len(rows)
    scoreable = [r for r in rows if r[0] not in _NON_OBLIGATION_TABLES]
    scoreable_found = [r for r in found if r[0] not in _NON_OBLIGATION_TABLES]
    return {
        "rows": total,
        "found": len(found),
        "recall": (len(found) / total) if total else 0.0,
        "scoreable_rows": len(scoreable),
        "scoreable_found": len(scoreable_found),
        "scoreable_recall": (len(scoreable_found) / len(scoreable)) if scoreable else 0.0,
        "records": len(records),
        "by_table": {
            key: {"rows": counts[0], "found": counts[1], "recall": counts[1] / counts[0]}
            for key, counts in sorted(by_table.items())
        },
        "missed": missed,
    }


def score_precision(
    rows: List[Tuple[str, str]],
    records: List[Dict[str, Any]],
    document_text: Optional[str],
) -> Dict[str, Any]:
    """What the emitted records are worth, not just how many rows they cover.

    Recall alone rewards emitting more. Every change made to this pipeline so
    far — table rows, batch bisecting, the repair loop — *adds* records, so each
    one looks like an improvement on recall whether or not the additions are
    right. This is the counterweight.

    Three outcomes per record:

    * **supported**  — binds a value that a ground-truth table row states.
    * **in-document** — binds a value the document states in prose. The corpus
      ground truth covers tables only, so this is not an error; a rate stated in
      a sentence is a real obligation.
    * **ungrounded** — binds a value that appears nowhere in the document. There
      is no charitable reading of this one.

    Duplicates are counted separately: two records for one row are not two
    obligations, and they inflate any count-based metric.
    """
    row_numbers: Dict[float, List[str]] = {}
    for table_key, row_text in rows:
        for value in _numbers(row_text):
            row_numbers.setdefault(value, []).append(f"{table_key}|{row_text}")

    document_numbers = _numbers(document_text or "")

    supported: List[Dict[str, Any]] = []
    in_document: List[Dict[str, Any]] = []
    ungrounded: List[Dict[str, Any]] = []
    unbound: List[Dict[str, Any]] = []
    row_hits: Dict[str, int] = {}

    for record in records:
        text = _record_text(record)
        measurement = record.get("measurement") if isinstance(record.get("measurement"), dict) else {}
        bound = record.get("value")
        if bound is None:
            bound = measurement.get("threshold")
        if bound is None:
            unbound.append(record)
            continue

        values = _numbers(str(bound))
        matched_rows = [r for value in values for r in row_numbers.get(value, [])]
        if matched_rows:
            supported.append(record)
            # Attribute to the row whose words overlap most, so two records for
            # one row are visible as duplicates rather than as two rows covered.
            tokens = _tokens(text)
            best = max(matched_rows, key=lambda r: len(_tokens(r) & tokens))
            row_hits[best] = row_hits.get(best, 0) + 1
        elif values and values & document_numbers:
            in_document.append(record)
        elif document_text:
            ungrounded.append(record)
        else:
            in_document.append(record)   # cannot tell without the text; say so

    duplicates = sum(count - 1 for count in row_hits.values() if count > 1)
    scored = len(supported) + len(in_document) + len(ungrounded)
    return {
        "records": len(records),
        "unbound": len(unbound),
        "supported": len(supported),
        "in_document": len(in_document),
        "ungrounded": len(ungrounded),
        "duplicates": duplicates,
        "distinct_rows_covered": len(row_hits),
        # Precision here is "binds a value the document actually states".
        # Deliberately generous: it does not check that the record describes the
        # right duty, only that the number is real.
        "value_precision": ((len(supported) + len(in_document)) / scored) if scored else 0.0,
        "ungrounded_examples": [
            {"name": r.get("name"), "value": r.get("value"), "quote": (r.get("quote") or "")[:90]}
            for r in ungrounded[:10]
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--document", required=True, help="corpus document id: A, B, C, D or E")
    parser.add_argument("--records", required=True, type=Path,
                        help="JSON file: a list of extracted records, or {'records': [...]}, "
                             "or the /kpis API response")
    parser.add_argument("--show-missed", type=int, default=15)
    parser.add_argument("--document-text", type=Path,
                        help="the contract's extracted text. Required for precision: without it "
                             "there is no way to tell a value the document states in prose from a "
                             "value the model invented.")
    parser.add_argument("--show-unsupported", type=int, default=8)
    args = parser.parse_args()

    payload = json.loads(args.records.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        records = payload.get("records") or payload.get("kpis") or payload.get("items") or []
    else:
        records = payload

    result = score(load_rows(args.document), records)

    print(f"document      : {args.document}")
    print(f"records       : {result['records']}")
    print(f"ground truth  : {result['rows']} rows")
    print(f"row recall    : {result['found']}/{result['rows']} = {result['recall'] * 100:.1f}%  (all rows)")
    print(f"ROW RECALL    : {result['scoreable_found']}/{result['scoreable_rows']} = "
          f"{result['scoreable_recall'] * 100:.1f}%  (obligation-bearing tables only)")
    print()
    print(f"{'table':32} {'rows':>5} {'found':>6} {'recall':>8}")
    for key, stats in result["by_table"].items():
        print(f"{key[:30]:32} {stats['rows']:>5} {stats['found']:>6} {stats['recall'] * 100:>7.0f}%")

    document_text = args.document_text.read_text(encoding="utf-8") if args.document_text else None
    precision = score_precision(load_rows(args.document), records, document_text)
    print()
    print(f"{'records emitted':28} {precision['records']:>5}")
    print(f"{'  bind no value at all':28} {precision['unbound']:>5}")
    print(f"{'  supported by a table row':28} {precision['supported']:>5}")
    print(f"{'  value stated in prose':28} {precision['in_document']:>5}")
    print(f"{'  UNGROUNDED':28} {precision['ungrounded']:>5}"
          f"{'   <-- value appears nowhere in the document' if precision['ungrounded'] else ''}")
    print(f"{'  duplicate readings':28} {precision['duplicates']:>5}")
    if document_text:
        print(f"{'VALUE PRECISION':28} {precision['value_precision'] * 100:>4.1f}%")
    else:
        print("VALUE PRECISION              n/a  (pass --document-text to separate prose from invention)")

    if precision["ungrounded_examples"] and args.show_unsupported:
        print(f"\nungrounded records (first {args.show_unsupported}):")
        for entry in precision["ungrounded_examples"][: args.show_unsupported]:
            print(f"  {str(entry['name'])[:44]:46} value={entry['value']}  {entry['quote'][:50]}")

    if result["missed"] and args.show_missed:
        print(f"\nmissed rows (first {args.show_missed}):")
        for table_key, row_text in [m for m in result["missed"] if m[0] not in _NON_OBLIGATION_TABLES][: args.show_missed]:
            print(f"  [{table_key}] {row_text[:96]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
