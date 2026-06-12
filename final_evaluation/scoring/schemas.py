"""Data models for the final ContractSense evaluation.

These models are intentionally small and standalone. They do not import the
application eval harness or any existing benchmark package.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional


LayerName = Literal["pac1", "rag", "tools"]


@dataclass
class GoldSpan:
    text: str
    start: Optional[int] = None
    end: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"text": self.text, "start": self.start, "end": self.end}


@dataclass
class GoldLabel:
    clause_type: str
    question: str
    present: bool
    spans: List[GoldSpan] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "clause_type": self.clause_type,
            "question": self.question,
            "present": self.present,
            "spans": [span.to_dict() for span in self.spans],
        }


@dataclass
class EvalCase:
    case_id: str
    layer: LayerName
    task_type: str
    contract_id: str
    contract_title: str
    prompt: str
    repeat: int
    gold_labels: List[GoldLabel] = field(default_factory=list)
    expected_tools: List[str] = field(default_factory=list)
    forbidden_tools: List[str] = field(default_factory=list)
    expected_workflow: Optional[str] = None
    requires_citation: bool = True
    requires_approval: bool = False
    expects_refusal: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "case_id": self.case_id,
            "layer": self.layer,
            "task_type": self.task_type,
            "contract_id": self.contract_id,
            "contract_title": self.contract_title,
            "prompt": self.prompt,
            "repeat": self.repeat,
            "gold_labels": [label.to_dict() for label in self.gold_labels],
            "expected_tools": self.expected_tools,
            "forbidden_tools": self.forbidden_tools,
            "expected_workflow": self.expected_workflow,
            "requires_citation": self.requires_citation,
            "requires_approval": self.requires_approval,
            "expects_refusal": self.expects_refusal,
            "metadata": self.metadata,
        }


@dataclass
class EvalObservation:
    case_id: str
    attempt: int
    answer: str = ""
    workflow: str = ""
    status: str = ""
    citations: List[Dict[str, Any]] = field(default_factory=list)
    tools: List[Dict[str, Any]] = field(default_factory=list)
    artifacts: List[Dict[str, Any]] = field(default_factory=list)
    approval_request: Optional[Dict[str, Any]] = None
    trace: List[Dict[str, Any]] = field(default_factory=list)
    latency_ms: Optional[int] = None
    cost_usd: Optional[float] = None
    error: Optional[str] = None
    raw_response: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "case_id": self.case_id,
            "attempt": self.attempt,
            "answer": self.answer,
            "workflow": self.workflow,
            "status": self.status,
            "citations": self.citations,
            "tools": self.tools,
            "artifacts": self.artifacts,
            "approval_request": self.approval_request,
            "trace": self.trace,
            "latency_ms": self.latency_ms,
            "cost_usd": self.cost_usd,
            "error": self.error,
            "raw_response": self.raw_response,
        }


@dataclass
class EvalResult:
    case: EvalCase
    observation: EvalObservation
    score: float
    passed: bool
    hard_gate_passed: bool
    metrics: Dict[str, float] = field(default_factory=dict)
    failure_modes: List[str] = field(default_factory=list)

    def to_dict(self, public_safe: bool = False) -> Dict[str, Any]:
        observation = self.observation.to_dict()
        if public_safe:
            observation["answer"] = _redact_text(observation.get("answer", ""))
            observation["raw_response"] = {}
        return {
            "case": self.case.to_dict(),
            "observation": observation,
            "score": self.score,
            "passed": self.passed,
            "hard_gate_passed": self.hard_gate_passed,
            "metrics": self.metrics,
            "failure_modes": self.failure_modes,
        }


@dataclass
class EvalReport:
    run_id: str
    provider: str
    contract_count: int
    summary: Dict[str, Any]
    results: List[EvalResult]
    methodology: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self, public_safe: bool = False) -> Dict[str, Any]:
        return {
            "run_id": self.run_id,
            "provider": self.provider,
            "contract_count": self.contract_count,
            "summary": self.summary,
            "methodology": self.methodology,
            "results": [result.to_dict(public_safe=public_safe) for result in self.results],
        }


def _redact_text(text: str) -> str:
    redacted = str(text or "")
    for marker in ("api_key", "authorization", "bearer "):
        if marker in redacted.lower():
            return "[REDACTED]"
    return redacted[:1200]
