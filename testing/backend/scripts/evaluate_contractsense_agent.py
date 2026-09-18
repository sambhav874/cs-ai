"""Run public-grade ContractSense agent evaluations."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path


TESTING_BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
APP_BACKEND_ROOT = REPO_ROOT / "apps" / "intelligence"

for path in (APP_BACKEND_ROOT, TESTING_BACKEND_ROOT):
    path_string = str(path)
    if path_string not in sys.path:
        sys.path.insert(0, path_string)

from evals.contractsense_agent.agent_runner import AgentContractSenseRunner  # noqa: E402
from evals.contractsense_agent.metrics import (  # noqa: E402
    compare_metrics,
    compute_metrics,
    format_markdown,
)
from evals.contractsense_agent.runners import (  # noqa: E402
    ApiContractSenseRunner,
    BitGNContractSenseRunner,
    CoreContractSenseRunner,
    load_suite,
)
from evals.contractsense_agent.schema import EvalReport  # noqa: E402
from evals.contractsense_agent.scoring import score_observation, summarize_results  # noqa: E402


DEFAULT_SUITE_PATH = TESTING_BACKEND_ROOT / "evals" / "contractsense_agent" / "fixtures" / "public_smoke.json"
DEFAULT_PRIVATE_SUITE_PATH = TESTING_BACKEND_ROOT / "evals" / "contractsense_agent" / "fixtures" / "private_holdout.example.json"
DEFAULT_ENV_PATH = APP_BACKEND_ROOT / ".env"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ContractSense public-grade agent evals.")
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_SUITE_PATH, help="Eval fixture JSON file.")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_PATH, help="Env file to load before reading provider/API settings.")
    parser.add_argument("--suite", choices=["smoke", "full", "security", "benchmark"], default="smoke")
    parser.add_argument(
        "--runner",
        choices=["core", "agent", "api", "bitgn"],
        default="agent",
        help=(
            "'agent' runs the real DeepContractAgentRunner loop against fixture retrieval "
            "and is the CI gate. 'core' drives the legacy ContractRAGSystem and is kept only "
            "for the side-by-side comparison Phase 3.4's deletion needs."
        ),
    )
    parser.add_argument("--case-id", action="append", help="Run only a specific case id. Can be repeated.")
    parser.add_argument("--visibility", choices=["public", "private", "retired", "all"], default="all")
    parser.add_argument("--max-cases", type=int, help="Limit number of selected cases.")
    parser.add_argument("--repeat", type=int, help="Override per-case repeat count.")
    parser.add_argument("--ai-provider", help="Provider override for ContractSense core/API runs.")
    parser.add_argument("--api-base-url", help="Base URL for --runner api. Defaults to CONTRACTSENSE_EVAL_API_BASE_URL.")
    parser.add_argument("--auth-token", help="Bearer token for --runner api. Defaults to CONTRACTSENSE_EVAL_AUTH_TOKEN.")
    parser.add_argument("--seed-api-fixtures", action="store_true", help="Insert synthetic fixture contracts/projects before API cases.")
    parser.add_argument("--keep-api-fixtures", action="store_true", help="Do not delete synthetic API fixtures after each case.")
    parser.add_argument("--bitgn-config", type=Path, help="Optional BitGN adapter config.")
    parser.add_argument("--max-iterations", type=int, help="Override the agent's react iteration ceiling.")
    parser.add_argument("--output", type=Path, help="Write JSON report to this path.")
    parser.add_argument("--private-output", type=Path, help="Write private debug report with full observations.")
    parser.add_argument(
        "--baseline",
        type=Path,
        help="Report JSON from the base branch. Metrics are diffed against its summary.metrics.",
    )
    parser.add_argument("--markdown-output", type=Path, help="Write the metric comparison table for a PR comment.")
    parser.add_argument(
        "--fail-on-regression",
        action="store_true",
        help=(
            "Exit non-zero when a blocking metric regresses against --baseline, or when "
            "citation support falls below its absolute floor. This is the CI gate."
        ),
    )
    parser.add_argument("--fail-on-hard-gate", action="store_true", help="Exit non-zero if any hard gate fails.")
    parser.add_argument("--public-safe", action="store_true", default=True, help="Write redacted/public-safe output.")
    parser.add_argument("--list-cases", action="store_true")
    return parser.parse_args()


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def load_baseline_metrics(path: Path | None):
    """Read summary.metrics out of a base-branch report.

    A missing or malformed baseline is not fatal — compare_metrics still applies
    the absolute citation-support floor, so the gate degrades to "must not be
    broken" rather than "must not have changed".
    """
    if not path:
        return None
    if not path.exists():
        print(f"Baseline {path} not found; comparing against the absolute floor only.", file=sys.stderr)
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"Baseline {path} is not valid JSON ({exc}); ignoring it.", file=sys.stderr)
        return None
    metrics = (payload.get("summary") or {}).get("metrics")
    if not isinstance(metrics, dict):
        print(f"Baseline {path} has no summary.metrics block; ignoring it.", file=sys.stderr)
        return None
    return metrics


def select_cases(args: argparse.Namespace):
    suite = load_suite(args.fixtures)
    selected_ids = set(args.case_id or [])
    cases = [
        case
        for case in suite.cases
        if case.suite == args.suite
        and (not selected_ids or case.case_id in selected_ids)
        and (args.visibility == "all" or case.visibility == args.visibility)
    ]
    if selected_ids:
        found = {case.case_id for case in cases}
        missing = sorted(selected_ids - found)
        if missing:
            raise SystemExit(f"Unknown or filtered case id(s): {', '.join(missing)}")
    if args.max_cases:
        cases = cases[: args.max_cases]
    return suite, cases


def build_runner(args: argparse.Namespace):
    if args.runner == "core":
        return CoreContractSenseRunner(ai_provider=args.ai_provider)
    if args.runner == "agent":
        return AgentContractSenseRunner(
            ai_provider=args.ai_provider,
            max_iterations=args.max_iterations,
        )
    if args.runner == "api":
        return ApiContractSenseRunner(
            base_url=args.api_base_url,
            auth_token=args.auth_token,
            ai_provider=args.ai_provider,
            seed_fixtures=args.seed_api_fixtures,
            cleanup_fixtures=not args.keep_api_fixtures,
        )
    return BitGNContractSenseRunner(adapter_config=args.bitgn_config)


def public_safe_result(result):
    payload = result.model_dump(mode="json")
    observation = payload.get("observation", {})
    if observation.get("answer"):
        observation["answer"] = _redact_text(str(observation["answer"]))
    if "metadata" in observation:
        observation["metadata"] = {
            key: value
            for key, value in observation["metadata"].items()
            if key in {"provider", "adapter_contract"}
        }
    observation["trace"] = [
        {
            key: value
            for key, value in event.items()
            if key in {"event", "document_count", "citation_refs", "latency_ms", "status_code"}
        }
        for event in observation.get("trace", [])
    ]
    return payload


def _redact_text(text: str) -> str:
    redacted = text
    redacted = redacted.replace(os.getenv("OPENAI_API_KEY", ""), "[REDACTED]") if os.getenv("OPENAI_API_KEY") else redacted
    redacted = redacted.replace(os.getenv("GROQ_API_KEY", ""), "[REDACTED]") if os.getenv("GROQ_API_KEY") else redacted
    redacted = redacted.replace(os.getenv("ANTHROPIC_API_KEY", ""), "[REDACTED]") if os.getenv("ANTHROPIC_API_KEY") else redacted
    redacted = redacted.replace(os.getenv("GEMINI_API_KEY", ""), "[REDACTED]") if os.getenv("GEMINI_API_KEY") else redacted
    return redacted


def main() -> int:
    args = parse_args()
    load_env_file(args.env_file)
    suite, cases = select_cases(args)
    if args.list_cases:
        for case in cases:
            standards = ", ".join(f"{item.framework}:{item.control}" for item in case.standards)
            print(f"{case.case_id}\t{case.suite}\t{case.visibility}\t{case.category}\t{standards}")
        return 0
    if not cases:
        print("No eval cases selected.", file=sys.stderr)
        return 2

    runner = build_runner(args)
    results = []
    for case in cases:
        repeat_count = args.repeat or case.repeat
        for attempt in range(1, repeat_count + 1):
            turn_note = f" ({1 + len(case.follow_up_prompts)} turns)" if case.follow_up_prompts else ""
            print(f"== {case.case_id} attempt {attempt}/{repeat_count}{turn_note} ==")
            observation = runner.run_case(case, attempt=attempt)
            result = score_observation(case, observation)
            results.append(result)
            status = "PASS" if result.passed else "FAIL"
            hard_gate = "hard-ok" if result.hard_gate_passed else "hard-fail"
            print(f"{status} score={result.score:.3f} {hard_gate} outcome={observation.outcome}")
            for check in result.checks:
                marker = "ok" if check.passed else "no"
                detail = f" - {check.detail}" if check.detail else ""
                print(f"  [{marker}] {check.dimension}.{check.name}{detail}")

    summary = summarize_results(results)
    summary["metrics"] = compute_metrics(results)
    comparison = compare_metrics(load_baseline_metrics(args.baseline), summary["metrics"])
    summary["metric_comparison"] = comparison
    report = EvalReport(
        runner=args.runner,
        suite=args.suite,
        model_provider=args.ai_provider or os.getenv("CONTRACTSENSE_AI_PROVIDER"),
        model_id=os.getenv("MODEL_ID"),
        summary=summary,
        results=results,
        public_safe=args.public_safe,
        methodology={
            "suite_name": suite.name,
            "suite_version": suite.version,
            "fixtures": str(args.fixtures),
            "no_ragas": True,
            "public_cases_are_not_release_holdout": True,
            "standards": [
                "NIST AI RMF",
                "NIST AI 600-1",
                "ISO/IEC 42001",
                "OWASP Top 10 for LLM Applications",
                "MLCommons AILuminate",
                "HELM",
                "BitGN PAC",
                "tau-bench",
                "BFCL",
                "GAIA",
                "LegalBench",
                "CUAD",
                "ContractNLI",
            ],
        },
    )

    print("\nSUMMARY", json.dumps(summary, indent=2))
    markdown = format_markdown(summary["metrics"], comparison, title=f"ContractSense agent eval ({args.runner})")
    print("\n" + markdown)
    if args.markdown_output:
        args.markdown_output.parent.mkdir(parents=True, exist_ok=True)
        args.markdown_output.write_text(markdown, encoding="utf-8")
        print(f"Wrote {args.markdown_output}")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        if args.public_safe:
            payload = report.model_dump(mode="json")
            payload["results"] = [public_safe_result(result) for result in results]
        else:
            payload = report.model_dump(mode="json")
        args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"Wrote {args.output}")
    if args.private_output:
        args.private_output.parent.mkdir(parents=True, exist_ok=True)
        args.private_output.write_text(json.dumps(report.model_dump(mode="json"), indent=2), encoding="utf-8")
        print(f"Wrote private report {args.private_output}")

    if args.fail_on_regression and not comparison["passed"]:
        for item in [*comparison["regressions"], *comparison["floor_failures"]]:
            print(f"REGRESSION {item}", file=sys.stderr)
        return 1
    if args.fail_on_hard_gate and not summary["hard_gate_passed"]:
        return 1
    return 0 if all(result.passed for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
