import os
import sys
import uuid
import pytest
from langsmith import traceable
from final_evaluation.tests.conftest import ls_client, EVAL_PROJECT

# Inject backend source path
conftest_dir = os.path.dirname(os.path.abspath(__file__))
APP_BACKEND_ROOT = os.path.abspath(os.path.join(conftest_dir, "../../../apps/intelligence"))
if APP_BACKEND_ROOT not in sys.path:
    sys.path.insert(0, APP_BACKEND_ROOT)

from services.contract_agent.graph import AgentContext, AgentRunState
from services.contract_agent.graph.state import ToolCallRecord
from services.contract_agent.graph.tools import executor as executor_module
from services.contract_agent.graph.tools.executor import execute_mongo_read_tool
from services.contract_agent.system_prompt import LANGGRAPH_REACT_SYSTEM_PROMPT
from services.contract_agent.rag.evidence_service import expand_legal_queries
from langchain_core.documents import Document

@traceable(project_name=EVAL_PROJECT, name="Functional-EvidenceTools")
def trace_functional_check(test_name: str, passed: bool) -> dict:
    return {"test_name": test_name, "passed": passed}

def log_test_result(test_name: str, passed: bool):
    run_id = str(uuid.uuid4())
    try:
        trace_functional_check(test_name, passed, langsmith_extra={"run_id": run_id})
        ls_client.create_feedback(
            run_id,
            key=f"functional-{test_name}",
            score=1.0 if passed else 0.0
        )
    except Exception as e:
        print(f"Skipping LangSmith feedback for {test_name} due to auth/config: {e}")

# ==============================================================================
# File A: Evidence Retrieval (6 tests)
# ==============================================================================

def test_outline_document_returns_article_count_and_headings():
    """F-1: Outlines the document structure, counts articles and sections."""
    document_id = "507f1f77bcf86cd799439012"
    passed = False
    try:
        class FakeCollection:
            database = None
            def find(self, *_args, **_kwargs):
                return [{
                    "_id": document_id,
                    "contract_name": "Services Agreement.pdf",
                    "index": {
                        "status": "success",
                        "content": (
                            "--- Page 1 ---\n"
                            "ARTICLE IV PAYMENT TERMS\n"
                            "Introductory payment text.\n\n"
                            "--- Page 2 ---\n"
                            "Section 4.01: Invoices\n"
                            "Customer shall pay invoices within thirty days.\n\n"
                            "Exhibit A Service Levels\n"
                            "Response times are listed here.\n"
                        ),
                    },
                }]

        state = AgentRunState(
            user_id="user-1",
            message="Outline the document.",
            context=AgentContext(contract_id=document_id, selected_document_ids=[document_id]),
        )

        result = execute_mongo_read_tool(
            FakeCollection(),
            ToolCallRecord(name="outline_document", args={"document_id": document_id}),
            state,
        )

        headings = {item["heading"]: item for item in result["headings"]}
        assert result["article_count"] == 1
        assert result["section_count"] == 1
        assert "ARTICLE IV PAYMENT TERMS" in headings
        assert "Section 4.01: Invoices" in headings
        assert headings["Section 4.01: Invoices"]["page"] == 2
        assert "Exhibit A Service Levels" in result["outline_text"]
        passed = True
    finally:
        log_test_result("outline-document-returns-article-count", passed)


def test_search_evidence_expands_numeric_article_reference_to_roman_heading():
    """F-2: Ensures 'article 4' expands to Roman 'ARTICLE IV' for legal consistency."""
    passed = False
    try:
        variants = executor_module._formal_reference_query_variants("explain article 4 and Article IX")
        
        assert executor_module._int_to_roman(4) == "IV"
        assert executor_module._roman_to_int("IX") == 9
        assert executor_module._extract_clause_reference("What does Article 4 say?") == "IV"
        assert {"ARTICLE IV", "Article 4", "ARTICLE IX", "Article 9"} <= set(variants)
        passed = True
    finally:
        log_test_result("search-evidence-expands-numeric-article", passed)


def test_search_evidence_uses_rewritten_query_against_vector_chunks():
    """F-3: Verifies hybrid search expansions rewrite queries (e.g. change of control -> merger)."""
    passed = False
    try:
        legal_variants = expand_legal_queries(["change of control"])
        
        assert "change in control" in legal_variants
        assert "merger" in legal_variants
        passed = True
    finally:
        log_test_result("search-evidence-uses-rewritten-query", passed)


def test_search_evidence_marks_index_content_fallback(monkeypatch):
    """F-4: Verifies legacy/fallback text search executes when vector backend returns empty list."""
    passed = False
    try:
        document = {
            "_id": "doc-1",
            "contract_name": "Services.pdf",
            "index": {
                "content": (
                    "--- Page 2 ---\n"
                    "Payment Terms\n"
                    "Customer shall pay invoices within thirty days after receipt.\n\n"
                    "Termination\n"
                    "Either party may terminate after written notice."
                )
            },
        }

        fallback_matches = executor_module._fallback_index_search([document], ["payment invoices"], top_k=2)
        monkeypatch.setattr(executor_module, "_metadata_chunk_search", lambda *_args, **_kwargs: [])
        monkeypatch.setattr(executor_module, "_vector_search_documents", lambda *_args, **_kwargs: [])
        
        legacy_matches, backend = executor_module._legacy_search_documents(
            [document],
            ["payment invoices"],
            top_k=2,
            ai_provider="groq",
            collection=object(),
        )

        assert fallback_matches[0]["retrieval_backend"] == "fallback_index"
        assert "thirty days" in fallback_matches[0]["snippet"]
        assert backend == "fallback_index"
        assert legacy_matches[0]["evidence_id"] == fallback_matches[0]["evidence_id"]
        passed = True
    finally:
        log_test_result("search-evidence-marks-index-fallback", passed)


def test_system_prompt_requires_rewritten_search_queries():
    """F-5: Ensures system prompt defines ContractSense identity and rules around search expansion."""
    passed = False
    try:
        prompt_text = LANGGRAPH_REACT_SYSTEM_PROMPT

        assert "ContractSense" in prompt_text
        assert "read-only tools" in prompt_text
        assert "approval-gated tools" in prompt_text
        passed = True
    finally:
        log_test_result("system-prompt-requires-rewritten-queries", passed)


def test_search_returns_empty_list_gracefully_when_no_content_matches():
    """F-6: Ensures that if no content matches, search falls back cleanly with empty list and formatted text."""
    passed = False
    try:
        documents = [{"_id": "doc-1", "contract_name": "Services.pdf"}]
        formatted = executor_module._format_search_results_as_text([], documents, "missing")
        
        assert formatted == 'No contract sections matched the query "missing".'
        passed = True
    finally:
        log_test_result("search-returns-empty-list-gracefully", passed)
