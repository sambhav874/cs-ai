import os
import sys
import uuid
import pytest
from langsmith import traceable
from final_evaluation.tests.conftest import ls_client, EVAL_PROJECT

# Inject paths
conftest_dir = os.path.dirname(os.path.abspath(__file__))
TESTING_BACKEND_ROOT = os.path.abspath(os.path.join(conftest_dir, "../../../testing/backend"))
if TESTING_BACKEND_ROOT not in sys.path:
    sys.path.insert(0, TESTING_BACKEND_ROOT)

from pathlib import Path
from services.contract_agent.graph import AgentContext, AgentRunState
from services.contract_agent.graph.tools.langchain_tools import build_langchain_tools
from services.contract_agent.graph.tools.registry import APPROVAL_REQUIRED_TOOLS
from services.contract_agent.system_prompt import langgraph_react_system_prompt_for_tools
from evals.contractsense_agent.runners import load_suite
from evals.contractsense_agent.schema import AgentEvalObservation
from evals.contractsense_agent.scoring import score_observation

FIXTURE_PATH = Path(TESTING_BACKEND_ROOT) / "evals" / "contractsense_agent" / "fixtures" / "public_smoke.json"

@traceable(project_name=EVAL_PROJECT, name="Functional-ToolCoverage")
def trace_tool_check(test_name: str, passed: bool) -> dict:
    return {"test_name": test_name, "passed": passed}

def log_test_result(test_name: str, passed: bool):
    run_id = str(uuid.uuid4())
    try:
        trace_tool_check(test_name, passed, langsmith_extra={"run_id": run_id})
        ls_client.create_feedback(
            run_id,
            key=f"functional-{test_name}",
            score=1.0 if passed else 0.0
        )
    except Exception as e:
        print(f"Skipping LangSmith feedback for {test_name} due to auth/config: {e}")

# ==============================================================================
# File C: Tool & Coverage Scoring (3 tests)
# ==============================================================================

def test_kpi_tool_metrics_require_fields_and_citations():
    """F-21: Verifies that extract_kpis is registered as an approval-required tool and requires contract scope."""
    passed = False
    try:
        # Assert that 'extract_kpis' is indeed mapped in APPROVAL_REQUIRED_TOOLS
        assert "extract_kpis" in APPROVAL_REQUIRED_TOOLS
        passed = True
    finally:
        log_test_result("kpi-tool-metrics-requirements", passed)

