"""Typed state for the ContractSense deep workflow agent."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator


class AgentSurface(str, Enum):
    DASHBOARD = "dashboard"
    PROJECT = "project"
    CONTRACT = "contract"
    KPI = "kpi"
    TABULAR_REVIEW = "tabular_review"
    PLAYBOOK = "playbook"
    REPORT = "report"
    HISTORY = "history"
    ACCOUNT = "account"
    UNKNOWN = "unknown"


class AgentWorkflow(str, Enum):
    CHAT = "chat"
    QA = "qa"
    SUMMARY = "summary"
    COMPARE = "compare"
    RISK = "risk"
    KPI = "kpi"
    DRAFT = "draft"
    REDLINE = "redline"
    TABULAR_PROPOSAL = "tabular_proposal"
    TABULAR_EXECUTION = "tabular_execution"
    UNSUPPORTED = "unsupported"
    SECURITY_DENIAL = "security_denial"


class AgentStatus(str, Enum):
    STARTED = "started"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    COMPLETED = "completed"
    FAILED = "failed"


class ApprovalDecision(str, Enum):
    APPROVE = "approve"
    EDIT = "edit"
    REJECT = "reject"


class AgentContext(BaseModel):
    surface: AgentSurface = AgentSurface.UNKNOWN
    project_id: Optional[str] = None
    contract_id: Optional[str] = None
    review_id: Optional[str] = None
    playbook_id: Optional[str] = None
    session_id: Optional[str] = None
    selected_document_ids: List[str] = Field(default_factory=list)
    reference_contract_ids: List[str] = Field(default_factory=list)
    displayed_document: Optional[Dict[str, str]] = None
    attached_documents: List[Dict[str, str]] = Field(default_factory=list)
    visible_state: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("selected_document_ids", "reference_contract_ids", mode="before")
    @classmethod
    def _coerce_string_list(cls, value: Any) -> List[str]:
        if not value:
            return []
        return [str(item) for item in value if item]


class TabularColumnProposal(BaseModel):
    index: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=2000)
    format: Optional[str] = Field(default=None, max_length=80)
    tags: List[str] = Field(default_factory=list)


class TabularReviewProposal(BaseModel):
    title: str = Field(default="ContractSense Review", max_length=180)
    project_id: Optional[str] = None
    document_ids: List[str] = Field(default_factory=list)
    columns_config: List[TabularColumnProposal] = Field(default_factory=list)
    reason: str = ""
    estimated_rows: int = 0
    estimated_columns: int = 0
    estimated_tokens: int = 0
    estimated_cost_usd: float = 0.0
    practice_area: Optional[str] = None

    @field_validator("columns_config")
    @classmethod
    def _ensure_unique_column_indexes(cls, value: List[TabularColumnProposal]) -> List[TabularColumnProposal]:
        seen: set[int] = set()
        normalized: List[TabularColumnProposal] = []
        for position, column in enumerate(value):
            index = column.index if column.index is not None else position
            if index in seen:
                raise ValueError("Column indexes must be unique.")
            seen.add(index)
            normalized.append(column.model_copy(update={"index": index}))
        return normalized


class ApprovalRequest(BaseModel):
    approval_id: str = Field(default_factory=lambda: f"approval-{uuid4().hex}")
    workflow_id: str
    action: Literal[
        "create_tabular_review",
        "generate_tabular_review",
        "duplicate_document_copy",
        "extract_kpis",
        "remember_fact",
        "replicate_document",
    ]
    title: str
    description: str
    allowed_decisions: List[ApprovalDecision] = Field(
        default_factory=lambda: [ApprovalDecision.APPROVE, ApprovalDecision.EDIT, ApprovalDecision.REJECT]
    )
    tabular_review: Optional[TabularReviewProposal] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class TokenUsage(BaseModel):
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


class CostEstimate(BaseModel):
    model_tier: str = "small"
    model_name: Optional[str] = None
    cost_usd: float = 0.0
    latency_ms: int = 0


class ToolCallRecord(BaseModel):
    name: str
    args: Dict[str, Any] = Field(default_factory=dict)
    status: Literal["planned", "approved", "rejected", "done", "error"] = "planned"
    reason: str = ""
    observation: Dict[str, Any] = Field(default_factory=dict)
    iteration: int = 0


class AgentTraceEvent(BaseModel):
    event: str
    detail: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AgentRunState(BaseModel):
    workflow_id: str = Field(default_factory=lambda: f"workflow-{uuid4().hex}")
    user_id: str
    message: str = Field(min_length=1, max_length=4000)
    context: AgentContext = Field(default_factory=AgentContext)
    ai_provider: Optional[str] = None
    memory_context: str = ""
    status: AgentStatus = AgentStatus.STARTED
    workflow: AgentWorkflow = AgentWorkflow.QA
    answer: str = ""
    confidence: Literal["high", "medium", "low"] = "low"
    reason: str = ""
    citation_details: Dict[str, Any] = Field(default_factory=dict)
    citation_annotations: List[Dict[str, Any]] = Field(default_factory=list)
    tools: List[ToolCallRecord] = Field(default_factory=list)
    react_iterations: int = 0
    react_scratchpad: List[Dict[str, Any]] = Field(default_factory=list)
    react_complete: bool = False
    traces: List[AgentTraceEvent] = Field(default_factory=list)
    approval_request: Optional[ApprovalRequest] = None
    tabular_proposal: Optional[TabularReviewProposal] = None
    created_review_id: Optional[str] = None
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)
    token_usage: TokenUsage = Field(default_factory=TokenUsage)
    cost: CostEstimate = Field(default_factory=CostEstimate)
    verifier_issues: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def add_trace(self, event: str, **detail: Any) -> None:
        self.traces.append(AgentTraceEvent(event=event, detail=detail))
        self.updated_at = datetime.utcnow()


class AgentResponse(BaseModel):
    answer: str
    workflow: AgentWorkflow = AgentWorkflow.QA
    confidence: str = "low"
    reason: str = ""
    citation_details: Dict[str, Any] = Field(default_factory=dict)
    citation_annotations: List[Dict[str, Any]] = Field(default_factory=list)
    citations: List[Dict[str, Any]] = Field(default_factory=list)
    tools_called: List[str] = Field(default_factory=list)
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)
    workflow_id: str
    workflow_status: AgentStatus
    requires_approval: bool = False
    approval_request: Optional[ApprovalRequest] = None
    tools: List[Dict[str, Any]] = Field(default_factory=list)
    agent_trace: List[Dict[str, Any]] = Field(default_factory=list)
    token_usage: TokenUsage = Field(default_factory=TokenUsage)
    cost_usd: float = 0.0
    created_review_id: Optional[str] = None
