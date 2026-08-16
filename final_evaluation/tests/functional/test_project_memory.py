"""Project memory regression tests.

Covers the two bugs that made the agent answer "which documents relate to this
contract?" with documents from a different project while omitting half of its
own, plus the invariants the OKF restructure must not break.

Backed by mongomock so these are deterministic and never touch a real database.
"""

import os
import sys

import mongomock
import pytest

conftest_dir = os.path.dirname(os.path.abspath(__file__))
APP_BACKEND_ROOT = os.path.abspath(os.path.join(conftest_dir, "../../../apps/backend"))
if APP_BACKEND_ROOT not in sys.path:
    sys.path.insert(0, APP_BACKEND_ROOT)

from services.project_memory import ProjectMemoryManager  # noqa: E402

PROJECT_A = "6a7f8420355760378cc4db77"
PROJECT_B = "6a7f6729c16d4a678241ecde"


@pytest.fixture
def manager():
    client = mongomock.MongoClient()
    return ProjectMemoryManager(client["contract_core_db"])


def _section(contract_id: str, filename: str, body: str = "") -> str:
    return (
        f"<!-- pm:section:{contract_id} -->\n"
        f"## {filename} — sow\n{body}\n"
        f"<!-- /pm:section:{contract_id} -->"
    )


def test_search_returns_only_the_requested_projects_memory(manager):
    """The bug: a store bound to the whole vector collection, queried without a
    namespace filter, returned every project's memory to every project."""
    manager.update_scratchpad(PROJECT_A, _section("c1", "01_MSA_Solstice_Cobalt.pdf"))
    manager.update_scratchpad(PROJECT_B, _section("c2", "02_AnnexA_Services.pdf"))

    context_a = manager.search_project_memory(PROJECT_A, "which documents relate?")
    context_b = manager.search_project_memory(PROJECT_B, "which documents relate?")

    assert "01_MSA_Solstice_Cobalt.pdf" in context_a
    assert "02_AnnexA_Services.pdf" not in context_a
    assert "02_AnnexA_Services.pdf" in context_b
    assert "01_MSA_Solstice_Cobalt.pdf" not in context_b


def test_search_returns_none_when_project_has_no_scratchpad(manager):
    assert manager.search_project_memory(PROJECT_A, "anything") is None


def test_search_returns_none_for_a_whitespace_only_scratchpad(manager):
    manager.update_scratchpad(PROJECT_A, "   \n\n  ")
    assert manager.search_project_memory(PROJECT_A, "anything") is None


def test_whole_scratchpad_is_returned_untruncated(manager):
    """The old fixed 3500-char cap silently dropped whichever documents sorted
    last — the reason the agent missed half its own project."""
    sections = [
        _section(f"c{i}", f"{i:02d}_Document.pdf", "Purpose summary. " * 40)
        for i in range(1, 26)
    ]
    scratchpad = "\n\n---\n\n".join(sections)
    assert len(scratchpad) > 3500, "fixture must exceed the old cap to be meaningful"

    manager.update_scratchpad(PROJECT_A, scratchpad)
    context = manager.search_project_memory(PROJECT_A, "summarise the project")

    assert scratchpad.strip() in context
    for i in range(1, 26):
        assert f"{i:02d}_Document.pdf" in context


def test_context_for_agent_lists_every_successful_document(manager):
    """The chronological fallback is also uncapped; truncating it would drop the
    most recently uploaded documents."""
    for i in range(1, 31):
        manager.memories.insert_one({
            "project_id": PROJECT_A,
            "contract_id": f"c{i}",
            "filename": f"{i:02d}_Document.pdf",
            "doc_type": "sow",
            "purpose_summary": "Purpose summary. " * 20,
            "status": "success",
            "uploaded_at": f"2026-08-{i:02d}",
        })

    context = manager.build_project_context_for_agent(PROJECT_A)

    for i in range(1, 31):
        assert f"{i:02d}_Document.pdf" in context


def test_sync_preserves_human_prose_outside_the_markers(manager):
    """Manual prose lives only in the scratchpad text and is not derivable from
    the per-document records. Phase 1 of the OKF restructure has to migrate it,
    so this invariant is what guards against losing it."""
    manual = "Renewal is being negotiated verbally; nothing signed yet."
    manager.update_scratchpad(
        PROJECT_A, _section("c1", "01_MSA.pdf", "old body") + "\n\n---\n\n" + manual
    )

    manager._sync_scratchpad(PROJECT_A, "c1", "## 01_MSA.pdf — sow\nnew body")
    content = manager.get_scratchpad(PROJECT_A)["content"]

    assert manual in content
    assert "new body" in content
    assert "old body" not in content


def test_sync_appends_a_document_that_has_no_section_yet(manager):
    manager.update_scratchpad(PROJECT_A, _section("c1", "01_MSA.pdf"))
    manager._sync_scratchpad(PROJECT_A, "c2", "## 02_SOW.pdf — sow")

    content = manager.get_scratchpad(PROJECT_A)["content"]
    assert "01_MSA.pdf" in content
    assert "02_SOW.pdf" in content


def test_project_memory_writes_no_vectors(manager):
    """Phase 0 removed the embedding write: the scratchpad was stored as a
    single document smaller than the splitter's chunk size, so retrieval could
    only ever return the one chunk it had just written."""
    assert not hasattr(manager, "_reembed_scratchpad")

    result = manager.update_scratchpad(PROJECT_A, _section("c1", "01_MSA.pdf"))
    assert "vectorized" not in result
    assert "vector_error" not in result

    # No rag_system argument, and no vector backend reachable from mongomock —
    # this raising would mean an embedding call crept back in.
    manager._sync_scratchpad(PROJECT_A, "c1", "## 01_MSA.pdf — sow")
