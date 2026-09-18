"""Which documents in a project actually govern, and which have been replaced.

A project is not a bag of documents. A master agreement is amended, an annex is
superseded by a later annex, and an amendment is itself amended a year on. Every
one of those documents stays in the project and stays retrievable, so retrieval
alone will happily quote a rate card that stopped applying two years ago and
present it with exactly the same confidence as the current one.

Schedules already have lineage. This is the same idea one level up, for the
documents themselves, built from the relations the overview extraction records
with the quote that supports each one.

Deliberately generic. The relation vocabulary is about documents, not about any
industry: something replaces something else, or modifies it. A project of
employment contracts, leases, or licences amends and supersedes exactly the way
a ground handling annex does.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Relation types that mean "this document takes the other one's place". The
# earlier document stops governing from the day this one takes effect.
REPLACES = {"supersedes", "replaces", "restates", "supercedes"}

# Relation types that mean "this document changes part of the other one". The
# earlier document still governs — it just no longer reads the way it did, so
# quoting it without the amendment is quoting something that is not in force.
AMENDS = {"amends", "modifies", "varies", "supplements"}

IN_FORCE = "in_force"
IN_FORCE_AS_AMENDED = "in_force_as_amended"
SUPERSEDED = "superseded"
SPENT = "spent"
NOT_YET_IN_EFFECT = "not_yet_in_effect"
UNDATED = "undated"

_STATUS_LABEL = {
    IN_FORCE: "in force",
    IN_FORCE_AS_AMENDED: "in force, as amended",
    SUPERSEDED: "superseded",
    SPENT: "spent — everything it amends has been superseded",
    NOT_YET_IN_EFFECT: "not yet in effect",
    UNDATED: "in force (no effective date stated)",
}


def status_label(status: str) -> str:
    return _STATUS_LABEL.get(status, status)


def _today() -> str:
    return date.today().isoformat()


def build_document_graph(
    project_id: str,
    *,
    contract_query: Dict[str, Any],
    as_of: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Every document in the project with what governs it and what it governs.

    `as_of` answers "what applied then" rather than "what applies now", which is
    the question anyone reconciling a historic invoice is really asking. A
    document superseded last year was in force the year before, and the graph
    has to be able to say so rather than only reporting today.
    """
    from core.database import collection as contracts_collection, db as core_db
    from services.project_memory import ProjectMemoryManager, _parse_effective_date

    when = (as_of or "").strip() or _today()

    names: Dict[str, str] = {}
    for contract in contracts_collection.find(contract_query, {"_id": 1, "contract_name": 1}):
        names[str(contract["_id"])] = contract.get("contract_name") or str(contract["_id"])
    if not names:
        return []

    try:
        overviews = list(
            ProjectMemoryManager(core_db).memories.find({"project_id": project_id})
        )
    except Exception:
        logger.warning("Could not read overviews for project %s", project_id)
        overviews = []

    nodes: Dict[str, Dict[str, Any]] = {
        contract_id: {
            "contract_id": contract_id,
            "contract_name": name,
            "doc_type": None,
            "effective_date": None,
            "superseded_by": [],
            "amended_by": [],
            "supersedes": [],
            "amends": [],
        }
        for contract_id, name in names.items()
    }

    edges: List[Tuple[str, str, str, str]] = []  # (source, target, kind, quote)
    for overview in overviews:
        source = str(overview.get("contract_id") or "")
        if source not in nodes:
            # An overview for a document outside this caller's scope. Its
            # relations are not ours to apply.
            continue
        nodes[source]["doc_type"] = overview.get("doc_type")
        nodes[source]["effective_date"] = _parse_effective_date(
            overview.get("effective_date")
        ) or _parse_effective_date(overview.get("effective_from"))

        for relation in overview.get("related_documents") or []:
            target = str(relation.get("contract_id") or "")
            if target not in nodes or target == source:
                continue
            kind = str(relation.get("relation_type") or "").strip().lower()
            quote = str(relation.get("evidence_quote") or "")
            if kind in REPLACES:
                edges.append((source, target, "supersedes", quote))
            elif kind in AMENDS:
                edges.append((source, target, "amends", quote))

    for source, target, kind, quote in edges:
        entry = {
            "contract_id": source,
            "contract_name": nodes[source]["contract_name"],
            "effective_date": nodes[source]["effective_date"],
            "quote": quote,
        }
        reverse = {
            "contract_id": target,
            "contract_name": nodes[target]["contract_name"],
            "effective_date": nodes[target]["effective_date"],
            "quote": quote,
        }
        if kind == "supersedes":
            nodes[target]["superseded_by"].append(entry)
            nodes[source]["supersedes"].append(reverse)
        else:
            nodes[target]["amended_by"].append(entry)
            nodes[source]["amends"].append(reverse)

    for node in nodes.values():
        node["status"] = _status_for(node, when)
        node["as_of"] = when

    # An amendment has no independent life: it edits another document. Once
    # every document it amends has been replaced, there is nothing left for it
    # to change, and treating it as current is how a 2023 rate revision gets
    # quoted as though it survived the 2025 annex that replaced what it revised.
    #
    # Iterated to a fixpoint rather than applied once, because an amendment can
    # amend an amendment: a 2024 revision of a 2023 revision of an annex is only
    # spent once the 2023 revision is, which is only known after the annex is
    # resolved. One pass would settle that chain in whichever order the
    # documents happened to be stored. Bounded by the node count so a
    # circular reference between two documents cannot spin.
    for _pass in range(len(nodes) + 1):
        changed = False
        for node in nodes.values():
            if node["status"] not in (IN_FORCE, IN_FORCE_AS_AMENDED):
                continue
            targets = [t for t in node["amends"] if t["contract_id"] in nodes]
            if not targets:
                continue
            if all(
                nodes[target["contract_id"]]["status"] in (SUPERSEDED, SPENT)
                for target in targets
            ):
                node["status"] = SPENT
                changed = True
        if not changed:
            break

    # In force first, then by effective date, so the answer to "what governs"
    # is the top of the list rather than something to search for.
    order = {
        IN_FORCE: 0, IN_FORCE_AS_AMENDED: 0, UNDATED: 1,
        NOT_YET_IN_EFFECT: 2, SUPERSEDED: 3, SPENT: 3,
    }
    return sorted(
        nodes.values(),
        key=lambda n: (order.get(n["status"], 4), n["effective_date"] or "", n["contract_name"]),
    )


