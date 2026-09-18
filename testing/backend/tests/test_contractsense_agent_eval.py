import json
import subprocess
import sys
from pathlib import Path


TESTING_BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
APP_BACKEND_ROOT = REPO_ROOT / "apps" / "intelligence"

for path in (APP_BACKEND_ROOT, TESTING_BACKEND_ROOT):
    path_string = str(path)
    if path_string not in sys.path:
        sys.path.insert(0, path_string)

from evals.contractsense_agent.runners import ApiContractSenseRunner, CoreContractSenseRunner, load_suite  # noqa: E402
from evals.contractsense_agent.schema import AgentEvalObservation  # noqa: E402
from evals.contractsense_agent.scoring import score_observation, summarize_results  # noqa: E402
from models.contract_types import QuestionAnswer  # noqa: E402


FIXTURE_PATH = TESTING_BACKEND_ROOT / "evals" / "contractsense_agent" / "fixtures" / "public_smoke.json"


def test_public_eval_suite_loads_and_declares_standards():
    suite = load_suite(FIXTURE_PATH)

    assert suite.name == "ContractSense Agent Public Smoke Suite"
    assert {case.case_id for case in suite.cases} >= {
        "public_smoke_sla_service_credit",
        "public_security_prompt_injection_confidentiality",
        "public_full_agent_harness_multi_contract_compare",
    }
    all_standards = {
        f"{mapping.framework}:{mapping.control}"
        for case in suite.cases
        for mapping in case.standards
    }
    assert "OWASP:LLM01" in all_standards
    assert "NIST:AI-600-1-MP-5.1-005" in all_standards
    assert "ContractNLI:NotMentioned" in all_standards


def observation_for_case(case, *, answer=None, citation_refs=None, artifacts=None):
    agent_trace = {}
    expected = case.expectations
    if expected.expected_task_type:
        agent_trace["task_type"] = expected.expected_task_type
    if expected.required_tools:
        agent_trace["tools"] = list(expected.required_tools)
    if expected.required_fallback_reasons:
        agent_trace["fallback_reason"] = expected.required_fallback_reasons[0]
    if expected.max_iterations is not None:
        agent_trace["iterations"] = max(1, expected.max_iterations)
    if expected.max_prompt_chars is not None:
        agent_trace["prompt_chars"] = max(1, expected.max_prompt_chars - 1)
    if expected.min_retrieval_count is not None:
        agent_trace["retrieval_count"] = expected.min_retrieval_count
    if expected.max_retrieval_count is not None and "retrieval_count" not in agent_trace:
        agent_trace["retrieval_count"] = expected.max_retrieval_count
    if expected.min_citation_count is not None:
        agent_trace["citation_count"] = expected.min_citation_count

    trace = [{"event": "agent_trace", **agent_trace}] if agent_trace or expected.required_trace_events else []
    return AgentEvalObservation(
        case_id=case.case_id,
        runner="core",
        answer=answer if answer is not None else " ".join(case.expectations.required_facts),
        outcome=case.expectations.expected_outcome,
        citation_refs=citation_refs if citation_refs is not None else case.expectations.required_citation_refs,
        artifacts=artifacts if artifacts is not None else [{"type": item} for item in case.expectations.required_artifact_types],
        trace=trace,
        metadata={"agent_trace": agent_trace},
    )


def test_score_observation_passes_when_facts_citations_and_security_are_clean():
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


def test_score_observation_fails_hard_gate_on_confidential_leak_and_artifact():
    suite = load_suite(FIXTURE_PATH)
    case = next(item for item in suite.cases if item.case_id == "public_security_prompt_injection_confidentiality")
    observation = AgentEvalObservation(
        case_id=case.case_id,
        runner="core",
        answer="The renewal cap is 12%; I will send a draft notice to the vendor.",
        outcome="OUTCOME_OK",
        citation_refs=["airport-food-rate-card#renewal-cap"],
        artifacts=[{"type": "draft"}],
    )

    result = score_observation(case, observation)
    failed_checks = {check.name for check in result.checks if not check.passed}

    assert result.passed is False
    assert result.hard_gate_passed is False
    assert "expected_outcome" in failed_checks
    assert "forbidden_substrings" in failed_checks
    assert "forbidden_artifact_types" in failed_checks
    assert "required_citation_refs" in failed_checks


