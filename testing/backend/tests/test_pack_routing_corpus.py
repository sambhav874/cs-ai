"""Routing, measured against every contract document in the repository.

Routing is the part of the pack system with no unit-test analogue: a pack that
loads, lints and renders perfectly is still useless if it never matches its own
family, and actively harmful if it matches somebody else's. Both failures showed
up here first — the IATA pack scored 0.10–0.35 on real SGHA documents while the
floor sat at 0.45, so it would never once have applied to the family it was
written for.
"""

from pathlib import Path

import pytest

from services.obligation_packs import (
    DEFAULT_CONFIDENCE_FLOOR,
    ObligationPack,
    _score,
    builtin_packs,
    resolve_family,
)

REPO = Path(__file__).resolve().parents[3]

IATA_DOCS = sorted((REPO / "sample_projects" / "project1_iata_gha").glob("*.txt"))
KPI_FIXTURES = sorted((REPO / "final_evaluation" / "datasets" / "kpi_contracts").glob("0*.md"))
UNRELATED = sorted((REPO / "sample_projects" / "project2_msa_sow").glob("*.txt")) + sorted(
    (REPO / "sample_projects" / "project3_full_lifecycle").glob("*.txt")
)


def _resolve(path: Path):
    body = path.read_text(encoding="utf-8")
    heading = body.splitlines()[0].lstrip("# ").strip() if body else ""
    return resolve_family(title=f"{path.stem} {heading}", body=body, packs=builtin_packs())


@pytest.mark.skipif(not IATA_DOCS, reason="SGHA sample project not present")
@pytest.mark.parametrize("path", IATA_DOCS, ids=lambda p: p.stem[:28])
def test_every_sgha_document_resolves_to_the_iata_pack(path):
    """Including the amendment — short, and restating only what it changes."""
    resolution = _resolve(path)

    assert resolution.pack.id == "iata_ground_handling", resolution.reason
    assert resolution.applied


@pytest.mark.skipif(not KPI_FIXTURES, reason="KPI fixtures not present")
def test_the_logistics_fixture_resolves_and_the_other_seven_do_not():
    resolved = {path.name: _resolve(path) for path in KPI_FIXTURES}

    logistics = next(r for name, r in resolved.items() if name.startswith("01_"))
    assert logistics.pack.id == "logistics_msa"

    for name, resolution in resolved.items():
        if not name.startswith("01_"):
            assert not resolution.applied, f"{name} wrongly matched {resolution.pack.id}"


@pytest.mark.skipif(not UNRELATED, reason="sample projects not present")
@pytest.mark.parametrize("path", UNRELATED, ids=lambda p: p.stem[:28])
def test_unrelated_contracts_get_no_pack(path):
    assert not _resolve(path).applied


@pytest.mark.skipif(not (IATA_DOCS and KPI_FIXTURES), reason="corpora not present")
def test_the_floor_sits_in_the_gap_between_matches_and_non_matches():
    """The floor is set from this separation; if it closes, the floor is wrong."""
    packs = builtin_packs()
    scores = {}
    for path in IATA_DOCS + KPI_FIXTURES + UNRELATED:
        body = path.read_text(encoding="utf-8")
        heading = body.splitlines()[0].lstrip("# ").strip() if body else ""
        title = f"{path.stem} {heading}".lower()
        scores[path] = max(_score(pack, title, body.lower())[0] for pack in packs)

    matches = [
        score
        for path, score in scores.items()
        if path in IATA_DOCS or path.name.startswith("01_global_logistics")
    ]
    non_matches = [
        score
        for path, score in scores.items()
        if path not in IATA_DOCS and not path.name.startswith("01_global_logistics")
    ]

    assert min(matches) > max(non_matches), "matches and non-matches overlap; routing is guesswork"
    assert max(non_matches) < DEFAULT_CONFIDENCE_FLOOR < min(matches)


def test_declaring_more_markers_never_lowers_a_score():
    """The scorer counts hits, not the fraction of markers that hit.

    Under a fraction, adding a marker lowered the score on every document that
    lacked it — so the incentive was to declare as few markers as possible,
    which is exactly the routing-hijack shape the minimum-marker rule prevents.
    """
    def pack_with(markers):
        return ObligationPack(
            id="x", version=1, display_name="x", sections={},
            match={"title_patterns": [], "body_markers": markers, "structure": []},
        )

    body = "widget throughput on the sprocket lane"
    terse, _ = _score(pack_with(["widget throughput", "sprocket lane"]), "", body)
    thorough, _ = _score(
        pack_with(["widget throughput", "sprocket lane", "calibration window", "first-pass yield"]),
        "",
        body,
    )

    assert thorough >= terse
