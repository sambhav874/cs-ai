"""Collapse a table's rate ladder into one tiered obligation.

Ingestion already classifies every table. On the reference SGHA Annex B it
labelled `table_3` "Tiered Pricing" and `table_16` "Liability Limit" — and the
register still showed four separate "Turnaround Rate" records, one per MTOW
band, and three separate "Liability Cap" records, one per aircraft category.
The classification was sitting in `index.tables` the whole time; nothing read
it.

Worse, the extraction prompt actively asked for that shape: Rule 1 told the
model to "Emit ONE RECORD PER ROW" for any rate ladder, and the consolidation
prompt then told it to "Never collapse multi-tier rate cards". Both survive,
because unrolling is right for *extraction* — a row read on its own is the
only reading that reliably survives batching. It is wrong for *presentation*.
A ladder is one commercial obligation with a schedule attached, and the v2
schema has had `rule_type: "tiered"` with `spec.tiers` for exactly this since
before any of it was written.

So the rows are extracted flat and folded here, once, at the end: grouping is
deterministic (rows of one table), and the judgement — is this one obligation
with bands, or several distinct obligations that merely share a table? — is
the model's, made with the caption, the header, and every row in front of it.
That distinction is not mechanical. `table_9` holds four labour rates that are
one rate card by role; `table_10` holds four pass-through fees that are four
unrelated charges. Same row count, same table type, opposite answers.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

# `{contract_id}:{table_id}:r{row_index}` — written by _table_row_candidates.
_TABLE_ROW_ID = re.compile(r":(table_\d+):r(\d+)$")

# A ladder needs at least two rungs. One row is just a record.
MIN_LADDER_ROWS = 2

# Guard against a 40-row rate card becoming a single unreadable blob and
# against the adjudication prompt growing without bound.
MAX_LADDER_ROWS = 30

# Rows shown to the adjudicator per table. The count is always stated, so a
# long rate card is still recognisable without pasting forty rows.
_MAX_ROWS_SHOWN = 12
MAX_GROUPS_PER_RUN = 24


@dataclass
class LadderGroup:
    """Rows of one table that were each extracted as their own record."""

    table_id: str
    caption: str
    table_type: str
    members: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def size(self) -> int:
        return len(self.members)


@dataclass
class LadderDecision:
    table_id: str
    is_ladder: bool
    name: str = ""
    dimension: str = ""
    reason: str = ""


def _row_position(item: Dict[str, Any]) -> Tuple[Optional[str], int]:
    chunk_id = str(item.get("source_chunk_id") or item.get("chunk_id") or "")
    match = _TABLE_ROW_ID.search(chunk_id)
    if not match:
        return None, 0
    return match.group(1), int(match.group(2))


def find_ladder_groups(
    items: Sequence[Dict[str, Any]],
    tables: Sequence[Dict[str, Any]] = (),
) -> List[LadderGroup]:
    """Group extracted records by the table row they came from.

    Only rows carry a `table_N:rM` chunk id, so prose records are never
    grouped — a paragraph that happens to list four fees stays four records.
    """
    meta = {
        str(table.get("table_id")): table
        for table in tables or []
        if table.get("table_id")
    }

    buckets: Dict[str, List[Tuple[int, Dict[str, Any]]]] = {}
    for item in items:
        table_id, row_index = _row_position(item)
        if not table_id:
            continue
        buckets.setdefault(table_id, []).append((row_index, item))

    groups: List[LadderGroup] = []
    for table_id, rows in buckets.items():
        if not (MIN_LADDER_ROWS <= len(rows) <= MAX_LADDER_ROWS):
            continue
        rows.sort(key=lambda pair: pair[0])
        info = meta.get(table_id) or {}
        first = rows[0][1]
        groups.append(
            LadderGroup(
                table_id=table_id,
                caption=str(
                    info.get("caption")
                    or first.get("section_path")
                    or table_id
                ),
                table_type=str(info.get("table_type") or "Table"),
                members=[item for _, item in rows],
            )
        )

    # Biggest ladders first: if the prompt budget forces a cut, the four-row
    # cards matter more than the two-row ones.
    groups.sort(key=lambda group: -group.size)
    return groups[:MAX_GROUPS_PER_RUN]


def _member_summary(item: Dict[str, Any]) -> Dict[str, Any]:
    measurement = item.get("measurement") if isinstance(item.get("measurement"), dict) else {}
    return {
        "name": str(item.get("name") or "")[:120],
        "value": item.get("value"),
        "unit": item.get("unit") or measurement.get("unit"),
        "currency": item.get("currency") or measurement.get("currency"),
        "quote": str(item.get("quote") or item.get("clause_text") or "")[:220],
    }


def render_adjudication_prompt(groups: Sequence[LadderGroup], contract_name: str) -> str:
    """Ask the model one question per group, with the rows in front of it."""
    blocks = []
    for group in groups:
        shown = group.members[:_MAX_ROWS_SHOWN]
        rows = json.dumps(
            [_member_summary(item) for item in shown],
            ensure_ascii=False,
            indent=1,
        )
        if len(group.members) > len(shown):
            rows += f"\n... and {len(group.members) - len(shown)} more rows of the same table"
        blocks.append(
            f"### {group.table_id}\n"
            f"caption: {group.caption}\n"
            f"table_type: {group.table_type}\n"
            f"rows ({group.size}):\n{rows}"
        )
    body = "\n\n".join(blocks)

    return (
        "# Rate-ladder adjudication\n"
        f"Contract: {contract_name}\n\n"
        "Each block below is one table from the contract. Every row was already "
        "extracted as its own obligation record. Decide, per table, whether "
        "those rows are ONE obligation priced across bands (a rate ladder) or "
        "SEVERAL distinct obligations that merely share a table.\n\n"
        "It is a ladder when the rows differ only in the band of a single "
        "variable — weight, aircraft type, duration, headcount, seniority, "
        "volume — and the thing being priced or promised stays the same.\n"
        "Examples of a ladder: turnaround charge by MTOW band; liability cap "
        "by aircraft category; straight-time labour rate by staff grade.\n\n"
        "It is NOT a ladder when the rows price different services, cover "
        "unrelated fees, or set targets for different metrics — even when the "
        "shape of the rows is identical. Pass-through charges (an admin fee, "
        "an overflight fee, a de-icing reserve) are separate obligations.\n"
        "If you are not confident the rows share one subject, answer false. "
        "Splitting a real ladder is a smaller error than merging two "
        "obligations into one record.\n\n"
        "For each ladder, give the obligation a name that states the subject "
        "and the banding variable, without any single band in it "
        "(\"Turnaround Handling Charge by MTOW Band\", not "
        "\"Turnaround Rate: >60,000 kg\").\n\n"
        f"TABLES:\n{body}\n\n"
        "Return one entry for EVERY table_id listed above, including the ones "
        "that are not ladders (is_ladder: false, with a one-line reason). A "
        "missing entry is read as 'not a ladder' but leaves no reason on the "
        "record for why the rows were kept apart.\n\n"
        "Output ONLY JSON:\n"
        '{"ladders": [{"table_id": "table_3", "is_ladder": true, '
        '"name": "Turnaround Handling Charge by MTOW Band", '
        '"dimension": "Maximum Take-Off Weight band", '
        '"reason": "one charge, four weight bands"}]}'
    )


def parse_decisions(payload: Any, groups: Sequence[LadderGroup]) -> Dict[str, LadderDecision]:
    known = {group.table_id for group in groups}
    decisions: Dict[str, LadderDecision] = {}
    entries = (payload or {}).get("ladders") if isinstance(payload, dict) else None
    for entry in entries or []:
        if not isinstance(entry, dict):
            continue
        table_id = str(entry.get("table_id") or "").strip()
        if table_id not in known:
            continue
        decisions[table_id] = LadderDecision(
            table_id=table_id,
            is_ladder=bool(entry.get("is_ladder")),
            name=str(entry.get("name") or "").strip()[:160],
            dimension=str(entry.get("dimension") or "").strip()[:120],
            reason=str(entry.get("reason") or "").strip()[:240],
        )
    return decisions


def _common_prefix(names: Sequence[str]) -> str:
    """Longest shared word-prefix, so the tier label keeps only what varies."""
    if len(names) < 2:
        return ""
    split = [name.split() for name in names]
    prefix: List[str] = []
    for words in zip(*split):
        if len(set(words)) != 1:
            break
        prefix.append(words[0])
    return " ".join(prefix)


def _common_suffix(names: Sequence[str]) -> str:
    """Longest shared word-suffix. Coded rate cards repeat the metric at the
    end ("... Straight Time Rate") instead of the front."""
    if len(names) < 2:
        return ""
    split = [name.split() for name in names]
    suffix: List[str] = []
    for words in zip(*(list(reversed(part)) for part in split)):
        if len(set(words)) != 1:
            break
        suffix.append(words[0])
    return " ".join(reversed(suffix))


# "RATE-DM-01:", "STAFF-03:", "KPI-01:" — a row code, not a band name.
_ROW_CODE = re.compile(r"^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+){0,3}\s*[:\-]\s*")


def _tier_label(name: str, prefix: str, suffix: str = "") -> str:
    label = name
    if prefix and label.startswith(prefix):
        label = label[len(prefix):]
    if suffix and label.endswith(suffix) and len(label) > len(suffix):
        label = label[: -len(suffix)]
    # Names arrive as "Turnaround Rate: >60,000 kg MTOW" or
    # "RATE-DM-01: Duty Manager Straight Time Rate".
    label = _ROW_CODE.sub("", label.strip())
    label = re.sub(r"^[\s:\-–—|]+|[\s:\-–—|]+$", "", label).strip()
    return label or name


def build_tiers(group: LadderGroup) -> List[Dict[str, Any]]:
    names = [_ROW_CODE.sub("", str(item.get("name") or "").strip()) for item in group.members]
    prefix = _common_prefix(names)
    # A name is disambiguated at one end or the other, never trimmed at both.
    # "Turnaround Rate: <=3,000 kg MTOW" shares the prefix AND the trailing
    # unit; stripping both leaves "<=3,000", a band that no longer says what
    # it measures.
    suffix = "" if prefix else _common_suffix(names)
    tiers: List[Dict[str, Any]] = []
    for index, item in enumerate(group.members):
        measurement = item.get("measurement") if isinstance(item.get("measurement"), dict) else {}
        band = _tier_label(str(item.get("name") or ""), prefix, suffix)
        tiers.append({
            "tier": f"Tier {index + 1}",
            "band": band,
            "range": band,
            "value": _tier_value(item),
            "unit": item.get("unit") or measurement.get("unit"),
            "currency": item.get("currency") or measurement.get("currency"),
            "quote": str(item.get("quote") or item.get("clause_text") or "")[:400],
            "source_chunk_id": item.get("source_chunk_id"),
            "source_kpi_id": item.get("kpi_id"),
        })
    return tiers


_NUMBER = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_CURRENCY = r"EUR|USD|GBP|SEK|CHF|€|\$|£"
# The priced amount, not the band bound. "20,001-60,000 kg MTOW | 850.00 EUR"
# holds three numbers and only the one touching a currency is the rate; taking
# the largest picks the weight ceiling every time.
_MONEY = re.compile(
    rf"(?:(?:{_CURRENCY})\s*({_NUMBER}))|(?:({_NUMBER})\s*(?:{_CURRENCY}))",
    re.IGNORECASE,
)
_AMOUNT = re.compile(rf"(?<![\w.])({_NUMBER})")


def _tier_value(item: Dict[str, Any]) -> Optional[float]:
    """The row's number, wherever the pipeline happened to leave it.

    Extraction nulls `value` on any row whose unit reads as a currency and
    whose type is not financial — a guard meant to stop a penalty amount
    becoming a metric target. On a rate card that guard empties the column the
    whole record exists for, so the tier falls back to the measurement, then
    to the row's own text. A band with no number is not a band.
    """
    measurement = item.get("measurement") if isinstance(item.get("measurement"), dict) else {}
    for candidate in (
        item.get("value"),
        measurement.get("threshold"),
        item.get("target_value"),
        item.get("consequence_value"),
    ):
        if isinstance(candidate, (int, float)):
            return float(candidate)
        if isinstance(candidate, str):
            try:
                return float(candidate.replace(",", "").strip())
            except ValueError:
                continue

    text = str(item.get("quote") or item.get("clause_text") or "")
    money = [group for match in _MONEY.findall(text) for group in match if group]
    if money:
        try:
            return float(money[-1].replace(",", ""))
        except ValueError:
            pass
    matches = _AMOUNT.findall(text)
    if not matches:
        return None
    # No currency in the row: the rate is conventionally the last column, so
    # the last number beats the band bounds that precede it.
    try:
        return float(matches[-1].replace(",", ""))
    except ValueError:
        return None


def _dominant(values: Sequence[Any]) -> Optional[Any]:
    present = [value for value in values if value not in (None, "")]
    if not present:
        return None
    return max(set(present), key=present.count)


def collapse_group(
    group: LadderGroup,
    decision: LadderDecision,
    *,
    contract_id: str,
) -> Dict[str, Any]:
    """One record carrying the whole ladder, built on the first row's record.

    Building on a member rather than from scratch keeps citation, party role,
    pack stamp, record type and every downstream field that the rest of the
    pipeline expects; only the fields the ladder actually changes are
    overridden.
    """
    base = dict(group.members[0])
    tiers = build_tiers(group)
    measurement = dict(base.get("measurement") or {}) if isinstance(base.get("measurement"), dict) else {}

    name = decision.name or f"{group.caption} Schedule"
    seed = f"{contract_id}:{group.table_id}:ladder"
    kpi_id = f"kpi_{hashlib.md5(seed.encode()).hexdigest()[:18]}"

    pages = [item.get("page_start") for item in group.members if item.get("page_start")]
    pages_end = [item.get("page_end") for item in group.members if item.get("page_end")]

    unit = _dominant([tier.get("unit") for tier in tiers])
    currency = _dominant([tier.get("currency") for tier in tiers])

    base.update({
        "kpi_id": kpi_id,
        "name": name[:160],
        "rule_type": "tiered",
        "target_type": "tiered_schedule",
        "target_schedule": tiers,
        # A ladder has no single threshold. Putting one band's number here is
        # how "≥3,000 kg" became the contract's turnaround target.
        "value": None,
        "value_min": None,
        "value_max": None,
        "operator": None,
        "unit": unit,
        "currency": currency,
        "measurement": {
            **measurement,
            "target_type": "tiered_schedule",
            "threshold": None,
            "operator": None,
            "unit": unit,
            "currency": currency,
            "measurement_scope": decision.dimension or measurement.get("measurement_scope"),
        },
        "description": (
            f"{name}. {len(tiers)} bands by {decision.dimension or 'schedule'}: "
            + "; ".join(
                f"{tier['band']} = {tier['value']}{(' ' + tier['currency']) if tier.get('currency') else ''}"
                for tier in tiers
                if tier.get("value") is not None
            )
        )[:900],
        "collapsed_from": [item.get("kpi_id") for item in group.members],
        "collapsed_row_count": len(tiers),
        "collapsed_table_id": group.table_id,
        "collapsed_reason": decision.reason,
        "collapsed_dimension": decision.dimension,
        "page_start": min(pages) if pages else base.get("page_start"),
        "page_end": max(pages_end) if pages_end else base.get("page_end"),
    })
    # canonical_metric_key drives dedupe elsewhere; the ladder is a new
    # identity, not the first row's.
    base["canonical_metric_key"] = f"LADDER:{group.table_id}:{name.lower()}"
    return base


def apply_ladders(
    items: Sequence[Dict[str, Any]],
    groups: Sequence[LadderGroup],
    decisions: Dict[str, LadderDecision],
    *,
    contract_id: str,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Replace each confirmed ladder's rows with one tiered record.

    Returns the new record list and a per-table trail entry, so the run can
    show what was folded and why rather than silently returning fewer rows.
    """
    collapsed_ids: set = set()
    replacements: Dict[str, Dict[str, Any]] = {}
    trail: List[Dict[str, Any]] = []

    for group in groups:
        decision = decisions.get(group.table_id)
        if decision is None:
            trail.append({
                "table_id": group.table_id,
                "caption": group.caption,
                "table_type": group.table_type,
                "rows": group.size,
                "collapsed": False,
                "reason": "no decision returned for this table",
            })
            continue
        if not decision.is_ladder:
            trail.append({
                "table_id": group.table_id,
                "caption": group.caption,
                "table_type": group.table_type,
                "rows": group.size,
                "collapsed": False,
                "reason": decision.reason or "distinct obligations, kept apart",
            })
            continue

        record = collapse_group(group, decision, contract_id=contract_id)
        anchor = group.members[0].get("kpi_id")
        replacements[str(anchor)] = record
        collapsed_ids.update(
            str(item.get("kpi_id")) for item in group.members[1:]
        )
        trail.append({
            "table_id": group.table_id,
            "caption": group.caption,
            "table_type": group.table_type,
            "rows": group.size,
            "collapsed": True,
            "name": record["name"],
            "dimension": decision.dimension,
            "reason": decision.reason,
            "kpi_id": record["kpi_id"],
        })

    if not replacements:
        return list(items), trail

    result: List[Dict[str, Any]] = []
    for item in items:
        kpi_id = str(item.get("kpi_id"))
        if kpi_id in collapsed_ids:
            continue
        result.append(replacements.get(kpi_id, item))
    return result, trail
