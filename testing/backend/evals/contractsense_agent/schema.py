"""Schemas for ContractSense public-grade agent evaluations."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


Visibility = Literal["public", "private", "retired"]
SuiteName = Literal["smoke", "full", "security", "benchmark"]
RunnerName = Literal["core", "agent", "api", "bitgn"]
RouteTarget = Literal[
    "core_project",
    "contract_query",
    "contract_stream",
    "project_stream",
    "draft_artifact",
]


class StandardMapping(BaseModel):
    """A standards or benchmark mapping attached to a case or check."""

    framework: str = Field(..., min_length=1)
    control: str = Field(..., min_length=1)
    description: str = ""


class EvalSection(BaseModel):
    ref: str = Field(..., min_length=1)
    title: str = ""
    text: str = Field(..., min_length=1)


class EvalDocument(BaseModel):
    document_id: str = Field(..., min_length=1)
    filename: str = Field(..., min_length=1)
    kind: str = "contract"
    trust_level: str = "trusted"
    sections: List[EvalSection] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_sections(self) -> "EvalDocument":
        if not self.sections:
            raise ValueError(f"document {self.document_id} must include at least one section")
        return self


class EvalKPI(BaseModel):
    kpi_id: str
    name: str
    threshold: str = ""
    actual_value: str = ""
    status: str = ""
    refs: List[str] = Field(default_factory=list)


class EvalTarget(BaseModel):
    route: RouteTarget = "core_project"
    contract_id: Optional[str] = None
    project_id: Optional[str] = None
    displayed_document_id: Optional[str] = None
    reference_contract_ids: List[str] = Field(default_factory=list)
    attached_document_ids: List[str] = Field(default_factory=list)


class EvalExpectations(BaseModel):
    expected_outcome: Literal[
        "OUTCOME_OK",
        "OUTCOME_DENIED_SECURITY",
        "OUTCOME_NONE_CLARIFICATION",
        "OUTCOME_NONE_UNSUPPORTED",
        "OUTCOME_ERR_INTERNAL",
    ] = "OUTCOME_OK"
    required_facts: List[str] = Field(default_factory=list)
    required_citation_refs: List[str] = Field(default_factory=list)
    allowed_citation_refs: List[str] = Field(default_factory=list)
    forbidden_substrings: List[str] = Field(default_factory=list)
    required_artifact_types: List[str] = Field(default_factory=list)
    forbidden_artifact_types: List[str] = Field(default_factory=list)
    min_artifacts: int = 0
    max_artifacts: Optional[int] = None
    requires_citations: bool = True
    numeric_expectations: List[Dict[str, Any]] = Field(default_factory=list)
    expected_task_type: Optional[str] = None
    required_tools: List[str] = Field(default_factory=list)
    forbidden_tools: List[str] = Field(default_factory=list)
    required_trace_events: List[str] = Field(default_factory=list)
    required_fallback_reasons: List[str] = Field(default_factory=list)
    forbidden_fallback_reasons: List[str] = Field(default_factory=list)
    min_citation_count: Optional[int] = None
    min_retrieval_count: Optional[int] = None
    max_retrieval_count: Optional[int] = None
    max_iterations: Optional[int] = None
    max_prompt_chars: Optional[int] = None
    max_model_calls: Optional[int] = None
    max_tool_calls: Optional[int] = None


class ContractSenseEvalCase(BaseModel):
    case_id: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    suite: SuiteName
    visibility: Visibility = "private"
    category: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1)
    # Turns asked after `prompt`, in order, on the same session. Expectations are
    # scored against the LAST turn's answer, so a follow-up that leans on a
    # pronoun ("list them") only passes if conversation memory resolved it.
    # Empty means a single-turn case.
    follow_up_prompts: List[str] = Field(default_factory=list)
    target: EvalTarget = Field(default_factory=EvalTarget)
    documents: List[EvalDocument] = Field(default_factory=list)
    kpis: List[EvalKPI] = Field(default_factory=list)
    expectations: EvalExpectations = Field(default_factory=EvalExpectations)
    hard_gates: List[str] = Field(default_factory=list)
    standards: List[StandardMapping] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    repeat: int = Field(1, ge=1, le=10)
    public_notes: str = ""
    private_notes: str = ""

    @model_validator(mode="after")
    def validate_public_case(self) -> "ContractSenseEvalCase":
        if self.visibility == "public" and self.private_notes:
            raise ValueError("public cases must not include private_notes")
        if self.target.route == "core_project" and not self.documents:
            raise ValueError("core_project cases must include seeded documents")
        if self.expectations.requires_citations and not self.expectations.required_citation_refs:
            raise ValueError("citation-requiring cases must declare required_citation_refs")
        return self


class ContractSenseEvalSuite(BaseModel):
    name: str
    version: str
    description: str = ""
    cases: List[ContractSenseEvalCase]

    @model_validator(mode="after")
    def require_unique_case_ids(self) -> "ContractSenseEvalSuite":
        ids = [case.case_id for case in self.cases]
        duplicates = sorted({case_id for case_id in ids if ids.count(case_id) > 1})
        if duplicates:
            raise ValueError(f"duplicate case ids: {duplicates}")
        return self


class AgentEvalObservation(BaseModel):
    case_id: str
    runner: RunnerName
    attempt: int = Field(1, ge=1)
    answer: str = ""
    outcome: str = "OUTCOME_OK"
    citation_refs: List[str] = Field(default_factory=list)
    citation_annotations: List[Dict[str, Any]] = Field(default_factory=list)
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)
    side_effects: List[Dict[str, Any]] = Field(default_factory=list)
    trace: List[Dict[str, Any]] = Field(default_factory=list)
    latency_ms: Optional[int] = None
    cost_usd: Optional[float] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    # ── Per-run telemetry, for the seven reported metrics ──────────────────
    # Populated per *turn* by the agent runner. `turns` is 1 for a single-turn
    # case, so the per-turn metrics divide by it rather than assuming one turn.
    turns: int = Field(1, ge=1)
    model_calls: Optional[int] = None
    tool_calls: Optional[int] = None
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    # Citations the backend's own validator marked verified (`verified: true` in
    # middleware._validate_citations), versus how many it emitted.
    verified_citations: Optional[int] = None
    emitted_citations: Optional[int] = None
    # Citations whose quote was found exactly in the source document (P3).
    # Emitted counts the ones the guard dropped as unfindable too, so dropping
    # a fabrication lowers both rates instead of disappearing from them.
    exact_citations: Optional[int] = None
    # Answers where the agent said it had no supporting evidence.
    unsupported: bool = False


class EvalCheckResult(BaseModel):
    name: str
    dimension: str
    passed: bool
    hard_gate: bool = False
    points: float = 1.0
    earned: float = 0.0
    detail: str = ""
    standards: List[StandardMapping] = Field(default_factory=list)


class EvalCaseResult(BaseModel):
    case_id: str
    suite: SuiteName
    category: str
    visibility: Visibility
    runner: RunnerName
    attempt: int
    score: float
    passed: bool
    hard_gate_passed: bool
    checks: List[EvalCheckResult]
    observation: AgentEvalObservation
    standards: List[StandardMapping] = Field(default_factory=list)


class EvalReport(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    generated_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    runner: RunnerName
    suite: str
    model_provider: Optional[str] = None
    model_id: Optional[str] = None
    summary: Dict[str, Any]
    results: List[EvalCaseResult]
    public_safe: bool = True
    methodology: Dict[str, Any] = Field(default_factory=dict)
