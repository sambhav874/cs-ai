"""Which documents govern, and which have been replaced.

No Mongo — `_status_for` and the spent-amendment fixpoint are the decisions
worth testing, and both are pure over the node shape the loader builds.
"""

from services.document_graph import (
    IN_FORCE,
    IN_FORCE_AS_AMENDED,
    NOT_YET_IN_EFFECT,
    SPENT,
    SUPERSEDED,
    UNDATED,
    _status_for,
    render_document_graph,
)


def node(effective=None, superseded_by=(), amended_by=(), amends=()):
    return {
        "contract_id": "c",
        "contract_name": "Doc.pdf",
        "doc_type": "annex",
        "effective_date": effective,
        "superseded_by": list(superseded_by),
        "amended_by": list(amended_by),
        "amends": list(amends),
        "supersedes": [],
    }


def ref(contract_id, effective=None):
    return {"contract_id": contract_id, "contract_name": f"{contract_id}.pdf",
            "effective_date": effective, "quote": ""}


# ------------------------------------------------------------------ status


def test_a_document_with_nothing_against_it_is_in_force():
    assert _status_for(node(effective="2022-01-01"), "2024-01-01") == IN_FORCE


def test_a_future_effective_date_is_not_yet_in_effect():
    assert _status_for(node(effective="2027-01-01"), "2024-01-01") == NOT_YET_IN_EFFECT


def test_a_replaced_document_is_superseded():
    replaced = node(effective="2022-01-01", superseded_by=[ref("e", "2025-01-01")])
    assert _status_for(replaced, "2026-01-01") == SUPERSEDED


def test_a_replacement_that_has_not_taken_effect_yet_does_not_displace_anything():
    """A replacement annex signed today but effective next quarter leaves the
    current one governing until then. Treating it as immediate would answer
    'what applies now' with a document that does not yet apply."""
    replaced = node(effective="2022-01-01", superseded_by=[ref("e", "2025-01-01")])
    assert _status_for(replaced, "2024-01-01") == IN_FORCE


def test_an_amended_document_still_governs():
    amended = node(effective="2022-01-01", amended_by=[ref("b", "2023-01-01")])
    assert _status_for(amended, "2024-01-01") == IN_FORCE_AS_AMENDED


def test_an_amendment_that_has_not_taken_effect_yet_does_not_change_anything():
    amended = node(effective="2022-01-01", amended_by=[ref("b", "2025-01-01")])
    assert _status_for(amended, "2024-01-01") == IN_FORCE


def test_an_undated_document_is_reported_as_undated_not_assumed_current():
    """Guessing is wrong in a way the user cannot see: assume it is in force and
    a draft governs; assume it is not and a real agreement vanishes."""
    assert _status_for(node(effective=None), "2024-01-01") == UNDATED


def test_an_undated_replacement_is_treated_as_already_in_effect():
    """The safer direction. A replacement whose date we could not read is more
    likely to have happened than not, and reporting the old document as current
    is the error that gets quoted."""
    replaced = node(effective="2022-01-01", superseded_by=[ref("e", None)])
    assert _status_for(replaced, "2024-01-01") == SUPERSEDED


# ---------------------------------------------------------------- rendering


def test_the_render_warns_against_quoting_a_superseded_document():
    nodes = [
        {**node(effective="2025-01-01"), "contract_name": "New.pdf",
         "status": IN_FORCE, "as_of": "2026-01-01"},
        {**node(effective="2022-01-01", superseded_by=[ref("new", "2025-01-01")]),
         "contract_name": "Old.pdf", "status": SUPERSEDED, "as_of": "2026-01-01"},
    ]
    rendered = render_document_graph(nodes)
    assert "Old.pdf" in rendered and "superseded" in rendered
    assert "Do not quote terms from a superseded document as current" in rendered


def test_the_render_flags_undated_documents_as_unconfirmed():
    nodes = [{**node(), "contract_name": "Undated.pdf", "status": UNDATED, "as_of": "2026-01-01"}]
    rendered = render_document_graph(nodes)
    assert "unconfirmed" in rendered


def test_an_empty_project_renders_without_claiming_anything():
    assert "No documents" in render_document_graph([])


# ------------------------------------------------------- spent amendments


def _graph(nodes_by_id, when):
    """The fixpoint pass from build_document_graph, over prepared nodes."""
    for n in nodes_by_id.values():
        n["status"] = _status_for(n, when)
    for _pass in range(len(nodes_by_id) + 1):
        changed = False
        for n in nodes_by_id.values():
            if n["status"] not in (IN_FORCE, IN_FORCE_AS_AMENDED):
                continue
            targets = [t for t in n["amends"] if t["contract_id"] in nodes_by_id]
            if not targets:
                continue
            if all(nodes_by_id[t["contract_id"]]["status"] in (SUPERSEDED, SPENT)
                   for t in targets):
                n["status"] = SPENT
                changed = True
        if not changed:
            break
    return nodes_by_id


def test_an_amendment_to_a_superseded_document_is_spent():
    graph = _graph({
        "a": node(effective="2022-01-01", superseded_by=[ref("e", "2025-01-01")],
                  amended_by=[ref("b", "2023-01-01")]),
        "b": node(effective="2023-01-01", amends=[ref("a", "2022-01-01")]),
        "e": node(effective="2025-01-01"),
    }, "2026-01-01")

    assert graph["a"]["status"] == SUPERSEDED
    assert graph["b"]["status"] == SPENT
    assert graph["e"]["status"] == IN_FORCE


def test_an_amendment_of_an_amendment_is_spent_through_the_chain():
    """One pass would settle this in whichever order the documents happened to
    be stored: c is only spent once b is, and b only once a is resolved."""
    graph = _graph({
        "a": node(effective="2022-01-01", superseded_by=[ref("e", "2025-01-01")]),
        "b": node(effective="2023-01-01", amends=[ref("a")]),
        "c": node(effective="2024-01-01", amends=[ref("b")]),
        "e": node(effective="2025-01-01"),
    }, "2026-01-01")

    assert graph["b"]["status"] == SPENT
    assert graph["c"]["status"] == SPENT


def test_an_amendment_with_one_live_target_is_not_spent():
    graph = _graph({
        "a": node(effective="2022-01-01", superseded_by=[ref("e", "2025-01-01")]),
        "live": node(effective="2022-01-01"),
        "b": node(effective="2023-01-01", amends=[ref("a"), ref("live")]),
        "e": node(effective="2025-01-01"),
    }, "2026-01-01")

    assert graph["b"]["status"] != SPENT


def test_a_circular_reference_terminates():
    """Two documents each claiming to amend the other is malformed input, not a
    reason to spin."""
    graph = _graph({
        "x": node(effective="2022-01-01", amends=[ref("y")]),
        "y": node(effective="2022-01-01", amends=[ref("x")]),
    }, "2026-01-01")

    assert graph["x"]["status"] in (IN_FORCE, IN_FORCE_AS_AMENDED, SPENT)


def test_nothing_is_spent_before_its_target_was_superseded():
    graph = _graph({
        "a": node(effective="2022-01-01", superseded_by=[ref("e", "2025-01-01")]),
        "b": node(effective="2023-01-01", amends=[ref("a")]),
        "e": node(effective="2025-01-01"),
    }, "2024-01-01")

    assert graph["a"]["status"] == IN_FORCE
    assert graph["b"]["status"] != SPENT
