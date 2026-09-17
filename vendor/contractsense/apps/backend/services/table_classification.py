"""Label each extracted table with what kind of contract object it is.

The point of the label is not display. It is the candidate filter for matching
a schedule across documents: when a rate card is reissued, only tables of the
same kind are worth comparing, so classification is the first step of tracking
a schedule's values over time.

Classification is advisory and must never be able to fail an ingestion. Every
error path here degrades to "unclassified" and returns.
"""

import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

CLASSIFICATION_VERSION = "1"

# Closed set. A model answer outside this list is discarded rather than stored,
# because a free-text label silently breaks every filter that reads the field.
TABLE_CATEGORIES = [
    "Rate Schedule",
    "Tiered Pricing",
    "Surcharge & Penalty",
    "Payment Schedule",
    "SLA / Performance Target",
    "Staffing & Resourcing",
    "Liability Limit",
    "Deadline / Milestone",
    "Scope & Services Matrix",
    "Contract Metadata",
    "Contact & Signature",
    "Not A Table",
]

# Kinds whose values get reissued with new numbers over time. Only these are
# worth signature-matching between revisions to track what changed year on year.
TRACKABLE_CATEGORIES = {
    "Rate Schedule",
    "Tiered Pricing",
    "Surcharge & Penalty",
    "Payment Schedule",
    "SLA / Performance Target",
    "Staffing & Resourcing",
    "Liability Limit",
    "Deadline / Milestone",
}

_CATEGORY_LOOKUP = {category.lower(): category for category in TABLE_CATEGORIES}


def _match_category(raw: Any) -> Optional[str]:
    """Resolve a model's answer to one of the known categories, or None.

    Kept closed-set — an invented label would silently break every filter that
    reads this field. But models routinely echo the category together with the
    gloss the prompt listed beside it ("Rate Schedule — priced services..."),
    and rejecting those loses a correct answer over punctuation, so the text
    before the separator is matched too.
    """
    text = str(raw or "").strip().strip('"').strip()
    if not text:
        return None
    candidates = [text, re.split(r"\s+[—–-]\s+", text)[0], text.split(":")[0]]
    for candidate in candidates:
        match = _CATEGORY_LOOKUP.get(candidate.strip().lower())
        if match:
            return match
    return None

PROMPT = """You classify tables extracted from commercial contracts.

For each table below, choose exactly one category from this list:
- Rate Schedule — priced services or goods at a flat rate per unit
- Tiered Pricing — a price that varies by volume, weight or another band
- Surcharge & Penalty — surcharges, late fees, breach charges, service credits
- Payment Schedule — invoicing, settlement timing, milestone payments
- SLA / Performance Target — service levels, metrics with targets or thresholds
- Staffing & Resourcing — headcount, roles, man hours, equipment commitments
- Liability Limit — liability caps or limits, typically per incident
- Deadline / Milestone — dated obligations or a schedule of dates
- Scope & Services Matrix — which services or clauses are included or excluded, often as references
- Contract Metadata — parties, effective dates, locations, document identity
- Contact & Signature — contact blocks, notification addresses, signature blocks
- Not A Table — the rows are actually prose, numbered clauses, or a page-layout artefact rather than tabular data

Judge only from the content shown. Do not infer a category from the section
heading alone, as headings are often attached to the wrong table.

Return ONLY a JSON array, one object per table, no prose and no markdown fences:
[{{"index": <the table's index>, "category": "<exact category>", "confidence": <0.0-1.0>}}]

Tables:
{tables}"""


def _render_table_for_prompt(index: int, table: Dict[str, Any], max_rows: int = 8) -> str:
    lines = [line for line in (table.get("body") or "").splitlines() if line.strip()]
    header = lines[0] if lines else ""
    data_rows = [line for line in lines[2:]][:max_rows]
    omitted = max(0, len(lines[2:]) - len(data_rows))

    parts = [f"### Table {index}"]
    if table.get("caption"):
        parts.append(f"Caption: {table['caption']}")
    if table.get("section_path"):
        parts.append(f"Nearest heading: {table['section_path']}")
    parts.append(f"Shape: {table.get('rows')} rows x {table.get('cols')} columns")
    parts.append(header)
    parts.extend(data_rows)
    if omitted:
        parts.append(f"... {omitted} further row(s) omitted")
    return "\n".join(parts)


