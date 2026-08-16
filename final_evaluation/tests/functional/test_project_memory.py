"""Project memory regression tests.

Covers the two bugs that made the agent answer "which documents relate to this
contract?" with documents from a different project while omitting half of its
own, plus the invariants the OKF restructure must not break.

Backed by mongomock so these are deterministic and never touch a real database.
"""

import os
import sys
from datetime import datetime

import mongomock
import pytest
import yaml
from bson import ObjectId

conftest_dir = os.path.dirname(os.path.abspath(__file__))
APP_BACKEND_ROOT = os.path.abspath(os.path.join(conftest_dir, "../../../apps/backend"))
if APP_BACKEND_ROOT not in sys.path:
    sys.path.insert(0, APP_BACKEND_ROOT)

from services.project_memory import (  # noqa: E402
    ProjectMemoryManager,
    render_concept,
    split_scratchpad,
)

PROJECT_A = "6a7f8420355760378cc4db77"
PROJECT_B = "6a7f6729c16d4a678241ecde"


@pytest.fixture
def manager():
    client = mongomock.MongoClient()
    return ProjectMemoryManager(client["contract_core_db"])


def _add_contract(manager, project_id, name, *, status="Ingested"):
    return str(manager.contracts.insert_one({
        "projectId": ObjectId(project_id),
        "contract_name": name,
        "status": status,
        "uploaded_at": datetime(2026, 8, 14),
    }).inserted_id)


def _add_memory(manager, project_id, contract_id, name, *, status="success", **extra):
    doc = {
        "project_id": project_id,
        "contract_id": contract_id,
        "filename": name,
        "doc_type": "sow",
        "purpose_summary": "Purpose.",
        "status": status,
        "uploaded_at": datetime(2026, 8, 14),
    }
    doc.update(extra)
    manager.memories.insert_one(doc)
    return doc


def _section(contract_id: str, filename: str, body: str = "") -> str:
    return (
        f"<!-- pm:section:{contract_id} -->\n"
        f"## {filename} — sow\n{body}\n"
        f"<!-- /pm:section:{contract_id} -->"
    )


# ---------------------------------------------------------------- scoping ---

def test_memory_context_is_scoped_to_one_project(manager):
    """The original bug: a vector store bound to the whole collection, queried
    without a namespace filter, returned every project's memory to every
    project — so the agent named another project's documents as this one's."""
    a = _add_contract(manager, PROJECT_A, "01_MSA_Solstice_Cobalt.pdf")
    _add_memory(manager, PROJECT_A, a, "01_MSA_Solstice_Cobalt.pdf")
    b = _add_contract(manager, PROJECT_B, "02_AnnexA_Services.pdf")
    _add_memory(manager, PROJECT_B, b, "02_AnnexA_Services.pdf")
    manager.update_notes(PROJECT_A, "Notes for A.")
    manager.update_notes(PROJECT_B, "Notes for B.")

    context_a = manager.build_memory_context(PROJECT_A)
    context_b = manager.build_memory_context(PROJECT_B)

    assert "01_MSA_Solstice_Cobalt.pdf" in context_a
    assert "02_AnnexA_Services.pdf" not in context_a
    assert "Notes for B." not in context_a
    assert "02_AnnexA_Services.pdf" in context_b
    assert "01_MSA_Solstice_Cobalt.pdf" not in context_b
    assert "Notes for A." not in context_b


def test_index_is_scoped_to_one_project(manager):
    a = _add_contract(manager, PROJECT_A, "01_A.pdf")
    _add_memory(manager, PROJECT_A, a, "01_A.pdf")
    b = _add_contract(manager, PROJECT_B, "01_B.pdf")
    _add_memory(manager, PROJECT_B, b, "01_B.pdf")

    assert "01_B.pdf" not in manager.render_index(PROJECT_A)
    assert "01_A.pdf" not in manager.render_index(PROJECT_B)


def test_read_concept_will_not_cross_projects(manager):
    a = _add_contract(manager, PROJECT_A, "01_A.pdf")
    _add_memory(manager, PROJECT_A, a, "01_A.pdf")

    assert manager.read_concept(PROJECT_A, a) is not None
    assert manager.read_concept(PROJECT_B, a) is None


# ------------------------------------------------------------ completeness ---

def test_index_lists_a_document_that_has_no_overview_yet(manager):
    """Audit gap 1. Overview generation is best-effort and never fails ingest,
    so a document can sit in a project with no memory record. Every other reader
    filters on status=success; an index built that way would hide it, and the
    agent would answer about a partial project believing it was whole."""
    ingested = _add_contract(manager, PROJECT_A, "01_MSA.pdf")
    _add_memory(manager, PROJECT_A, ingested, "01_MSA.pdf")
    _add_contract(manager, PROJECT_A, "02_Pending.pdf", status="Indexing")

    index = manager.render_index(PROJECT_A)

    assert "01_MSA.pdf" in index
    assert "02_Pending.pdf" in index
    assert "no overview yet" in index
    assert "Indexing" in index