def _status_for(node: Dict[str, Any], when: str) -> str:
    """What this document is doing on `when`.

    An undated document is reported as undated rather than assumed current.
    Guessing either way is wrong in a way the user cannot see: assume it is in
    force and a draft governs; assume it is not and a real agreement vanishes.
    """
    effective = node.get("effective_date")
    if effective and effective > when:
        return NOT_YET_IN_EFFECT

    # Only a superseder that has itself taken effect actually displaces
    # anything. A replacement annex signed today but effective next quarter
    # leaves the current one governing until then.
    for superseder in node["superseded_by"]:
        superseder_date = superseder.get("effective_date")
        if superseder_date is None or superseder_date <= when:
            return SUPERSEDED

    if not effective:
        return UNDATED

    for amendment in node["amended_by"]:
        amendment_date = amendment.get("effective_date")
        if amendment_date is None or amendment_date <= when:
            return IN_FORCE_AS_AMENDED

    return IN_FORCE


def render_document_graph(nodes: List[Dict[str, Any]], *, as_of: Optional[str] = None) -> str:
    """The graph as the agent reads it."""
    if not nodes:
        return "No documents with a recorded overview were found in this project."

    when = as_of or (nodes[0].get("as_of") if nodes else None) or _today()
    lines = [f"Documents in this project and what governs, as of {when}:"]
    for node in nodes:
        detail = []
        if node["superseded_by"]:
            detail.append(
                "superseded by " + ", ".join(s["contract_name"] for s in node["superseded_by"])
            )
        if node["amended_by"]:
            detail.append(
                "amended by " + ", ".join(a["contract_name"] for a in node["amended_by"])
            )
        suffix = f" · {'; '.join(detail)}" if detail else ""
        lines.append(
            f'- {node["contract_name"]} · {node.get("doc_type") or "type unknown"} · '
            f'effective {node["effective_date"] or "not stated"} · '
            f'{status_label(node["status"])}{suffix}'
        )

    superseded = [n for n in nodes if n["status"] in (SUPERSEDED, SPENT)]
    if superseded:
        lines.append(
            "Do not quote terms from a superseded document as current. "
            "If a superseded document is the only source for something, say that "
            "it no longer governs and name the document that replaced it."
        )
    undated = [n for n in nodes if n["status"] == UNDATED]
    if undated:
        lines.append(
            "Documents with no stated effective date cannot be placed in this "
            "order; treat their status as unconfirmed rather than current."
        )
    return "\n".join(lines)
