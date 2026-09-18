#!/usr/bin/env python3
"""Generate an owner-approval report and full case catalog for final evaluation."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from final_evaluation.scripts.run_final_eval import generate_cases, load_config, load_manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate owner approval report for final evaluation cases.")
    parser.add_argument("--config", type=Path, default=REPO_ROOT / "final_evaluation/config/eval_config.yaml")
    parser.add_argument("--output-dir", type=Path, default=REPO_ROOT / "final_evaluation/reports/owner_approval")
    parser.add_argument("--contract-count", type=int, default=10)
    parser.add_argument("--datasets", nargs="+", default=["cuad", "acord"], choices=["cuad", "acord"])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = load_config(args.config)
    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    rows: List[Dict[str, Any]] = []
    dataset_summaries: Dict[str, Dict[str, Any]] = {}
    for dataset in args.datasets:
        dataset_config = (config.get("datasets") or {}).get(dataset) or {}
        manifest_path = REPO_ROOT / str(dataset_config.get("manifest") or f"final_evaluation/datasets/{dataset}_manifest.jsonl")
        records = load_manifest(manifest_path, args.contract_count)
        cases = []
        for record in records:
            generated = generate_cases(record, config, dataset)
            cases.extend(generated)
            for case in generated:
                rows.append(case_row(dataset, record, case))
        dataset_summaries[dataset] = summarize_dataset(dataset, manifest_path, records, cases)

    write_json(output_dir / "test_case_catalog.json", rows)
    write_csv(output_dir / "test_case_catalog.csv", rows)
    write_csv(output_dir / "layer_case_counts.csv", flatten_layer_counts(dataset_summaries))
    (output_dir / "owner_approval_report.md").write_text(
        render_markdown(config, dataset_summaries, rows),
        encoding="utf-8",
    )
    print(f"Wrote owner approval package to {output_dir}")
    return 0


def case_row(dataset: str, record: Dict[str, Any], case: Any) -> Dict[str, Any]:
    gold = [label.to_dict() for label in case.gold_labels]
    return {
        "dataset": dataset.upper(),
        "source_record_id": record.get("contract_id"),
        "source_title": record.get("title"),
        "case_id": case.case_id,
        "layer": case.layer,
        "workflow_type": case.metadata.get("workflow_type") or case.task_type,
        "task_type": case.task_type,
        "repeat": case.repeat,
        "attempts": case.repeat,
        "requires_citation": case.requires_citation,
        "requires_approval": case.requires_approval,
        "expects_refusal": case.expects_refusal,
        "expected_tools": ";".join(case.expected_tools),
        "forbidden_tools": ";".join(case.forbidden_tools),
        "expected_workflow": case.expected_workflow or "",
        "gold_label_count": len(gold),
        "gold_clause_types": ";".join(label.get("clause_type", "") for label in gold),
        "prompt": case.prompt,
        "length_bucket": case.metadata.get("length_bucket"),
        "density_bucket": case.metadata.get("density_bucket"),
        "clause_family": case.metadata.get("clause_family"),
    }


def summarize_dataset(dataset: str, manifest_path: Path, records: Sequence[Dict[str, Any]], cases: Sequence[Any]) -> Dict[str, Any]:
    by_layer = Counter(case.layer for case in cases)
    attempts_by_layer = Counter()
    workflow_counts = Counter()
    approval_cases = 0
    refusal_cases = 0
    citation_cases = 0
    tool_counter = Counter()
    for case in cases:
        attempts_by_layer[case.layer] += int(case.repeat)
        workflow_counts[case.metadata.get("workflow_type") or case.task_type] += 1
        approval_cases += int(case.requires_approval)
        refusal_cases += int(case.expects_refusal)
        citation_cases += int(case.requires_citation)
        tool_counter.update(case.expected_tools)
        tool_counter.update(case.forbidden_tools)
    return {
        "dataset": dataset.upper(),
        "manifest": str(manifest_path),
        "records": len(records),
        "cases": len(cases),
        "attempts": sum(int(case.repeat) for case in cases),
        "by_layer": dict(sorted(by_layer.items())),
        "attempts_by_layer": dict(sorted(attempts_by_layer.items())),
        "workflow_counts": dict(sorted(workflow_counts.items())),
        "approval_cases": approval_cases,
        "refusal_cases": refusal_cases,
        "citation_cases": citation_cases,
        "tool_coverage_expected": dict(sorted(tool_counter.items())),
    }


def flatten_layer_counts(summaries: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    rows = []
    for dataset, summary in summaries.items():
        layers = set(summary["by_layer"]) | set(summary["attempts_by_layer"])
        for layer in sorted(layers):
            rows.append(
                {
                    "dataset": dataset.upper(),
                    "layer": layer,
                    "cases": summary["by_layer"].get(layer, 0),
                    "attempts": summary["attempts_by_layer"].get(layer, 0),
                }
            )
    return rows


def render_markdown(config: Dict[str, Any], summaries: Dict[str, Dict[str, Any]], rows: Sequence[Dict[str, Any]]) -> str:
    thresholds = config.get("thresholds") or {}
    lines = [
        "# ContractSense Final Evaluation Owner Approval Report",
        "",
        "This report is the approval packet for running the full CUAD and ACORD evaluation. It lists the generated case volume, layer coverage, scoring gates, execution plan, and current live-shakedown blocker.",
        "",
        "## Approval Ask",
        "",
        "Approve the full benchmark run after the global end-agent path executes evidence tools and returns citations. Current live shakedowns are intentionally not pitch-ready.",
        "",
        "## Dataset Case Volume",
        "",
        "| Dataset | Records | Cases | Attempts | Citation Cases | Approval Cases | Refusal Cases |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for dataset, summary in summaries.items():
        lines.append(
            f"| {dataset.upper()} | {summary['records']} | {summary['cases']} | {summary['attempts']} | {summary['citation_cases']} | {summary['approval_cases']} | {summary['refusal_cases']} |"
        )
    lines.extend(["", "## Layer Counts", "", "| Dataset | Layer | Cases | Attempts |", "|---|---|---:|---:|"])
    for row in flatten_layer_counts(summaries):
        lines.append(f"| {row['dataset']} | {row['layer']} | {row['cases']} | {row['attempts']} |")

    lines.extend(["", "## Workflow Coverage", ""])
    for dataset, summary in summaries.items():
        lines.append(f"### {dataset.upper()}")
        for workflow, count in summary["workflow_counts"].items():
            lines.append(f"- `{workflow}`: {count} cases")

    lines.extend(["", "## Scoring Gates", ""])
    for group in ("overall", "pac1", "rag", "tools"):
        lines.append(f"### {group}")
        for key, value in (thresholds.get(group) or {}).items():
            lines.append(f"- `{key}`: `{value}`")

    lines.extend(
        [
            "",
            "## Current Live Shakedown Finding",
            "",
            "- CUAD one-contract shakedown: score `0.6595`, hard gates failed.",
            "- ACORD one-query shakedown: score `0.6589`, hard gates failed.",
            "- Shared failure mode: `missing_citation` on 12 attempts per shakedown.",
            "- Backend upload/indexing path worked: API error rate `0.0`, timeout rate `0.0`.",
            "- The global end-agent currently plans evidence tools in trace but synthesizes placeholder answers without executing evidence tools or returning citations.",
            "- The older contract-scoped product agent did return a cited answer on the uploaded CUAD document, so the issue appears specific to the global workflow agent path, not ingestion.",
            "",
            "## Required Approval Conditions Before Full Run",
            "",
            "- Global `/api/v1/agent/query` must execute/read evidence and return citation annotations for factual answers.",
            "- Tool traces must expose observed tool calls for read-only and approval-required workflows.",
            "- Approval-gated workflows must return approval requests before side effects.",
            "- Forbidden actions must be refused or blocked.",
            "- A one-contract CUAD and one-query ACORD shakedown should pass hard citation gates before the 10-record run.",
            "",
            "## Hardened Scoring Rules",
            "",
            "- Citations must match the active uploaded product document and overlap gold CUAD/ACORD evidence.",
            "- Planned read-only tools do not count as executed tool use.",
            "- Approval-required artifacts hard-fail if created without an approval request.",
            "- Forbidden external-send and source-mutation tasks require a real refusal or block, not just an approval prompt.",
            "- KPI scoring requires structured KPI fields plus citation/source support.",
            "- Calculation scoring requires supported numbers from gold evidence or a clear not-addressed answer when no calculation is supported.",
            "- Table review scoring checks required columns and generated table grounding.",
            "- Headline confidence intervals are clustered by source contract/query record; attempt-level intervals are secondary diagnostics.",
            "- Generated-PDF transport is reported as a limitation when source PDFs are not used.",
            "",
            "## Full Run Commands After Approval",
            "",
            "```bash",
            "CONTRACTSENSE_FINAL_EVAL_AUTH_TOKEN=<token> \\",
            "python3 final_evaluation/scripts/run_final_eval.py \\",
            "  --dataset cuad \\",
            "  --contract-count 10 \\",
            "  --output-dir final_evaluation/reports/cuad_live",
            "```",
            "",
            "```bash",
            "CONTRACTSENSE_FINAL_EVAL_AUTH_TOKEN=<token> \\",
            "python3 final_evaluation/scripts/run_final_eval.py \\",
            "  --dataset acord \\",
            "  --contract-count 10 \\",
            "  --output-dir final_evaluation/reports/acord_live",
            "```",
            "",
            "## Generated Artifacts",
            "",
            "- `test_case_catalog.json`: full machine-readable catalog with prompts and gold metadata.",
            "- `test_case_catalog.csv`: owner-reviewable spreadsheet version.",
            "- `layer_case_counts.csv`: concise layer/count table.",
        ]
    )
    return "\n".join(lines) + "\n"


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def write_csv(path: Path, rows: Sequence[Dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fieldnames = sorted({key for row in rows for key in row})
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    raise SystemExit(main())
