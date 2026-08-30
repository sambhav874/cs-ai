"""Track what changed in a schedule between one contract and the next.

Rate cards are reissued rather than edited: a new document arrives carrying the
same schedule with different numbers. Matching those to their predecessor is
what turns a pile of tables into a history, and the comparison is the thing a
commercial manager actually wants — not the tables themselves, but whether the
prices moved and by how much.

Nothing here decides *why* a rate moved. The observed change is derived from
the values and reported as measured; comparing it to what a contract's
escalation clause promised is a separate step that needs the clause.
"""

import logging
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# A ratio spread below this reads as one indexation applied to every line.
# Per-line rounding to 2dp moves small values proportionally more than large
# ones, so an exact match is too strict to survive a real uplift.
UNIFORM_RATIO_TOLERANCE = 0.005

# Guardrail on how much detail rides along with an event. The full diff is
# useful in the payload; an unbounded one turns a 500-row fee schedule into a
# document nobody can read and bloats every context that renders it.
MAX_DETAIL_ROWS = 20

_MONEY = re.compile(r"^\s*[€$£]?\s*([\d,]+\.?\d*)\s*(EUR|USD|GBP)?\s*$", re.IGNORECASE)


def is_trackable(table_type: Optional[str]) -> bool:
    """Whether a change in this kind of table is worth reporting.

    A contact block gains a new signatory and a cover page changes its dates on
    every revision. Those are changes, but reporting them buries the one that
    matters, so only kinds whose values carry commercial weight are compared.

    An unclassified table is tracked: classification is advisory and can return
    nothing, and silently dropping a rate card because the label was missing is
    the worse failure.
    """
    if not table_type:
        return True
    try:
        from services.table_classification import TRACKABLE_CATEGORIES

        return table_type in TRACKABLE_CATEGORIES
    except Exception:
        return True


def _money(value: Any) -> Optional[Decimal]:
    """The numeric part of a price cell, or None when it is not a price."""
    match = _MONEY.match(str(value or ""))
    if not match:
        return None
    try:
        return Decimal(match.group(1).replace(",", ""))
    except InvalidOperation:
        return None


# Below this, two tables just happen to look a bit alike — not worth surfacing
# as "might be the same schedule". Above it we'd rather flag a possible match
# for a human than let a renamed column sever the lineage with no trace at all.
FUZZY_MATCH_THRESHOLD = 0.55


