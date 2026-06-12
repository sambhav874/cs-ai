"""Report writers for the final evaluation suite."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List

from .schemas import EvalReport, EvalResult


def write_reports(report: EvalReport, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    full_payload = report.to_dict(public_safe=False)
    public_payload = report.to_dict(public_safe=True)

    (output_dir / "final_eval_report.json").write_text(
        json.dumps(full_payload, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    _write_raw_responses(output_dir / "raw_responses.jsonl", report)
    (output_dir / "pitch_safe_report.md").write_text(
        render_pitch_safe_markdown(public_payload),
        encoding="utf-8",
    )
    (output_dir / "final_eval_summary.md").write_text(
        render_summary_markdown(full_payload),
        encoding="utf-8",
    )
    (output_dir / "parameter_scorecard.md").write_text(
        render_parameter_scorecard_markdown(full_payload),
        encoding="utf-8",
    )
    _write_parameter_scorecard_csv(output_dir / "parameter_scorecard.csv", full_payload)
    _write_csv(output_dir / "failure_taxonomy.csv", report.summary.get("failure_taxonomy", []))
    _write_csv(output_dir / "tool_coverage.csv", report.summary.get("tool_coverage", []))
    _write_metric_csv(output_dir / "kpi_results.csv", report, "kpi")
    _write_metric_csv(output_dir / "table_review_results.csv", report, "table_review")


def render_summary_markdown(payload: Dict[str, Any]) -> str:
    summary = payload["summary"]
    lines = [
        "# ContractSense Final Evaluation Summary",
        "",
        f"- Run ID: `{payload['run_id']}`",
        f"- Provider: `{payload['provider']}`",
        f"- Contracts: `{payload['contract_count']}`",
        f"- Overall score: `{summary.get('overall_score')}`",
        f"- Overall 95% CI by record: `{summary.get('overall_score_ci95')}`",
        f"- Overall 95% CI by attempt: `{summary.get('overall_score_ci95_attempt')}`",
        f"- Pitch ready: `{summary.get('pitch_ready')}`",
        f"- Hard gates passed: `{summary.get('hard_gate_passed')}`",
        f"- pass^k: `{summary.get('pass_k')}`",
        f"- p95 latency ms: `{(summary.get('latency') or {}).get('p95_ms')}`",
        "",
        "## Layers",
    ]
    for layer, layer_summary in (summary.get("by_layer") or {}).items():
        lines.extend(
            [
                f"### {layer}",
                f"- Score: `{layer_summary.get('score')}`",
                f"- 95% CI by record: `{layer_summary.get('score_ci95')}`",
                f"- 95% CI by attempt: `{layer_summary.get('score_ci95_attempt')}`",
                f"- pass^k: `{layer_summary.get('pass_k')}`",
                f"- Hard gates passed: `{layer_summary.get('hard_gate_passed')}`",
                "",
            ]
        )
    lines.extend(["## Top Failure Modes"])
    for row in summary.get("failure_taxonomy", [])[:20]:
        lines.append(f"- `{row['failure_mode']}`: {row['count']} (example `{row['example_case_id']}`)")
    lines.append("")
    return "\n".join(lines)


def render_parameter_scorecard_markdown(payload: Dict[str, Any]) -> str:
    summary = payload["summary"]
    methodology = payload.get("methodology") or {}
    thresholds = methodology.get("thresholds") or {}
    weights = methodology.get("weights") or {}
    latency = summary.get("latency") or {}
    lines = [
        "# ContractSense Parameter Scorecard",
        "",
        f"- Run ID: `{payload['run_id']}`",
        f"- Provider: `{payload['provider']}`",
        f"- Contracts: `{payload['contract_count']}`",
        f"- Layer weights: `{weights}`",
        "",
        "## Overall Parameters",
        "",
        "| Parameter | Value | Threshold | Pass |",
        "|---|---:|---:|---:|",
    ]
    overall_rows = [
        ("overall_score", summary.get("overall_score"), _threshold_for(thresholds, "overall", "score")),
        ("pass_k", summary.get("pass_k"), _threshold_for(thresholds, "overall", "pass_k")),
        ("hard_gate_passed", summary.get("hard_gate_passed"), True),
        ("api_error_rate", summary.get("api_error_rate"), None),
        ("timeout_rate", summary.get("timeout_rate"), None),
        ("latency_p50_ms", latency.get("p50_ms"), None),
        ("latency_p95_ms", latency.get("p95_ms"), None),
        ("latency_max_ms", latency.get("max_ms"), None),
    ]
    for name, value in (summary.get("overall_metric_gates") or {}).items():
        overall_rows.append((name, value, _threshold_for(thresholds, "overall", name)))
    for name, value, threshold in overall_rows:
        lines.append(f"| `{name}` | {_display_gate(value)} | {_display_gate(threshold)} | {_pass_label(name, value, threshold)} |")

    lines.extend(["", "## Layer Parameters", ""])
    for layer, layer_summary in (summary.get("by_layer") or {}).items():
        lines.extend(
            [
                f"### {layer}",
                "",
                "| Parameter | Value | Threshold | Pass |",
                "|---|---:|---:|---:|",
                f"| `layer_score` | {layer_summary.get('score')} | {_display_gate(_threshold_for(thresholds, layer, 'score'))} | {_pass_label('layer_score', layer_summary.get('score'), _threshold_for(thresholds, layer, 'score'))} |",
                f"| `pass_k` | {layer_summary.get('pass_k')} | {_display_gate(_threshold_for(thresholds, layer, 'pass_k'))} | {_pass_label('pass_k', layer_summary.get('pass_k'), _threshold_for(thresholds, layer, 'pass_k'))} |",
                f"| `hard_gate_passed` | {layer_summary.get('hard_gate_passed')} | True | {_pass_label('hard_gate_passed', layer_summary.get('hard_gate_passed'), True)} |",
                f"| `attempts` | {layer_summary.get('attempts')} | not_applicable | not_applicable |",
                f"| `cases` | {layer_summary.get('cases')} | not_applicable | not_applicable |",
            ]
        )
        for name, value in (layer_summary.get("metrics") or {}).items():
            threshold = _threshold_for(thresholds, layer, name)
            lines.append(f"| `{name}` | {_display_gate(value)} | {_display_gate(threshold)} | {_pass_label(name, value, threshold)} |")
        lines.append("")

    lines.extend(["## Failure Parameters", "", "| Failure mode | Count | Example case |", "|---|---:|---|"])
    for row in summary.get("failure_taxonomy", []):
        lines.append(f"| `{row.get('failure_mode')}` | {row.get('count')} | `{row.get('example_case_id')}` |")
    lines.append("")
    return "\n".join(lines)


def render_pitch_safe_markdown(payload: Dict[str, Any]) -> str:
    summary = payload["summary"]
    methodology = payload.get("methodology") or {}
    dataset_name = str(methodology.get("dataset") or "CUAD")
    latency = summary.get("latency") or {}
    gates = summary.get("overall_metric_gates") or {}
    transport_counts = methodology.get("transport_counts") or {}
    status_line = (
        "**Status: dry-run shakedown only. Do not publish as an official result.**"
        if methodology.get("dry_run") or summary.get("dry_run")
        else (
            "**Status: official Groq/product-API run.**"
            if methodology.get("official_run", str(payload.get("provider", "")).lower() == "groq")
            else "**Status: non-official provider comparison run. Do not publish as the Groq final benchmark.**"
        )
    )
    lines = [
        f"# ContractSense {dataset_name}-Based Final Evaluation",
        "",
        status_line,
        "",
        "This pitch-safe report summarizes an independent three-layer evaluation of the real ContractSense end agent. Official runs use Groq and product-level APIs only; failures, timeouts, missing citations, unsafe actions, and indexing errors remain in the denominator.",
        "",
        "## Dataset And Run",
        "",
        f"- Dataset: `{dataset_name}` with expert/lawyer-supervised legal annotations.",
        f"- Dataset provenance: confirm local {dataset_name} license terms before external publication.",
        f"- Manifest: `{methodology.get('manifest', '')}`",
        f"- Contracts evaluated: `{payload['contract_count']}`",
        f"- Requested contract count: `{methodology.get('contract_count_requested', payload['contract_count'])}`",
        f"- Provider: `{payload['provider']}`",
        f"- Model name recorded by runner: `{methodology.get('model_name') or 'not_reported_by_backend'}`",
        f"- Official provider required: `{methodology.get('official_provider_required', 'groq')}`",
        f"- Official run: `{methodology.get('official_run', str(payload.get('provider', '')).lower() == 'groq')}`",
        f"- End-agent only: `{methodology.get('end_agent_only')}`",
        f"- Product API only: `{methodology.get('product_api_only')}`",
        f"- Existing repo evals used: `{methodology.get('existing_repo_evals_used')}`",
        f"- Repeats: default `{methodology.get('repeat_default')}`, security `{methodology.get('repeat_security')}`",
        f"- Document transport: `{transport_counts}`",
        "",
        "## Scorecard",
        "",
        "| Metric | Value |",
        "|---|---:|",
        f"| Contracts evaluated | {payload['contract_count']} |",
        f"| Overall score | {summary.get('overall_score')} |",
        f"| Overall 95% CI by record | {summary.get('overall_score_ci95')} |",
        f"| Overall 95% CI by attempt | {summary.get('overall_score_ci95_attempt')} |",
        f"| pass^k | {summary.get('pass_k')} |",
        f"| Hard gates passed | {summary.get('hard_gate_passed')} |",
        f"| API error rate | {summary.get('api_error_rate')} |",
        f"| Timeout rate | {summary.get('timeout_rate')} |",
        f"| p50 latency ms | {latency.get('p50_ms')} |",
        f"| p95 latency ms | {latency.get('p95_ms')} |",
        f"| Max latency ms | {latency.get('max_ms')} |",
        "",
        "## Three Layers",
    ]
    for layer, layer_summary in (summary.get("by_layer") or {}).items():
        lines.append(
            f"- **{layer}**: score `{layer_summary.get('score')}`, record-clustered 95% CI `{layer_summary.get('score_ci95')}`, pass^k `{layer_summary.get('pass_k')}`"
        )
    lines.extend(["", "## KPI And Table Results", ""])
    lines.extend(
        [
            f"- KPI field F1: `{_display_gate(gates.get('kpi_field_f1'))}`",
            f"- Gold span recall: `{_display_gate(gates.get('gold_span_recall'))}`",
            f"- Citation precision: `{_display_gate(gates.get('citation_precision'))}`",
            f"- Table cell accuracy: `{_display_gate(gates.get('table_cell_accuracy'))}`",
            f"- Forbidden tool block rate: `{_display_gate(gates.get('forbidden_tool_block_rate'))}`",
            f"- Source contract immutability: `{_display_gate(gates.get('source_contract_immutability'))}`",
        ]
    )
    lines.extend(["", "## Tool Coverage", "", "| Tool | Group | Covered | Observed |", "|---|---|---:|---:|"])
    for row in summary.get("tool_coverage", []):
        lines.append(
            f"| `{row.get('tool')}` | {row.get('group')} | {row.get('covered')} | {row.get('observed_in_run')} |"
        )
    lines.extend(["", "## Failure Taxonomy", ""])
    failures = summary.get("failure_taxonomy") or []
    if failures:
        for row in failures[:20]:
            lines.append(f"- `{row.get('failure_mode')}`: {row.get('count')} attempts, example `{row.get('example_case_id')}`")
    else:
        lines.append("- No failure modes recorded in this run.")
    lines.extend(["", "## Breakdowns", ""])
    for name, rows in (summary.get("breakdowns") or {}).items():
        lines.append(f"### {name}")
        for row in rows[:12]:
            lines.append(f"- `{row.get('group')}`: score `{row.get('score')}`, pass^k `{row.get('pass_k')}`, attempts `{row.get('attempts')}`")
    lines.extend(["", "## What This Proves", ""])
    if dataset_name.upper() == "ACORD":
        lines.extend(
            [
                "- Grounded precedent-clause retrieval over expert-rated ACORD legal text.",
                "- High-rated clause selection with low-rated distractor avoidance.",
                "- Structured table reviews for precedent comparison and drafting reuse.",
                "- Draft, redline, playbook, and artifact workflows with approval gates.",
                "- Source clause-bank immutability and forbidden-tool blocking.",
            ]
        )
    else:
        lines.extend(
            [
                f"- Grounded answers with citations over real {dataset_name} legal text.",
                "- Absent-clause discipline rather than confident hallucination.",
                "- KPI and obligation extraction from contract evidence.",
                "- Structured table reviews that legal and procurement teams can reuse.",
                "- Draft, redline, playbook, and artifact workflows with approval gates.",
                "- Source contract immutability and forbidden-tool blocking.",
            ]
        )
    lines.extend(
        [
            "",
            "## Limitations",
            "",
            f"- {dataset_name} labels are the gold source; tasks outside available label coverage are reported separately or scored only when deterministic evidence exists.",
            "- Ambiguous KPI fields are excluded from deterministic scoring and should be reviewed qualitatively.",
            "- Main confidence intervals are clustered by source record; attempt-level intervals are shown only as secondary diagnostics.",
            "- If document transport is rendered text PDF or rendered clause-bank PDF, the run proves text-grounding and workflow behavior but is weaker evidence for OCR/layout fidelity than original source PDFs.",
            "- Dry-run reports validate plumbing only and must not be used in sales material.",
            "- This is a product benchmark, not a base-model leaderboard.",
            "- Private holdout prompts and gold answers should not be published.",
            "",
        ]
    )
    return "\n".join(lines)


def _write_csv(path: Path, rows: Iterable[Dict[str, Any]]) -> None:
    rows = list(rows)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fieldnames = sorted({key for row in rows for key in row})
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _write_metric_csv(path: Path, report: EvalReport, task_type: str) -> None:
    rows: List[Dict[str, Any]] = []
    for result in report.results:
        if result.case.task_type != task_type:
            continue
        rows.append(
            {
                "case_id": result.case.case_id,
                "attempt": result.observation.attempt,
                "layer": result.case.layer,
                "score": result.score,
                "passed": result.passed,
                **result.metrics,
            }
        )
    _write_csv(path, rows)


def _write_parameter_scorecard_csv(path: Path, payload: Dict[str, Any]) -> None:
    summary = payload["summary"]
    thresholds = ((payload.get("methodology") or {}).get("thresholds") or {})
    rows: List[Dict[str, Any]] = []
    latency = summary.get("latency") or {}
    overall_items = [
        ("overall_score", summary.get("overall_score"), _threshold_for(thresholds, "overall", "score")),
        ("pass_k", summary.get("pass_k"), _threshold_for(thresholds, "overall", "pass_k")),
        ("hard_gate_passed", summary.get("hard_gate_passed"), True),
        ("api_error_rate", summary.get("api_error_rate"), None),
        ("timeout_rate", summary.get("timeout_rate"), None),
        ("latency_p50_ms", latency.get("p50_ms"), None),
        ("latency_p95_ms", latency.get("p95_ms"), None),
        ("latency_max_ms", latency.get("max_ms"), None),
    ]
    for name, value in (summary.get("overall_metric_gates") or {}).items():
        overall_items.append((name, value, _threshold_for(thresholds, "overall", name)))
    for name, value, threshold in overall_items:
        rows.append(_parameter_row("overall", name, value, threshold))

    for layer, layer_summary in (summary.get("by_layer") or {}).items():
        rows.append(_parameter_row(layer, "layer_score", layer_summary.get("score"), _threshold_for(thresholds, layer, "score")))
        rows.append(_parameter_row(layer, "pass_k", layer_summary.get("pass_k"), _threshold_for(thresholds, layer, "pass_k")))
        rows.append(_parameter_row(layer, "hard_gate_passed", layer_summary.get("hard_gate_passed"), True))
        rows.append(_parameter_row(layer, "attempts", layer_summary.get("attempts"), None))
        rows.append(_parameter_row(layer, "cases", layer_summary.get("cases"), None))
        for name, value in (layer_summary.get("metrics") or {}).items():
            rows.append(_parameter_row(layer, name, value, _threshold_for(thresholds, layer, name)))
    _write_csv(path, rows)


def _write_raw_responses(path: Path, report: EvalReport) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for result in report.results:
            handle.write(json.dumps(raw_response_payload(report.run_id, report.provider, result), ensure_ascii=False) + "\n")


def append_raw_response(path: Path, *, run_id: str, provider: str, result: EvalResult) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(raw_response_payload(run_id, provider, result), ensure_ascii=False) + "\n")


def raw_response_payload(run_id: str, provider: str, result: EvalResult) -> Dict[str, Any]:
    case = result.case
    observation = result.observation
    return {
        "run_id": run_id,
        "provider": provider,
        "case_id": case.case_id,
        "attempt": observation.attempt,
        "dataset": case.metadata.get("source_dataset"),
        "layer": case.layer,
        "task_type": case.task_type,
        "workflow_type": case.metadata.get("workflow_type"),
        "source_contract_id": case.metadata.get("source_contract_id") or case.contract_id,
        "product_project_id": case.metadata.get("product_project_id"),
        "product_contract_id": case.metadata.get("product_contract_id"),
        "contract_title": case.contract_title,
        "prompt": case.prompt,
        "gold_labels": [label.to_dict() for label in case.gold_labels],
        "expected_tools": case.expected_tools,
        "forbidden_tools": case.forbidden_tools,
        "requires_citation": case.requires_citation,
        "requires_approval": case.requires_approval,
        "expects_refusal": case.expects_refusal,
        "answer": observation.answer,
        "workflow": observation.workflow,
        "status": observation.status,
        "citations": observation.citations,
        "tools": observation.tools,
        "artifacts": observation.artifacts,
        "approval_request": observation.approval_request,
        "trace": observation.trace,
        "latency_ms": observation.latency_ms,
        "cost_usd": observation.cost_usd,
        "error": observation.error,
        "raw_response": observation.raw_response,
        "score": result.score,
        "passed": result.passed,
        "hard_gate_passed": result.hard_gate_passed,
        "metrics": result.metrics,
        "failure_modes": result.failure_modes,
    }


def _parameter_row(layer: str, name: str, value: Any, threshold: Any) -> Dict[str, Any]:
    return {
        "layer": layer,
        "parameter": name,
        "value": _display_gate(value),
        "threshold": _display_gate(threshold),
        "pass": _pass_label(name, value, threshold),
    }


def _threshold_for(thresholds: Dict[str, Any], layer: str, metric_name: str) -> Any:
    layer_thresholds = thresholds.get(layer) or {}
    if metric_name == "layer_score":
        metric_name = "score"
    if metric_name in layer_thresholds:
        return layer_thresholds[metric_name]
    max_name = f"{metric_name}_max"
    if max_name in layer_thresholds:
        return {"max": layer_thresholds[max_name]}
    aliases = {
        "negative_case_hallucination_rate": "negative_case_hallucination_rate_max",
        "hallucination_rate": "hallucination_rate_max",
    }
    alias = aliases.get(metric_name)
    if alias and alias in layer_thresholds:
        return {"max": layer_thresholds[alias]}
    return None


def _pass_label(metric_name: str, value: Any, threshold: Any) -> str:
    if threshold is None:
        return "not_applicable"
    if value is None:
        return "not_applicable"
    if isinstance(threshold, bool):
        return "pass" if bool(value) is threshold else "fail"
    if isinstance(threshold, dict) and "max" in threshold:
        try:
            return "pass" if float(value) <= float(threshold["max"]) else "fail"
        except (TypeError, ValueError):
            return "not_applicable"
    try:
        return "pass" if float(value) >= float(threshold) else "fail"
    except (TypeError, ValueError):
        return "not_applicable"


def _display_gate(value: Any) -> Any:
    return "not_applicable" if value is None else value
