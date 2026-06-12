"""Metric aggregation helpers for final evaluation reports."""

from __future__ import annotations

import random
from collections import defaultdict
from statistics import mean
from typing import Any, Callable, Dict, Iterable, List, Sequence, Tuple

from .schemas import EvalResult


def safe_mean(values: Iterable[float]) -> float:
    values = [float(value) for value in values if value is not None]
    if not values:
        return 0.0
    return round(sum(values) / len(values), 4)


def percentile(values: Sequence[float], pct: float) -> float:
    clean = sorted(float(value) for value in values if value is not None)
    if not clean:
        return 0.0
    index = int(round((len(clean) - 1) * pct))
    return round(clean[max(0, min(index, len(clean) - 1))], 4)


def pass_k(results: Sequence[EvalResult]) -> float:
    by_case: Dict[str, List[EvalResult]] = defaultdict(list)
    for result in results:
        by_case[result.case.case_id].append(result)
    if not by_case:
        return 0.0
    passed = sum(1 for attempts in by_case.values() if all(item.passed for item in attempts))
    return round(passed / len(by_case), 4)


def bootstrap_ci(values: Sequence[float], *, iterations: int, seed: int) -> Tuple[float, float]:
    clean = [float(value) for value in values if value is not None]
    if not clean:
        return (0.0, 0.0)
    if len(clean) == 1:
        return (round(clean[0], 4), round(clean[0], 4))
    rng = random.Random(seed)
    estimates: List[float] = []
    for _ in range(max(1, iterations)):
        sample = [clean[rng.randrange(len(clean))] for _ in clean]
        estimates.append(mean(sample))
    estimates.sort()
    low = estimates[int(0.025 * (len(estimates) - 1))]
    high = estimates[int(0.975 * (len(estimates) - 1))]
    return (round(low, 4), round(high, 4))


def clustered_bootstrap_ci(
    results: Sequence[EvalResult],
    *,
    value_fn: Callable[[EvalResult], float],
    cluster_fn: Callable[[EvalResult], str],
    iterations: int,
    seed: int,
) -> Tuple[float, float]:
    clusters: Dict[str, List[float]] = defaultdict(list)
    for result in results:
        clusters[str(cluster_fn(result) or result.case.contract_id)].append(float(value_fn(result)))
    cluster_values = [mean(values) for values in clusters.values() if values]
    return bootstrap_ci(cluster_values, iterations=iterations, seed=seed)


def summarize_dimension(results: Sequence[EvalResult], metric_name: str) -> float:
    return safe_mean(result.metrics[metric_name] for result in results if metric_name in result.metrics)