def _header_cells(table: Dict[str, Any]) -> List[str]:
    lines = [line for line in (table.get("body") or "").splitlines() if line.strip()]
    if not lines:
        return []
    return [cell.strip().lower() for cell in lines[0].strip().strip("|").split("|") if cell.strip()]


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _lineage_similarity(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    """How likely two tables are the same schedule, when the signature does not agree.

    Header overlap alone is too weak: two entirely unrelated rate cards often
    share generic columns like DESCRIPTION/UNIT/PRICE, which would fuzzy-match
    a de-icing schedule to a ramp-services one on shape alone. The caption is
    the stronger signal — a renamed column keeps the caption, an unrelated
    table rarely shares one — so it carries most of the weight, with header
    overlap breaking ties between equally-captioned candidates.
    """
    caption_a = re.sub(r"[^a-z0-9]+", " ", (a.get("caption") or "").lower()).strip()
    caption_b = re.sub(r"[^a-z0-9]+", " ", (b.get("caption") or "").lower()).strip()
    caption_score = 1.0 if caption_a and caption_a == caption_b else 0.0
    header_score = _jaccard(set(_header_cells(a)), set(_header_cells(b)))
    return 0.65 * caption_score + 0.35 * header_score


def _data_rows(table: Dict[str, Any]) -> List[List[str]]:
    lines = [line for line in (table.get("body") or "").splitlines() if line.strip()]
    return [
        [cell.strip() for cell in line.strip().strip("|").split("|")]
        for line in lines[2:]
    ]


def _row_key(row: List[str]) -> str:
    """Rows are matched on their label, which survives a repricing."""
    return row[0].strip().lower() if row else ""


def compare_tables(before: Dict[str, Any], after: Dict[str, Any]) -> Dict[str, Any]:
    """Diff two revisions of the same schedule.

    Returns the row-level changes plus, when every changed price moved by the
    same factor, the factor itself. A uniform ratio is what separates an
    indexation from a renegotiation: an index moves the whole card, a
    negotiation moves individual lines.
    """
    old_rows = {_row_key(r): r for r in _data_rows(before) if _row_key(r)}
    new_rows = {_row_key(r): r for r in _data_rows(after) if _row_key(r)}

    changes: List[Dict[str, str]] = []
    ratios: List[float] = []
    changed = unchanged = 0

    for key, new_row in new_rows.items():
        old_row = old_rows.get(key)
        if old_row is None:
            changes.append({"change": "added", "row": new_row[0], "old": "", "new": " | ".join(new_row[1:])})
            continue
        row_changed = False
        for old_cell, new_cell in zip(old_row[1:], new_row[1:]):
            if old_cell.strip() == new_cell.strip():
                continue
            row_changed = True
            changes.append({"change": "changed", "row": new_row[0], "old": old_cell, "new": new_cell})
            old_value, new_value = _money(old_cell), _money(new_cell)
            if old_value and new_value and old_value > 0:
                ratios.append(float(new_value) / float(old_value))
        changed += row_changed
        unchanged += not row_changed

    for key, old_row in old_rows.items():
        if key not in new_rows:
            changes.append({"change": "removed", "row": old_row[0], "old": " | ".join(old_row[1:]), "new": ""})

    uniform_ratio: Optional[float] = None
    if ratios and (max(ratios) - min(ratios)) <= UNIFORM_RATIO_TOLERANCE:
        uniform_ratio = sum(ratios) / len(ratios)

    return {
        "changed_rows": changed,
        "unchanged_rows": unchanged,
        "added_rows": sum(1 for c in changes if c["change"] == "added"),
        "removed_rows": sum(1 for c in changes if c["change"] == "removed"),
        "priced_cells": len(ratios),
        "uniform_ratio": uniform_ratio,
        "observed_pct": round((uniform_ratio - 1) * 100, 2) if uniform_ratio else None,
        "changes": changes,
    }


def _describe(caption: str, diff: Dict[str, Any]) -> Tuple[str, str]:
    """A one-line summary of a revision, and how loudly to report it."""
    if not any((diff["changed_rows"], diff["added_rows"], diff["removed_rows"])):
        return f"{caption} was reissued unchanged.", "info"

    parts: List[str] = []
    if diff["observed_pct"] is not None:
        parts.append(f"{diff['observed_pct']:+.2f}% applied uniformly to {diff['priced_cells']} rate(s)")
    elif diff["changed_rows"]:
        parts.append(f"{diff['changed_rows']} row(s) repriced individually")
    if diff["added_rows"]:
        parts.append(f"{diff['added_rows']} added")
    if diff["removed_rows"]:
        parts.append(f"{diff['removed_rows']} removed")

    # A uniform move is an index being applied and is expected. Individually
    # repriced lines, or services appearing and disappearing, are the cases
    # somebody should look at.
    severity = "info" if diff["observed_pct"] is not None and not diff["added_rows"] and not diff["removed_rows"] else "warning"
    return f"{caption}: " + ", ".join(parts) + ".", severity


def diff_against_previous(
    current: List[Dict[str, Any]],
    previous: List[Tuple[str, str, List[Dict[str, Any]]]],
) -> List[Dict[str, Any]]:
    """Match this contract's tables to the most recent earlier version of each.

    ``previous`` is (contract_id, contract_name, tables) ordered oldest first.
    Matching is by signature first, which is derived from the caption and
    column headers, so a schedule keeps its identity while its prices change.

    A renamed column breaks that — the corpus case that motivated this is a
    "SGHA 2018" header becoming "SGHA Ref" between two revisions of the same
    rate card. Without a second attempt that lineage just stops, silently, and
    nothing downstream ever learns the schedule kept existing. So a signature
    miss falls back to header-overlap similarity against tables not already
    claimed by an exact match, and a strong-enough overlap is reported as a
    possible match rather than either a silent loss or a confident wrong link.
    """
    latest: Dict[str, Tuple[str, str, Dict[str, Any]]] = {}
    # (recency, contract_id, contract_name, table) — recency breaks a tied
    # header-similarity score toward the most recent candidate, the same
    # "most recent earlier version" rule the exact-signature path follows.
    unclaimed: List[Tuple[int, str, str, Dict[str, Any]]] = []
    for recency, (contract_id, contract_name, tables) in enumerate(previous):
        for table in tables:
            signature = table.get("signature")
            if signature:
                latest[signature] = (contract_id, contract_name, table)
                unclaimed.append((recency, contract_id, contract_name, table))

    exactly_matched_signatures = {
        table.get("signature") for table in current if table.get("signature") in latest
    }

    results: List[Dict[str, Any]] = []
    for table in current:
        signature = table.get("signature")
        if not signature or not is_trackable(table.get("table_type")):
            continue
        caption = table.get("caption") or (table.get("body") or "").splitlines()[0][:60]
        match = latest.get(signature)

        if not match:
            fuzzy = max(
                (
                    (recency, candidate_id, candidate_name, candidate_table, _lineage_similarity(table, candidate_table))
                    for recency, candidate_id, candidate_name, candidate_table in unclaimed
                    # A table already linked by an exact match elsewhere is not
                    # available as a fuzzy candidate for this one.
                    if candidate_table.get("signature") not in exactly_matched_signatures
                ),
                key=lambda item: (item[4], item[0]),
                default=None,
            )
            if fuzzy and fuzzy[4] >= FUZZY_MATCH_THRESHOLD:
                _recency, prior_id, prior_name, prior_table, score = fuzzy
                results.append({
                    "signature": signature,
                    "caption": caption,
                    "table_type": table.get("table_type"),
                    "status": "possible_match",
                    "summary": (
                        f"A table matching \"{caption}\" could not be linked to its exact prior "
                        f"version — its columns changed enough that {prior_name or 'an earlier document'} "
                        f"may be the same schedule under a different header. Needs confirmation."
                    ),
                    "severity": "warning",
                    "previous_contract_id": prior_id,
                    "previous_contract_name": prior_name,
                    "header_similarity": round(score, 2),
                })
                continue
            results.append({
                "signature": signature,
                "caption": caption,
                "table_type": table.get("table_type"),
                "status": "new",
                "summary": f"{caption} has no earlier version in this project.",
                "severity": "info",
            })
            continue

        prior_id, prior_name, prior_table = match
        diff = compare_tables(prior_table, table)
        summary, severity = _describe(caption, diff)
        results.append({
            "signature": signature,
            "caption": caption,
            "table_type": table.get("table_type"),
            "status": "unchanged" if not any(
                (diff["changed_rows"], diff["added_rows"], diff["removed_rows"])
            ) else "revised",
            "summary": summary,
            "severity": severity,
            "previous_contract_id": prior_id,
            "previous_contract_name": prior_name,
            "observed_pct": diff["observed_pct"],
            "changed_rows": diff["changed_rows"],
            "added_rows": diff["added_rows"],
            "removed_rows": diff["removed_rows"],
            "priced_cells": diff["priced_cells"],
            "changes": diff["changes"][:MAX_DETAIL_ROWS],
            "changes_truncated": max(0, len(diff["changes"]) - MAX_DETAIL_ROWS),
        })
    return results
