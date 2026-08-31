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

# Currency symbols seen across contract corpora, plus a generic three-letter
# ISO code. Deliberately broad: the same comparison runs over whatever a project
# happens to contain, and a rate card denominated in a currency this did not
# recognise would silently stop being comparable.
_CURRENCY_SYMBOLS = "€$£¥₹₽₩₪₺R\\u20a9\\u20ab"
_VALUE = re.compile(
    r"^\s*(?P<sign>[-+(])?\s*"
    r"(?:(?P<sym>[" + _CURRENCY_SYMBOLS + r"]|[A-Z]{3})\s*)?"
    r"(?P<num>\d[\d.,\s]*\d|\d)"
    r"\s*(?P<pct>%)?"
    r"(?:\s*(?P<code>[A-Z]{3}))?"
    r"\s*\)?\s*$",
    re.IGNORECASE,
)

# Words that make a cell a statement rather than a value. "FREE" and "included"
# are meaningful contract terms, but they are not numbers and must not be
# compared as though a change to one were a repricing.
_NON_NUMERIC = {"free", "n/a", "na", "nil", "none", "included", "inclusive",
                "on request", "at cost", "tbc", "tba", "centralized", "centralised", "-", "—"}


def _normalize_decimal(raw: str) -> Optional[Decimal]:
    """Read a number written in whichever convention the document used.

    "1,234.56" and "1.234,56" are the same amount in different locales, and
    guessing wrong changes it by three orders of magnitude. Where both
    separators appear the last one is the decimal point; where only one appears
    it is a thousands separator only if it groups the digits exactly.
    """
    text = re.sub(r"\s", "", raw or "")
    if not text:
        return None

    last_dot, last_comma = text.rfind("."), text.rfind(",")
    if last_dot >= 0 and last_comma >= 0:
        decimal_sep = "." if last_dot > last_comma else ","
        thousands_sep = "," if decimal_sep == "." else "."
        text = text.replace(thousands_sep, "").replace(decimal_sep, ".")
    elif last_dot >= 0 or last_comma >= 0:
        sep = "." if last_dot >= 0 else ","
        groups = text.split(sep)
        # "1.234" is ambiguous. Treated as thousands only when the digits are
        # grouped the way a thousands separator groups them: trailing group of
        # three, and every group before it two or three long — which covers both
        # "1,234,567" and the Indian "2,50,000".
        looks_grouped = (
            len(groups) > 1
            and len(groups[-1]) == 3
            and all(len(g) in (2, 3) for g in groups[1:])
        )
        text = text.replace(sep, "") if looks_grouped else text.replace(sep, ".")

    try:
        return Decimal(text)
    except InvalidOperation:
        return None


def parse_value(cell: Any) -> Optional[Tuple[Decimal, str]]:
    """The number in a cell and what kind it is, or None if it holds no number.

    The kind matters because only like should be compared with like: a fee that
    rises 3% alongside a percentage-based levy that stays at 5.25% is a uniform
    uplift, and treating the levy as just another number would make it look
    like the rates moved by different amounts.
    """
    text = str(cell or "").strip()
    if not text or text.lower() in _NON_NUMERIC:
        return None

    match = _VALUE.match(text)
    if not match:
        return None
    value = _normalize_decimal(match.group("num"))
    if value is None:
        return None
    if match.group("sign") in ("-", "("):
        value = -value

    if match.group("pct"):
        kind = "percent"
    elif match.group("sym") or match.group("code"):
        kind = "currency"
    else:
        kind = "number"
    return value, kind


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


