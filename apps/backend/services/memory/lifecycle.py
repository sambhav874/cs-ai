"""Memory lifecycle: decay, consolidation, and provenance propagation (F-23).

Deliberately not run on the hot path. Every function here is a pure
transformation over records a caller already fetched, so it can be tested with
no Mongo and no model, and invoked from a maintenance script on whatever
cadence an operator picks — a per-request sweep would spend budget every run
on a problem that only compounds over weeks.

What lives elsewhere on purpose:
- Recency-weighted *ranking* is `semantic.rank` (2.3) — this module does not
  re-rank, it decides what should stop being a candidate at all, and what
  should be merged before it ever reaches ranking.
- Project facts do not decay; they supersede via `ProjectMemoryManager.
  supersede_fact`, which already works and stays untouched.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Sequence

from .composer import _dedupe_tokens, _similar

# Below this many days since last_verified_at, a session-scoped memory is
# still shown but ranked as unverified; past the hard TTL it is dropped from
# candidates entirely rather than left to decay asymptotically toward zero
# relevance, which recency weighting alone never actually reaches.
DEFAULT_TTL_DAYS = 180

# Two memories whose supporting content overlaps this much are treated as the
# same fact restated, not two facts that happen to share a subject — the same
# threshold the composer uses for the same reason (see composer._similar).
CONSOLIDATION_SIMILARITY = 0.7


def _age_days(record: Dict[str, Any], *, now: datetime) -> float:
    timestamp = record.get("last_verified_at") or record.get("updated_at") or record.get("created_at")
    if not isinstance(timestamp, datetime):
        return 0.0
    delta = now - timestamp
    return max(delta.total_seconds() / 86400.0, 0.0)


def apply_ttl(
    records: Sequence[Dict[str, Any]],
    *,
    now: datetime,
    ttl_days: float = DEFAULT_TTL_DAYS,
) -> List[Dict[str, Any]]:
    """Drop session-scoped memories past their hard TTL.

    A memory recorded from an explicit user request keeps its provenance
    forever — the user said it was worth remembering, and age alone does not
    make that untrue. Only unattributed/contract-inferred memories age out;
    project facts are not passed to this function at all.
    """
    kept: List[Dict[str, Any]] = []
    for record in records:
        origin = record.get("origin")
        if origin == "user":
            kept.append(record)
            continue
        if _age_days(record, now=now) <= ttl_days:
            kept.append(record)
    return kept


def consolidate(records: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge near-duplicate memories into one, confidence-boosted record.

    Returns the records to *keep*, in the same shape they came in, with two
    changes on a merged record: `confirmed_count` counts how many source
    records agreed, and `confidence` is raised to "high" once two or more
    independently-written memories say the same thing — the corroboration
    signal a single memory, however well cited, cannot carry on its own.

    Input order sets precedence: the first record in each duplicate group
    supplies the surviving id/content/quote (callers should sort
    newest-or-most-cited first), later duplicates only contribute their
    confirmation and get discarded.
    """
    kept: List[Dict[str, Any]] = []
    kept_tokens: List[set] = []

    for record in records:
        content = str(record.get("content") or "")
        tokens = _dedupe_tokens(f"{record.get('memory_key') or ''} {content}")
        match_index = None
        if tokens:
            for index, other_tokens in enumerate(kept_tokens):
                if _similar(tokens, other_tokens):
                    match_index = index
                    break

        if match_index is None:
            merged = dict(record)
            merged["confirmed_count"] = 1
            kept.append(merged)
            kept_tokens.append(tokens)
            continue

        survivor = kept[match_index]
        survivor["confirmed_count"] = int(survivor.get("confirmed_count") or 1) + 1
        if survivor["confirmed_count"] >= 2:
            survivor["confidence"] = "high"

    return kept


def flag_memories_for_amended_document(
    agent_memories_collection: Any,
    *,
    contract_id: str,
) -> int:
    """Mark every semantic memory sourced from an amended document as stale.

    The project-fact equivalent (`ProjectMemoryManager.
    flag_facts_for_amended_document`) already runs at the moment an amendment
    relation is recorded; this is the same action for the collection that
    fact-flagging never reached, so a memory recalled from a superseded
    clause is not handed to the model as though nothing changed.
    """
    result = agent_memories_collection.update_many(
        {"source_contract_id": contract_id},
        {"$set": {"needs_review": True}},
    )
    return result.modified_count
