"""Public-grade ContractSense agent evaluation harness."""

from .metrics import compare_metrics, compute_metrics, format_markdown
from .schema import (
    AgentEvalObservation,
    ContractSenseEvalCase,
    ContractSenseEvalSuite,
    EvalCaseResult,
    EvalReport,
)
from .scoring import score_observation, summarize_results

__all__ = [
    "AgentEvalObservation",
    "ContractSenseEvalCase",
    "ContractSenseEvalSuite",
    "EvalCaseResult",
    "EvalReport",
    "compare_metrics",
    "compute_metrics",
    "format_markdown",
    "score_observation",
    "summarize_results",
]
