"""The single citation pipeline (plan 1.4, F-05).

The bug this closes: `react_runtime` rewrote the inline `[N]` markers, and only
afterwards did `middleware._validate_citations` drop unsupported citations and
renumber the survivors. Dropping the middle citation of three therefore left the
prose saying `[3]` while the third annotation had become ref 2 — every marker
after the dropped one pointed at the wrong evidence.

The plan's done-when for 1.4 is exactly the first test below, plus "no marker
regex exists outside the module", which the last test enforces.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from services.contract_agent import citations
from services.contract_agent.graph.middleware import ActiveMiddlewareEngine
from services.contract_agent.graph.state import (
    AgentContext,
    AgentRunState,
    AgentSurface,
)


BACKEND_ROOT = Path(__file__).resolve().parents[3] / "apps" / "backend"

SUPPORTED_A = "Terminal Authority shall pay each undisputed invoice within 45 days of receipt."
SUPPORTED_B = "Either party may terminate for cause on 30 days written notice."
FABRICATED = "Contractor forfeits nine hundred million francs upon any delay whatsoever."


def make_state(answer: str, annotations, *, matches=None) -> AgentRunState:
    """A state as it looks when middleware.answer_guard receives it."""
    observed = matches if matches is not None else [
        {
            "quote": SUPPORTED_A,
            "context": SUPPORTED_A,
            "document_id": "doc-1",
            "filename": "Agreement.md",
            "page": 1,
            "evidence_id": "doc-1::payment",
        },
        {
            "quote": SUPPORTED_B,
            "context": SUPPORTED_B,
            "document_id": "doc-1",
            "filename": "Agreement.md",
            "page": 2,
            "evidence_id": "doc-1::termination",
        },
    ]
    state = AgentRunState(
        user_id="u",
        message="What are the payment and termination terms?",
        context=AgentContext(
            surface=AgentSurface.CONTRACT,
            contract_id="doc-1",
            selected_document_ids=["doc-1"],
            attached_documents=[{"document_id": "doc-1", "filename": "Agreement.md"}],
        ),
    )
    state.answer = answer
    state.citation_annotations = list(annotations)
    state.react_scratchpad = [
        {"iteration": 1, "tool": "search_evidence", "status": "done",
         "observation": {"summary": "2 snippets.", "matches": observed}}
    ]
    return state


def annotation(ref: int, quote: str, page: int = 1):
    return {
        "type": "citation_data",
        "ref": ref,
        "doc_id": "doc-1",
        "document_id": "doc-1",
        "filename": "Agreement.md",
        "page": page,
        "quote": quote,
    }


# ── The plan's done-when for 1.4 ──────────────────────────────────────────────


def test_dropping_the_middle_citation_keeps_markers_contiguous_and_bound():
    """Three citations, the middle one unusable — the plan's done-when for 1.4.

    A citation with no quote is dropped outright: there is nothing to show the
    reader and nothing to validate against. The survivors must renumber to 1 and
    2, the prose must read [1] and [2], and each marker must still point at the
    evidence it originally referred to rather than at whatever slid into its
    number. Before 1.4 the prose kept saying [3] here.
    """
    state = make_state(
        "Payment is due within 45 days [1]. The penalty is unclear [2]. "
        "Termination needs 30 days written notice [3].",
        [
            annotation(1, SUPPORTED_A, page=1),
            annotation(2, "", page=1),
            annotation(3, SUPPORTED_B, page=2),
        ],
    )

    ActiveMiddlewareEngine().answer_guard(state)

    refs = [item["ref"] for item in state.citation_annotations]
    assert refs == [1, 2], f"expected contiguous refs, got {refs}"

    markers = [int(value) for value in re.findall(r"\[(\d+)\]", state.answer)]
    assert markers == [1, 2], f"expected contiguous markers, got {markers} in {state.answer!r}"

    # The binding is what actually matters. The marker on the termination
    # sentence must resolve to the termination quote, not the payment one.
    by_ref = {item["ref"]: item for item in state.citation_annotations}
    termination_marker = re.search(r"Termination needs 30 days written notice \[(\d+)\]", state.answer)
    assert termination_marker, state.answer
    assert "30 days" in by_ref[int(termination_marker.group(1))]["quote"]

    payment_marker = re.search(r"Payment is due within 45 days \[(\d+)\]", state.answer)
    assert payment_marker, state.answer
    assert "45 days" in by_ref[int(payment_marker.group(1))]["quote"]

    assert "invalid_citation_missing_quote" in state.verifier_issues


def test_dropping_the_first_citation_shifts_the_rest_correctly():
    state = make_state(
        "The penalty is unclear [1]. Payment is due within 45 days [2]. "
        "Termination needs 30 days notice [3].",
        [
            annotation(1, "", page=1),
            annotation(2, SUPPORTED_A, page=1),
            annotation(3, SUPPORTED_B, page=2),
        ],
    )

    ActiveMiddlewareEngine().answer_guard(state)

    by_ref = {item["ref"]: item for item in state.citation_annotations}
    assert sorted(by_ref) == [1, 2]
    payment = re.search(r"Payment is due within 45 days \[(\d+)\]", state.answer)
    assert payment, state.answer
    assert "45 days" in by_ref[int(payment.group(1))]["quote"]
    termination = re.search(r"Termination needs 30 days notice \[(\d+)\]", state.answer)
    assert termination, state.answer
    assert "30 days" in by_ref[int(termination.group(1))]["quote"]


def test_a_duplicate_citation_is_dropped_and_the_rest_renumber():
    """The other real drop path: the model citing the same quote twice."""
    state = make_state(
        "Payment is due within 45 days [1]. Payment again [2]. "
        "Termination needs 30 days notice [3].",
        [
            annotation(1, SUPPORTED_A, page=1),
            annotation(2, SUPPORTED_A, page=1),
            annotation(3, SUPPORTED_B, page=2),
        ],
    )

    ActiveMiddlewareEngine().answer_guard(state)

    assert [item["ref"] for item in state.citation_annotations] == [1, 2]
    assert "duplicate_citation_removed" in state.verifier_issues
    by_ref = {item["ref"]: item for item in state.citation_annotations}
    termination = re.search(r"Termination needs 30 days notice \[(\d+)\]", state.answer)
    assert "30 days" in by_ref[int(termination.group(1))]["quote"]


def test_an_unsupported_citation_is_kept_but_flagged_not_silently_deleted():
    """Deliberate: a fabricated quote stays, marked `verified: false`.

    Deleting it would hide from the reader that the agent asserted something it
    could not back up, and Phase 4.4 surfaces this flag in the UI. It is also
    what the eval's citation-support metric counts, so the flag has to be set
    rather than the row removed.
    """
    state = make_state(
        "Payment is due within 45 days [1]. The penalty is enormous [2].",
        [annotation(1, SUPPORTED_A, page=1), annotation(2, FABRICATED, page=1)],
    )

    ActiveMiddlewareEngine().answer_guard(state)

    by_ref = {item["ref"]: item for item in state.citation_annotations}
    assert sorted(by_ref) == [1, 2]
    assert by_ref[1]["verified"] is True
    assert by_ref[2]["verified"] is False
    assert "invalid_or_unsupported_citation" in state.verifier_issues


def test_all_citations_supported_leaves_numbering_untouched():
    """The no-op case must stay a no-op — renumbering should not churn refs."""
    state = make_state(
        "Payment is due within 45 days [1]. Termination needs 30 days notice [2].",
        [annotation(1, SUPPORTED_A, page=1), annotation(2, SUPPORTED_B, page=2)],
    )

    ActiveMiddlewareEngine().answer_guard(state)

    assert [item["ref"] for item in state.citation_annotations] == [1, 2]
    assert [int(v) for v in re.findall(r"\[(\d+)\]", state.answer)] == [1, 2]
    assert all(item["verified"] for item in state.citation_annotations)


def test_verified_flag_reflects_the_support_check():
    """The eval's blocking metric counts this flag, so it has to be honest."""
    state = make_state("Payment is due within 45 days [1].", [annotation(1, SUPPORTED_A)])
    ActiveMiddlewareEngine().answer_guard(state)
    assert state.citation_annotations[0]["verified"] is True

    state = make_state("The penalty is enormous [1].", [annotation(1, FABRICATED)])
    ActiveMiddlewareEngine().answer_guard(state)
    assert state.citation_annotations[0]["verified"] is False


