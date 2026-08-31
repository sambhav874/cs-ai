"""One place that answers "what schedules does this project have, and what do
they say now".

Both the Schedules tab and the agent read a project's rate history. Built twice
they would drift, and a disagreement between what a person sees on screen and
what the agent states in a chat is the worst kind: neither side is obviously
wrong, so it is argued rather than fixed. The route and the tool call the same
functions here.

Authorization stays with the caller. Every entry point takes an already-built
contract query — the route's access-filtered one, the agent's route-built
scope — because the two surfaces authorize differently and a single shared
notion of "the project's documents" here would have to pick one of them.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# A schedule named in prose ("the ramp card") has to reach the same lineage a
# person sees in the tab. Anything below this is treated as not a match rather
# than answering about the wrong schedule, which is the failure that matters:
# a confidently quoted rate from the wrong card is worse than "which one?".
NAME_MATCH_THRESHOLD = 0.34


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def load_project_tables(
    project_id: str,
    *,
    contract_query: Dict[str, Any],
) -> List[Tuple[str, str, Optional[str], List[Dict[str, Any]]]]:
    """Every table in the project's documents, ordered by when each document
    takes effect.

    Ordered on the stated effective date rather than upload time so a document
    uploaded late but effective early sits where it belongs in the history —
    the ordering the whole change-tracking story depends on.
    """
    from core.database import collection as contracts_collection, db as core_db
    from services.project_memory import ProjectMemoryManager, _parse_effective_date
    from services.table_extraction import extract_tables

    query = dict(contract_query)
    query["index.content"] = {"$regex": "<!--TABLE:START"}

    try:
        effective_dates = {
            str(record.get("contract_id")): record.get("effective_date")
            for record in ProjectMemoryManager(core_db).memories.find(
                {"project_id": project_id}, {"contract_id": 1, "effective_date": 1}
            )
        }
    except Exception:
        # Dates are an ordering refinement, not a dependency — without them the
        # history still builds, just ordered by upload time.
        logger.warning("Could not read effective dates for project %s", project_id)
        effective_dates = {}

    documents = []
    for contract in contracts_collection.find(
        query,
        {"_id": 1, "contract_name": 1, "uploaded_at": 1,
         "index.content": 1, "index.table_classifications": 1},
    ):
        index_data = contract.get("index") or {}
        tables = extract_tables(index_data.get("content") or "")
        labels = {
            record.get("signature"): record.get("table_type")
            for record in (index_data.get("table_classifications") or [])
            if isinstance(record, dict)
        }
        for table in tables:
            table["table_type"] = labels.get(table.get("signature")) or table.get("table_type")
        contract_id = str(contract["_id"])
        documents.append((
            contract_id,
            contract.get("contract_name") or "",
            _parse_effective_date(effective_dates.get(contract_id)),
            contract.get("uploaded_at"),
            tables,
        ))

    documents.sort(key=lambda d: (d[2] or "", d[3] or datetime.min))
    return [(c, n, eff, tables) for c, n, eff, _uploaded, tables in documents]


def project_schedules(
    project_id: str,
    *,
    contract_query: Dict[str, Any],
    links: Optional[Dict[str, str]] = None,
) -> Tuple[List[Dict[str, Any]], List[Tuple[str, str, Optional[str], List[Dict[str, Any]]]]]:
    """The project's schedule histories, plus the tables they were built from.

    The tables come back too because every caller that wants a lineage also
    wants the rows behind it sooner or later, and re-reading and re-extracting
    every document to get them is the expensive half of this.
    """
    from services.table_tracking import build_lineages

    documents = load_project_tables(project_id, contract_query=contract_query)
    return build_lineages(documents, links or {}), documents


def find_schedule(
    lineages: List[Dict[str, Any]],
    query: str,
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    """Resolve a schedule the way a person names it.

    Returns (match, candidates). A match is returned only when one schedule is
    clearly the best answer; otherwise the candidates come back so the caller
    can ask which one rather than guessing. People ask about "the ramp card",
    not about a signature, and refusing to answer is recoverable in a way that
    quoting the wrong schedule's rates is not.
    """
    if not lineages:
        return None, []

    wanted = _normalize(query)
    if not wanted:
        return None, list(lineages)

    # An exact signature always wins — it is unambiguous by construction.
    for lineage in lineages:
        if lineage.get("signature") == query.strip():
            return lineage, []

    wanted_terms = set(wanted.split())
    scored: List[Tuple[float, Dict[str, Any]]] = []
    for lineage in lineages:
        caption = _normalize(lineage.get("caption") or "")
        if not caption:
            continue
        if wanted == caption or wanted in caption.split():
            scored.append((1.0, lineage))
            continue
        caption_terms = set(caption.split())
        if not caption_terms:
            continue
        overlap = len(wanted_terms & caption_terms)
        if not overlap:
            continue
        # Weighted toward covering what was asked for: "ramp" should match
        # "RAMP HANDLING CHARGES" strongly even though the caption says more
        # than the question did.
        score = 0.7 * (overlap / len(wanted_terms)) + 0.3 * (overlap / len(caption_terms))
        scored.append((score, lineage))

    if not scored:
        return None, list(lineages)

    scored.sort(key=lambda pair: pair[0], reverse=True)
    best_score, best = scored[0]
    if best_score < NAME_MATCH_THRESHOLD:
        return None, [lineage for _score, lineage in scored]

    # A tie is genuinely ambiguous. Two schedules scoring the same on the words
    # the user gave means the user has not yet said which one they mean.
    if len(scored) > 1 and abs(scored[1][0] - best_score) < 1e-9:
        return None, [lineage for _score, lineage in scored]

    return best, []


def schedule_table(
    lineage: Dict[str, Any],
    documents: List[Tuple[str, str, Optional[str], List[Dict[str, Any]]]],
    *,
    as_of: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """The rendered rows of one schedule, as they stand now or on a past date.

    `as_of` picks the last version that had taken effect on that date, which is
    the question people actually ask of a rate card — "what were we charging in
    March" — and is not answerable from the change summaries alone, since those
    describe the movement between versions rather than the values.
    """
    versions = lineage.get("versions") or []
    if not versions:
        return None

    chosen = None
    for version in versions:
        effective = version.get("effective_date")
        if as_of and effective and effective > as_of:
            break
        chosen = version
    if chosen is None:
        # Every version takes effect after the date asked about.
        return None

    tables_by_contract = {
        contract_id: tables for contract_id, _name, _eff, tables in documents
    }
    # The version's own signature, not the lineage's: a confirmed rename means
    # the two differ, and only the version's own hash finds its table.
    wanted = {chosen.get("signature"), lineage.get("signature")} - {None}
    for table in tables_by_contract.get(chosen.get("contract_id"), []):
        if table.get("signature") in wanted:
            return {
                "caption": lineage.get("caption"),
                "table_type": lineage.get("table_type"),
                "contract_id": chosen.get("contract_id"),
                "contract_name": chosen.get("contract_name"),
                "effective_date": chosen.get("effective_date"),
                "page": table.get("page"),
                "body": table.get("body"),
                "is_latest": chosen is versions[-1],
            }
    return None
