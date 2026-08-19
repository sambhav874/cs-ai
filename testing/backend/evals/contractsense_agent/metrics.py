"""The seven agent metrics reported per eval run, and the regression gate over them.

`scoring.py` answers "did this case pass?". This module answers "did the agent get
worse than `main`?" — the question Phase 1 needs before it is allowed to delete
loop behavior. Deliberately split into two halves:

  compute_metrics()  — pure function over scored results. No I/O, no model.
  compare_metrics()  — baseline vs current, returns the build verdict.

Both are deterministic and unit-testable without API keys, which is what lets the
gate itself be covered by the normal backend test suite.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from .schema import AgentEvalObservation, EvalCaseResult


# ── Regression tolerances ─────────────────────────────────────────────────────
# Quality metrics move on model nondeterminism, so they get a small absolute
# slack. Cost metrics get relative slack: they are noisier, they are not
# correctness, and 1.2 exists specifically to push model_calls_per_turn *down*.
QUALITY_TOLERANCE = 0.02
COST_TOLERANCE_RATIO = 0.25

# Falling below this fails the build outright, independent of any baseline —
# so a first run with no baseline still has a floor.
CITATION_SUPPORT_FLOOR = 0.90

# Higher is better; a drop beyond QUALITY_TOLERANCE is a regression.
QUALITY_METRICS = (
    "citation_support_rate",
    "multi_turn_resolution_rate",
    "overall_score",
    "pass_rate",
)

# Lower is better; a rise beyond QUALITY_TOLERANCE is a regression.
INVERSE_QUALITY_METRICS = ("unsupported_answer_rate",)

# Lower is better; a rise beyond COST_TOLERANCE_RATIO is a warning, not a failure.
COST_METRICS = (
    "model_calls_per_turn",
    "tool_calls_per_turn",
    "input_tokens_per_turn",
    "output_tokens_per_turn",
    "latency_p50_ms",
    "latency_p95_ms",
)

# Only this one fails the build on a baseline regression. The rest are reported
# so a human can see the trade, because "fewer model calls, same citations" is
# the whole point of 1.2 and a gate that fails on any movement would block it.
BLOCKING_METRICS = ("citation_support_rate",)


def percentile(values: Sequence[float], fraction: float) -> Optional[float]:
    """Nearest-rank percentile. No numpy dependency in the eval path."""
    ordered = sorted(value for value in values if value is not None)
    if not ordered:
        return None
    if len(ordered) == 1:
        return float(ordered[0])
    rank = max(0, min(len(ordered) - 1, int(round(fraction * (len(ordered) - 1)))))
    return float(ordered[rank])


def _mean(values: Sequence[float]) -> Optional[float]:
    present = [value for value in values if value is not None]
    if not present:
        return None
    return round(sum(present) / len(present), 3)


def _rate(numerator: int, denominator: int) -> Optional[float]:
    if denominator <= 0:
        return None
    return round(numerator / denominator, 3)


def _per_turn(observations: Sequence[AgentEvalObservation], field: str) -> Optional[float]:
    """Total of `field` divided by total turns, not by observation count.

    A two-turn case that makes two model calls averages one per turn, which is
    the number 1.2 is trying to move. Dividing by observations would report two
    and hide the improvement.
    """
    total = 0
    turns = 0
    seen = False
    for observation in observations:
        value = getattr(observation, field, None)
        if value is None:
            continue
        seen = True
        total += int(value)
        turns += max(int(observation.turns or 1), 1)
    if not seen or turns <= 0:
        return None
    return round(total / turns, 3)


def compute_metrics(results: Sequence[EvalCaseResult]) -> Dict[str, Any]:
    """The seven reported numbers, plus the counts they were derived from."""
    observations = [result.observation for result in results]
    total = len(results)

    latencies = [
        float(observation.latency_ms)
        for observation in observations
        if observation.latency_ms is not None
    ]

    # 5. Citation-support rate — the backend's own verdict, not a re-scoring.
    #    middleware._validate_citations already stamps `verified` on every
    #    annotation it lets through; this surfaces that instead of duplicating
    #    the support logic here.
    verified = sum(observation.verified_citations or 0 for observation in observations)
    emitted = sum(observation.emitted_citations or 0 for observation in observations)

    # 6. Unsupported-answer rate — only counted over cases that were *supposed*
    #    to be answerable. A case expecting OUTCOME_NONE_UNSUPPORTED is correct
    #    when it declines, so counting it here would penalise right behavior.
    answerable = [
        result
        for result in results
        if result.observation.metadata.get("expected_outcome", "OUTCOME_OK") == "OUTCOME_OK"
    ]
    unsupported = sum(1 for result in answerable if result.observation.unsupported)

    # 7. Multi-turn reference resolution — over multi-turn cases only. The final
    #    turn's answer is scored against required_facts, so a pronoun the agent
    #    failed to resolve shows up as a factuality miss on that check.
    multi_turn = [result for result in results if (result.observation.turns or 1) > 1]
    resolved = sum(1 for result in multi_turn if _facts_check_passed(result))

    return {
        # 1. wall time
        "latency_p50_ms": percentile(latencies, 0.50),
        "latency_p95_ms": percentile(latencies, 0.95),
        # 2. tokens per turn
        "input_tokens_per_turn": _per_turn(observations, "input_tokens"),
        "output_tokens_per_turn": _per_turn(observations, "output_tokens"),
        # 3. model calls per turn
        "model_calls_per_turn": _per_turn(observations, "model_calls"),
        # 4. tool calls per turn
        "tool_calls_per_turn": _per_turn(observations, "tool_calls"),
        # 5. citation support
        "citation_support_rate": _rate(verified, emitted),
        # 6. unsupported answers
        "unsupported_answer_rate": _rate(unsupported, len(answerable)),
        # 7. multi-turn reference resolution
        "multi_turn_resolution_rate": _rate(resolved, len(multi_turn)),
        # Case-level scores, so a metrics-only report is still self-contained.
        "overall_score": round(sum(result.score for result in results) / max(total, 1), 3),
        "pass_rate": _rate(sum(1 for result in results if result.passed), total),
        "counts": {
            "cases": total,
            "turns": sum(max(int(o.turns or 1), 1) for o in observations),
            "multi_turn_cases": len(multi_turn),
            "answerable_cases": len(answerable),
            "citations_emitted": emitted,
            "citations_verified": verified,
            "unsupported_answers": unsupported,
        },
    }


def _facts_check_passed(result: EvalCaseResult) -> bool:
    """Did the answer contain the facts the case required?

    Used as the multi-turn resolution signal: the follow-up turn asks about
    something only turn one established, so the facts only appear if the
    reference resolved.
    """
    checks = [check for check in result.checks if check.name == "required_facts"]
    if not checks:
        # No declared facts to look for — fall back to the case verdict rather
        # than silently counting it as resolved.
        return result.passed
    return all(check.passed for check in checks)


def compare_metrics(
    baseline: Optional[Dict[str, Any]],
    current: Dict[str, Any],
) -> Dict[str, Any]:
    """Diff current metrics against a baseline and decide whether the build fails.

    A missing baseline is not a pass by default: the absolute
    CITATION_SUPPORT_FLOOR still applies, so the very first run on a branch
    cannot ship a broken citation pipeline just because there is nothing to
    compare against.
    """
    comparisons: List[Dict[str, Any]] = []
    regressions: List[str] = []
    warnings: List[str] = []

    for metric in (*QUALITY_METRICS, *INVERSE_QUALITY_METRICS, *COST_METRICS):
        current_value = current.get(metric)
        baseline_value = (baseline or {}).get(metric)
        verdict, delta = _verdict_for(metric, baseline_value, current_value)
        comparisons.append(
            {
                "metric": metric,
                "baseline": baseline_value,
                "current": current_value,
                "delta": delta,
                "verdict": verdict,
            }
        )
        if verdict == "regression":
            if metric in BLOCKING_METRICS:
                regressions.append(
                    f"{metric}: {baseline_value} -> {current_value} (delta {delta})"
                )
            else:
                warnings.append(
                    f"{metric}: {baseline_value} -> {current_value} (delta {delta})"
                )

    floor_failures: List[str] = []
    support = current.get("citation_support_rate")
    if support is not None and support < CITATION_SUPPORT_FLOOR:
        floor_failures.append(
            f"citation_support_rate {support} is below the {CITATION_SUPPORT_FLOOR} floor"
        )

    return {
        "passed": not regressions and not floor_failures,
        "has_baseline": baseline is not None,
        "regressions": regressions,
        "floor_failures": floor_failures,
        "warnings": warnings,
        "comparisons": comparisons,
        "blocking_metrics": list(BLOCKING_METRICS),
        "citation_support_floor": CITATION_SUPPORT_FLOOR,
    }


def _verdict_for(
    metric: str,
    baseline_value: Optional[float],
    current_value: Optional[float],
) -> tuple[str, Optional[float]]:
    if baseline_value is None or current_value is None:
        return "no_baseline", None
    delta = round(current_value - baseline_value, 4)

    if metric in COST_METRICS:
        allowed = abs(baseline_value) * COST_TOLERANCE_RATIO
        if delta > allowed:
            return "regression", delta
        return ("improvement" if delta < 0 else "unchanged"), delta

    if metric in INVERSE_QUALITY_METRICS:
        if delta > QUALITY_TOLERANCE:
            return "regression", delta
        return ("improvement" if delta < 0 else "unchanged"), delta

    if delta < -QUALITY_TOLERANCE:
        return "regression", delta
    return ("improvement" if delta > 0 else "unchanged"), delta


def format_markdown(
    current: Dict[str, Any],
    comparison: Dict[str, Any],
    *,
    title: str = "ContractSense agent eval",
) -> str:
    """Render the comparison as the PR comment body."""
    if comparison["passed"]:
        headline = "passed" if comparison["has_baseline"] else "passed (no baseline to diff)"
    else:
        headline = "FAILED"
    lines = [
        f"## {title} — {headline}",
        "",
        "| Metric | Baseline | Current | Delta | |",
        "| --- | --- | --- | --- | --- |",
    ]
    marks = {
        "regression": "regressed",
        "improvement": "improved",
        "unchanged": "",
        "no_baseline": "new",
    }
    for row in comparison["comparisons"]:
        lines.append(
            "| {metric} | {baseline} | {current} | {delta} | {mark} |".format(
                metric=row["metric"],
                baseline="—" if row["baseline"] is None else row["baseline"],
                current="—" if row["current"] is None else row["current"],
                delta="—" if row["delta"] is None else f"{row['delta']:+}",
                mark=marks.get(row["verdict"], row["verdict"]),
            )
        )

    for label, items in (
        ("Blocking regressions", comparison["regressions"]),
        ("Below absolute floor", comparison["floor_failures"]),
        ("Warnings (reported, not blocking)", comparison["warnings"]),
    ):
        if items:
            lines.extend(["", f"**{label}**", ""])
            lines.extend(f"- {item}" for item in items)

    counts = current.get("counts") or {}
    if counts:
        lines.extend(
            [
                "",
                "<sub>{cases} cases / {turns} turns · {multi} multi-turn · "
                "{verified}/{emitted} citations verified</sub>".format(
                    cases=counts.get("cases", 0),
                    turns=counts.get("turns", 0),
                    multi=counts.get("multi_turn_cases", 0),
                    verified=counts.get("citations_verified", 0),
                    emitted=counts.get("citations_emitted", 0),
                ),
            ]
        )
    return "\n".join(lines)
