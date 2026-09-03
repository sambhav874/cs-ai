#!/usr/bin/env python3
"""Score obligation extraction output against a hand-labelled gold set.

Phase 0 of the extraction accuracy plan.  Nothing else in that plan is
measurable until this exists, so this module is deliberately standalone:
stdlib only, no Mongo, no LLM, no imports from ``apps.backend``.  Feed it a
JSON dump of extracted records from wherever they come from (a pipeline run,
an API response, a ``kpis`` collection export) and it reports what was found,
what was missed, and which fields were wrong.

Design notes that matter when reading the numbers:

* **Matching is evidence-based, never name-based.**  Gold quotes in the
  Baltia set are short (22-77 chars) and carry the value, so they discriminate
  well.  Names do not: three ladder rows share the name "B747-200 series
  aircraft" and differ only by amount.

* **Record-type agreement is reported separately from recall.**  The gold
  vocabulary (``fee_schedule``, ``payment_term``, ...) predates the 2.1
  extraction vocabulary and does not map onto it one-to-one.  Baking a
  debatable mapping into the headline recall number would make the mapping
  unfalsifiable, so recall counts evidence found and type agreement is its own
  field metric, split into strict and undebatable variants.

* **Extra predictions are reported, not punished by default.**  The gold set
  covers one annex of the agreement; an extractor that legitimately finds more
  is not thereby wrong.  Precision is printed, but ``--gate`` only enforces
  recall and the field accuracies unless ``--gate-precision`` is passed.

Usage::

    python testing/backend/scripts/score_obligation_extraction.py \
        --gold demo_data/baltia_jfk_ground_truth.json \
        --pred run1.json [--pred run2.json --pred run3.json] \
        --report reports/obligation_extraction_baseline.json
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


# ---------------------------------------------------------------------------
# Vocabulary maps — explicit and reviewable on purpose
# ---------------------------------------------------------------------------

# Gold party vocabulary -> the 2.1 extraction vocabulary.
GOLD_PARTY_ROLE_MAP: Dict[str, str] = {
    "customer": "client",
    "client": "client",
    "supplier": "supplier",
    "provider": "supplier",
    "mutual": "mutual",
    "both": "mutual",
}

# Gold record_type -> 2.1 record_type.  Entries marked debatable below are
# judgement calls about equivalence rather than renames, and are excluded from
# the "undebatable" type-accuracy figure.
GOLD_RECORD_TYPE_MAP: Dict[str, str] = {
    "kpi": "supporting_measurement",
    "obligation": "trackable_operational_obligation",
    "penalty": "financial_consequence",
    "remedy": "financial_consequence",
    "reference_only": "reference_only",
    # Judgement calls:
    "fee_schedule": "trackable_operational_obligation",
    "payment_term": "trackable_operational_obligation",
    "liability_clause": "financial_consequence",
    "index_clause": "trackable_operational_obligation",
}

DEBATABLE_GOLD_RECORD_TYPES = {
    "fee_schedule",
    "payment_term",
    "liability_clause",
    "index_clause",
}

# Gold operators -> the operator vocabulary the extractor emits.
GOLD_OPERATOR_MAP: Dict[str, Optional[str]] = {
    "=": "==",
    "==": "==",
    ">=": ">=",
    "<=": "<=",
    ">": ">",
    "<": "<",
    "n/a": None,
    "na": None,
    "": None,
}

NULL_STRINGS = {"", "n/a", "na", "none", "null", "not specified", "unknown"}

CURRENCY_CODES = ("USD", "EUR", "GBP", "SEK", "CHF", "INR", "AED", "SGD", "JPY", "CAD", "AUD")


# ---------------------------------------------------------------------------
# Normalisation helpers
# ---------------------------------------------------------------------------

def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _is_null(value: Any) -> bool:
    return _text(value).lower() in NULL_STRINGS


def normalize_quote(value: Any) -> str:
    """Lowercase, strip punctuation that carries no evidence, collapse space.

    Digits, decimal points and percent signs are kept: they are what make a
    ladder row distinguishable from the row above it.
    """
    text = _text(value).lower()
    text = text.replace("–", "-").replace("—", "-").replace("’", "'")
    text = re.sub(r"[^a-z0-9%.\-/ ]+", " ", text)
    text = re.sub(r"(?<=\d),(?=\d)", "", text)  # 2,395.00 -> 2395.00
    return re.sub(r"\s+", " ", text).strip()


def _tokens(text: str) -> List[str]:
    return [token for token in normalize_quote(text).split(" ") if token]


def _numeric_tokens(text: str) -> List[str]:
    out: List[str] = []
    for raw in re.findall(r"\d+(?:\.\d+)?", normalize_quote(text)):
        # 2395.00 and 2395 are the same evidence.
        out.append(str(float(raw)))
    return out


def _f1(left: Sequence[str], right: Sequence[str]) -> float:
    left_set, right_set = set(left), set(right)
    if not left_set or not right_set:
        return 0.0
    overlap = len(left_set & right_set)
    if not overlap:
        return 0.0
    precision = overlap / len(right_set)
    recall = overlap / len(left_set)
    return 2 * precision * recall / (precision + recall)


def quote_similarity(gold_quote: str, pred_quote: str) -> float:
    """Similarity in [0, 1] between a gold quote and a predicted quote.

    Containment scores 1.0 in either direction: the extractor caps quotes at
    45 words and the gold quotes are single lines, so a correct prediction
    usually *contains* the gold quote rather than equalling it.
    """
    gold_norm = normalize_quote(gold_quote)
    pred_norm = normalize_quote(pred_quote)
    if not gold_norm or not pred_norm:
        return 0.0
    if gold_norm in pred_norm or pred_norm in gold_norm:
        return 1.0

    word_score = _f1(_tokens(gold_quote), _tokens(pred_quote))
    gold_numbers = _numeric_tokens(gold_quote)
    if not gold_numbers:
        return word_score
    number_score = _f1(gold_numbers, _numeric_tokens(pred_quote))
    # A ladder row is identified by its amount; weight numbers accordingly.
    return 0.5 * word_score + 0.5 * number_score


def parse_currency(value: Any) -> Optional[str]:
    """Pull a currency code out of a unit string such as 'USD/turnaround'."""
    text = _text(value).upper()
    if not text:
        return None
    for code in CURRENCY_CODES:
        if re.search(rf"\b{code}\b", text):
            return code
    if "$" in text:
        return "USD"
    return None


def parse_unit_basis(value: Any) -> Optional[str]:
    """The denominator of a unit: 'USD/turnaround' -> 'turnaround'."""
    text = _text(value)
    if _is_null(text):
        return None
    if "/" in text:
        basis = text.split("/", 1)[1]
    else:
        basis = text
    basis = re.sub(r"\(.*?\)", " ", basis)
    basis = re.sub(r"[^A-Za-z ]+", " ", basis).strip().lower()
    basis = re.sub(r"\s+", " ", basis)
    return basis or None


def to_float(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = _text(value).replace(",", "")
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group(0)) if match else None


def numbers_equal(left: Optional[float], right: Optional[float]) -> bool:
    if left is None or right is None:
        return False
    return math.isclose(left, right, rel_tol=1e-6, abs_tol=1e-9)


# ---------------------------------------------------------------------------
# Input loading
# ---------------------------------------------------------------------------

@dataclass
class Record:
    """One obligation, flattened out of whichever shape it arrived in."""

    quote: str
    name: str = ""
    code: str = ""
    section: str = ""
    party_role: Optional[str] = None
    record_type: Optional[str] = None
    operator: Optional[str] = None
    value: Optional[float] = None
    unit: Optional[str] = None
    currency: Optional[str] = None
    target_schedule: List[Any] = field(default_factory=list)
    raw: Dict[str, Any] = field(default_factory=dict)


def load_gold(path: Path) -> List[Record]:
    payload = json.loads(path.read_text())
    rows = payload.get("kpis") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise SystemExit(f"{path}: expected a 'kpis' array")

    records: List[Record] = []
    for row in rows:
        unit = row.get("unit")
        records.append(
            Record(
                quote=_text(row.get("quote")),
                name=_text(row.get("name")),
                code=_text(row.get("code")),
                section=_text(row.get("section")),
                party_role=GOLD_PARTY_ROLE_MAP.get(_text(row.get("party_role")).lower()),
                record_type=GOLD_RECORD_TYPE_MAP.get(_text(row.get("record_type")).lower()),
                operator=GOLD_OPERATOR_MAP.get(_text(row.get("operator")).lower(), None),
                value=to_float(row.get("value")),
                unit=None if _is_null(unit) else _text(unit),
                currency=parse_currency(unit),
                target_schedule=row.get("target_schedule") or [],
                raw=row,
            )
        )
    return records


def _flatten_prediction(row: Dict[str, Any]) -> Dict[str, Any]:
    """Accept a 2.1 envelope record, a legacy flat row, or a stored V2 doc."""
    if isinstance(row.get("phase1"), dict):
        merged = {**row["phase1"]}
        merged.setdefault("record_id", row.get("record_id"))
        return merged
    # Stored V2 documents nest the display fields under identity/rule.
    if isinstance(row.get("identity"), dict):
        merged = {**row}
        merged.update({k: v for k, v in row["identity"].items() if k not in merged or merged[k] is None})
        return merged
    return dict(row)


def load_predictions(path: Path) -> List[Record]:
    payload = json.loads(path.read_text())
    if isinstance(payload, dict):
        rows = payload.get("records") or payload.get("kpis") or payload.get("items") or []
    else:
        rows = payload
    if not isinstance(rows, list):
        raise SystemExit(f"{path}: expected an array, or an object with records/kpis/items")

    records: List[Record] = []
    for raw_row in rows:
        if not isinstance(raw_row, dict):
            continue
        row = _flatten_prediction(raw_row)
        measurement = row.get("measurement") if isinstance(row.get("measurement"), dict) else {}
        source_clause = row.get("source_clause") if isinstance(row.get("source_clause"), dict) else {}

        quote = _text(row.get("quote") or source_clause.get("quote") or row.get("clause_text"))
        unit = row.get("unit") or measurement.get("unit")
        value = row.get("value")
        if value is None:
            value = measurement.get("threshold")

        records.append(
            Record(
                quote=quote,
                name=_text(row.get("name")),
                code=_text(row.get("canonical_metric_key") or row.get("kpi_id") or row.get("record_id")),
                section=_text(row.get("section_path") or row.get("clause_ref")),
                party_role=_text(row.get("party_role") or row.get("obligation_type")).lower() or None,
                record_type=_text(row.get("record_type")).lower() or None,
                operator=_text(row.get("operator") or measurement.get("operator")) or None,
                value=to_float(value),
                unit=None if _is_null(unit) else _text(unit),
                currency=_text(measurement.get("currency") or row.get("currency")).upper() or parse_currency(unit),
                target_schedule=row.get("target_schedule") or [],
                raw=raw_row,
            )
        )
    return records


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

@dataclass
class Match:
    gold_index: int
    pred_index: int
    similarity: float


def match_records(
    gold: Sequence[Record],
    pred: Sequence[Record],
    *,
    threshold: float = 0.60,
) -> Tuple[List[Match], List[int], List[int]]:
    """Greedy one-to-one assignment on quote similarity, best pairs first."""
    scored: List[Match] = []
    for gold_index, gold_record in enumerate(gold):
        for pred_index, pred_record in enumerate(pred):
            score = quote_similarity(gold_record.quote, pred_record.quote)
            if score >= threshold:
                scored.append(Match(gold_index, pred_index, score))

    # Ties broken by index so a rerun on the same input gives the same pairs.
    scored.sort(key=lambda m: (-m.similarity, m.gold_index, m.pred_index))

    matches: List[Match] = []
    used_gold: set[int] = set()
    used_pred: set[int] = set()
    for candidate in scored:
        if candidate.gold_index in used_gold or candidate.pred_index in used_pred:
            continue
        used_gold.add(candidate.gold_index)
        used_pred.add(candidate.pred_index)
        matches.append(candidate)

    missed = [i for i in range(len(gold)) if i not in used_gold]
    spurious = [i for i in range(len(pred)) if i not in used_pred]
    return matches, missed, spurious


# ---------------------------------------------------------------------------
# Field scoring
# ---------------------------------------------------------------------------

@dataclass
class FieldOutcome:
    status: str  # match | mismatch | missing_prediction | not_in_gold
    gold: Any = None
    pred: Any = None


def _compare_optional(gold_value: Any, pred_value: Any, *, equal) -> FieldOutcome:
    if gold_value is None:
        return FieldOutcome("not_in_gold", gold_value, pred_value)
    if pred_value is None:
        return FieldOutcome("missing_prediction", gold_value, pred_value)
    status = "match" if equal(gold_value, pred_value) else "mismatch"
    return FieldOutcome(status, gold_value, pred_value)


def score_fields(gold: Record, pred: Record) -> Dict[str, FieldOutcome]:
    same = lambda a, b: a == b  # noqa: E731 - short and local

    outcomes: Dict[str, FieldOutcome] = {
        "party_role": _compare_optional(gold.party_role, pred.party_role, equal=same),
        "record_type": _compare_optional(gold.record_type, pred.record_type, equal=same),
        "operator": _compare_optional(gold.operator, pred.operator, equal=same),
        "value": _compare_optional(gold.value, pred.value, equal=numbers_equal),
        "currency": _compare_optional(gold.currency, pred.currency, equal=same),
        "unit_basis": _compare_optional(
            parse_unit_basis(gold.unit),
            parse_unit_basis(pred.unit),
            equal=lambda a, b: a == b or a in b or b in a,
        ),
    }

    # Tier schedules are scored on presence, not row equality: the gold set
    # records them as free-form rows and row-level equality would measure
    # formatting, not extraction.
    if gold.target_schedule:
        status = "match" if pred.target_schedule else "missing_prediction"
        outcomes["target_schedule"] = FieldOutcome(status, len(gold.target_schedule), len(pred.target_schedule))
    else:
        outcomes["target_schedule"] = FieldOutcome("not_in_gold", 0, len(pred.target_schedule))

    return outcomes


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def score_run(
    gold: Sequence[Record],
    pred: Sequence[Record],
    *,
    threshold: float = 0.60,
) -> Dict[str, Any]:
    matches, missed, spurious = match_records(gold, pred, threshold=threshold)

    field_totals: Dict[str, Dict[str, Any]] = {}
    mismatch_examples: List[Dict[str, Any]] = []
    undebatable_type_scored = 0
    undebatable_type_matched = 0

    for match in matches:
        gold_record = gold[match.gold_index]
        pred_record = pred[match.pred_index]
        outcomes = score_fields(gold_record, pred_record)

        for name, outcome in outcomes.items():
            bucket = field_totals.setdefault(
                name, {"scored": 0, "match": 0, "mismatch": 0, "missing_prediction": 0}
            )
            if outcome.status == "not_in_gold":
                continue
            bucket["scored"] += 1
            bucket[outcome.status] += 1
            if outcome.status != "match":
                mismatch_examples.append(
                    {
                        "field": name,
                        "gold_code": gold_record.code,
                        "gold_name": gold_record.name,
                        "gold": outcome.gold,
                        "pred": outcome.pred,
                        "status": outcome.status,
                        "quote": gold_record.quote,
                    }
                )

        gold_type_raw = _text(gold_record.raw.get("record_type")).lower()
        if gold_record.record_type is not None and gold_type_raw not in DEBATABLE_GOLD_RECORD_TYPES:
            undebatable_type_scored += 1
            if outcomes["record_type"].status == "match":
                undebatable_type_matched += 1

    for bucket in field_totals.values():
        bucket["accuracy"] = round(bucket["match"] / bucket["scored"], 4) if bucket["scored"] else None

    matched_count = len(matches)
    recall = matched_count / len(gold) if gold else 0.0
    precision = matched_count / len(pred) if pred else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0

    return {
        "gold_count": len(gold),
        "prediction_count": len(pred),
        "matched": matched_count,
        "missed": len(missed),
        "unmatched_predictions": len(spurious),
        "recall": round(recall, 4),
        "precision": round(precision, 4),
        "f1": round(f1, 4),
        "match_threshold": threshold,
        "fields": field_totals,
        "record_type_accuracy_undebatable": (
            round(undebatable_type_matched / undebatable_type_scored, 4) if undebatable_type_scored else None
        ),
        "record_type_undebatable_scored": undebatable_type_scored,
        "missed_records": [
            {
                "code": gold[i].code,
                "name": gold[i].name,
                "section": gold[i].section,
                "quote": gold[i].quote,
                "record_type": _text(gold[i].raw.get("record_type")),
            }
            for i in missed
        ],
        "unmatched_prediction_records": [
            {"name": pred[i].name, "code": pred[i].code, "section": pred[i].section, "quote": pred[i].quote}
            for i in spurious
        ],
        "field_mismatches": mismatch_examples,
        "matched_gold_codes": sorted(gold[m.gold_index].code for m in matches),
    }


def stability(reports: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Pairwise Jaccard over the set of gold records each run managed to find."""
    if len(reports) < 2:
        return None
    sets = [set(report["matched_gold_codes"]) for report in reports]
    scores: List[float] = []
    for left, right in combinations(sets, 2):
        union = left | right
        scores.append(len(left & right) / len(union) if union else 1.0)
    counts = [report["matched"] for report in reports]
    return {
        "runs": len(reports),
        "matched_per_run": counts,
        "matched_spread": max(counts) - min(counts),
        "mean_pairwise_jaccard": round(sum(scores) / len(scores), 4),
        "min_pairwise_jaccard": round(min(scores), 4),
        "always_found": sorted(set.intersection(*sets)),
        "sometimes_found": sorted(set.union(*sets) - set.intersection(*sets)),
    }


