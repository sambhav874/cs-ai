"""Tests for the Phase 1.1 eval gate.

The gate's whole job is to fail the build on an agent regression, so the gate
itself needs coverage that runs without API keys — otherwise a broken comparator
silently passes everything and the "eval is green" signal means nothing.

Split by dependency:
  * metric computation and the comparator are pure functions -> tested directly
  * the fixture retriever and the suite file need no model -> tested directly
  * the live agent loop needs a provider key -> not tested here, run by CI's
    scheduled job via `make eval-agent`
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from evals.contractsense_agent.agent_runner import (
    FixtureRetriever,
    _is_unsupported_answer,
    build_fixture_tool_executor,
)
from evals.contractsense_agent.metrics import (
    CITATION_SUPPORT_FLOOR,
    compare_metrics,
    compute_metrics,
    format_markdown,
    percentile,
)
from evals.contractsense_agent.runners import load_suite
from evals.contractsense_agent.schema import (
    AgentEvalObservation,
    EvalCaseResult,
    EvalCheckResult,
)
from evals.contractsense_agent.scoring import score_observation


FIXTURE_PATH = (
    Path(__file__).resolve().parents[1]
    / "evals"
    / "contractsense_agent"
    / "fixtures"
    / "public_smoke.json"
)


def observation(**overrides) -> AgentEvalObservation:
    payload = {
        "case_id": "case-1",
        "runner": "agent",
        "answer": "The service credit is 2% of the affected monthly invoice [1].",
        "outcome": "OUTCOME_OK",
        "metadata": {"expected_outcome": "OUTCOME_OK"},
    }
    payload.update(overrides)
    return AgentEvalObservation(**payload)


def case_result(**overrides) -> EvalCaseResult:
    payload = {
        "case_id": "case-1",
        "suite": "smoke",
        "category": "contract_qa_extraction",
        "visibility": "public",
        "runner": "agent",
        "attempt": 1,
        "score": 1.0,
        "passed": True,
        "hard_gate_passed": True,
        "checks": [],
        "observation": observation(),
    }
    payload.update(overrides)
    return EvalCaseResult(**payload)


def facts_check(passed: bool) -> EvalCheckResult:
    return EvalCheckResult(
        name="required_facts",
        dimension="factuality",
        passed=passed,
        points=1.0,
        earned=1.0 if passed else 0.0,
    )


# ── Metric computation ────────────────────────────────────────────────────────


def test_percentile_uses_nearest_rank_without_numpy():
    values = [10.0, 20.0, 30.0, 40.0, 100.0]
    assert percentile(values, 0.50) == 30.0
    assert percentile(values, 0.95) == 100.0
    assert percentile([], 0.5) is None
    assert percentile([7.0], 0.95) == 7.0


def test_per_turn_metrics_divide_by_turns_not_cases():
    """A two-turn case making two model calls averages one per turn.

    Dividing by observation count instead would report 2.0 and hide exactly the
    improvement 1.2 is trying to produce.
    """
    metrics = compute_metrics(
        [
            case_result(observation=observation(turns=2, model_calls=2, tool_calls=4)),
            case_result(observation=observation(turns=1, model_calls=1, tool_calls=2)),
        ]
    )
    assert metrics["model_calls_per_turn"] == 1.0
    assert metrics["tool_calls_per_turn"] == 2.0
    assert metrics["counts"]["turns"] == 3


def test_citation_support_rate_comes_from_the_backend_verified_flag():
    metrics = compute_metrics(
        [
            case_result(observation=observation(emitted_citations=4, verified_citations=3)),
            case_result(observation=observation(emitted_citations=2, verified_citations=2)),
        ]
    )
    assert metrics["citation_support_rate"] == 0.833
    assert metrics["counts"]["citations_emitted"] == 6
    assert metrics["counts"]["citations_verified"] == 5


def test_unsupported_rate_excludes_cases_that_should_decline():
    """Declining is correct when the case expects it, so it must not be counted.

    The contract-NLI 'not mentioned' case is supposed to say the contract is
    silent. Counting that as an unsupported answer would push the metric up for
    doing the right thing.
    """
    metrics = compute_metrics(
        [
            case_result(
                observation=observation(
                    unsupported=True,
                    metadata={"expected_outcome": "OUTCOME_NONE_UNSUPPORTED"},
                )
            ),
            case_result(observation=observation(unsupported=True)),
            case_result(observation=observation(unsupported=False)),
        ]
    )
    assert metrics["counts"]["answerable_cases"] == 2
    assert metrics["unsupported_answer_rate"] == 0.5


def test_multi_turn_resolution_rate_scores_only_multi_turn_cases():
    metrics = compute_metrics(
        [
            case_result(observation=observation(turns=2), checks=[facts_check(True)]),
            case_result(observation=observation(turns=2), checks=[facts_check(False)]),
            # Single-turn: must not dilute the multi-turn metric either way.
            case_result(observation=observation(turns=1), checks=[facts_check(False)]),
        ]
    )
    assert metrics["counts"]["multi_turn_cases"] == 2
    assert metrics["multi_turn_resolution_rate"] == 0.5


def test_metrics_are_none_rather_than_zero_when_a_runner_reports_nothing():
    """A runner that does not populate telemetry must not look like a perfect zero."""
    metrics = compute_metrics([case_result()])
    assert metrics["model_calls_per_turn"] is None
    assert metrics["citation_support_rate"] is None
    assert metrics["multi_turn_resolution_rate"] is None


# ── The comparator: what actually fails the build ─────────────────────────────


def test_citation_support_regression_fails_the_build():
    """The plan's stated done-when condition for 1.1."""
    comparison = compare_metrics(
        {"citation_support_rate": 0.98},
        {"citation_support_rate": 0.80},
    )
    assert comparison["passed"] is False
    assert any("citation_support_rate" in item for item in comparison["regressions"])


