"""Two documents that both govern and disagree.

No Mongo. `conflicts_between` is the whole substance — it decides whether a
user is warned or left to find out from an invoice — so it is tested directly
over a prepared graph and lineage set.
"""

from services.conflict_detection import (
    CONFLICT,
    UNRESOLVED_PRECEDENCE,
    conflicts_between,
    render_conflicts,
)


def doc(contract_id, status="in_force", **relations):
    return {
        "contract_id": contract_id,
        "contract_name": f"{contract_id}.pdf",
        "status": status,
        "as_of": "2026-01-01",
        "superseded_by": relations.get("superseded_by", []),
        "amended_by": relations.get("amended_by", []),
        "supersedes": relations.get("supersedes", []),
        "amends": relations.get("amends", []),
    }


def ref(contract_id):
    return {"contract_id": contract_id, "contract_name": f"{contract_id}.pdf",
            "effective_date": None, "quote": ""}


def version(contract_id, effective, status="revised", changes=None, pct=None):
    return {
        "contract_id": contract_id,
        "contract_name": f"{contract_id}.pdf",
        "effective_date": effective,
        "status": status,
        "changes": changes if changes is not None else [
            {"change": "changed", "row": "TOWING", "old": "100.00", "new": "120.00"}
        ],
        "observed_pct": pct,
    }


def lineage(versions, caption="RAMP SERVICES"):
    return {
        "signature": "sig-1",
        "caption": caption,
        "table_type": "Rate Schedule",
        "versions": versions,
        "version_count": len(versions),
    }


# ------------------------------------------------------------- detection


def test_two_live_documents_disagreeing_with_no_ordering_is_a_conflict():
    """Same effective date, both in force, neither references the other.
    Nothing can decide this but a person."""
    nodes = [doc("a"), doc("b")]
    lineages = [lineage([
        version("a", "2024-01-01"),
        version("b", "2024-01-01"),
    ])]

    found = conflicts_between(nodes, lineages)

    assert len(found) == 1
    assert found[0]["kind"] == CONFLICT
    assert found[0]["severity"] == "warning"
    assert {d["contract_name"] for d in found[0]["documents"]} == {"a.pdf", "b.pdf"}


def test_undated_documents_that_disagree_are_a_conflict_not_a_guess():
    nodes = [doc("a", status="undated"), doc("b", status="undated")]
    lineages = [lineage([version("a", None), version("b", None)])]

    found = conflicts_between(nodes, lineages)

    assert found and found[0]["kind"] == CONFLICT


def test_a_later_document_with_no_stated_relation_is_precedence_not_conflict():
    """Most projects never declare supersession for every pair. Reporting these
    as conflicts would bury the real ones."""
    nodes = [doc("a"), doc("b")]
    lineages = [lineage([
        version("a", "2023-01-01"),
        version("b", "2024-01-01"),
    ])]

    found = conflicts_between(nodes, lineages)

    assert len(found) == 1
    assert found[0]["kind"] == UNRESOLVED_PRECEDENCE
    assert found[0]["severity"] == "info"


def test_a_superseded_document_does_not_conflict_with_the_one_that_replaced_it():
    """The resolved case. This is what the document graph is for."""
    nodes = [
        doc("a", status="superseded", superseded_by=[ref("b")]),
        doc("b", supersedes=[ref("a")]),
    ]
    lineages = [lineage([version("a", "2023-01-01"), version("b", "2024-01-01")])]

    assert conflicts_between(nodes, lineages) == []


def test_documents_that_reference_each_other_are_never_silently_disagreeing():
    """Even where the graph left both live, two documents that state their own
    relationship have said something about how they fit together."""
    nodes = [doc("a", amended_by=[ref("b")]), doc("b", amends=[ref("a")])]
    lineages = [lineage([version("a", "2023-01-01"), version("b", "2024-01-01")])]

    assert conflicts_between(nodes, lineages) == []


def test_a_schedule_reissued_unchanged_is_redundant_not_contradictory():
    nodes = [doc("a"), doc("b")]
    lineages = [lineage([
        version("a", "2023-01-01"),
        version("b", "2024-01-01", status="unchanged", changes=[]),
    ])]

    assert conflicts_between(nodes, lineages) == []


def test_a_version_with_no_measured_difference_is_not_reported():
    nodes = [doc("a"), doc("b")]
    lineages = [lineage([
        version("a", "2023-01-01"),
        version("b", "2024-01-01", changes=[], pct=None),
    ])]

    assert conflicts_between(nodes, lineages) == []


def test_a_single_live_document_cannot_conflict():
    nodes = [doc("a"), doc("b", status="superseded", superseded_by=[ref("a")])]
    lineages = [lineage([version("a", "2024-01-01"), version("b", "2023-01-01")])]

    assert conflicts_between(nodes, lineages) == []


def test_conflicts_are_ranked_before_unstated_precedence():
    nodes = [doc("a"), doc("b"), doc("c"), doc("d")]
    lineages = [
        lineage([version("a", "2023-01-01"), version("b", "2024-01-01")], caption="ORDERED"),
        lineage([version("c", "2024-01-01"), version("d", "2024-01-01")], caption="TIED"),
    ]

    found = conflicts_between(nodes, lineages)

    assert [c["kind"] for c in found] == [CONFLICT, UNRESOLVED_PRECEDENCE]


# ------------------------------------------------------------- rendering


def test_a_clean_project_says_so_without_hedging():
    rendered = render_conflicts([])
    assert "No live document" in rendered
    assert "accounted for by a stated amendment or replacement" in rendered


def test_the_render_tells_the_model_not_to_pick_a_side():
    nodes = [doc("a"), doc("b")]
    lineages = [lineage([version("a", "2024-01-01"), version("b", "2024-01-01")])]

    rendered = render_conflicts(conflicts_between(nodes, lineages))

    assert "CONFLICT" in rendered
    assert "TOWING: 100.00 → 120.00" in rendered
    assert "Do not present either side as the answer" in rendered
