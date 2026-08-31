"""Two documents that both govern and disagree.

Schedule lineage answers "what did this rate card become". The document graph
answers "which documents still apply". Neither alone catches the case that
matters most to someone relying on a project: two documents that are both in
force right now and state different values for the same thing, with nothing in
either saying which one wins.

That is not the same as a revision. A 2023 rate card replaced by a 2024 one is
resolved — the graph knows the earlier document was superseded or its amendment
spent. A conflict is what is left over once every relation the documents
actually state has been applied and two live documents still disagree.

The distinction this module is careful about is precedence. Most projects do
not declare supersession for every pair of documents, so two live documents
disagreeing is usually *ordering that nobody wrote down* rather than genuine
contradiction. Reporting those identically would bury the real conflicts in
noise, and a warning nobody can act on is a warning people learn to skip.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# The document states that still bind. `undated` is included: a document whose
# effective date could not be read still governs as far as anyone knows, and
# excluding it would silently drop it out of every conflict check.
LIVE_STATUSES = {"in_force", "in_force_as_amended", "undated"}

# Two live documents disagree and nothing orders them. Someone has to decide.
CONFLICT = "conflict"

# Two live documents disagree, but one is plainly later. It probably governs —
# nothing in either document says so, which is worth flagging and is not worth
# alarming anyone about.
UNRESOLVED_PRECEDENCE = "unresolved_precedence"


def detect_conflicts(
    project_id: str,
    *,
    contract_query: Dict[str, Any],
    links: Optional[Dict[str, str]] = None,
    as_of: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Schedules stated differently by two documents that both still govern."""
    from services.document_graph import build_document_graph
    from services.schedule_registry import project_schedules

    nodes = build_document_graph(project_id, contract_query=contract_query, as_of=as_of)
    if not nodes:
        return []
    lineages, _documents = project_schedules(
        project_id, contract_query=contract_query, links=links
    )
    return conflicts_between(nodes, lineages)


def conflicts_between(
    nodes: List[Dict[str, Any]],
    lineages: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """The comparison itself, over an already-loaded graph and set of lineages.

    Split from the loading so the rule can be tested without a database — the
    rule is the whole substance here, and it is the part that decides whether a
    user is warned or left to find out from an invoice.
    """
    status_by_id = {node["contract_id"]: node["status"] for node in nodes}
    related = _related_pairs(nodes)
    live: Set[str] = {
        contract_id for contract_id, status in status_by_id.items()
        if status in LIVE_STATUSES
    }
    if len(live) < 2:
        # Nothing can conflict with itself. The common healthy case.
        return []

    conflicts: List[Dict[str, Any]] = []
    for lineage in lineages:
        versions = [
            version for version in lineage.get("versions") or []
            if version.get("contract_id") in live
        ]
        if len(versions) < 2:
            continue

        # Consecutive live versions that actually changed something. A schedule
        # reissued unchanged in two live documents is redundant, not
        # contradictory, and saying so would be noise.
        for earlier, later in zip(versions, versions[1:]):
            if later.get("status") == "unchanged":
                continue
            if not (later.get("changes") or later.get("observed_pct") is not None):
                continue

            pair = frozenset({earlier["contract_id"], later["contract_id"]})
            if pair in related:
                # The documents state their own relationship. Whatever the
                # graph made of it, they are not silently disagreeing.
                continue

            earlier_date = earlier.get("effective_date")
            later_date = later.get("effective_date")
            ordered = bool(earlier_date and later_date and earlier_date < later_date)

            conflicts.append({
                "kind": UNRESOLVED_PRECEDENCE if ordered else CONFLICT,
                "severity": "info" if ordered else "warning",
                "signature": lineage.get("signature"),
                "caption": lineage.get("caption"),
                "table_type": lineage.get("table_type"),
                "documents": [
                    {
                        "contract_id": earlier["contract_id"],
                        "contract_name": earlier.get("contract_name"),
                        "effective_date": earlier_date,
                        "status": status_by_id.get(earlier["contract_id"]),
                    },
                    {
                        "contract_id": later["contract_id"],
                        "contract_name": later.get("contract_name"),
                        "effective_date": later_date,
                        "status": status_by_id.get(later["contract_id"]),
                    },
                ],
                "summary": _summarize(lineage, earlier, later, ordered),
                "changes": (later.get("changes") or [])[:8],
                "as_of": nodes[0]["as_of"],
            })

    # The ones somebody has to decide, first.
    conflicts.sort(key=lambda c: (c["kind"] != CONFLICT, c["caption"] or ""))
    return conflicts


def _related_pairs(nodes: List[Dict[str, Any]]) -> Set[frozenset]:
    """Document pairs that state a relationship to each other, in either
    direction. Two documents that reference one another have not silently
    disagreed, whatever precedence the graph worked out."""
    pairs: Set[frozenset] = set()
    for node in nodes:
        for key in ("superseded_by", "amended_by", "supersedes", "amends"):
            for other in node.get(key) or []:
                pairs.add(frozenset({node["contract_id"], other["contract_id"]}))
    return pairs


def _summarize(
    lineage: Dict[str, Any],
    earlier: Dict[str, Any],
    later: Dict[str, Any],
    ordered: bool,
) -> str:
    caption = lineage.get("caption") or "A schedule"
    earlier_name = earlier.get("contract_name") or "an earlier document"
    later_name = later.get("contract_name") or "a later document"
    movement = (
        f' ({later["observed_pct"]:+.2f}%)'
        if later.get("observed_pct") is not None else ""
    )
    if ordered:
        return (
            f'"{caption}" is stated differently{movement} in {later_name} '
            f'({later.get("effective_date")}) than in {earlier_name} '
            f'({earlier.get("effective_date")}). Both still govern and neither '
            f"document says it replaces or amends the other, so the later one "
            f"only probably applies."
        )
    return (
        f'"{caption}" is stated differently{movement} in {later_name} and '
        f"{earlier_name}. Both govern, neither replaces or amends the other, "
        f"and their effective dates do not order them — which of the two applies "
        f"has to be decided rather than inferred."
    )


def render_conflicts(conflicts: List[Dict[str, Any]]) -> str:
    """As the agent reads it."""
    if not conflicts:
        return (
            "No live document in this project contradicts another on a tracked "
            "schedule. Every difference found is accounted for by a stated "
            "amendment or replacement."
        )

    lines = [f"Unresolved disagreements between documents that all still govern ({len(conflicts)}):"]
    for conflict in conflicts:
        marker = "CONFLICT" if conflict["kind"] == CONFLICT else "precedence not stated"
        lines.append(f'- [{marker}] {conflict["summary"]}')
        for change in conflict["changes"][:4]:
            lines.append(
                f'    · {change.get("row")}: {change.get("old") or "—"} → {change.get("new") or "—"}'
            )
    lines.append(
        "Do not present either side as the answer. Say that the documents "
        "disagree, name both, and let the user decide."
    )
    return "\n".join(lines)