def test_small_citation_support_movement_is_tolerated():
    comparison = compare_metrics(
        {"citation_support_rate": 0.98},
        {"citation_support_rate": 0.97},
    )
    assert comparison["passed"] is True
    assert comparison["regressions"] == []


def test_citation_support_below_the_floor_fails_without_any_baseline():
    """A branch with no baseline still cannot ship a broken citation pipeline."""
    comparison = compare_metrics(None, {"citation_support_rate": 0.10})
    assert comparison["has_baseline"] is False
    assert comparison["passed"] is False
    assert comparison["floor_failures"]


def test_no_baseline_and_healthy_citations_passes():
    comparison = compare_metrics(None, {"citation_support_rate": CITATION_SUPPORT_FLOOR})
    assert comparison["passed"] is True


def test_fewer_model_calls_is_an_improvement_not_a_regression():
    """1.2 halves model_calls_per_turn on purpose; the gate must not block it."""
    comparison = compare_metrics(
        {"model_calls_per_turn": 2.0, "citation_support_rate": 0.98},
        {"model_calls_per_turn": 1.0, "citation_support_rate": 0.98},
    )
    assert comparison["passed"] is True
    row = next(r for r in comparison["comparisons"] if r["metric"] == "model_calls_per_turn")
    assert row["verdict"] == "improvement"


def test_cost_regression_warns_but_does_not_fail():
    """Cost is reported for a human to judge; only quality blocks the build."""
    comparison = compare_metrics(
        {"model_calls_per_turn": 1.0, "citation_support_rate": 0.98},
        {"model_calls_per_turn": 2.0, "citation_support_rate": 0.98},
    )
    assert comparison["passed"] is True
    assert any("model_calls_per_turn" in item for item in comparison["warnings"])


def test_rising_unsupported_rate_is_a_regression_direction():
    comparison = compare_metrics(
        {"unsupported_answer_rate": 0.05},
        {"unsupported_answer_rate": 0.40},
    )
    row = next(r for r in comparison["comparisons"] if r["metric"] == "unsupported_answer_rate")
    assert row["verdict"] == "regression"


def test_markdown_report_names_the_failure():
    comparison = compare_metrics({"citation_support_rate": 0.98}, {"citation_support_rate": 0.5})
    markdown = format_markdown({"counts": {"cases": 3, "turns": 4}}, comparison)
    assert "FAILED" in markdown
    assert "citation_support_rate" in markdown


# ── Fixture retrieval, so the gate is hermetic ────────────────────────────────


def test_suite_file_loads_and_declares_multi_turn_coverage():
    """Metric 7 is only meaningful if the suite actually contains a follow-up."""
    suite = load_suite(FIXTURE_PATH)
    multi_turn = [case for case in suite.cases if case.follow_up_prompts]
    assert multi_turn, "the suite must contain at least one multi-turn case"
    for case in multi_turn:
        assert case.expectations.required_facts, (
            f"{case.case_id}: a multi-turn case needs required_facts, since the "
            "resolution metric is measured from that check"
        )


def test_fixture_retriever_ranks_the_relevant_section_first():
    suite = load_suite(FIXTURE_PATH)
    case = next(c for c in suite.cases if c.case_id == "public_smoke_sla_service_credit")
    matches = FixtureRetriever(case.documents).search("service credit remedy", top_k=5)
    assert matches
    assert matches[0]["section_ref"] == "airport-food-master#service-credit"


