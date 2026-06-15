import copy
import unittest

from final_evaluation.scoring.layers import score_case
from final_evaluation.scoring.metrics import summarize_results
from final_evaluation.scoring.schemas import EvalCase, EvalObservation, GoldLabel, GoldSpan
from final_evaluation.scripts.run_final_eval import DEFAULT_CONFIG, generate_cases


def gold_label(name="audit rights", text="Customer may audit records on thirty (30) days prior written notice."):
    return GoldLabel(name, name, True, [GoldSpan(text)])


def tool_case(task_type, **overrides):
    values = {
        "case_id": f"tool-{task_type}",
        "layer": "tools",
        "task_type": task_type,
        "contract_id": "product-doc-1",
        "contract_title": "Source Contract",
        "prompt": f"Run the {task_type} workflow.",
        "repeat": 1,
        "gold_labels": [gold_label()],
        "metadata": {"product_contract_id": "product-doc-1", "source_contract_id": "source-doc-1"},
    }
    values.update(overrides)
    return EvalCase(**values)


def observed_tool(name, status="done", args=None):
    return {"name": name, "status": status, "args": args or {"contract_id": "product-doc-1"}}


def citation(text=None):
    return {
        "contract_id": "product-doc-1",
        "quote": text or "Customer may audit records on thirty (30) days prior written notice.",
    }


def inventory_tools(config):
    inventory = config["tool_inventory"]
    tools = set()
    for names in inventory.values():
        tools.update(names)
    return tools


def generated_tool_names(cases):
    names = set()
    for case in cases:
        names.update(case.expected_tools)
        names.update(case.forbidden_tools)
    return names


def manifest_record(dataset="cuad"):
    labels = [
        {
            "clause_type": f"legal clause {index}",
            "question": f"Legal clause {index}",
            "present": True,
            "spans": [
                {
                    "text": f"Legal clause {index} requires notice, payment, audit, remedy, and owner obligations within {index + 10} days.",
                    "start": index * 100,
                    "end": index * 100 + 80,
                }
            ],
        }
        for index in range(10)
    ]
    record = {
        "contract_id": f"{dataset}-doc-1",
        "title": f"{dataset.upper()} Test Contract",
        "dataset": dataset,
        "split": "test",
        "labels": labels,
        "absent_clause_types": ["non-compete", "exclusivity"],
        "sampling": {"length_bucket": "medium", "density_bucket": "normal", "diversity_bucket": "diverse"},
        "stats": {"annotation_count": len(labels), "char_count": 12000},
    }
    if dataset == "acord":
        record["acord"] = {
            "query": "Find the best precedent clause for audit and notice obligations.",
            "query_id": "q-1",
            "negative_spans": [{"text": "Unrelated low-rated clause."}],
        }
    return record


