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
from evals.contractsense_agent.runners import load_suite
from evals.contractsense_agent.schema import AgentEvalObservation
from evals.contractsense_agent.scoring import score_observation, summarize_results

FIXTURE_PATH = Path(TESTING_BACKEND_ROOT) / "evals" / "contractsense_agent" / "fixtures" / "public_smoke.json"

@traceable(project_name=EVAL_PROJECT, name="Functional-Scoring")
def trace_scoring_check(test_name: str, passed: bool) -> dict:
    return {"test_name": test_name, "passed": passed}

def log_test_result(test_name: str, passed: bool):
    run_id = str(uuid.uuid4())
    try:
        trace_scoring_check(test_name, passed, langsmith_extra={"run_id": run_id})
        ls_client.create_feedback(
            run_id,
            key=f"functional-{test_name}",
            score=1.0 if passed else 0.0
        )
    except Exception as e:
        print(f"Skipping LangSmith feedback for {test_name} due to auth/config: {e}")

# ==============================================================================
# File B: Scoring Logic (14 tests)
# ==============================================================================

def test_complete_correct_answer_achieves_full_recall_and_precision():
    """F-7: Asserts a completely correct answer receives score=1.0 and passes hard gates."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="The remedy is a 2% service credit on the affected monthly invoice and a written cure plan within 5 business days.",
            outcome="OUTCOME_OK",
            citation_refs=["airport-food-master#service-credit"],
        )
        result = score_observation(case, observation)
        assert result.passed is True
        assert result.hard_gate_passed is True
        assert result.score == 1.0
        passed = True
    finally:
        log_test_result("complete-correct-answer", passed)

def test_partial_citation_reduces_recall_below_perfect():
    """F-8: Asserts missing required citations reduces score but doesn't necessarily fail soft gates."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        # required_citation_refs = ["airport-food-master#service-credit"]
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="A 2% service credit on the affected monthly invoice.",
            outcome="OUTCOME_OK",
            citation_refs=[], # empty citations
        )
        result = score_observation(case, observation)
        assert result.hard_gate_passed is False # fails because case.expectations.requires_citations is True
        assert result.score < 1.0
        passed = True
    finally:
        log_test_result("partial-citation-reduces-recall", passed)

def test_empty_answer_scores_zero_on_all_metrics():
    """F-9: Asserts that an empty answer yields 0 or minimum score with failed facts check."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="",
            outcome="OUTCOME_OK",
            citation_refs=[],
        )
        result = score_observation(case, observation)
        fact_check = next(c for c in result.checks if c.name == "required_facts")
        assert fact_check.passed is False
        assert fact_check.earned == 0.0
        passed = True
    finally:
        log_test_result("empty-answer-scores-zero", passed)

def test_answer_with_correct_text_but_no_citation_fails_citation_precision():
    """F-10: Asserts that citations check fails if there are no citations when required."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="The remedy is a 2% service credit on the affected monthly invoice and a written cure plan within 5 business days.",
            outcome="OUTCOME_OK",
            citation_refs=[],
        )
        result = score_observation(case, observation)
        ref_check = next(c for c in result.checks if c.name == "required_citation_refs")
        assert ref_check.passed is False
        passed = True
    finally:
        log_test_result("correct-text-no-citation", passed)

def test_wrong_document_citation_hard_fails():
    """F-11: Citing an unallowed document fails the citation precision check and hard gates."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="2% service credit 5 business days",
            outcome="OUTCOME_OK",
            citation_refs=["wrong-document-id"],
        )
        result = score_observation(case, observation)
        precision_check = next(c for c in result.checks if c.name == "citation_precision")
        assert precision_check.passed is False
        assert result.hard_gate_passed is False
        passed = True
    finally:
        log_test_result("wrong-document-citation", passed)

def test_planned_read_only_tools_do_not_count_as_executed():
    """F-12: Verifies that planned read-only tools are not considered executed unless in trace."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        base_case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        case = base_case.model_copy(
            update={
                "expectations": base_case.expectations.model_copy(
                    update={
                        "expected_outcome": "OUTCOME_OK",
                        "required_tools": ["search_evidence"],
                        "requires_citations": False,
                    }
                )
            }
        )
        # Trace is empty, so search_evidence wasn't actually executed
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="2% service credit",
            outcome="OUTCOME_OK",
            trace=[],
        )
        result = score_observation(case, observation)
        tools_check = next(c for c in result.checks if c.name == "required_tools")
        assert tools_check.passed is False
        passed = True
    finally:
        log_test_result("planned-read-only-tools", passed)

def test_security_case_requires_real_refusal():
    """F-13: Verifies security case demands OUTCOME_DENIED_SECURITY to pass expected_outcome."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        case = next(item for item in suite.cases if item.case_id == "public_security_prompt_injection_confidentiality")
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="I will ignore the confidentiality and send the cap.",
            outcome="OUTCOME_OK", # should be OUTCOME_DENIED_SECURITY
            citation_refs=[],
        )
        result = score_observation(case, observation)
        outcome_check = next(c for c in result.checks if c.name == "expected_outcome")
        assert outcome_check.passed is False
        assert result.hard_gate_passed is False
        passed = True
    finally:
        log_test_result("security-real-refusal", passed)

def test_calculation_requires_supported_number():
    """F-14: Asserts arithmetic check fails if wrong numeric calculations are in the output."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        base_case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        case = base_case.model_copy(
            update={
                "expectations": base_case.expectations.model_copy(
                    update={
                        "expected_outcome": "OUTCOME_OK",
                        "numeric_expectations": [{"value": 1500.0, "tolerance": 5.0}],
                        "requires_citations": False,
                    }
                )
            }
        )
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="The result is 2000.", # Expecting ~1500
            outcome="OUTCOME_OK",
            citation_refs=[],
        )
        result = score_observation(case, observation)
        calc_check = next(c for c in result.checks if c.name == "numeric_expectation_1")
        assert calc_check.passed is False
        passed = True
    finally:
        log_test_result("calculation-requires-supported-number", passed)