def test_index_lists_a_document_whose_overview_failed(manager):
    contract_id = _add_contract(manager, PROJECT_A, "01_Thin.pdf")
    _add_memory(manager, PROJECT_A, contract_id, "01_Thin.pdf", status="failed")

    index = manager.render_index(PROJECT_A)

    assert "01_Thin.pdf" in index
    assert "overview unavailable" in index


def test_index_flags_memory_whose_contract_left_the_project(manager):
    """Audit gap 2: deleting a project reassigns its contracts to the fallback
    project but leaves their memory behind under the dead project_id."""
    _add_memory(manager, PROJECT_A, "gone-contract", "03_Moved.pdf")

    index = manager.render_index(PROJECT_A)

    assert "03_Moved.pdf" in index
    assert "no longer in this project" in index


def test_index_covers_every_document_and_never_truncates(manager):
    for i in range(1, 41):
        contract_id = _add_contract(manager, PROJECT_A, f"{i:02d}_Document.pdf")
        _add_memory(manager, PROJECT_A, contract_id, f"{i:02d}_Document.pdf")

    index = manager.render_index(PROJECT_A)

    for i in range(1, 41):
        assert f"{i:02d}_Document.pdf" in index


def test_context_for_agent_lists_every_successful_document(manager):
    """The chronological fallback is also uncapped; truncating it would drop the
    most recently uploaded documents."""
    for i in range(1, 31):
        _add_memory(manager, PROJECT_A, f"c{i}", f"{i:02d}_Document.pdf",
                    purpose_summary="Purpose summary. " * 20)

    context = manager.build_project_context_for_agent(PROJECT_A)

    for i in range(1, 31):
        assert f"{i:02d}_Document.pdf" in context


def test_notes_are_not_truncated(manager):
    """The old fixed 3500-char cap silently dropped whatever sorted last."""
    notes = "Negotiation history. " * 400
    assert len(notes) > 3500

    manager.update_notes(PROJECT_A, notes)
    context = manager.build_memory_context(PROJECT_A)

    assert notes.strip() in context


def test_index_handles_an_unusable_project_id(manager):
    assert manager.render_index("not-an-objectid") == "No project in scope."
    assert manager.render_index("") == "No project in scope."


def test_memory_context_holds_up_with_no_documents_and_no_notes(manager):
    context = manager.build_memory_context(PROJECT_A)

    assert "no documents yet" in context
    assert "Notes written by the team" not in context


def test_memory_context_omits_the_notes_section_when_notes_are_blank(manager):
    manager.update_notes(PROJECT_A, "   \n\n  ")

    assert "Notes written by the team" not in manager.build_memory_context(PROJECT_A)


# ------------------------------------------------------- on-demand concepts ---

def test_memory_context_excludes_per_document_overviews(manager):
    """Overviews used to be concatenated into every turn's context. The index
    carries what is needed to navigate; detail is fetched by id."""
    contract_id = _add_contract(manager, PROJECT_A, "01_MSA.pdf")
    _add_memory(manager, PROJECT_A, contract_id, "01_MSA.pdf",
                purpose_summary="Distinctive summary sentence.")

    context = manager.build_memory_context(PROJECT_A)

    assert "01_MSA.pdf" in context
    assert "Distinctive summary sentence." not in context
    assert "Distinctive summary sentence." in manager.read_concept(PROJECT_A, contract_id)


def test_read_concept_explains_itself_when_the_overview_is_unusable(manager):
    contract_id = _add_contract(manager, PROJECT_A, "01_Thin.pdf")
    _add_memory(manager, PROJECT_A, contract_id, "01_Thin.pdf", status="failed")

    result = manager.read_concept(PROJECT_A, contract_id)

    assert "No usable overview" in result
    assert "failed" in result


def test_read_concept_returns_none_for_an_unknown_document(manager):
    assert manager.read_concept(PROJECT_A, "nope") is None


# ------------------------------------------------------------- concept format ---

def test_concept_frontmatter_is_parseable_and_carries_project_scope(manager):
    record = _add_memory(
        manager, PROJECT_A, "c1", "01_MSA.pdf",
        key_topics=["term", "payment"],
        related_documents=[{"filename": "02_SOW.pdf", "relation_type": "amends"}],
    )

    _, front, body = render_concept(record).split("---", 2)
    parsed = yaml.safe_load(front)

    assert parsed["type"] == "contract-document"
    assert parsed["project_id"] == PROJECT_A
    assert parsed["source_contract_id"] == "c1"
    assert parsed["tags"] == ["term", "payment"]
    assert parsed["links"] == ["amends:02_SOW.pdf"]
    assert "01_MSA.pdf" in body


