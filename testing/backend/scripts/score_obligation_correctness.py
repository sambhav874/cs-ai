#!/usr/bin/env python3
"""Score extraction against a hand-labelled obligation set.

Everything else in this repo measures *presence*: span coverage asks whether a
number was quoted somewhere, grounding asks whether a quote is real, anchors ask
whether a handful of must-find values survived. None of them can tell you that a
record bound the wrong threshold to the wrong party — a record can be perfectly
grounded, satisfy every anchor, and still be wrong.

This compares against `labels/<contract>.labels.json`, which enumerates each
obligation with its party, operator, threshold and unit, and reports:

    recall      — labelled obligations that some record captured
    precision   — records that correspond to a labelled obligation
    party        — of matched pairs, how many agree on who owes the duty
    threshold    — of matched pairs with a numeric target, how many agree on it

A record matches a label when the record's quote contains the label's anchor
text. That is deliberately strict and objective: no fuzzy scoring, no judgement.

Usage::

    python testing/backend/scripts/score_obligation_correctness.py \\
        --labels final_evaluation/datasets/kpi_contracts/labels/01_global_logistics.labels.json \\
        --pred <extraction.json>
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional

_DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−"), "-")


def norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "").translate(_DASHES)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[*_`~]+", "", text)
    return re.sub(r"\s+", " ", text).strip().casefold()


def record_quotes(record: Dict[str, Any]) -> List[str]:
    out = []
    for key in ("quote", "source_quote", "clause_text"):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            out.append(norm(value))
    phase1 = record.get("phase1")
    if isinstance(phase1, dict) and isinstance(phase1.get("quote"), str):
        out.append(norm(phase1["quote"]))
    return out


def record_party(record: Dict[str, Any]) -> Optional[str]:
    for key in ("party_role", "obligation_type"):
        value = str(record.get(key) or "").strip().lower()
        if value in {"supplier", "client", "mutual"}:
            return value
    phase1 = record.get("phase1")
    if isinstance(phase1, dict):
        value = str(phase1.get("party_role") or "").strip().lower()
        if value in {"supplier", "client", "mutual"}:
            return value
    return None


def record_numbers(record: Dict[str, Any]) -> List[float]:
    """Every numeric value the record binds, so a threshold match is not
    penalised by which field the extractor happened to use."""
    out: List[float] = []

    def take(value: Any) -> None:
        if isinstance(value, bool) or value is None:
            return
        try:
            out.append(float(value))
        except (TypeError, ValueError):
            return

    for key in ("value", "value_min", "value_max", "consequence_value"):
        take(record.get(key))
    measurement = record.get("measurement")
    if isinstance(measurement, dict):
        for key in ("threshold", "threshold_min", "threshold_max"):
            take(measurement.get(key))
    for tier in record.get("target_schedule") or []:
        if isinstance(tier, dict):
            for value in tier.values():
                if isinstance(value, (int, float)):
                    take(value)
                elif isinstance(value, str):
                    for found in re.findall(r"[\d,]+(?:\.\d+)?", value):
                        take(found.replace(",", ""))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--labels", required=True, type=Path)
    parser.add_argument("--pred", required=True, type=Path)
    parser.add_argument("--show-missed", type=int, default=12)
    args = parser.parse_args()

    labels = json.loads(args.labels.read_text(encoding="utf-8"))
    obligations = labels["obligations"]

    payload = json.loads(args.pred.read_text(encoding="utf-8"))
    records = payload.get("records", payload) if isinstance(payload, dict) else payload

    quotes = [(record, record_quotes(record)) for record in records]

    matched_records = set()
    hits: List[Dict[str, Any]] = []
    missed: List[Dict[str, Any]] = []

    for label in obligations:
        needle = norm(label["anchor"])
        found = None
        for index, (record, record_quote_list) in enumerate(quotes):
            if any(needle in quote for quote in record_quote_list):
                found = (index, record)
                break
        if found is None:
            missed.append(label)
        else:
            matched_records.add(found[0])
            hits.append({"label": label, "record": found[1]})

    total = len(obligations)
    recall = len(hits) / total if total else 1.0
    precision = len(matched_records) / len(records) if records else 0.0

    party_checked = [h for h in hits if record_party(h["record"])]
    party_ok = [h for h in party_checked if record_party(h["record"]) == h["label"]["party"]]

    threshold_checked = [h for h in hits if h["label"]["threshold"] is not None]
    threshold_ok = [
        h for h in threshold_checked
        if any(abs(n - float(h["label"]["threshold"])) < 0.01 for n in record_numbers(h["record"]))
    ]

    print(f"contract        {labels['contract_file']}")
    print(f"labels          {total}   ({labels.get('status', 'unknown status')})")
    print(f"records         {len(records)}")
    print()
    print(f"recall          {recall * 100:5.1f}%  ({len(hits)}/{total} labelled obligations captured)")
    print(f"precision       {precision * 100:5.1f}%  ({len(matched_records)}/{len(records)} records map to a label)")
    if party_checked:
        print(f"party accuracy  {len(party_ok) / len(party_checked) * 100:5.1f}%  "
              f"({len(party_ok)}/{len(party_checked)} matched records name the right obligor)")
    if threshold_checked:
        print(f"threshold acc.  {len(threshold_ok) / len(threshold_checked) * 100:5.1f}%  "
              f"({len(threshold_ok)}/{len(threshold_checked)} matched records bind the right number)")

    if missed:
        print(f"\nmissed obligations ({len(missed)}):")
        for label in missed[: args.show_missed]:
            print(f"  {label['id']}  §{label['section']:<7} {label['action'][:64]}")

    wrong_party = [h for h in party_checked if h not in party_ok]
    if wrong_party:
        print(f"\nwrong obligor ({len(wrong_party)}):")
        for h in wrong_party[:8]:
            print(f"  {h['label']['id']}  expected {h['label']['party']:<9} got {record_party(h['record'])!r:<10} "
                  f"{h['label']['action'][:48]}")

    wrong_threshold = [h for h in threshold_checked if h not in threshold_ok]
    if wrong_threshold:
        print(f"\nwrong or missing threshold ({len(wrong_threshold)}):")
        for h in wrong_threshold[:8]:
            print(f"  {h['label']['id']}  expected {h['label']['threshold']} {h['label']['unit'] or ''} "
                  f"| record numbers: {record_numbers(h['record'])[:6]}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