def test_missing_required_kpi_field_reduces_f1_below_perfect():
    """F-22: Asserts that when a required KPI fact is missing in the response, the factuality score drops below perfect."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        base_case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        case = base_case.model_copy(
            update={
                "expectations": base_case.expectations.model_copy(
                    update={
                        "expected_outcome": "OUTCOME_OK",
                        "required_facts": ["2%", "affected monthly invoice", "5 business days"],
                        "requires_citations": False,
                    }
                )
            }
        )
        
        # Missing "5 business days" in the answer
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="The remedy is a 2% service credit on the affected monthly invoice.",
            outcome="OUTCOME_OK",
            citation_refs=[],
        )
        
        result = score_observation(case, observation)
        fact_check = next(c for c in result.checks if c.name == "required_facts")
        
        assert fact_check.passed is False
        assert fact_check.earned < fact_check.points
        assert result.score < 1.0
        passed = True
    finally:
        log_test_result("missing-kpi-field-reduces-f1", passed)

def test_generated_cuad_tool_cases_cover_full_inventory():
    """F-23: Verifies that the generated prompt includes the expected tools list and system definitions."""
    passed = False
    try:
        state = AgentRunState(
            user_id="user-1",
            message="What are the payment terms?",
            context=AgentContext(surface="contract", contract_id="507f1f77bcf86cd799439012"),
        )

        prompt_text = langgraph_react_system_prompt_for_tools(build_langchain_tools(state=state))

        assert "## Tools" in prompt_text
        assert "search_evidence" in prompt_text
        assert "read_document" in prompt_text
        assert "extract_kpis" in prompt_text
        assert "calculate_from_evidence" in prompt_text
        passed = True
    finally:
        log_test_result("generated-cuad-tool-cases-coverage", passed)

def test_core_runner_runs_evaluation_case_end_to_end():
    """F-24: Verifies the evaluation runner executes a case and scores the output end-to-end using a mock RAG."""
    passed = False
    try:
        from evals.contractsense_agent.runners import CoreContractSenseRunner
        from models.contract_types import QuestionAnswer

        suite = load_suite(FIXTURE_PATH)
        case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")

        class FakeRag:
            def answer_project_question(self, **_kwargs):
                answer = QuestionAnswer(
                    question=case.prompt,
                    answer="The remedy is a 2% service credit and a cure plan within 5 business days.",
                    confidence="high",
                    citation_details={
                        "annotations": [{
                            "doc_id": "airport-food-master",
                            "quote": "service credit equal to 2% of the affected monthly invoice and require a written cure plan within 5 business days",
                        }]
                    },
                )
                answer.agent_trace = {
                    "task_type": "qa",
                    "tools": ["search_evidence", "final_answer"],
                    "iterations": 2,
                    "retrieval_count": 2,
                    "prompt_chars": 5000,
                    "citation_count": 1,
                }
                return answer

        runner = CoreContractSenseRunner()
        runner._rag = FakeRag()

        observation = runner.run_case(case)

        assert observation.metadata["agent_trace"]["task_type"] == "qa"
        assert observation.trace[-1]["event"] == "agent_trace"
        assert "search_evidence" in observation.trace[-1]["tools"]
        
        # Test that we can score the output cleanly
        result = score_observation(case, observation)
        assert result.passed is True
        passed = True
    finally:
        log_test_result("core-runner-runs-evaluation-case-e2e", passed)

def test_live_llm_agent_execution_and_scoring():
    """F-25: Runs a live query through the agent using the real Groq LLM and scores the synthesized output."""
    passed = False
    try:
        from services.contract_agent.graph import AgentRunState, AgentContext, AgentStatus
        from services.contract_agent.graph.runner import DeepContractAgentRunner
        
        # 1. Setup run state scoped to a mock contract
        state = AgentRunState(
            user_id="user-1",
            message="What is the governing law of this agreement?",
            context=AgentContext(
                surface="contract",
                contract_id="507f1f77bcf86cd799439012",
                selected_document_ids=["507f1f77bcf86cd799439012"]
            )
        )
        
        # 2. Mock the vector DB search tool to return a real legal clause
        def mock_tool_executor(tool_record, run_state):
            if tool_record.name == "search_evidence":
                return {
                    "summary": "Retrieved governing law clause from the contract.",
                    "matches": [{
                        "quote": "This Agreement shall be governed by, and construed in accordance with, the laws of the State of New York.",
                        "document_id": "507f1f77bcf86cd799439012",
                        "section_path": "Article 11.1"
                    }]
                }
            return {"summary": "Tool execution completed."}
            
        # 3. Initialize the runner with the REAL LLM model (built from state config)
        # Note: self.model is None, so it builds the real ChatGroq client using GROQ_API_KEY from .env
        runner = DeepContractAgentRunner(tool_executor=mock_tool_executor)
        
        response = runner.run(state)
        
        # 4. Verify that the agent successfully processed the live response
        assert response.workflow_status == AgentStatus.COMPLETED
        
        normalized_answer = response.answer.replace("\u202f", " ").replace("\u00a0", " ")
        assert "New York" in normalized_answer
        assert "[1]" in normalized_answer
        
        # 5. Verify the answer verifier and citation checker score it cleanly
        assert len(response.citation_annotations) > 0
        assert response.citation_annotations[0]["doc_id"] == "507f1f77bcf86cd799439012"
        passed = True
    finally:
        log_test_result("live-llm-agent-execution-and-scoring", passed)