def format_summary(report: Dict[str, Any], *, label: str) -> str:
    lines = [
        f"── {label} ──",
        f"gold={report['gold_count']}  predicted={report['prediction_count']}  "
        f"matched={report['matched']}  missed={report['missed']}  extra={report['unmatched_predictions']}",
        f"recall={report['recall']:.3f}  precision={report['precision']:.3f}  f1={report['f1']:.3f}",
        "",
        f"{'field':<18}{'scored':>7}{'match':>7}{'acc':>8}",
    ]
    for name, bucket in sorted(report["fields"].items()):
        accuracy = "  n/a" if bucket["accuracy"] is None else f"{bucket['accuracy']:.3f}"
        lines.append(f"{name:<18}{bucket['scored']:>7}{bucket['match']:>7}{accuracy:>8}")

    undebatable = report["record_type_accuracy_undebatable"]
    if undebatable is not None:
        lines.append(
            f"{'record_type (undebatable)':<25}{report['record_type_undebatable_scored']:>0} scored, "
            f"acc={undebatable:.3f}"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

DEFAULT_GATES = {"recall": 1.0, "party_role": 1.0, "value": 1.0, "currency": 1.0}


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gold", type=Path, default=Path("demo_data/baltia_jfk_ground_truth.json"))
    parser.add_argument("--pred", type=Path, action="append", required=True,
                        help="Extraction output. Repeat for several runs to also get a stability figure.")
    parser.add_argument("--threshold", type=float, default=0.60, help="Minimum quote similarity to call it a match.")
    parser.add_argument("--report", type=Path, help="Write the full JSON report here.")
    parser.add_argument("--gate", action="store_true", help="Exit non-zero when a gate below is not met.")
    parser.add_argument("--gate-recall", type=float, default=DEFAULT_GATES["recall"])
    parser.add_argument("--gate-precision", type=float, default=None)
    parser.add_argument("--show-missed", type=int, default=10, help="How many missed gold records to print.")
    args = parser.parse_args(argv)

    gold = load_gold(args.gold)
    reports = []
    for pred_path in args.pred:
        predictions = load_predictions(pred_path)
        report = score_run(gold, predictions, threshold=args.threshold)
        report["prediction_file"] = str(pred_path)
        reports.append(report)
        print(format_summary(report, label=pred_path.name))
        print()

    combined: Dict[str, Any] = {"gold_file": str(args.gold), "runs": reports}
    stability_report = stability(reports)
    if stability_report:
        combined["stability"] = stability_report
        print("── stability ──")
        print(f"matched per run: {stability_report['matched_per_run']}  spread={stability_report['matched_spread']}")
        print(f"mean pairwise Jaccard: {stability_report['mean_pairwise_jaccard']:.3f}  "
              f"min: {stability_report['min_pairwise_jaccard']:.3f}")
        print(f"found in every run: {len(stability_report['always_found'])}  "
              f"unstable: {len(stability_report['sometimes_found'])}")
        print()

    first = reports[0]
    if args.show_missed and first["missed_records"]:
        print(f"── missed ({first['missed']}) ──")
        for row in first["missed_records"][: args.show_missed]:
            print(f"  {row['code'] or '-':<22} {row['section']:<18} {row['quote'][:70]}")
        if first["missed"] > args.show_missed:
            print(f"  ... and {first['missed'] - args.show_missed} more (see the JSON report)")
        print()

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(combined, indent=2))
        print(f"report written to {args.report}")

    if not args.gate:
        return 0

    failures: List[str] = []
    for report in reports:
        name = Path(report["prediction_file"]).name
        if report["recall"] < args.gate_recall:
            failures.append(f"{name}: recall {report['recall']:.3f} < {args.gate_recall}")
        if args.gate_precision is not None and report["precision"] < args.gate_precision:
            failures.append(f"{name}: precision {report['precision']:.3f} < {args.gate_precision}")
        for field_name, target in DEFAULT_GATES.items():
            if field_name == "recall":
                continue
            bucket = report["fields"].get(field_name)
            if bucket and bucket["accuracy"] is not None and bucket["accuracy"] < target:
                failures.append(f"{name}: {field_name} accuracy {bucket['accuracy']:.3f} < {target}")

    if failures:
        print("GATE FAILED")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("GATE PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