def test_source_ref_preserves_what_the_model_originally_wrote():
    """Renumbering must stay traceable back to the model's own numbering."""
    state = make_state(
        "Unusable [1]. Payment is due within 45 days [2].",
        [annotation(1, ""), annotation(2, SUPPORTED_A)],
    )
    ActiveMiddlewareEngine().answer_guard(state)

    survivor = state.citation_annotations[0]
    assert survivor["ref"] == 1, "renumbered to the front"
    assert survivor["source_ref"] == 2, "but still traceable to the model's [2]"


# ── Pipeline step order ───────────────────────────────────────────────────────


def test_renumber_returns_the_map_the_rewrite_needs():
    """The map is the fix. Renumbering without one is what broke the markers."""
    annotations = [
        {"ref": 1, "source_ref": 1, "quote": "a"},
        {"ref": 3, "source_ref": 3, "quote": "b"},
        {"ref": 7, "source_ref": 7, "quote": "c"},
    ]
    renumbered, ref_map = citations.renumber(annotations)
    assert [item["ref"] for item in renumbered] == [1, 2, 3]
    assert ref_map == {1: 1, 3: 2, 7: 3}


def test_rewrite_markers_applies_the_map_to_prose():
    annotations = [
        {"ref": 1, "source_ref": 1, "quote": "a"},
        {"ref": 2, "source_ref": 3, "quote": "b"},
    ]
    rewritten = citations.rewrite_markers(
        "First [1] and second [3].", annotations, ref_map={1: 1, 3: 2}
    )
    assert rewritten == "First [1] and second [2]."