def _parse_response(text: str, table_count: int) -> Dict[int, Dict[str, Any]]:
    """Pull the JSON array out of a model reply, discarding anything unusable."""
    if not text:
        return {}
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if not match:
        logger.warning("Table classification reply contained no JSON array")
        return {}
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        logger.warning("Table classification reply was not valid JSON: %s", exc)
        return {}
    if not isinstance(payload, list):
        return {}

    results: Dict[int, Dict[str, Any]] = {}
    for item in payload:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        if not 0 <= index < table_count:
            continue
        category = _match_category(item.get("category"))
        if category is None:
            # An invented label would break every filter reading this field.
            logger.warning("Discarding unknown table category %r", item.get("category"))
            continue
        try:
            confidence = float(item.get("confidence"))
        except (TypeError, ValueError):
            confidence = 0.0
        results[index] = {
            "table_type": category,
            "classification_confidence": max(0.0, min(1.0, confidence)),
        }
    return results


# Batch size and token budget are set together. A reasoning model spends most
# of its output allowance thinking before it writes anything, so a budget sized
# only for the JSON comes back empty with finish_reason="length" — which looks
# exactly like a model that had nothing to say. Keep batches small and the
# allowance generous enough to cover the thinking as well as the answer.
CLASSIFY_BATCH_SIZE = 5
_REASONING_HEADROOM = 2500
_TOKENS_PER_TABLE = 60


def _classify_batch(
    model: Any,
    tables: List[Dict[str, Any]],
    contract_name: str,
) -> Dict[int, Dict[str, Any]]:
    prompt = PROMPT.format(
        tables="\n\n".join(_render_table_for_prompt(i, t) for i, t in enumerate(tables))
    )
    try:
        from langchain_core.messages import HumanMessage

        reply = model.invoke([HumanMessage(content=prompt)])
        text = getattr(reply, "content", "") or ""
        if isinstance(text, list):
            text = " ".join(
                block.get("text", "") if isinstance(block, dict) else str(block)
                for block in text
            )
        metadata = getattr(reply, "response_metadata", None) or {}
        if metadata.get("finish_reason") == "length" or metadata.get("stop_reason") == "max_tokens":
            logger.warning(
                "Table classification for %s hit the output limit; %d table(s) left unlabelled",
                contract_name or "contract", len(tables),
            )
    except Exception as exc:
        logger.warning("Table classification call failed for %s: %s", contract_name, exc)
        return {}
    return _parse_response(str(text), len(tables))


def classify_tables(
    tables: List[Dict[str, Any]],
    *,
    contract_name: str = "",
    provider: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Classify a contract's tables, in batches.

    Returns one record per table that could be classified, keyed by signature so
    the result survives the tables being renumbered on a later read. Returns an
    empty list — never raises — when no model is configured or the call fails.
    A batch that fails costs only its own tables, not the whole contract.
    """
    if not tables:
        return []

    try:
        from services.contract_agent.graph.model_factory import build_chat_model

        model = build_chat_model(
            purpose="classify",
            provider=provider,
            max_tokens=_REASONING_HEADROOM + _TOKENS_PER_TABLE * CLASSIFY_BATCH_SIZE,
            optional=True,
        )
    except Exception as exc:
        logger.warning("Table classification unavailable for %s: %s", contract_name, exc)
        return []
    if model is None:
        logger.info("No classification model configured; leaving %s tables unclassified", contract_name)
        return []

    parsed: Dict[int, Dict[str, Any]] = {}
    for start in range(0, len(tables), CLASSIFY_BATCH_SIZE):
        batch = tables[start:start + CLASSIFY_BATCH_SIZE]
        for local_index, result in _classify_batch(model, batch, contract_name).items():
            parsed[start + local_index] = result
    if not parsed:
        return []

    classified_at = datetime.utcnow()
    records: List[Dict[str, Any]] = []
    for index, table in enumerate(tables):
        result = parsed.get(index)
        if not result:
            continue
        records.append({
            "signature": table.get("signature"),
            "content_hash": table.get("content_hash"),
            "table_type": result["table_type"],
            "classification_confidence": result["classification_confidence"],
            "classification_version": CLASSIFICATION_VERSION,
            "trackable": result["table_type"] in TRACKABLE_CATEGORIES,
            "classified_at": classified_at,
            "source": "llm",
        })

    logger.info(
        "Classified %d of %d table(s) for %s",
        len(records), len(tables), contract_name or "contract",
    )
    return records


def merge_classifications(
    existing: Optional[List[Dict[str, Any]]],
    fresh: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Combine a new run with what is already stored, by signature.

    A record a person set by hand always wins. Re-running the classifier — on a
    version bump, or after a re-ingest — must not quietly overwrite a human
    correction, or the correction would have to be made again every time.
    """
    merged: Dict[str, Dict[str, Any]] = {}
    for record in existing or []:
        signature = record.get("signature")
        if signature:
            merged[signature] = record

    for record in fresh:
        signature = record.get("signature")
        if not signature:
            continue
        if merged.get(signature, {}).get("source") == "user":
            continue
        merged[signature] = record
    return list(merged.values())