def test_fixture_retriever_scopes_to_requested_documents():
    suite = load_suite(FIXTURE_PATH)
    case = next(c for c in suite.cases if c.case_id == "public_full_kpi_service_credit_calculation")
    retriever = FixtureRetriever(case.documents)
    matches = retriever.search("invoice total", document_ids=["may-2026-invoice"], top_k=10)
    assert matches
    assert {match["document_id"] for match in matches} == {"may-2026-invoice"}


def test_fixture_executor_emits_evidence_ids_the_citation_pipeline_can_resolve():
    """react_runtime and middleware both key off `matches` entries carrying
    evidence_id/quote. If the fixture executor's shape drifts, the eval would
    report citation failures that production would not have."""
    suite = load_suite(FIXTURE_PATH)
    case = next(c for c in suite.cases if c.case_id == "public_smoke_sla_service_credit")
    executor = build_fixture_tool_executor(case)

    class Record:
        name = "search_evidence"
        args = {"query": "service credit"}

    class Ctx:
        selected_document_ids = ["airport-food-master"]

    class State:
        message = "What remedy applies?"
        context = Ctx()

    result = executor(Record(), State())
    assert result["matches"], "search must return evidence for a seeded query"
    match = result["matches"][0]
    for key in ("evidence_id", "document_id", "filename", "quote", "context", "page"):
        assert key in match, f"missing {key}; the citation pipeline reads it"
    assert "Evidence ID:" in result["search_results"]


def test_fixture_executor_reports_no_match_without_inventing_evidence():
    suite = load_suite(FIXTURE_PATH)
    case = next(c for c in suite.cases if c.case_id == "public_smoke_sla_service_credit")
    executor = build_fixture_tool_executor(case)

    class Record:
        name = "search_evidence"
        args = {"query": "zzzqqq nonexistent clause"}

    class Ctx:
        selected_document_ids = ["airport-food-master"]

    class State:
        message = "?"
        context = Ctx()

    result = executor(Record(), State())
    assert result["matches"] == []
    # react_runtime._has_evidence_content keys off this exact prefix to decide
    # whether a synthesis turn is warranted.
    assert result["summary"].startswith("No contract sections matched")


@pytest.mark.parametrize(
    "answer,expected",
    [
        ("The contract does not contain a force majeure clause.", True),
        ("I could not find any evidence of that.", True),
        ("Payment is due within 45 days [1].", False),
    ],
)
def test_unsupported_answer_detection(answer, expected):
    assert _is_unsupported_answer(answer) is expected


# ── Telemetry plumbed end to end ──────────────────────────────────────────────


def test_scoring_reads_model_call_ceiling_from_observation_telemetry():
    suite = load_suite(FIXTURE_PATH)
    case = next(c for c in suite.cases if c.case_id == "public_full_whole_contract_coverage")
    assert case.expectations.max_model_calls is not None

    over_budget = score_observation(case, observation(model_calls=99, turns=1))
    check = next(c for c in over_budget.checks if c.name == "max_model_calls")
    assert check.passed is False

    within_budget = score_observation(case, observation(model_calls=2, turns=1))
    check = next(c for c in within_budget.checks if c.name == "max_model_calls")
    assert check.passed is True


def test_agent_run_state_counts_model_calls_separately_from_iterations():
    """model_calls is the metric 1.2 moves; react_iterations cannot stand in for
    it, because the synthesis turn is a second model call inside one iteration."""
    from services.contract_agent.graph.state import AgentRunState

    state = AgentRunState(user_id="u", message="hello")
    assert state.model_calls == 0
    assert "model_calls" in AgentRunState.model_fields


def test_baseline_loader_tolerates_a_missing_or_broken_file(tmp_path):
    import sys

    scripts_dir = Path(__file__).resolve().parents[1] / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    from evaluate_contractsense_agent import load_baseline_metrics

    assert load_baseline_metrics(None) is None
    assert load_baseline_metrics(tmp_path / "nope.json") is None

    broken = tmp_path / "broken.json"
    broken.write_text("{not json", encoding="utf-8")
    assert load_baseline_metrics(broken) is None

    empty = tmp_path / "empty.json"
    empty.write_text(json.dumps({"summary": {}}), encoding="utf-8")
    assert load_baseline_metrics(empty) is None

    good = tmp_path / "good.json"
    good.write_text(
        json.dumps({"summary": {"metrics": {"citation_support_rate": 0.97}}}), encoding="utf-8"
    )
    assert load_baseline_metrics(good) == {"citation_support_rate": 0.97}