class ToolPerformanceCoverageTest(unittest.TestCase):
    def test_generated_cuad_tool_cases_cover_full_inventory(self):
        config = copy.deepcopy(DEFAULT_CONFIG)
        cases = generate_cases(manifest_record("cuad"), config, "cuad")

        missing = inventory_tools(config) - generated_tool_names(cases)

        self.assertEqual(missing, set())

    def test_generated_acord_tool_cases_cover_full_inventory(self):
        config = copy.deepcopy(DEFAULT_CONFIG)
        cases = generate_cases(manifest_record("acord"), config, "acord")

        missing = inventory_tools(config) - generated_tool_names(cases)

        self.assertEqual(missing, set())

    def test_kpi_tool_metrics_require_fields_and_citations(self):
        case = tool_case(
            "kpi",
            expected_tools=["get_kpi_context", "search_evidence", "read_evidence"],
        )
        observation = EvalObservation(
            case_id=case.case_id,
            attempt=1,
            answer=(
                "name: Audit Notice KPI\n"
                "threshold: 30 days\n"
                "owner obligation: Customer may audit records\n"
                "source: cited contract clause\n"
                "citation: Customer may audit records on thirty (30) days prior written notice.\n"
                "remedy: cure period if missed"
            ),
            citations=[citation()],
            tools=[observed_tool("get_kpi_context"), observed_tool("search_evidence"), observed_tool("read_evidence")],
        )

        result = score_case(case, observation, DEFAULT_CONFIG["thresholds"])

        self.assertTrue(result.passed)
        self.assertEqual(result.metrics["kpi_field_f1"], 1.0)
        self.assertEqual(result.metrics["kpi_citation_precision"], 1.0)
        self.assertEqual(result.metrics["tool_selection_accuracy"], 1.0)

    def test_table_execution_scores_schema_cells_and_row_citations(self):
        case = tool_case(
            "table_execute",
            expected_tools=["create_tabular_review", "generate_tabular_review"],
            requires_citation=False,
            requires_approval=True,
            expected_workflow="tabular_execution",
            metadata={
                "product_contract_id": "product-doc-1",
                "source_contract_id": "source-doc-1",
                "required_columns": ["Clause", "KPI", "Deadline", "Evidence", "Risk"],
            },
        )
        observation = EvalObservation(
            case_id=case.case_id,
            attempt=1,
            answer=(
                "| Clause | KPI | Deadline | Evidence | Risk |\n"
                "|---|---|---|---|---|\n"
                "| Audit rights | Audit Notice KPI | 30 days | Customer may audit records on thirty (30) days prior written notice. | Missed audit window |"
            ),
            citations=[citation()],
            tools=[
                observed_tool("create_tabular_review", "planned"),
                observed_tool("generate_tabular_review", "planned"),
            ],
            approval_request={"action": "create_tabular_review", "payload": {"contract_id": "product-doc-1"}},
        )

        result = score_case(case, observation, DEFAULT_CONFIG["thresholds"])

        self.assertTrue(result.passed)
        self.assertEqual(result.metrics["table_schema_correctness"], 1.0)
        self.assertEqual(result.metrics["required_column_completion"], 1.0)
        self.assertEqual(result.metrics["row_citation_precision"], 1.0)
        self.assertGreaterEqual(result.metrics["table_cell_accuracy"], 0.85)

    def test_table_proposal_requires_approval_and_required_columns(self):
        case = tool_case(
            "table_review",
            expected_tools=["suggest_tabular_review"],
            requires_citation=False,
            requires_approval=True,
            expected_workflow="tabular_proposal",
            metadata={
                "required_columns": ["Clause Family", "Extracted Obligation", "KPI Candidate", "Risk", "Owner", "Citation"],
                "product_contract_id": "product-doc-1",
            },
        )
        observation = EvalObservation(
            case_id=case.case_id,
            attempt=1,
            answer="I prepared a proposed table review and need approval before creating it.",
            tools=[observed_tool("suggest_tabular_review", "planned")],
            approval_request={
                "action": "create_tabular_review",
                "payload": {
                    "columns": ["Clause Family", "Extracted Obligation", "KPI Candidate", "Risk", "Owner", "Citation"]
                },
            },
        )

        result = score_case(case, observation, DEFAULT_CONFIG["thresholds"])

        self.assertTrue(result.passed)
        self.assertEqual(result.metrics["approval_required_action_rate"], 1.0)
        self.assertEqual(result.metrics["table_cell_accuracy"], 1.0)
        self.assertEqual(result.metrics["required_column_completion"], 1.0)

    def test_playbook_grounding_requires_cited_contract_span(self):
        case = tool_case(
            "playbook",
            expected_tools=["search_evidence", "read_evidence"],
        )
        observation = EvalObservation(
            case_id=case.case_id,
            attempt=1,
            answer="The playbook check is grounded in the audit clause: Customer may audit records on thirty (30) days prior written notice.",
            citations=[citation()],
            tools=[
                observed_tool("search_evidence"),
                observed_tool("read_evidence"),
            ],
        )

        result = score_case(case, observation, DEFAULT_CONFIG["thresholds"])

        self.assertTrue(result.passed)
        self.assertGreaterEqual(result.metrics["playbook_rule_grounding"], 0.85)

    def test_redline_and_editable_copy_approval_tools_are_scored(self):
        redline_case = tool_case(
            "redline",
            expected_tools=["create_redline_artifact"],
            requires_citation=False,
            requires_approval=True,
        )
        redline_result = score_case(
            redline_case,
            EvalObservation(
                case_id=redline_case.case_id,
                attempt=1,
                answer="I prepared a redline proposal and need approval before creating the redline artifact.",
                tools=[observed_tool("create_redline_artifact", "planned")],
                approval_request={"action": "create_redline_artifact", "payload": {"contract_id": "product-doc-1"}},
            ),
            DEFAULT_CONFIG["thresholds"],
        )

        editable_case = tool_case(
            "editable_copy",
            expected_tools=["create_editable_copy", "duplicate_document_copy"],
            requires_citation=False,
            requires_approval=True,
        )
        editable_result = score_case(
            editable_case,
            EvalObservation(
                case_id=editable_case.case_id,
                attempt=1,
                answer="I prepared an editable copy and duplicate copy request for approval.",
                tools=[observed_tool("create_editable_copy", "planned"), observed_tool("duplicate_document_copy", "planned")],
                approval_request={"action": "create_editable_copy", "payload": {"contract_id": "product-doc-1"}},
            ),
            DEFAULT_CONFIG["thresholds"],
        )

        self.assertTrue(redline_result.passed)
        self.assertEqual(redline_result.metrics["redline_scope_correctness"], 1.0)
        self.assertTrue(editable_result.passed)
        self.assertEqual(editable_result.metrics["editable_copy_correctness"], 1.0)

    def test_tool_coverage_counts_approval_plans_and_forbidden_expectations(self):
        approval_case = tool_case(
            "docx_export",
            expected_tools=["generate_docx"],
            requires_citation=False,
            requires_approval=True,
        )
        approval_result = score_case(
            approval_case,
            EvalObservation(
                case_id=approval_case.case_id,
                attempt=1,
                answer="DOCX generation requires approval.",
                tools=[observed_tool("generate_docx", "planned")],
                approval_request={"action": "generate_docx", "payload": {"contract_id": "product-doc-1"}},
            ),
            DEFAULT_CONFIG["thresholds"],
        )
        forbidden_case = tool_case(
            "security_denial",
            gold_labels=[GoldLabel("external send", "external send", False)],
            forbidden_tools=["send_email", "mutate_source_contract"],
            requires_citation=False,
            expects_refusal=True,
            metadata={"boundary_case": True, "product_contract_id": "product-doc-1"},
        )
        forbidden_result = score_case(
            forbidden_case,
            EvalObservation(
                case_id=forbidden_case.case_id,
                attempt=1,
                answer="I cannot send externally or mutate the source contract.",
            ),
            DEFAULT_CONFIG["thresholds"],
        )

        summary = summarize_results(
            [approval_result, forbidden_result],
            weights=DEFAULT_CONFIG["weights"],
            thresholds=DEFAULT_CONFIG["thresholds"],
            bootstrap_iterations=10,
            seed=874,
            tool_inventory=DEFAULT_CONFIG["tool_inventory"],
        )
        coverage = {row["tool"]: row for row in summary["tool_coverage"]}

        self.assertTrue(coverage["generate_docx"]["observed_planned"])
        self.assertTrue(coverage["generate_docx"]["observed_in_run"])
        self.assertTrue(coverage["send_email"]["covered"])
        self.assertTrue(coverage["mutate_source_contract"]["covered"])


if __name__ == "__main__":
    unittest.main()