def failure_taxonomy(results: Sequence[EvalResult]) -> List[Dict[str, Any]]:
    counts: Dict[str, int] = defaultdict(int)
    examples: Dict[str, str] = {}
    for result in results:
        for failure in result.failure_modes:
            counts[failure] += 1
            examples.setdefault(failure, result.case.case_id)
    return [
        {"failure_mode": name, "count": count, "example_case_id": examples.get(name, "")}
        for name, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def tool_coverage(results: Sequence[EvalResult], inventory: Dict[str, List[str]]) -> List[Dict[str, Any]]:
    observed_executed = set()
    observed_planned = set()
    observed_unknown = set()
    expected = set()
    for result in results:
        expected.update(result.case.expected_tools)
        expected.update(result.case.forbidden_tools)
        for tool in result.observation.tools:
            name = tool.get("name") or tool.get("tool") or tool.get("event")
            if not name:
                continue
            status = str(tool.get("status") or tool.get("state") or "").lower()
            if status in {"done", "complete", "completed", "success", "succeeded", "executed", "approved"}:
                observed_executed.add(str(name))
            elif status in {"planned", "waiting_approval", "approval_required"}:
                observed_planned.add(str(name))
            else:
                observed_unknown.add(str(name))
        if result.observation.approval_request:
            action = result.observation.approval_request.get("action")
            if action:
                observed_planned.add(str(action))
    rows: List[Dict[str, Any]] = []
    for group, tools in inventory.items():
        for tool in tools:
            rows.append(
                {
                    "tool": tool,
                    "group": group,
                    "expected_by_suite": tool in expected,
                    "observed_in_run": tool in observed_executed or tool in observed_planned,
                    "observed_executed": tool in observed_executed,
                    "observed_planned": tool in observed_planned,
                    "observed_unknown_status": tool in observed_unknown,
                    "covered": tool in expected,
                }
            )
    return rows


def summarize_results(
    results: Sequence[EvalResult],
    *,
    weights: Dict[str, float],
    thresholds: Dict[str, Any],
    bootstrap_iterations: int,
    seed: int,
    tool_inventory: Dict[str, List[str]],
) -> Dict[str, Any]:
    by_layer: Dict[str, List[EvalResult]] = defaultdict(list)
    for result in results:
        by_layer[result.case.layer].append(result)

    layer_scores = {
        layer: safe_mean(result.score for result in layer_results)
        for layer, layer_results in by_layer.items()
    }
    weighted_score = 0.0
    weight_seen = 0.0
    for layer, weight in weights.items():
        if layer in layer_scores:
            weighted_score += layer_scores[layer] * float(weight)
            weight_seen += float(weight)
    overall_score = round(weighted_score / max(weight_seen, 1e-9), 4)
    score_values = [result.score for result in results]
    record_weighted_scores = weighted_scores_by_cluster(results, weights)
    latencies = [result.observation.latency_ms for result in results if result.observation.latency_ms is not None]
    hard_gate_passed = all(result.hard_gate_passed for result in results)
    passk = pass_k(results)
    coverage = tool_coverage(results, tool_inventory)

    summary = {
        "cases": len({result.case.case_id for result in results}),
        "attempts": len(results),
        "passed_attempts": sum(1 for result in results if result.passed),
        "overall_score": overall_score,
        "overall_score_ci95": bootstrap_ci(record_weighted_scores, iterations=bootstrap_iterations, seed=seed),
        "overall_score_ci95_attempt": bootstrap_ci(score_values, iterations=bootstrap_iterations, seed=seed),
        "hard_gate_passed": hard_gate_passed,
        "pass_k": passk,
        "by_layer": {},
        "latency": {
            "p50_ms": percentile(latencies, 0.50),
            "p95_ms": percentile(latencies, 0.95),
            "max_ms": max(latencies) if latencies else 0.0,
        },
        "api_error_rate": round(
            sum(1 for result in results if result.observation.error) / max(len(results), 1),
            4,
        ),
        "timeout_rate": round(
            sum(1 for result in results if "timeout" in str(result.observation.error or "").lower()) / max(len(results), 1),
            4,
        ),
        "failure_taxonomy": failure_taxonomy(results),
        "tool_coverage": coverage,
        "breakdowns": {
            "workflow_type": _breakdown(
                results,
                lambda result: result.case.metadata.get("workflow_type") or result.case.task_type,
            ),
            "contract_length": _breakdown(
                results,
                lambda result: str(result.case.metadata.get("length_bucket") or "unknown"),
            ),
            "annotation_density": _breakdown(
                results,
                lambda result: str(result.case.metadata.get("density_bucket") or "unknown"),
            ),
            "clause_family": _breakdown(
                results,
                lambda result: str(result.case.metadata.get("clause_family") or "mixed"),
            ),
        },
        "pitch_ready": False,
    }

    for layer, layer_results in sorted(by_layer.items()):
        summary["by_layer"][layer] = {
            "attempts": len(layer_results),
            "cases": len({result.case.case_id for result in layer_results}),
            "score": layer_scores.get(layer, 0.0),
            "score_ci95": clustered_bootstrap_ci(
                layer_results,
                value_fn=lambda result: result.score,
                cluster_fn=lambda result: result.case.contract_id,
                iterations=bootstrap_iterations,
                seed=seed,
            ),
            "score_ci95_attempt": bootstrap_ci(
                [result.score for result in layer_results],
                iterations=bootstrap_iterations,
                seed=seed,
            ),
            "pass_k": pass_k(layer_results),
            "hard_gate_passed": all(result.hard_gate_passed for result in layer_results),
            "metrics": _layer_metric_summary(layer_results),
        }

    overall_thresholds = thresholds.get("overall") or {}
    layer_thresholds = {
        layer: float((thresholds.get(layer) or {}).get("score", 0.0))
        for layer in ("pac1", "rag", "tools")
    }
    metric_gates = {
        "citation_precision": _optional_metric_mean(
            result.metrics["citation_precision"]
            for result in results
            if result.case.layer == "rag" and "citation_precision" in result.metrics
        ),
        "gold_span_recall": _optional_metric_mean(
            result.metrics["gold_span_recall"]
            for result in results
            if result.case.layer == "rag" and "gold_span_recall" in result.metrics
        ),
        "kpi_field_f1": _optional_metric_mean(
            result.metrics["kpi_field_f1"]
            for result in results
            if result.case.task_type == "kpi" and "kpi_field_f1" in result.metrics
        ),
        "table_cell_accuracy": _optional_metric_mean(
            result.metrics["table_cell_accuracy"]
            for result in results
            if result.case.task_type == "table_review" and "table_cell_accuracy" in result.metrics
        ),
        "forbidden_tool_block_rate": _optional_metric_mean(
            result.metrics["forbidden_tool_block_rate"]
            for result in results
            if result.case.layer == "tools" and "forbidden_tool_block_rate" in result.metrics
        ),
        "source_contract_immutability": _optional_metric_mean(
            result.metrics["source_contract_immutability"]
            for result in results
            if result.case.layer == "tools" and "source_contract_immutability" in result.metrics
        ),
    }
    summary["overall_metric_gates"] = metric_gates
    metric_gate_passed = all(
        metric_gates.get(name) is None or metric_gates.get(name, 0.0) >= float(overall_thresholds.get(name, 0.0))
        for name in metric_gates
        if name in overall_thresholds
    )
    layer_gate_passed = all(
        layer_scores.get(layer, 0.0) >= threshold
        for layer, threshold in layer_thresholds.items()
        if layer in layer_scores
    )
    overall_threshold = float(overall_thresholds.get("score", 0.90))
    summary["pitch_ready"] = bool(
        overall_score >= overall_threshold
        and hard_gate_passed
        and passk >= float((thresholds.get("overall") or {}).get("pass_k", 0.85))
        and layer_gate_passed
        and metric_gate_passed
    )
    return summary


def _layer_metric_summary(results: Sequence[EvalResult]) -> Dict[str, float]:
    names = sorted({name for result in results for name in result.metrics})
    return {name: summarize_dimension(results, name) for name in names}


def _optional_metric_mean(values: Iterable[float]) -> float | None:
    values = [float(value) for value in values if value is not None]
    if not values:
        return None
    return round(sum(values) / len(values), 4)


def weighted_scores_by_cluster(results: Sequence[EvalResult], weights: Dict[str, float]) -> List[float]:
    by_cluster: Dict[str, List[EvalResult]] = defaultdict(list)
    for result in results:
        by_cluster[result.case.contract_id].append(result)
    values: List[float] = []
    for cluster_results in by_cluster.values():
        by_layer: Dict[str, List[EvalResult]] = defaultdict(list)
        for result in cluster_results:
            by_layer[result.case.layer].append(result)
        weighted_score = 0.0
        weight_seen = 0.0
        for layer, weight in weights.items():
            if layer in by_layer:
                weighted_score += safe_mean(row.score for row in by_layer[layer]) * float(weight)
                weight_seen += float(weight)
        if weight_seen:
            values.append(round(weighted_score / weight_seen, 4))
    return values


def _breakdown(results: Sequence[EvalResult], key_fn) -> List[Dict[str, Any]]:
    grouped: Dict[str, List[EvalResult]] = defaultdict(list)
    for result in results:
        grouped[str(key_fn(result) or "unknown")].append(result)
    return [
        {
            "group": key,
            "attempts": len(rows),
            "cases": len({row.case.case_id for row in rows}),
            "score": safe_mean(row.score for row in rows),
            "pass_k": pass_k(rows),
            "hard_gate_passed": all(row.hard_gate_passed for row in rows),
        }
        for key, rows in sorted(grouped.items())
    ]