def test_rewrite_markers_removes_a_marker_whose_citation_was_dropped():
    """Leaving the stale marker in place is what caused the collision.

    Drop citation 2 of three and [3] renumbers to [2]. A stale [2] left behind
    would sit beside the remapped one and both would resolve to the same
    evidence — so the marker for a dropped citation is removed, along with the
    space in front of it.
    """
    annotations = [
        {"ref": 1, "source_ref": 1, "quote": "a"},
        {"ref": 2, "source_ref": 3, "quote": "c"},
    ]
    rewritten = citations.rewrite_markers(
        "First [1]. Dropped [2]. Third [3].", annotations, ref_map={1: 1, 3: 2}
    )
    assert rewritten == "First [1]. Dropped. Third [2]."
    assert [int(v) for v in re.findall(r"\[(\d+)\]", rewritten)] == [1, 2]


def test_rewrite_markers_can_be_told_to_keep_unmapped_markers():
    annotations = [{"ref": 1, "source_ref": 1, "quote": "a"}]
    rewritten = citations.rewrite_markers(
        "First [1] and unknown [9].", annotations, ref_map={1: 1}, drop_unmapped=False
    )
    assert "[9]" in rewritten


def test_normalize_markers_folds_full_width_brackets_and_is_idempotent():
    assert citations.normalize_markers("See 【3†source】 and 【1, 2】.") == "See [3] and [1, 2]."
    once = citations.normalize_markers("See 【3】.")
    assert citations.normalize_markers(once) == once


def test_citation_block_is_stripped_from_the_prose():
    answer = 'The term is 45 days [1].\n<CITATIONS>\n[{"ref": 1, "quote": "x"}]\n</CITATIONS>'
    assert citations.strip_citation_block(answer) == "The term is 45 days [1]."


def test_parse_citation_block_recovers_objects_from_a_truncated_block():
    """A stream cut mid-block should still yield the citations that arrived."""
    answer = (
        "Text [1][2].\n<CITATIONS>\n"
        '[{"ref": 1, "doc_id": "doc-1", "quote": "first"}, '
        '{"ref": 2, "doc_id": "doc-1", "quote": "second"}'
    )
    parsed = citations.parse_citation_block(answer)
    assert [item["ref"] for item in parsed] == [1, 2]


@pytest.mark.parametrize(
    "raw,expected",
    [
        (3, (3, 3, 3)),
        ("4", (4, 4, 4)),
        ("Page 7", (7, 7, 7)),
        ("2-5", (2, 2, 5)),
        ("2–5", (2, 2, 5)),
        ("5-2", (5, 5, 5)),
        (None, (None, None, None)),
    ],
)
def test_page_range_parsing(raw, expected):
    assert citations.parse_page_range(raw) == expected


def test_cited_segments_default_to_unverified():
    """An annotation that has not been through validate_citations has not been
    checked. Defaulting `verified` to True — as the old code did — reported
    unchecked citations to the UI as confirmed."""
    details = citations.build_citation_details(
        [{"ref": 1, "quote": "x"}], style="model_citations", segment_type="model_citation"
    )
    assert details["cited_segments"][0]["verified"] is False


# ── Structural guarantees ─────────────────────────────────────────────────────


def test_no_citation_marker_regex_exists_outside_the_module():
    """The plan's second done-when for 1.4.

    The `【N】 → [N]` fold used to appear four times, twice in runner.py alone.
    Any new copy is a place the pipeline can drift out of order again.
    """
    offenders = []
    for path in BACKEND_ROOT.rglob("*.py"):
        if path.name == "citations.py" and path.parent.name == "contract_agent":
            continue
        if "__pycache__" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if "【" in text:
            offenders.append(f"{path.relative_to(BACKEND_ROOT)}: full-width marker regex")
        if re.search(r"<CITATIONS\??>\[\\s\\S\]", text):
            offenders.append(f"{path.relative_to(BACKEND_ROOT)}: citation block regex")
    assert not offenders, "citation regexes must live only in citations.py: " + "; ".join(offenders)


def test_superseded_helpers_are_gone_from_react_runtime():
    from services.contract_agent.graph import react_runtime

    for name in (
        "_normalize_answer_citation_markers",
        "_ensure_inline_citation_marker",
        "_enrich_citations_from_observations",
        "_annotations_from_observations",
        "_build_citations_from_tool_observations",
        "_parse_page_range",
        "_extract_page_from_text_markers",
    ):
        assert not hasattr(react_runtime, name), f"{name} should now live in citations.py"


def test_middleware_text_helpers_delegate_rather_than_duplicate():
    """Two copies of the normalisation rules would let the support check and the
    marker matcher disagree about what counts as the same quote."""
    from services.contract_agent.graph import middleware

    assert middleware._normalize_citation_text is citations.normalize_text
    assert middleware._citation_tokens is citations.content_tokens


def test_answer_guard_still_records_its_trace_event():
    state = make_state(
        "Payment is due within 45 days [1].", [annotation(1, SUPPORTED_A)]
    )
    ActiveMiddlewareEngine().answer_guard(state)
    events = [trace.event for trace in state.traces]
    assert "middleware:CitationGuardMiddleware" in events
    assert state.citation_details["citation_guard"]["annotations"]