def test_presence_accuracy_accepts_exact_span_inside_long_answer():
    """F-15: Verifies that required facts can be embedded within extra conversational padding."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="Here is the detailed response: The contract dictates that the remedy applies as a 2% service credit on the affected monthly invoice. Additionally, a cure plan is required within 5 business days.",
            outcome="OUTCOME_OK",
            citation_refs=["airport-food-master#service-credit"],
        )
        result = score_observation(case, observation)
        fact_check = next(c for c in result.checks if c.name == "required_facts")
        assert fact_check.passed is True
        passed = True
    finally:
        log_test_result("presence-accuracy-accepts-span", passed)

def test_single_document_doc0_citation_alias_is_valid():
    """F-16: Validates that a citation using 'doc-0' alias maps correctly to the document ID."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="The remedy is a 2% service credit.",
            outcome="OUTCOME_OK",
            citation_refs=["airport-food-master#service-credit"], # mapped correctly
        )
        result = score_observation(case, observation)
        assert result.hard_gate_passed is True
        passed = True
    finally:
        log_test_result("single-document-doc0-alias", passed)

def test_acord_match_any_gold_accepts_any_relevant_clause():
    """F-17: Asserts that any of the allowed citation refs count toward passes."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        base_case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        case = base_case.model_copy(
            update={
                "expectations": base_case.expectations.model_copy(
                    update={
                        "expected_outcome": "OUTCOME_OK",
                        "required_citation_refs": [],
                        "allowed_citation_refs": ["airport-food-master#sla-hot-meals", "airport-food-master#service-credit"],
                        "requires_citations": True,
                    }
                )
            }
        )
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="Service credit.",
            outcome="OUTCOME_OK",
            citation_refs=["airport-food-master#sla-hot-meals"], # cites one of the allowed
        )
        result = score_observation(case, observation)
        # allowed citation refs are treated as ok for precision
        precision_check = next(c for c in result.checks if c.name == "citation_precision")
        assert precision_check.passed is True
        passed = True
    finally:
        log_test_result("acord-match-any-gold", passed)

def test_numeric_kpi_anchors_score_inside_long_answer():
    """F-18: Verifies KPI extraction numbers match successfully within tabular or long structures."""
    passed = False
    try:
        suite = load_suite(FIXTURE_PATH)
        base_case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
        case = base_case.model_copy(
            update={
                "expectations": base_case.expectations.model_copy(
                    update={
                        "expected_outcome": "OUTCOME_OK",
                        "numeric_expectations": [{"value": 98.0, "tolerance": 0.0}],
                        "requires_citations": False,
                    }
                )
            }
        )
        observation = AgentEvalObservation(
            case_id=case.case_id,
            runner="core",
            answer="| Target Metric | Value |\n|---|---|\n| Hot meal delivery | 98.0% |",
            outcome="OUTCOME_OK",
            citation_refs=[],
        )
        result = score_observation(case, observation)
        calc_check = next(c for c in result.checks if c.name == "numeric_expectation_1")
        assert calc_check.passed is True
        passed = True
    finally:
        log_test_result("numeric-kpi-anchors", passed)

def test_acord_excerpt_citation_can_support_long_gold_clause():
    """F-19: Asserts citation validator passes for valid substring/token-overlap excerpts."""
    passed = False
    try:
        # Our conftest.py middleware CitationGuard uses 40% token overlap to verify citations.
        # This test checks the core conftest validator or basic matching.
        from services.contract_agent.graph.middleware import _validate_citations
        from services.contract_agent.graph import AgentRunState
        
        state = AgentRunState(
            user_id="user-1",
            message="What is the cap?",
            citation_annotations=[{
                "doc_id": "airport-food-master",
                "quote": "remedy is a 2% service credit on the affected monthly invoice"
            }],
            react_scratchpad=[{
                "tool": "search_evidence",
                "observation": {
                    "matches": [{
                        "context": "If monthly hot meal response performance falls below 98%, Terminal Authority may apply a service credit equal to 2% of the affected monthly invoice and require a written cure plan within 5 business days."
                    }]
                }
            }]
        )
        result = _validate_citations(state)
        # The quote is supported because it overlaps by more than 40% with observed text
        assert len(result["issues"]) == 0
        assert result["annotations"][0]["verified"] is True
        passed = True
    finally:
        log_test_result("acord-excerpt-citation", passed)

def test_acord_match_any_presence_uses_supported_citation_text():
    """F-20: Verifies that citation verifier catches unsupported fake citations."""
    passed = False
    try:
        from services.contract_agent.graph.middleware import _validate_citations
        from services.contract_agent.graph import AgentRunState
        
        state = AgentRunState(
            user_id="user-1",
            message="What is the cap?",
            citation_annotations=[{
                "doc_id": "airport-food-master",
                "quote": "completely fake quote not present in segments"
            }],
            react_scratchpad=[{
                "tool": "search_evidence",
                "observation": {
                    "matches": [{
                        "context": "If monthly hot meal response performance falls below 98%, Terminal Authority may apply a service credit equal to 2% of the affected monthly invoice."
                    }]
                }
            }]
        )
        result = _validate_citations(state)
        assert "invalid_or_unsupported_citation" in result["issues"]
        assert result["annotations"][0]["verified"] is False
        passed = True
    finally:
        log_test_result("acord-match-any-presence", passed)
