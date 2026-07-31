"""Operational tests for serial run group orchestration and canonical case contracts."""

import pytest
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from final_evaluation.scripts.run_final_eval import (
    load_config,
    generate_cases,
    EXCLUDED_TASK_TYPES,
    EXCLUDED_TOOLS,
    DEFAULT_CONFIG,
    dry_run_observations,
    synthetic_observation,
)
from final_evaluation.scoring.schemas import EvalCase, EvalObservation


@pytest.mark.operational
def test_stable_case_id_generation():
    """Verify that case_id is deterministic, human-readable, and does not use Python hash()."""
    record = {
        "contract_id": "test_contract_001",
        "title": "Global Logistics Services Agreement",
        "dataset": "cuad",
        "present_all": [],
        "absent": [],
    }
    config = DEFAULT_CONFIG.copy()
    cases_a = generate_cases(record, config, "cuad")
    cases_b = generate_cases(record, config, "cuad")

    assert len(cases_a) > 0
    for ca, cb in zip(cases_a, cases_b):
        assert ca.case_id == cb.case_id, "Case ID must be deterministic across calls."
        assert not ca.case_id.isdigit(), "Case ID must be human-readable, not a raw integer hash."
        assert ca.case_id.startswith("cuad_") or ca.case_id.startswith("test_contract_001") or ":" in ca.case_id


@pytest.mark.operational
def test_excluded_workflows_rejection():
    """Verify prohibited workflows (playbook, docx generation, redlines) are strictly excluded from generated cases."""
    record = {
        "contract_id": "test_contract_002",
        "title": "Vendor Supply Agreement",
        "dataset": "cuad",
        "present_all": [],
        "absent": [],
    }
    config = DEFAULT_CONFIG.copy()
    cases = generate_cases(record, config, "cuad")

    for case in cases:
        assert case.task_type not in EXCLUDED_TASK_TYPES, f"Task type {case.task_type} is explicitly excluded."
        for expected_tool in case.expected_tools:
            assert expected_tool not in EXCLUDED_TOOLS, f"Tool {expected_tool} is explicitly excluded."


@pytest.mark.operational
def test_synthetic_observation_trace_completeness():
    """Verify synthetic dry-run observations contain complete structured trace events."""
    case = EvalCase(
        case_id="cuad:test:001",
        layer="pac1",
        task_type="clause_lookup",
        contract_id="contract_101",
        contract_title="Master Service Agreement",
        prompt="Find the governing law clause in the master service agreement.",
        repeat=1,
        expected_tools=["read_evidence"],
    )
    obs = synthetic_observation(case, attempt=1)

    assert obs.case_id == case.case_id
    assert isinstance(obs.trace, list)
    assert len(obs.trace) >= 4

    events = [event.get("event") for event in obs.trace]
    assert "agent_start" in events
    assert "middleware_guard" in events
    assert "prompt_sent" in events
    assert "tool_executed" in events
    assert "agent_completed" in events