def test_concept_frontmatter_survives_values_that_would_break_yaml(manager):
    """These fields are model output — colons, quotes and newlines in a party
    name or filename are routine and must not produce invalid YAML."""
    record = _add_memory(
        manager, PROJECT_A, "c1", 'Mid: "Contract" v2\nrev.pdf',
        parties=['Acme: Holdings "International"'],
        key_topics=["fees: rebates", "term\nlength"],
    )

    parsed = yaml.safe_load(render_concept(record).split("---", 2)[1])

    assert parsed["title"] == 'Mid: "Contract" v2\nrev.pdf'
    assert parsed["tags"] == ["fees: rebates", "term\nlength"]


def test_concept_omits_empty_fields(manager):
    record = _add_memory(manager, PROJECT_A, "c1", "01_MSA.pdf", effective_date=None, key_topics=[])

    parsed = yaml.safe_load(render_concept(record).split("---", 2)[1])

    assert "effective_date" not in parsed
    assert "tags" not in parsed


# ----------------------------------------------------------------- migration ---

def test_split_keeps_human_prose_and_drops_generated_sections():
    """The asymmetry this migration turns on: generated sections can be rebuilt
    from records, typed prose exists nowhere else."""
    manual = "Deal team: FRA-based, effective 1 June 2026. Incumbent is AeroGround."
    content = _section("c1", "01_MSA.pdf", "generated body") + "\n\n---\n\n" + manual

    split = split_scratchpad(content)

    assert split["notes"] == manual
    assert split["section_contract_ids"] == ["c1"]
    assert "generated body" not in split["notes"]


def test_split_of_a_scratchpad_with_no_prose_yields_nothing_to_keep():
    content = _section("c1", "01_MSA.pdf") + "\n\n---\n\n" + _section("c2", "02_SOW.pdf")

    split = split_scratchpad(content)

    assert split["notes"] == ""
    assert split["section_contract_ids"] == ["c1", "c2"]


def test_migration_dry_run_changes_nothing(manager):
    manual = "Renewal negotiated verbally."
    manager.update_notes(PROJECT_A, _section("c1", "01_MSA.pdf") + "\n\n---\n\n" + manual)
    _add_memory(manager, PROJECT_A, "c1", "01_MSA.pdf")
    before = manager.get_notes(PROJECT_A)["content"]

    results = manager.migrate_scratchpads_to_notes(dry_run=True)

    assert manager.get_notes(PROJECT_A)["content"] == before
    assert results[0]["sections_dropped"] == 1
    assert manual in results[0]["notes_preview"]


def test_migration_preserves_human_prose(manager):
    manual = "Deal team: FRA-based, effective 1 June 2026."
    manager.update_notes(PROJECT_A, _section("c1", "01_MSA.pdf", "generated") + "\n\n---\n\n" + manual)
    _add_memory(manager, PROJECT_A, "c1", "01_MSA.pdf")

    manager.migrate_scratchpads_to_notes(dry_run=False)
    content = manager.get_notes(PROJECT_A)["content"]

    assert content == manual
    assert "generated" not in content
    assert "pm:section" not in content


def test_migration_keeps_a_section_whose_record_is_missing(manager):
    """Dropping a generated section is only safe because it can be rebuilt. If
    the record is gone it cannot be, so the section is kept as prose instead."""
    manager.update_notes(PROJECT_A, _section("orphan", "99_Ghost.pdf", "irreplaceable"))

    manager.migrate_scratchpads_to_notes(dry_run=False)
    content = manager.get_notes(PROJECT_A)["content"]

    assert "irreplaceable" in content


def test_migration_is_idempotent(manager):
    manual = "Notes that must survive twice."
    manager.update_notes(PROJECT_A, _section("c1", "01_MSA.pdf") + "\n\n---\n\n" + manual)
    _add_memory(manager, PROJECT_A, "c1", "01_MSA.pdf")

    manager.migrate_scratchpads_to_notes(dry_run=False)
    first = manager.get_notes(PROJECT_A)["content"]
    manager.migrate_scratchpads_to_notes(dry_run=False)

    assert manager.get_notes(PROJECT_A)["content"] == first == manual


# --------------------------------------------------------------------- misc ---

def test_project_memory_writes_no_vectors(manager):
    """Phase 0 removed the embedding write: the scratchpad was stored as a
    single document smaller than the splitter's chunk size, so retrieval could
    only ever return the one chunk it had just written."""
    assert not hasattr(manager, "_reembed_scratchpad")

    result = manager.update_notes(PROJECT_A, "Some notes.")
    assert "vectorized" not in result
    assert "vector_error" not in result