def describe_table(table: Dict[str, Any]) -> str:
    """A name for a table that a person can scan in a list.

    A banner caption is best when the document has one, but plenty of tables
    have no title at all, and falling straight through to the header row gives
    a list of raw pipes. The nearest preceding heading is what a reader would
    use to refer to the table, so it is preferred over the columns.
    """
    caption = (table.get("caption") or "").strip()
    if caption:
        return caption

    section = (table.get("section_path") or "").strip()
    if section:
        return section

    lines = [line for line in (table.get("body") or "").splitlines() if line.strip()]
    if not lines:
        return "Untitled table"
    header = [c.strip() for c in lines[0].strip().strip("|").split("|") if c.strip()]
    return " · ".join(header)[:80] if header else "Untitled table"


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
            old_parsed, new_parsed = parse_value(old_cell), parse_value(new_cell)
            if old_parsed and new_parsed and old_parsed[1] == new_parsed[1]:
                old_value, kind = old_parsed
                new_value = new_parsed[0]
                # Percentages are excluded from the uplift ratio: a levy quoted
                # as 5.25% is a different kind of quantity from a price, and
                # folding it in would make a uniform uplift look ragged.
                if kind != "percent" and old_value > 0:
                    ratios.append(float(new_value) / float(old_value))
        changed += row_changed
        unchanged += not row_changed

    for key, old_row in old_rows.items():
        if key not in new_rows:
            changes.append({"change": "removed", "row": old_row[0], "old": " | ".join(old_row[1:]), "new": ""})

    uniform_ratio: Optional[float] = None
    if ratios and (max(ratios) - min(ratios)) <= UNIFORM_RATIO_TOLERANCE:
        uniform_ratio = sum(ratios) / len(ratios)

    # When values moved by different amounts there is no single rate to report,
    # but the span still says how much moved — leaving it blank hides the
    # largest change in a project behind an empty column.
    spread: Optional[Tuple[float, float]] = None
    if ratios and uniform_ratio is None:
        spread = (round((min(ratios) - 1) * 100, 2), round((max(ratios) - 1) * 100, 2))

    return {
        "changed_rows": changed,
        "unchanged_rows": unchanged,
        "added_rows": sum(1 for c in changes if c["change"] == "added"),
        "removed_rows": sum(1 for c in changes if c["change"] == "removed"),
        "priced_cells": len(ratios),
        "uniform_ratio": uniform_ratio,
        "observed_pct": round((uniform_ratio - 1) * 100, 2) if uniform_ratio else None,
        "spread_pct": spread,
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
        detail = f"{diff['changed_rows']} row(s) repriced individually"
        if diff.get("spread_pct"):
            low, high = diff["spread_pct"]
            detail += (f" by {low:+.2f}%" if abs(high - low) < 0.005
                       else f", between {low:+.2f}% and {high:+.2f}%")
        parts.append(detail)
    if diff["added_rows"]:
        parts.append(f"{diff['added_rows']} added")
    if diff["removed_rows"]:
        parts.append(f"{diff['removed_rows']} removed")

    # A uniform move is an index being applied and is expected. Individually
    # repriced lines, or services appearing and disappearing, are the cases
    # somebody should look at.
    severity = "info" if diff["observed_pct"] is not None and not diff["added_rows"] and not diff["removed_rows"] else "warning"
    return f"{caption}: " + ", ".join(parts) + ".", severity


def link_key(from_signature: str, to_signature: str) -> str:
    """Stable identifier for one confirmed or rejected link between schedules."""
    return f"{from_signature}->{to_signature}"


def diff_against_previous(
    current: List[Dict[str, Any]],
    previous: List[Tuple[str, str, List[Dict[str, Any]]]],
    links: Optional[Dict[str, str]] = None,
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
    # A person's decision about a link outranks any similarity score: once
    # somebody has said two schedules are or are not the same, recomputing an
    # opinion every ingestion would make that decision meaningless.
    links = links or {}

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
        caption = describe_table(table)
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
            if fuzzy:
                decision = links.get(link_key(fuzzy[3].get("signature") or "", signature))
                if decision == "rejected":
                    fuzzy = None
                elif decision == "confirmed":
                    # Treated as the real predecessor, so the diff is reported
                    # rather than another prompt to confirm what was confirmed.
                    _recency, prior_id, prior_name, prior_table, _score = fuzzy
                    diff = compare_tables(prior_table, table)
                    summary, severity = _describe(caption, diff)
                    results.append({
                        "signature": signature,
                        "caption": caption,
                        "table_type": table.get("table_type"),
                        "status": "revised",
                        "summary": summary,
                        "severity": severity,
                        "previous_contract_id": prior_id,
                        "previous_contract_name": prior_name,
                        "link_confirmed": True,
                        "observed_pct": diff["observed_pct"],
                        "spread_pct": diff.get("spread_pct"),
                        "changed_rows": diff["changed_rows"],
                        "added_rows": diff["added_rows"],
                        "removed_rows": diff["removed_rows"],
                        "changes": diff["changes"][:MAX_DETAIL_ROWS],
                        "changes_truncated": max(0, len(diff["changes"]) - MAX_DETAIL_ROWS),
                    })
                    continue
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
                    "previous_signature": prior_table.get("signature"),
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


def build_lineages(
    documents: List[Tuple[str, str, Optional[str], List[Dict[str, Any]]]],
    links: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    """Group a project's tables into per-schedule histories, oldest first.

    ``documents`` is (contract_id, contract_name, effective_date, tables) in the
    order the schedules took effect. Each returned lineage is one schedule and
    every version of it found, with the change between consecutive versions.

    Built by replaying ``diff_against_previous`` one document at a time rather
    than matching everything at once, so the links here are exactly the links
    recorded at ingestion — a lineage that shows a break is showing the same
    break the events show, not a second opinion computed a different way.
    """
    # A confirmed link means two signatures name the same schedule, so they must
    # land in one history rather than two adjacent ones. Resolved transitively:
    # a card renamed twice still collapses to a single lineage.
    alias: Dict[str, str] = {}
    for key, decision in (links or {}).items():
        if decision != "confirmed" or "->" not in key:
            continue
        previous_signature, signature = key.split("->", 1)
        alias[signature] = previous_signature

    def canonical(signature: str) -> str:
        seen = set()
        while signature in alias and signature not in seen:
            seen.add(signature)
            signature = alias[signature]
        return signature

    lineages: Dict[str, Dict[str, Any]] = {}
    history: List[Tuple[str, str, List[Dict[str, Any]]]] = []

    for contract_id, contract_name, effective_date, tables in documents:
        findings = {
            finding["signature"]: finding
            for finding in diff_against_previous(tables, history, links)
        }

        for table in tables:
            signature = table.get("signature")
            if not signature or not is_trackable(table.get("table_type")):
                continue
            finding = findings.get(signature) or {}
            caption = describe_table(table)

            lineage = lineages.setdefault(canonical(signature), {
                "signature": canonical(signature),
                "caption": caption,
                "table_type": table.get("table_type"),
                "versions": [],
            })
            # The most recent caption and label win: a schedule that gets
            # renamed should be listed under what it is called now.
            lineage["caption"] = caption
            if table.get("table_type"):
                lineage["table_type"] = table["table_type"]

            lineage["versions"].append({
                "contract_id": contract_id,
                "contract_name": contract_name,
                # The signature this version actually hashed to, which is not
                # the lineage's own once a schedule has been renamed and the
                # rename confirmed. Without it there is no way back from a
                # version to the table it came from.
                "signature": signature,
                "effective_date": effective_date,
                "rows": table.get("rows"),
                "cols": table.get("cols"),
                "page": table.get("page"),
                "status": finding.get("status", "new"),
                "summary": finding.get("summary"),
                "severity": finding.get("severity", "info"),
                "observed_pct": finding.get("observed_pct"),
                "changed_rows": finding.get("changed_rows"),
                "added_rows": finding.get("added_rows"),
                "removed_rows": finding.get("removed_rows"),
                "changes": finding.get("changes") or [],
                "changes_truncated": finding.get("changes_truncated", 0),
                "previous_contract_id": finding.get("previous_contract_id"),
                "previous_signature": finding.get("previous_signature"),
                "link_confirmed": finding.get("link_confirmed", False),
                "spread_pct": finding.get("spread_pct"),
                "header_similarity": finding.get("header_similarity"),
            })

        history.append((contract_id, contract_name, tables))

    results = list(lineages.values())
    for lineage in results:
        versions = lineage["versions"]
        lineage["version_count"] = len(versions)
        # Surfaced so a caller can lead with the schedules that moved rather
        # than the ones that were reissued untouched.
        lineage["has_changes"] = any(v["status"] == "revised" for v in versions)
        lineage["needs_review"] = any(
            v["severity"] == "warning" or v["status"] == "possible_match" for v in versions
        )
        uplifts = [v["observed_pct"] for v in versions if v.get("observed_pct") is not None]
        if uplifts:
            # Compounded, not summed. Successive uplifts multiply, so a card
            # taken +3%, +3% and then back down -5.74% has returned to where it
            # started; adding the percentages would report +0.26% and imply a
            # rise that never happened.
            factor = 1.0
            for pct in uplifts:
                factor *= 1 + pct / 100
            lineage["total_pct"] = round((factor - 1) * 100, 2)
        else:
            lineage["total_pct"] = None
        lineage["latest_effective_date"] = versions[-1]["effective_date"] if versions else None

    # Schedules that need attention first, then longest history, then name.
    results.sort(key=lambda l: (not l["needs_review"], -l["version_count"], l["caption"].lower()))
    return results