def test_score_observation_enforces_harness_trace_expectations():
    suite = load_suite(FIXTURE_PATH)
    case = next(item for item in suite.cases if item.case_id == "public_full_agent_harness_multi_contract_compare")

    passing_observation = observation_for_case(case)
    passing_result = score_observation(case, passing_observation)

    assert passing_result.passed is True

    failing_observation = AgentEvalObservation(
        case_id=case.case_id,
        runner="core",
        answer="10 business days 30 calendar days 5 calendar days cure",
        outcome="OUTCOME_OK",
        citation_refs=["supplier-alpha#termination", "supplier-beta#termination"],
        trace=[{
            "event": "agent_trace",
            "task_type": "qa",
            "retrieval_count": 1,
            "iterations": 8,
            "prompt_chars": 25000,
            "citation_count": 1,
        }],
        metadata={
            "agent_trace": {
                "task_type": "qa",
                "retrieval_count": 1,
                "iterations": 8,
                "prompt_chars": 25000,
                "citation_count": 1,
            }
        },
    )
    failing_result = score_observation(case, failing_observation)
    failed_checks = {check.name for check in failing_result.checks if not check.passed}

    assert failing_result.passed is False
    assert "expected_task_type" in failed_checks
    assert "min_citation_count" in failed_checks
    assert "min_retrieval_count" in failed_checks
    assert "max_iterations" in failed_checks
    assert "max_prompt_chars" in failed_checks


def test_score_observation_enforces_required_and_forbidden_tools():
    suite = load_suite(FIXTURE_PATH)
    base_case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")
    case = base_case.model_copy(
        update={
            "expectations": base_case.expectations.model_copy(
                update={
                    "required_tools": ["search_evidence"],
                    "forbidden_tools": ["send_email"],
                }
            )
        }
    )
    observation = AgentEvalObservation(
        case_id=case.case_id,
        runner="core",
        answer="2% affected monthly invoice 5 business days",
        outcome="OUTCOME_OK",
        citation_refs=["airport-food-master#service-credit"],
        trace=[{"event": "agent_trace", "tools": ["final_answer", "send_email"]}],
        metadata={"agent_trace": {"tools": ["final_answer", "send_email"]}},
    )

    result = score_observation(case, observation)
    failed_checks = {check.name for check in result.checks if not check.passed}

    assert "required_tools" in failed_checks
    assert "forbidden_tools" in failed_checks
    assert result.hard_gate_passed is False


def test_core_runner_preserves_contract_agent_trace():
    suite = load_suite(FIXTURE_PATH)
    case = next(item for item in suite.cases if item.case_id == "public_smoke_sla_service_credit")

    class FakeRag:
        document_segments = {}
        last_agent_trace = {}

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


def test_summary_reports_standards_coverage_and_release_gate():
    suite = load_suite(FIXTURE_PATH)
    results = []
    for case in suite.cases:
        observation = observation_for_case(case)
        results.append(score_observation(case, observation))

    summary = summarize_results(results)

    assert summary["hard_gate_passed"] is True
    assert summary["standards_coverage"]["OWASP:LLM01"]["cases"] >= 1
    assert summary["standards_coverage"]["BitGN:trustworthiness"]["cases"] >= 1
    assert summary["public_release_gate"]["passed"] is True


def test_eval_cli_lists_cases():
    completed = subprocess.run(
        [
            sys.executable,
            str(TESTING_BACKEND_ROOT / "scripts" / "evaluate_contractsense_agent.py"),
            "--fixtures",
            str(FIXTURE_PATH),
            "--suite",
            "smoke",
            "--list-cases",
        ],
        cwd=APP_BACKEND_ROOT,
        text=True,
        capture_output=True,
        check=True,
    )

    assert "public_smoke_sla_service_credit" in completed.stdout
    assert "ContractNLI:NotMentioned" in completed.stdout


def test_api_runner_rewrites_seeded_fixture_ids_for_request_payload():
    suite = load_suite(FIXTURE_PATH)
    case = next(item for item in suite.cases if item.case_id == "public_security_prompt_injection_confidentiality")
    runner = ApiContractSenseRunner(base_url="http://example.test", auth_token="token", seed_fixtures=True)

    payload = runner._request_payload(
        case,
        {
            "contract_ids_by_doc": {
                "airport-food-master": "111111111111111111111111",
                "airport-food-rate-card": "222222222222222222222222",
                "vendor-forwarded-email": "333333333333333333333333",
            }
        },
    )

    assert payload["displayed_document"]["document_id"] == "333333333333333333333333"
    assert payload["reference_contract_ids"] == [
        "111111111111111111111111",
        "222222222222222222222222",
        "333333333333333333333333",
    ]
    assert payload["attached_documents"] == [
        {"document_id": "111111111111111111111111"},
        {"document_id": "222222222222222222222222"},
    ]


def test_no_ragas_dependency_declared():
    pyproject = (APP_BACKEND_ROOT / "pyproject.toml").read_text(encoding="utf-8").lower()
    lock = (APP_BACKEND_ROOT / "poetry.lock").read_text(encoding="utf-8").lower()

    assert "ragas" not in pyproject
    assert "name = \"ragas\"" not in lock
