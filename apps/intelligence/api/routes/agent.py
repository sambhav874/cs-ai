"""Global ContractSense agent routes."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from core.rate_limiter import limiter
from api.dependencies import get_current_user_from_ticket_or_session, get_contract_and_verify_access
from api.routes.projects import verify_project_access
from api.routes.tabular_reviews import (
    _ensure_review_access,
    create_tabular_review_for_agent,
    find_tabular_review_for_agent_workflow,
    generate_tabular_review_for_agent,
)
from api.routes.projects import build_accessible_contract_query
from core.database import collection, db, fs, projects_collection , teams_collection
from core.security import get_current_active_user
from models.domain import UserInDB
from services.agent_documents import AgentDocumentManager
from services.agent_memory import AgentMemoryManager, detect_work_product_type
from services.memory import ComposedMemory, MemoryBlock, MemoryComposer, MemoryScope, UserPreferencesManager, preferences_block
from services.agent_stream import stream_agent_run
from services.project_memory import ProjectMemoryManager
from services.kpi_manager import ContractKPIManager
from services.kpi_source_ingestion import KpiSourceIngestionService
from services.document_artifacts import (
    build_redline_changes_from_request,
    redline_change_from_payload,
    redline_change_to_payload,
)
from services.contract_agent.graph import (
    AgentContext,
    AgentResponse,
    AgentRunState,
    AgentStatus,
    AgentSurface,
    AgentWorkflow,
    ApprovalDecision,
    DeepContractAgentRunner,
    TabularReviewProposal,
)
from services.contract_agent.graph.approvals import ApprovalManager
from services.contract_agent.graph.persistence import AgentRunStore
from services.contract_agent.graph.state import ToolCallRecord
from utils.text_cleanup import get_formatted_citations

from services.contract_agent.graph.tools.executor import execute_mongo_read_tool
from services.contract_agent.rag.facade import ContractRAGSystem
from api.routes.model_settings import apply_team_model_settings
from utils.secure_logger import log_exception

logger = logging.getLogger(__name__)

# Publishes the caller's team model settings for the duration of each request,
# so build_chat_model picks them up without every agent code path having to
# thread a team id down into the RAG stack.
router = APIRouter(dependencies=[Depends(apply_team_model_settings)])


class GlobalAgentQueryRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    context: AgentContext = Field(default_factory=AgentContext)
    ai_provider: Optional[str] = None


class AgentQueryRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    session_id: Optional[str] = Field(None, description="Persistent assistant chat session id.")
    ai_provider: Optional[str] = Field(None, description="AI provider to use for the agent response.")
    reference_contract_ids: Optional[List[str]] = Field(
        default=None,
        description="Optional project document IDs to use as explicit chat context. The active contract is always included.",
    )
    displayed_document: Optional[Dict[str, str]] = Field(
        default=None,
        description="Document currently open in the viewer. Used as focus context, not as the only retrieval scope.",
    )
    attached_documents: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description="Documents explicitly attached/referred to for the current chat turn.",
    )


class AgentQueryResponse(BaseModel):
    answer: str
    confidence: str
    citation: str = ""
    reason: str = ""
    citation_details: Dict[str, Any] = Field(default_factory=dict)
    citation_annotations: List[Dict[str, Any]] = Field(default_factory=list)
    citations: List[Dict[str, Any]] = Field(default_factory=list)
    tools_called: List[str] = Field(default_factory=list)
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)
    session_id: Optional[str] = None
    vector_namespace: Optional[str] = None
    vector_backend: Optional[str] = None



class WorkflowProposalPatchRequest(BaseModel):
    title: Optional[str] = None
    project_id: Optional[str] = None
    document_ids: Optional[list[str]] = None
    columns_config: Optional[list[Dict[str, Any]]] = None
    practice_area: Optional[str] = None


class WorkflowApprovalRequest(BaseModel):
    decision: ApprovalDecision = ApprovalDecision.APPROVE
    edited_tabular_review: Optional[TabularReviewProposal] = None
    generate: bool = True
    feedback: Optional[str] = Field(default=None, max_length=2000)


class AgentDocumentTextSaveRequest(BaseModel):
    body_text: str = Field(..., description="The body text content to save as a new version.")
    change_summary: str = Field(default="Saved from live editor", description="Summary of changes for this version.")


def _store() -> AgentRunStore:
    return AgentRunStore(db)


def _agent_documents() -> AgentDocumentManager:
    return AgentDocumentManager(db, fs)


def _kpi_manager() -> ContractKPIManager:
    return ContractKPIManager(db)


def _agent_tool_executor(tool: ToolCallRecord, state: AgentRunState) -> Dict[str, Any]:
    return execute_mongo_read_tool(collection, tool, state)


def _format_sse(event: str, payload: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


def _ensure_context_access(context: AgentContext, current_user: UserInDB) -> None:
    if context.project_id:
        verify_project_access(context.project_id, current_user)
    if context.contract_id:
        if not ObjectId.is_valid(context.contract_id):
            raise HTTPException(status_code=400, detail="Invalid contract_id format.")
        contract = collection.find_one(
            {"_id": ObjectId(context.contract_id)},
            {"_id": 1, "ownerType": 1, "ownerId": 1, "projectId": 1},
        )
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found.")
        owner_type = contract.get("ownerType")
        owner_id = str(contract.get("ownerId"))
        if owner_type == "user" and owner_id != current_user.id:
            raise HTTPException(status_code=403, detail="Access denied to this contract.")
        if owner_type == "team" and owner_id not in [current_user.ownedAccountId, *(current_user.teamIds or [])]:
            raise HTTPException(status_code=403, detail="Access denied to this contract.")
        if contract.get("projectId"):
            verify_project_access(str(contract["projectId"]), current_user)
    if context.review_id:
        _ensure_review_access(context.review_id, current_user)


def _load_kpi_extraction_contract(contract_id: str, current_user: UserInDB) -> Dict[str, Any]:
    if not ObjectId.is_valid(contract_id):
        raise HTTPException(status_code=400, detail="Invalid contract_id format.")
    contract = collection.find_one(
        {"_id": ObjectId(contract_id)},
        {
            "_id": 1,
            "ownerType": 1,
            "ownerId": 1,
            "projectId": 1,
            "contract_name": 1,
            "index.status": 1,
            "index.content": 1,
        },
    )
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found.")
    owner_type = contract.get("ownerType")
    owner_id = str(contract.get("ownerId"))
    if owner_type == "user" and owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied to this contract.")
    if owner_type == "team" and owner_id not in [current_user.ownedAccountId, *(current_user.teamIds or [])]:
        raise HTTPException(status_code=403, detail="Access denied to this contract.")
    if contract.get("projectId"):
        verify_project_access(str(contract["projectId"]), current_user)
    if (contract.get("index") or {}).get("status") != "success":
        raise HTTPException(status_code=400, detail="Contract must be ingested before KPI extraction.")
    return contract


def _bool_from_payload(value: Any, *, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in {"false", "0", "no", "off"}:
        return False
    if normalized in {"true", "1", "yes", "on"}:
        return True
    return default


def _require_owned_workflow(workflow_id: str, current_user: UserInDB) -> AgentRunState:
    state = _store().get(workflow_id)
    if not state:
        raise HTTPException(status_code=404, detail="Agent workflow not found.")
    if state.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied to this workflow.")
    return state


@router.post("/agent/query", response_model=AgentResponse)
@limiter.limit("30/minute")
def query_agent(
    request: Request,
    request_data: GlobalAgentQueryRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> AgentResponse:
    _ensure_context_access(request_data.context, current_user)
    state = AgentRunState(
        user_id=current_user.id,
        message=request_data.message.strip(),
        context=request_data.context,
        ai_provider=request_data.ai_provider,
    )
    return DeepContractAgentRunner(store=_store(), tool_executor=_agent_tool_executor).run(state)


@router.post("/agent/query/stream")
@limiter.limit("30/minute")
def stream_agent(
    request: Request,
    request_data: GlobalAgentQueryRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> StreamingResponse:
    def events():
        try:
            yield _format_sse("status", {"message": "running"})
            response = query_agent(request, request_data, current_user)
            if response.requires_approval:
                yield _format_sse("approval_required", response.model_dump(mode="json"))
            else:
                yield _format_sse("final", response.model_dump(mode="json"))
            yield _format_sse("done", {})
        except Exception as exc:
            log_exception(logger, "Global agent stream failed", exc)
            yield _format_sse("error", {"detail": "Agent stream failed."})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "Content-Encoding": "identity",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/agent/workflows/{workflow_id}", response_model=AgentResponse)
def get_workflow(
    workflow_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> AgentResponse:
    state = _require_owned_workflow(workflow_id, current_user)
    return DeepContractAgentRunner(store=_store()).response_from_state(state)


@router.patch("/agent/workflows/{workflow_id}/proposal", response_model=AgentResponse)
def update_workflow_proposal(
    workflow_id: str,
    request: WorkflowProposalPatchRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> AgentResponse:
    state = _require_owned_workflow(workflow_id, current_user)
    if not state.tabular_proposal or not state.approval_request:
        raise HTTPException(status_code=400, detail="Workflow has no editable tabular proposal.")
    patch = request.model_dump(exclude_unset=True)
    proposal = ApprovalManager().apply_tabular_patch(state.tabular_proposal, patch)
    state.tabular_proposal = proposal
    state.approval_request.tabular_review = proposal
    state.add_trace("proposal_updated", columns=len(proposal.columns_config), documents=len(proposal.document_ids))
    _store().save(state)
    return DeepContractAgentRunner(store=_store()).response_from_state(state)


@router.post("/agent/workflows/{workflow_id}/approve", response_model=AgentResponse)
@limiter.limit("30/minute")
def approve_workflow(
    request: Request,
    workflow_id: str,
    request_data: WorkflowApprovalRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> AgentResponse:
    return decide_workflow(workflow_id, request_data, current_user)


def decide_workflow(
    workflow_id: str,
    request_data: WorkflowApprovalRequest,
    current_user: UserInDB,
) -> AgentResponse:
    """Carry out, or decline, a workflow waiting on a person.

    Shared by this route and the internal one the platform chat's Apply card
    reaches (api/routes/internal.py), so an approval behaves the same from
    either surface.
    """
    state = _require_owned_workflow(workflow_id, current_user)
    if not state.approval_request:
        raise HTTPException(status_code=400, detail="Workflow is not waiting for approval.")
    if request_data.decision == ApprovalDecision.REJECT:
        return _reject_state(state, request_data.feedback)
    if state.approval_request.action == "create_tabular_review":
        return _approve_tabular_workflow(state, request_data, current_user)
    if state.approval_request.action == "extract_kpis":
        return _approve_kpi_extraction_workflow(state, current_user)
    if state.approval_request.action == "remember_fact":
        return _approve_remember_fact_workflow(state, current_user)
    if state.approval_request.action == "correct_fact":
        return _approve_correct_fact_workflow(state, current_user)
    if state.approval_request.action in {
        "create_editable_copy",
        "duplicate_document_copy",
        "replicate_document",
    }:
        return _approve_artifact_workflow(state, current_user)
    raise HTTPException(status_code=400, detail="Unsupported approval action.")


def _approve_tabular_workflow(
    state: AgentRunState,
    request: WorkflowApprovalRequest,
    current_user: UserInDB,
) -> AgentResponse:
    proposal = request.edited_tabular_review or state.tabular_proposal or state.approval_request.tabular_review
    if not proposal:
        raise HTTPException(status_code=400, detail="Missing tabular proposal.")
    if state.created_review_id:
        state.status = AgentStatus.COMPLETED
        state.answer = f"Tabular review already created: {state.created_review_id}."
        state.approval_request = None
        state.add_trace("approval_idempotent_reuse", review_id=state.created_review_id)
        _store().save(state)
        return DeepContractAgentRunner(store=_store()).response_from_state(state)

    review = find_tabular_review_for_agent_workflow(
        current_user=current_user,
        workflow_id=state.workflow_id,
    )
    if review:
        state.add_trace("approval_idempotent_reuse", review_id=review["id"], source="existing_agent_review")
    else:
        review = create_tabular_review_for_agent(
            current_user=current_user,
            title=proposal.title,
            project_id=proposal.project_id,
            document_ids=proposal.document_ids,
            columns_config=[column.model_dump(mode="json") for column in proposal.columns_config],
            source_workflow_id=state.workflow_id,
        )
    generated: Dict[str, Any] = {}
    generation_error = ""
    state.created_review_id = str(review["id"])
    if request.generate:
        try:
            generated = generate_tabular_review_for_agent(
                current_user=current_user,
                review_id=state.created_review_id,
                force=False,
            )
        except HTTPException as exc:
            if exc.status_code != status.HTTP_503_SERVICE_UNAVAILABLE:
                raise
            generation_error = str(exc.detail or "Tabular generation providers are unavailable.")
            state.add_trace(
                "tabular_generation_failed",
                review_id=state.created_review_id,
                status_code=exc.status_code,
                detail=generation_error,
            )
    state.status = AgentStatus.COMPLETED
    if generation_error:
        state.answer = (
            f"Created tabular review \"{review.get('title')}\" with {len(proposal.columns_config)} fields, "
            "but cell generation failed because no configured tabular model provider succeeded. "
            "The review is saved; fix the provider/model/API key configuration and regenerate it from the review page."
        )
        state.reason = generation_error
    else:
        state.answer = f"Created tabular review \"{review.get('title')}\" with {len(proposal.columns_config)} fields."
        state.reason = "Human approved the edited tabular review proposal."
    state.approval_request = None
    state.tabular_proposal = proposal
    state.artifacts = [{
        "type": "tabular_review",
        "review_id": state.created_review_id,
        "title": review.get("title"),
        "generated_count": generated.get("generated_count", 0),
        "generation_error": generation_error or None,
    }]
    state.add_trace(
        "approval_executed",
        action="create_tabular_review",
        review_id=state.created_review_id,
        generated_count=generated.get("generated_count", 0),
        generation_error=bool(generation_error),
    )
    _store().save(state)
    return DeepContractAgentRunner(store=_store()).response_from_state(state)


def _approve_kpi_extraction_workflow(state: AgentRunState, current_user: UserInDB) -> AgentResponse:
    if not state.approval_request:
        raise HTTPException(status_code=400, detail="Workflow is not waiting for approval.")
    if state.artifacts:
        state.status = AgentStatus.COMPLETED
        state.approval_request = None
        state.add_trace("approval_idempotent_reuse", artifacts=len(state.artifacts), action="extract_kpis")
        _store().save(state)
        return DeepContractAgentRunner(store=_store()).response_from_state(state)

    payload = state.approval_request.payload or {}
    selected_contract_ids = [str(item) for item in (state.context.selected_document_ids or []) if item]
    contract_id = str(
        payload.get("contract_id")
        or state.context.contract_id
        or (selected_contract_ids[0] if len(selected_contract_ids) == 1 else "")
    )
    if not contract_id:
        raise HTTPException(status_code=400, detail="Select a single ingested contract before extracting KPIs.")

    contract = _load_kpi_extraction_contract(contract_id, current_user)
    payload_project_id = str(payload.get("project_id") or state.context.project_id or "")
    if payload_project_id and contract.get("projectId") and payload_project_id != str(contract["projectId"]):
        raise HTTPException(status_code=400, detail="Selected contract is not part of the workflow project scope.")

    result = _kpi_manager().extract_for_contract(
        contract_doc=contract,
        user_id=str(current_user.id),
        replace_drafts=_bool_from_payload(payload.get("replace_drafts"), default=True),
        ai_provider=str(payload.get("ai_provider") or state.ai_provider or "") or None,
    )
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    kpi_count = int(result.get("kpi_count") or 0)
    updated_count = int(result.get("new_or_updated_count") or 0)
    contract_name = str(result.get("contract_name") or contract.get("contract_name") or "Contract")

    state.workflow = AgentWorkflow.KPI
    state.status = AgentStatus.COMPLETED
    state.approval_request = None
    state.answer = (
        f"Approved. I extracted KPI/SLA candidates for {contract_name}. "
        f"The register now has {kpi_count} KPI row{'' if kpi_count == 1 else 's'}, "
        f"with {updated_count} new or updated draft candidate{'' if updated_count == 1 else 's'}."
    )
    state.reason = "Human approved KPI extraction for the scoped contract."
    state.artifacts = [{
        "artifact_id": str(result.get("run_id") or f"kpi-extraction-{contract_id}"),
        "artifact_kind": "kpi_extraction",
        "type": "kpi_extraction",
        "filename": "KPI extraction complete",
        "contract_id": contract_id,
        "contract_name": contract_name,
        "project_id": result.get("project_id"),
        "run_id": result.get("run_id"),
        "kpi_count": kpi_count,
        "new_or_updated_count": updated_count,
        "candidate_count": result.get("candidate_count"),
        "extraction_method": result.get("extraction_method"),
        "llm_error": result.get("llm_error"),
        "summary": summary,
    }]
    state.add_trace(
        "approval_executed",
        action="extract_kpis",
        contract_id=contract_id,
        run_id=result.get("run_id"),
        kpi_count=kpi_count,
        new_or_updated_count=updated_count,
    )
    _store().save(state)
    return DeepContractAgentRunner(store=_store()).response_from_state(state)


def _approve_remember_fact_workflow(state: AgentRunState, current_user: UserInDB) -> AgentResponse:
    """Write one approved fact into project memory.

    Gated because a fact persists and shapes every later answer in the project,
    unlike a retrieval mistake that lasts one turn. project_id comes from the
    authorized run scope, never from the tool payload.
    """
    if not state.approval_request:
        raise HTTPException(status_code=400, detail="Workflow is not waiting for approval.")

    payload = state.approval_request.payload or {}
    project_id = str(state.context.project_id or "")
    if not project_id:
        raise HTTPException(status_code=400, detail="No project is in scope for this conversation.")

    origin = str(payload.get("origin") or "contract").strip().lower()
    contract_id = str(payload.get("contract_id") or "").strip()
    quote = str(payload.get("quote") or "").strip()
    sources = [{"contract_id": contract_id, "quote": quote}] if contract_id else []
    tags = [tag.strip() for tag in str(payload.get("tags") or "").split(",") if tag.strip()]

    from core.database import db as core_db
    from services.project_memory import ProjectMemoryManager

    try:
        fact = ProjectMemoryManager(core_db).remember_fact(
            project_id=project_id,
            text=str(payload.get("text") or ""),
            sources=sources,
            tags=tags,
            origin=origin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    state.status = AgentStatus.COMPLETED
    state.approval_request = None
    state.answer = f"Approved. I've recorded that in this project's memory: {fact['text']}"
    state.reason = "Human approved writing a fact to project memory."
    state.artifacts = [{
        "artifact_id": fact["fact_id"],
        "artifact_kind": "project_fact",
        "type": "project_fact",
        "filename": "Fact recorded",
        "project_id": project_id,
        "text": fact["text"],
        "origin": fact["origin"],
        "sources": fact["sources"],
        "tags": fact["tags"],
    }]
    state.add_trace(
        "approval_executed",
        action="remember_fact",
        fact_id=fact["fact_id"],
        origin=fact["origin"],
    )
    _store().save(state)
    return DeepContractAgentRunner(store=_store()).response_from_state(state)


def _approve_correct_fact_workflow(state: AgentRunState, _current_user: UserInDB) -> AgentResponse:
    """Record a user correction as a new fact, then supersede the old one.

    The replacement is written rather than editing the old row so a later audit
    can still see what the project believed before the lawyer corrected it. The
    old fact is checked first because creating a replacement for a missing id
    would leave durable memory with an orphaned correction.
    """
    if not state.approval_request:
        raise HTTPException(status_code=400, detail="Workflow is not waiting for approval.")

    payload = state.approval_request.payload or {}
    project_id = str(state.context.project_id or "")
    fact_id = str(payload.get("fact_id") or "").strip()
    fact_description = str(payload.get("fact_description") or "").strip()
    corrected_text = str(payload.get("corrected_value") or payload.get("text") or "").strip()
    if not project_id:
        raise HTTPException(status_code=400, detail="No project is in scope for this conversation.")
    if not corrected_text:
        raise HTTPException(status_code=400, detail="A correction needs replacement text.")

    from core.database import db as core_db
    from services.project_memory import ProjectMemoryManager

    manager = ProjectMemoryManager(core_db)
    all_facts = manager.list_facts(project_id, include_superseded=True)
    existing = None
    if fact_id:
        existing = next(
            (fact for fact in all_facts if str(fact.get("fact_id") or "") == fact_id),
            None,
        )
    if not existing and fact_description:
        desc = fact_description.strip().lower()
        existing = next(
            (fact for fact in all_facts if desc in str(fact.get("text") or "").lower() and not fact.get("superseded_by")),
            None,
        )
    if not existing and not fact_id and not fact_description:
        active_facts = [fact for fact in all_facts if not fact.get("superseded_by")]
        if len(active_facts) == 1:
            existing = active_facts[0]

    if not existing:
        raise HTTPException(status_code=404, detail="The project fact to correct was not found.")
    if existing.get("superseded_by"):
        raise HTTPException(status_code=409, detail="That project fact was already superseded; correct the current fact instead.")

    fact_id = existing["fact_id"]
    origin = str(payload.get("origin") or "user").strip().lower()
    contract_id = str(payload.get("contract_id") or "").strip()
    quote = str(payload.get("reason") or payload.get("quote") or "").strip()
    # A user correction may happen while discussing a contract, but that
    # context is not evidence for the correction. Avoid making the replacement
    # look contract-backed unless the approval explicitly marked it that way.
    sources = [{"contract_id": contract_id, "quote": quote}] if origin == "contract" and contract_id else []
    tags = [tag.strip() for tag in str(payload.get("tags") or "").split(",") if tag.strip()]

    try:
        replacement = manager.remember_fact(
            project_id=project_id,
            text=corrected_text,
            sources=sources,
            tags=tags,
            origin=origin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not manager.supersede_fact(project_id, fact_id, replacement["fact_id"]):
        raise HTTPException(status_code=409, detail="The project fact changed before the correction could be applied.")

    # The correction is episodic evidence of what changed, not a normal cited
    # answer. Keep it separate so future recall can distinguish user feedback
    # from a model conclusion that happened to mention the same term.
    try:
        _agent_memory().record_run_episode(
            session_id=str(state.context.session_id or state.workflow_id),
            contract_id=str(state.context.contract_id or project_id),
            user_id=str(state.user_id),
            project_id=project_id,
            question=state.message,
            tools_called=["correct_fact"],
            citation_count=0,
            confidence=state.confidence,
            unsupported=False,
            workflow_id=state.workflow_id,
            correction=corrected_text,
        )
    except Exception as episode_error:
        log_exception(logger, "Failed to record correction episode", episode_error)

    state.status = AgentStatus.COMPLETED
    state.approval_request = None
    state.answer = f"Approved. I've corrected that project fact: {replacement['text']}"
    state.reason = "Human approved superseding a project fact with the user's correction."
    state.artifacts = [{
        "artifact_id": replacement["fact_id"],
        "artifact_kind": "project_fact_correction",
        "type": "project_fact_correction",
        "filename": "Project fact corrected",
        "project_id": project_id,
        "fact_id": replacement["fact_id"],
        "superseded_fact_id": fact_id,
        "text": replacement["text"],
        "origin": replacement["origin"],
        "sources": replacement["sources"],
        "tags": replacement["tags"],
    }]
    state.add_trace(
        "approval_executed",
        action="correct_fact",
        fact_id=replacement["fact_id"],
        superseded_fact_id=fact_id,
    )
    _store().save(state)
    return DeepContractAgentRunner(store=_store()).response_from_state(state)


def _approve_artifact_workflow(state: AgentRunState, current_user: UserInDB) -> AgentResponse:
    if not state.approval_request:
        raise HTTPException(status_code=400, detail="Workflow is not waiting for approval.")
    if state.artifacts:
        state.status = AgentStatus.COMPLETED
        state.approval_request = None
        state.add_trace("approval_idempotent_reuse", artifacts=len(state.artifacts))
        _store().save(state)
        return DeepContractAgentRunner(store=_store()).response_from_state(state)

    _ensure_context_access(state.context, current_user)
    payload = state.approval_request.payload or {}
    scope_id = str(payload.get("scope_id") or state.context.contract_id or "")
    project_id = payload.get("project_id") or state.context.project_id
    session_id = str(payload.get("session_id") or state.context.session_id or state.workflow_id)
    contract_id = str(payload.get("contract_id") or state.context.contract_id or "")
    action = state.approval_request.action

    artifacts: list[Dict[str, Any]] = []
    if action in {"duplicate_document_copy", "replicate_document"}:
        copied = _agent_documents().duplicate_latest_for_session(
            contract_id=scope_id or contract_id,
            project_id=str(project_id) if project_id else None,
            user_id=str(current_user.id),
            session_id=session_id,
            count=int(payload.get("count") or 1),
        )
        artifacts = [document.to_payload(contract_id=scope_id or contract_id) for document in copied]
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported approval action: {action}")

    state.status = AgentStatus.COMPLETED
    state.approval_request = None
    state.artifacts = artifacts
    if not artifacts:
        state.answer = f"{state.answer}\n\nNo artifact was created because there was no eligible assistant work product to save."
    state.reason = "Human approved the assistant work-product side effect."
    state.add_trace("approval_executed", action=action, artifact_count=len(artifacts))
    _store().save(state)
    return DeepContractAgentRunner(store=_store()).response_from_state(state)


@router.post("/agent/workflows/{workflow_id}/reject", response_model=AgentResponse)
@limiter.limit("30/minute")
def reject_workflow(
    request: Request,
    workflow_id: str,
    request_data: WorkflowApprovalRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> AgentResponse:
    state = _require_owned_workflow(workflow_id, current_user)
    return _reject_state(state, request_data.feedback)


def _reject_state(state: AgentRunState, feedback: Optional[str]) -> AgentResponse:
    action = state.approval_request.action if state.approval_request else ""
    state.status = AgentStatus.COMPLETED
    state.approval_request = None
    if action == "create_tabular_review":
        state.answer = "No tabular review was created. I can continue with a normal cited answer in this chat."
    elif action:
        state.answer = "No artifact was created. I can continue with a normal cited answer in this chat."
    else:
        state.answer = "No side-effecting workflow was completed. I can continue normally in this chat."
    state.reason = feedback or "Human rejected the proposed side-effecting workflow."
    state.add_trace("approval_rejected", feedback=feedback or "")
    _store().save(state)
    return DeepContractAgentRunner(store=_store()).response_from_state(state)


# --- Shared Agent Helpers (from endpoints.py) ---
def format_sse_event(event: str, payload: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"

def _serialize_agent_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    clean_doc = dict(doc or {})
    clean_doc.pop("_id", None)
    for key in ("created_at", "updated_at", "archived_at"):
        if isinstance(clean_doc.get(key), datetime):
            clean_doc[key] = clean_doc[key].isoformat()
    return clean_doc

def _agent_memory() -> AgentMemoryManager:
    return AgentMemoryManager(db)


def _remember_if_durable(
    memory: AgentMemoryManager,
    *,
    contract_id: str,
    user_id: str,
    session_id: str,
    question: str,
    answer: str,
    metadata: Dict[str, Any],
) -> None:
    """Offer a completed answer to durable memory; the manager decides.

    Every answer path assembles the same `assistant_metadata` before persisting
    its message, so the citation and confidence the gate needs are read from
    there rather than re-derived per call site. Guarded because a memory write
    must never fail an answer the user already has.
    """
    annotations = metadata.get("citation_annotations") or []
    try:
        memory.remember_answer_if_durable(
            contract_id=contract_id,
            user_id=user_id,
            session_id=session_id,
            question=question,
            answer=answer,
            citation_count=len(annotations),
            confidence=metadata.get("confidence"),
            quote=str((annotations[0] or {}).get("quote") or "") if annotations else "",
        )
    except Exception as memory_error:
        log_exception(logger, "Failed to write durable agent memory", memory_error)


def _memory_composer(memory: AgentMemoryManager) -> MemoryComposer:
    """The single assembly point for what the agent is told up front.

    Both stores are resolved for every run regardless of surface. A contract
    chat inside a project used to see project facts only if the model guessed
    to call get_project_timeline (F-17); now it always sees the project index
    and facts, and the tools stay for pulling detail on demand.
    """
    return MemoryComposer(agent_memory=memory, project_memory=ProjectMemoryManager(db))


def _memory_disclosure_payload(composed: ComposedMemory) -> Dict[str, Any]:
    """The "what I remember" panel (4.5) gets exactly the blocks the model saw.

    Bodies are capped for transport; the panel is a disclosure, not a full
    memory browser, and the model already received the untruncated text.
    """
    return {
        "blocks": [
            {
                "name": block.name,
                "tier": block.tier,
                "heading": block.heading,
                "body": block.body[:1200],
                "provenance": block.provenance,
                "truncated": block.truncated,
            }
            for block in composed.blocks
        ],
        "dropped": list(composed.dropped),
        "total_chars": composed.total_chars,
        "budget_chars": composed.budget_chars,
    }


def _preference_blocks(current_user: UserInDB) -> List[MemoryBlock]:
    """Extra composer block for this user's saved preferences, or none set.

    Read here rather than inside the composer for the same reason kpi_context
    is: the composer owns ranking and budget, not how each block is sourced.
    Never raises — an unreadable preferences doc must degrade to no block, not
    fail the run.
    """
    try:
        org_id = str(current_user.ownedAccountId) if current_user.ownedAccountId else (
            str(current_user.teamIds[0]) if current_user.teamIds else None
        )
        values = UserPreferencesManager(db).get(str(current_user.id), org_id)
        block = preferences_block(values)
        return [block] if block else []
    except Exception as preferences_error:
        log_exception(logger, "Failed to load user preferences for memory composition", preferences_error)
        return []


def _agent_run_store() -> AgentRunStore:
    return AgentRunStore(db)


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value))


def _run_stream_agent_gate(
    *,
    user_id: str,
    message: str,
    context: AgentContext,
    ai_provider: Optional[str],
    memory_context: str = "",
    on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> AgentResponse:
    state = AgentRunState(
        user_id=user_id,
        message=message.strip(),
        context=context,
        ai_provider=ai_provider,
        memory_context=memory_context or "",
    )
    return DeepContractAgentRunner(
        store=_agent_run_store(),
        tool_executor=_stream_agent_tool_executor,
    ).run(state, on_event=on_event, cancel_check=cancel_check)


def _stream_agent_tool_executor(tool: ToolCallRecord, state: AgentRunState) -> Dict[str, Any]:
    return execute_mongo_read_tool(collection, tool, state)


def _should_interrupt_stream_for_agent(response: AgentResponse) -> bool:
    return (
        response.requires_approval
        or _enum_value(response.workflow) == AgentWorkflow.SECURITY_DENIAL.value
        or (
            _enum_value(response.workflow_status) == AgentStatus.COMPLETED.value
            and bool(response.answer.strip())
        )
    )


def _persist_stream_agent_gate_message(
    *,
    memory: AgentMemoryManager,
    session_id: str,
    scope_id: str,
    project_id: Optional[str],
    user_id: str,
    question: str,
    response: AgentResponse,
) -> None:
    metadata = {
        "source": "deep_workflow_agent",
        "workflow_id": response.workflow_id,
        "workflow": _enum_value(response.workflow),
        "workflow_status": _enum_value(response.workflow_status),
        "requires_approval": response.requires_approval,
        "approval_request": response.approval_request.model_dump(mode="json") if response.approval_request else None,
        "project_id": project_id,
        "created_review_id": response.created_review_id,
        "agent_trace": response.agent_trace,
        "token_usage": response.token_usage.model_dump(mode="json"),
        "cost_usd": response.cost_usd,
        "confidence": response.confidence,
        "citation": getattr(response, "citation", "") or "",
        "reason": response.reason,
        "citation_details": response.citation_details,
        "citation_annotations": response.citation_annotations,
    }
    memory.append_message(
        session_id=session_id,
        contract_id=scope_id,
        user_id=user_id,
        role="assistant",
        content=response.answer,
        metadata=metadata,
    )
    if not response.requires_approval:
        annotations = response.citation_annotations or []
        # Gated: only an answer backed by validated citations at real
        # confidence becomes a durable memory. Everything else is already a
        # conversation turn and does not need a second, unreviewed copy (F-20).
        memory.remember_answer_if_durable(
            contract_id=scope_id,
            user_id=user_id,
            session_id=session_id,
            question=question,
            answer=response.answer,
            citation_count=len(annotations),
            confidence=response.confidence,
            quote=str((annotations[0] or {}).get("quote") or "") if annotations else "",
        )
        # An episode of the agent's own work, separate from the transcript of
        # what was said. Guarded because a memory write must never be the thing
        # that fails a completed answer.
        try:
            memory.record_run_episode(
                session_id=session_id,
                contract_id=scope_id,
                user_id=user_id,
                project_id=project_id,
                question=question,
                tools_called=response.tools_called or [],
                citation_count=len(response.citation_annotations or []),
                confidence=response.confidence,
                unsupported=not (response.citation_annotations or []),
                workflow_id=response.workflow_id,
            )
        except Exception as episode_error:
            log_exception(logger, "Failed to record agent run episode", episode_error)



def _kpi_source_ingestion() -> KpiSourceIngestionService:
    return KpiSourceIngestionService(db)


def _kpi_context_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


def _latest_actuals_by_kpi(actuals: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    grouped: Dict[str, Dict[str, Any]] = {}
    for actual in actuals or []:
        kpi_id = str(actual.get("kpi_id") or "")
        if not kpi_id:
            continue
        current = grouped.get(kpi_id)
        actual_time = _kpi_context_timestamp(actual.get("timestamp") or actual.get("created_at"))
        current_time = _kpi_context_timestamp((current or {}).get("timestamp") or (current or {}).get("created_at"))
        if not current or actual_time >= current_time:
            grouped[kpi_id] = actual
    return grouped


def _source_mode_for_context(source: Dict[str, Any]) -> str:
    source_type = str(source.get("source_type") or "").lower()
    cadence = str((source.get("schedule") or {}).get("cadence") or "manual").lower()
    if source_type == "manual_attestation":
        return "manual attestation"
    if cadence in {"webhook", "real_time", "realtime", "on_file_arrival"}:
        return "webhook/realtime"
    if source.get("enabled") or cadence not in {"", "manual"}:
        return f"scheduled {cadence}"
    return "manual fetch"


def _normalize_kpi_match_text(value: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower())).strip()


def _is_operational_kpi_question(question: str) -> bool:
    text = _normalize_kpi_match_text(question)
    if "kpi" not in text:
        return False
    operational_terms = {
        "actual",
        "assigned",
        "assignment",
        "breach",
        "compliance",
        "fetch",
        "flag",
        "historical",
        "ingest",
        "latest",
        "log",
        "logs",
        "run",
        "source",
        "sources",
        "track",
        "tracked",
    }
    return any(term in text.split() for term in operational_terms)


def _matching_operational_kpis(question: str, kpis: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    question_text = _normalize_kpi_match_text(question)
    question_terms = {
        term
        for term in question_text.split()
        if len(term) > 2 and term not in {
            "actual",
            "assigned",
            "from",
            "kpi",
            "latest",
            "named",
            "source",
            "sources",
            "the",
            "value",
            "was",
            "what",
            "which",
        }
    }
    scored: List[Tuple[int, Dict[str, Any]]] = []
    for kpi in kpis:
        name_text = _normalize_kpi_match_text(kpi.get("name") or "")
        id_text = _normalize_kpi_match_text(kpi.get("kpi_id") or "")
        if not name_text and not id_text:
            continue
        score = 0
        if name_text and name_text in question_text:
            score += 100
        if id_text and id_text in question_text:
            score += 80
        name_terms = {term for term in name_text.split() if len(term) > 2}
        score += len(question_terms & name_terms) * 8
        if score:
            scored.append((score, kpi))
    scored.sort(key=lambda item: item[0], reverse=True)
    if scored:
        best_score = scored[0][0]
        return [kpi for score, kpi in scored[:3] if score >= max(16, best_score - 24)]
    approved = [kpi for kpi in kpis if kpi.get("status") == "approved"]
    return approved[:3]


def _build_operational_kpi_answer(
    question: str,
    kpis: List[Dict[str, Any]],
    *,
    source_configs: Optional[List[Dict[str, Any]]] = None,
    actuals: Optional[List[Dict[str, Any]]] = None,
    breaches: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    if not _is_operational_kpi_question(question):
        return None
    selected_kpis = _matching_operational_kpis(question, kpis)
    if not selected_kpis:
        return None

    source_configs = source_configs or []
    latest_actuals = _latest_actuals_by_kpi(actuals or [])
    source_by_id = {str(source.get("source_config_id")): source for source in source_configs if source.get("source_config_id")}
    sources_by_kpi: Dict[str, List[Dict[str, Any]]] = {}
    for source in source_configs:
        for kpi_id in source.get("kpi_ids") or []:
            sources_by_kpi.setdefault(str(kpi_id), []).append(source)
    for kpi in kpis:
        legacy_source = source_by_id.get(str(kpi.get("source_config_id") or ""))
        if legacy_source:
            kpi_id = str(kpi.get("kpi_id") or "")
            sources_by_kpi.setdefault(kpi_id, [])
            if legacy_source not in sources_by_kpi[kpi_id]:
                sources_by_kpi[kpi_id].append(legacy_source)

    open_flags_by_kpi: Dict[str, Dict[str, Any]] = {}
    for breach in breaches or []:
        if breach.get("is_breach") and str(breach.get("status") or "open").lower() != "resolved":
            open_flags_by_kpi.setdefault(str(breach.get("kpi_id") or ""), breach)

    def source_label(source: Dict[str, Any]) -> str:
        return str(source.get("display_name") or source.get("source_config_id") or "Configured source")

    def actual_source_label(actual: Dict[str, Any]) -> str:
        metadata = actual.get("metadata") or {}
        source_config = source_by_id.get(str(metadata.get("source_config_id") or ""))
        if source_config:
            return source_label(source_config)
        if metadata.get("source_display_name"):
            return str(metadata.get("source_display_name"))
        return str(actual.get("source") or "manual")

    sections: List[str] = []
    for kpi in selected_kpis:
        kpi_id = str(kpi.get("kpi_id") or "")
        assigned_sources = sources_by_kpi.get(kpi_id) or []
        source_lines = []
        for source in assigned_sources:
            last_fetch = source.get("last_fetch_status") or {}
            source_bits = [
                source_label(source),
                str(source.get("source_type") or "source"),
                _source_mode_for_context(source),
                f"status {source.get('status') or 'draft'}",
            ]
            if last_fetch.get("status"):
                source_bits.append(
                    f"last run {last_fetch.get('status')} with {last_fetch.get('accepted_count') or last_fetch.get('record_count') or 0} records"
                )
            source_lines.append("- " + " · ".join(bit for bit in source_bits if bit))
        latest_actual = latest_actuals.get(kpi_id)
        if latest_actual:
            latest_text = (
                f"{latest_actual.get('value')} {latest_actual.get('unit') or kpi.get('unit') or ''}".strip()
                + f" from {actual_source_label(latest_actual)}"
                + f" at {_kpi_context_timestamp(latest_actual.get('timestamp') or latest_actual.get('created_at'))}"
            )
        else:
            latest_text = "No actual has been ingested yet."
        open_flag = open_flags_by_kpi.get(kpi_id)
        flag_text = (
            f"{open_flag.get('severity') or 'open'} flag, status {open_flag.get('status') or 'open'}, actual {open_flag.get('actual_value')} {open_flag.get('actual_unit') or kpi.get('unit') or ''}".strip()
            if open_flag else "No open compliance flag in the KPI register."
        )
        sections.append(
            "\n".join([
                f"**{kpi.get('name') or 'KPI'}**",
                f"- KPI ID: `{kpi_id}`",
                f"- State: {kpi.get('status') or 'draft'}" + (" · tracked" if kpi.get("is_tracked") else ""),
                "- Assigned actual sources:",
                *(source_lines or ["- No actual source is assigned yet."]),
                f"- Latest actual: {latest_text}",
                f"- Compliance flag: {flag_text}",
            ])
        )

    answer = (
        "I checked the ContractSense KPI register and source configuration, not the PDF text.\n\n"
        + "\n\n".join(sections)
    )
    return {
        "answer": answer,
        "question": question,
        "confidence": "high",
        "citation": "",
        "reason": "Answered from ContractSense operational KPI data: KPI register, source configurations, actual logs, and compliance flags.",
        "citation_details": {
            "cited_segments": [],
            "justification": "Operational KPI data is stored outside the contract PDF.",
            "source_pages_display": "ContractSense KPI register",
            "annotations": [],
        },
        "citation_annotations": [],
        "vector_namespace": None,
        "vector_backend": None,
    }


def _load_kpi_agent_operational_context(contract_ids: List[str]) -> Dict[str, List[Dict[str, Any]]]:
    """Source configs, actuals and breaches for every scoped contract.

    Three queries per contract, run in a loop, against Atlas at roughly 200ms a
    round trip: a five-document project spent three and a half seconds here
    before the agent had been asked anything. Callers should skip it entirely
    when the project has no KPIs — see the project stream.
    """
    manager = _kpi_manager()
    context = {"source_configs": [], "actuals": [], "breaches": []}
    seen: set[str] = set()
    for raw_contract_id in contract_ids:
        contract_id = str(raw_contract_id)
        if not contract_id or contract_id in seen:
            continue
        seen.add(contract_id)
        try:
            context["source_configs"].extend(manager.list_source_configs(contract_id))
            context["actuals"].extend(manager.list_contract_actuals(contract_id))
            context["breaches"].extend(manager.list_contract_breaches(contract_id))
        except Exception as exc:
            logger.warning("Failed to load KPI agent context for contract %s: %s", contract_id, exc)
    return context


def _compact_kpi_context(
    kpis: List[Dict[str, Any]],
    *,
    source_configs: Optional[List[Dict[str, Any]]] = None,
    actuals: Optional[List[Dict[str, Any]]] = None,
    breaches: Optional[List[Dict[str, Any]]] = None,
    limit: int = 18,
) -> str:
    if not kpis:
        return ""
    approved = [kpi for kpi in kpis if kpi.get("status") == "approved"]
    drafts = [kpi for kpi in kpis if kpi.get("status") != "approved"]
    ordered = [*approved, *drafts][:limit]
    source_configs = source_configs or []
    latest_actuals = _latest_actuals_by_kpi(actuals or [])
    source_by_id = {str(source.get("source_config_id")): source for source in source_configs if source.get("source_config_id")}
    sources_by_kpi: Dict[str, List[Dict[str, Any]]] = {}
    for source in source_configs:
        for kpi_id in source.get("kpi_ids") or []:
            sources_by_kpi.setdefault(str(kpi_id), []).append(source)
    for kpi in kpis:
        source = source_by_id.get(str(kpi.get("source_config_id") or ""))
        if source:
            sources_by_kpi.setdefault(str(kpi.get("kpi_id")), [])
            if source not in sources_by_kpi[str(kpi.get("kpi_id"))]:
                sources_by_kpi[str(kpi.get("kpi_id"))].append(source)
    def actual_source_label(actual: Dict[str, Any]) -> str:
        metadata = actual.get("metadata") or {}
        source_config_id = str(metadata.get("source_config_id") or "")
        source_config = source_by_id.get(source_config_id)
        if source_config:
            return str(source_config.get("display_name") or source_config.get("source_config_id") or "configured source")
        if metadata.get("source_display_name"):
            return str(metadata.get("source_display_name"))
        return str(actual.get("source") or "manual")
    open_flags_by_kpi: Dict[str, Dict[str, Any]] = {}
    for breach in breaches or []:
        if breach.get("is_breach") and str(breach.get("status") or "open").lower() != "resolved":
            open_flags_by_kpi.setdefault(str(breach.get("kpi_id") or ""), breach)
    lines = [
        "## KPI Register",
        "Use approved KPIs as operational truth. Treat draft KPIs as extraction candidates that need user review.",
        "For questions about KPI source assignments, latest actuals, fetch status, or compliance flags, prefer this operational KPI data over contract text.",
    ]
    for index, kpi in enumerate(ordered, start=1):
        status_text = kpi.get("status") or "draft"
        value_bits = [
            str(kpi.get("operator") or "").replace("_", " "),
            str(kpi.get("value") or ""),
            str(kpi.get("unit") or ""),
        ]
        value_text = " ".join(bit for bit in value_bits if bit).strip() or "value pending review"
        page = kpi.get("page_start")
        source = f"page {page}" if page else "source page unknown"
        quote = str(kpi.get("quote") or kpi.get("description") or "").strip()
        if len(quote) > 220:
            quote = quote[:217].rstrip() + "..."
        kpi_id = str(kpi.get("kpi_id") or "")
        assigned_sources = sources_by_kpi.get(kpi_id) or []
        source_text = "; ".join(
            [
                (
                    f"{source.get('display_name') or source.get('source_config_id')}"
                    f" ({source.get('source_type') or 'source'}, {_source_mode_for_context(source)}, status={source.get('status') or 'draft'})"
                )
                for source in assigned_sources[:6]
            ]
        )
        if len(assigned_sources) > 6:
            source_text += f"; +{len(assigned_sources) - 6} more"
        latest_actual = latest_actuals.get(kpi_id)
        if latest_actual:
            latest_text = (
                f"{latest_actual.get('value')} {latest_actual.get('unit') or kpi.get('unit') or ''}".strip()
                + f" from {actual_source_label(latest_actual)}"
                + f" at {_kpi_context_timestamp(latest_actual.get('timestamp') or latest_actual.get('created_at'))}"
            )
        else:
            latest_text = "none"
        open_flag = open_flags_by_kpi.get(kpi_id)
        flag_text = (
            f"{open_flag.get('severity') or 'open'} flag; actual={open_flag.get('actual_value')} {open_flag.get('actual_unit') or kpi.get('unit') or ''}; status={open_flag.get('status') or 'open'}"
            if open_flag else "none"
        )
        lines.append(
            f"{index}. [{status_text}] {kpi.get('name') or 'KPI'} | "
            f"type={kpi.get('kpi_type') or 'obligation'} | value={value_text} | "
            f"party={kpi.get('party') or 'unspecified'} | document={kpi.get('contract_name') or kpi.get('contract_id')} | {source} | "
            f"assigned_sources={source_text or 'none'} | latest_actual={latest_text} | open_flag={flag_text} | quote=\"{quote}\""
        )
    if len(kpis) > limit:
        lines.append(f"... {len(kpis) - limit} more KPI rows exist in the register.")
    return "\n".join(lines)


def _project_agent_scope_id(project_id: str) -> str:
    return f"project:{project_id}"


def _load_indexed_project_documents(
    *,
    project_id: str,
    current_user: UserInDB,
    reference_contract_ids: Optional[List[str]] = None,
    include_content: bool = True,
    project_doc: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Every indexed, accessible document in the project.

    `include_content=False` returns the same documents without their parsed
    markdown. The filters are unchanged either way — "is this document indexed"
    is still decided server-side by `index.status` and the `index.content` type
    check — so the caller gets exactly the same document set, just without
    carrying every body it is not going to read. A project agent turn that only
    needs the ids was otherwise pulling the full text of every contract in the
    project out of Mongo on every message.
    """
    # `project_doc` lets a caller that has already verified access pass the
    # project through. Re-checking costs a round trip and cannot reach a
    # different answer within one request.
    if project_doc is None:
        project_doc = verify_project_access(project_id, current_user)
    project_query = build_accessible_contract_query(project_doc, current_user)
    project_filters: List[Dict[str, Any]] = [
        project_query,
        {"index.status": "success"},
        {"index.content": {"$type": "string", "$ne": ""}},
    ]

    reference_oids: List[ObjectId] = []
    for raw_reference_id in reference_contract_ids or []:
        try:
            reference_oid = ObjectId(raw_reference_id)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid referenced contract ID: {raw_reference_id}")
        if reference_oid not in reference_oids:
            reference_oids.append(reference_oid)

    if reference_oids:
        project_filters.append({"_id": {"$in": reference_oids}})

    projection: Dict[str, Any] = {
        "_id": 1,
        "contract_name": 1,
        "projectId": 1,
        "index.vector_namespace": 1,
        "index.vector_backend": 1,
    }
    if include_content:
        projection["index.content"] = 1

    documents = list(collection.find({"$and": project_filters}, projection))

    if reference_oids:
        found_reference_ids = {str(document["_id"]) for document in documents}
        expected_reference_ids = {str(oid) for oid in reference_oids}
        if missing_reference_ids := expected_reference_ids - found_reference_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    "One or more referenced documents are not indexed or not accessible yet: "
                    + ", ".join(sorted(missing_reference_ids))
                ),
            )

    return documents


def _create_agent_document_if_needed(
    *,
    contract_id: str,
    project_id: Optional[str],
    user_id: str,
    session_id: str,
    contract_name: str,
    question: str,
    answer: str,
    source_text: str,
) -> Optional[Dict[str, Any]]:
    try:
        result = _agent_documents().create_from_agent_turn(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            contract_name=contract_name,
            question=question,
            answer=answer,
            source_text=source_text,
        )
        return result.to_payload(contract_id=contract_id) if result else None
    except Exception as artifact_error:
        log_exception(logger, f"Failed to create editable agent document for contract {contract_id}", artifact_error)
        return None


def check_contract_access(contract_doc: Optional[Dict[str, Any]], current_user: UserInDB):
    """
    Checks if the user has access to the given contract document based on ownerType/ownerId.
    Raises HTTPException (404 or 403) if access is denied or contract not found.
    """
    # Check if contract document exists first
    if not contract_doc:
        logger.warning(f"Access check failed: Contract document is None (User: {current_user.id}).")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")

    contract_id = contract_doc.get("_id", "Unknown ID")
    owner_type = contract_doc.get("ownerType")
    owner_id = contract_doc.get("ownerId") 

    # Validate ownership fields exist
    if not owner_type or not owner_id:
        logger.error(f"Contract {contract_id} is missing ownerType ('{owner_type}') or ownerId ('{owner_id}'). Access denied.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Contract ownership data invalid or missing.")

    user_oid = ObjectId(current_user.id)
    owner_id_str = str(owner_id) if owner_id is not None else None

    # Check access based on ownerType
    if owner_type == "user":
        if owner_id != user_oid and owner_id_str != current_user.id:
            logger.warning(f"Access denied: User {current_user.id} attempting to access user-owned contract {contract_id} owned by {owner_id}.")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to access this contract.")
    elif owner_type == "team":
        user_team_ids = current_user.teamIds if current_user.teamIds else []
        is_owner = current_user.ownedAccountId == owner_id_str
        is_member = owner_id_str in user_team_ids
        direct_membership = False
        if not is_owner and not is_member and teams_collection and isinstance(owner_id, ObjectId):
            direct_membership = bool(teams_collection.find_one(
                {"_id": owner_id, "members.userId": user_oid},
                {"_id": 1}
            ))
        if not (is_owner or is_member or direct_membership):
            logger.warning(f"Access denied: User {current_user.id} attempting to access team-owned contract {contract_id} owned by team {owner_id}. User is not a member of this team (User teams: {user_team_ids}).")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to access this contract (not a team member).")
    else:
        # Invalid ownerType found in the database
        logger.error(f"Contract {contract_id} has an invalid ownerType: '{owner_type}'. Access denied.")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invalid contract ownership type found.")

    logger.debug(f"Access granted for user {current_user.id} to contract {contract_id} (Owner: {owner_type}:{owner_id})")



# --- Agent Routes (from endpoints.py) ---
@router.get("/agent/sessions/recent")
def list_recent_agent_sessions(
    limit: int = Query(8, ge=1, le=20),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    sessions = _agent_memory().list_recent_sessions(user_id=str(current_user.id), limit=limit)
    contract_ids = [
        session.get("contract_id")
        for session in sessions
        if isinstance(session.get("contract_id"), str) and ObjectId.is_valid(session.get("contract_id"))
    ]
    project_session_ids = [
        str(session.get("project_id") or str(session.get("contract_id") or "").replace("project:", "", 1))
        for session in sessions
        if isinstance(session.get("contract_id"), str)
        and str(session.get("contract_id")).startswith("project:")
        and ObjectId.is_valid(str(session.get("project_id") or str(session.get("contract_id")).replace("project:", "", 1)))
    ]
    contract_object_ids = [ObjectId(contract_id) for contract_id in contract_ids]
    contracts_by_id: Dict[str, Dict[str, Any]] = {}
    project_ids = set()

    if contract_object_ids:
        for contract in collection.find(
            {"_id": {"$in": contract_object_ids}},
            {"_id": 1, "contract_name": 1, "projectId": 1, "ownerType": 1, "ownerId": 1},
        ):
            try:
                check_contract_access(contract, current_user)
            except HTTPException:
                continue
            contract_id_text = str(contract.get("_id"))
            contracts_by_id[contract_id_text] = contract
            project_id = contract.get("projectId")
            if isinstance(project_id, ObjectId):
                project_ids.add(project_id)

    accessible_project_session_ids = set()
    for project_id_text in project_session_ids:
        try:
            project = verify_project_access(project_id_text, current_user)
        except HTTPException:
            continue
        accessible_project_session_ids.add(project_id_text)
        project_ids.add(project["_id"])

    projects_by_id: Dict[str, str] = {}
    if project_ids:
        for project in projects_collection.find({"_id": {"$in": list(project_ids)}}, {"name": 1}):
            projects_by_id[str(project.get("_id"))] = project.get("name") or "Project"

    enriched_sessions: List[Dict[str, Any]] = []
    for session in sessions:
        contract_id_text = str(session.get("contract_id") or "")
        if contract_id_text.startswith("project:"):
            project_id_text = str(session.get("project_id") or contract_id_text.replace("project:", "", 1))
            if project_id_text not in accessible_project_session_ids:
                continue
            enriched = dict(session)
            enriched["contract_id"] = contract_id_text
            enriched["contract_name"] = projects_by_id.get(project_id_text) or enriched.get("contract_name") or "Project assistant"
            enriched["project_id"] = project_id_text
            enriched["project_name"] = projects_by_id.get(project_id_text) or "Project"
            enriched["is_project_session"] = True
            enriched_sessions.append(enriched)
            continue

        contract = contracts_by_id.get(contract_id_text)
        if not contract:
            continue
        enriched = dict(session)
        enriched["contract_id"] = contract_id_text
        enriched["contract_name"] = contract.get("contract_name") or enriched.get("contract_name") or contract_id_text
        project_id = contract.get("projectId") or enriched.get("project_id")
        if project_id:
            project_id_text = str(project_id)
            enriched["project_id"] = project_id_text
            if project_id_text in projects_by_id:
                enriched["project_name"] = projects_by_id[project_id_text]
        enriched_sessions.append(enriched)

    return {"sessions": [_serialize_agent_doc(session) for session in enriched_sessions]}


@router.get("/contracts/{contract_id}/agent/sessions")
def list_contract_agent_sessions(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one(
        {"_id": contract_oid},
        {"_id": 1, "ownerType": 1, "ownerId": 1},
    )
    check_contract_access(contract, current_user)
    sessions = _agent_memory().list_sessions(contract_id=contract_id, user_id=str(current_user.id))
    return {"sessions": [_serialize_agent_doc(session) for session in sessions]}


@router.get("/contracts/{contract_id}/agent/sessions/{session_id}/messages")
def get_contract_agent_session_messages(
    contract_id: str,
    session_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one(
        {"_id": contract_oid},
        {"_id": 1, "ownerType": 1, "ownerId": 1},
    )
    check_contract_access(contract, current_user)
    messages = _agent_memory().get_messages(
        session_id=session_id,
        contract_id=contract_id,
        user_id=str(current_user.id),
    )
    return {"messages": [_serialize_agent_doc(message) for message in messages]}


@router.delete("/contracts/{contract_id}/agent/sessions/{session_id}")
def clear_contract_agent_session(
    contract_id: str,
    session_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one(
        {"_id": contract_oid},
        {"_id": 1, "ownerType": 1, "ownerId": 1},
    )
    check_contract_access(contract, current_user)
    cleared = _agent_memory().clear_session(
        session_id=session_id,
        contract_id=contract_id,
        user_id=str(current_user.id),
    )
    return {"status": "cleared" if cleared else "not_found", "session_id": session_id}


@router.get("/contracts/{contract_id}/agent/drafts")
def list_contract_agent_drafts(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one(
        {"_id": contract_oid},
        {"_id": 1, "ownerType": 1, "ownerId": 1},
    )
    check_contract_access(contract, current_user)
    drafts = _agent_memory().list_drafts(contract_id=contract_id, user_id=str(current_user.id))
    return {"drafts": [_serialize_agent_doc(draft) for draft in drafts]}


@router.get("/projects/{project_id}/agent/sessions")
def list_project_agent_sessions(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    project_scope_id = _project_agent_scope_id(project_id)
    sessions = _agent_memory().list_sessions(contract_id=project_scope_id, user_id=str(current_user.id))
    return {"sessions": [_serialize_agent_doc(session) for session in sessions]}


@router.get("/projects/{project_id}/agent/sessions/{session_id}/messages")
def get_project_agent_session_messages(
    project_id: str,
    session_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    project_scope_id = _project_agent_scope_id(project_id)
    messages = _agent_memory().get_messages(
        session_id=session_id,
        contract_id=project_scope_id,
        user_id=str(current_user.id),
    )
    return {"messages": [_serialize_agent_doc(message) for message in messages]}


@router.delete("/projects/{project_id}/agent/sessions/{session_id}")
def clear_project_agent_session(
    project_id: str,
    session_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    project_scope_id = _project_agent_scope_id(project_id)
    cleared = _agent_memory().clear_session(
        session_id=session_id,
        contract_id=project_scope_id,
        user_id=str(current_user.id),
    )
    return {"status": "cleared" if cleared else "not_found", "session_id": session_id}


@router.get("/projects/{project_id}/agent/drafts")
def list_project_agent_drafts(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    project_scope_id = _project_agent_scope_id(project_id)
    drafts = _agent_memory().list_drafts(contract_id=project_scope_id, user_id=str(current_user.id))
    return {"drafts": [_serialize_agent_doc(draft) for draft in drafts]}


@router.get("/projects/{project_id}/agent/documents")
def list_project_agent_documents(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    documents = _agent_documents().list_project_documents(project_id=project_id, user_id=str(current_user.id))
    return {"documents": documents}


@router.get("/projects/{project_id}/agent/documents/{document_id}/versions/{version_id}")
def preview_project_agent_document_version(
    project_id: str,
    document_id: str,
    version_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    preview = _agent_documents().get_project_version_preview(
        project_id=project_id,
        user_id=str(current_user.id),
        document_id=document_id,
        version_id=version_id,
    )
    if not preview:
        raise HTTPException(status_code=404, detail="Agent document version not found.")
    return preview


@router.post("/projects/{project_id}/agent/documents/{document_id}/versions")
def save_project_agent_document_text_version(
    project_id: str,
    document_id: str,
    request: AgentDocumentTextSaveRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    result = _agent_documents().save_text_version(
        project_id=project_id,
        user_id=str(current_user.id),
        document_id=document_id,
        body_text=request.body_text,
        change_summary=request.change_summary or "Saved from live editor",
    )
    if not result:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return result.to_payload(contract_id=f"project:{project_id}")


@router.get("/projects/{project_id}/agent/documents/{document_id}/versions/{version_id}/download")
def download_project_agent_document_version(
    project_id: str,
    document_id: str,
    version_id: str,
    current_user: UserInDB = Depends(get_current_user_from_ticket_or_session),
) -> StreamingResponse:
    verify_project_access(project_id, current_user)
    version, grid_out = _agent_documents().get_project_version_file(
        project_id=project_id,
        user_id=str(current_user.id),
        document_id=document_id,
        version_id=version_id,
    )
    if not version or not grid_out:
        raise HTTPException(status_code=404, detail="Agent document version not found.")

    return StreamingResponse(
        grid_out,
        media_type=grid_out.content_type or "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": content_disposition("attachment", version.get("filename") or grid_out.filename, "Project Work Product.docx"),
            "Cache-Control": "private, max-age=60",
        },
    )


@router.get("/projects/{project_id}/agent/documents/{document_id}/tracked-change-ids")
def list_project_agent_document_tracked_change_ids(
    project_id: str,
    document_id: str,
    version_id: Optional[str] = Query(None),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    ids = _agent_documents().tracked_change_ids(
        project_id=project_id,
        user_id=str(current_user.id),
        document_id=document_id,
        version_id=version_id,
    )
    if ids is None:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return {"document_id": document_id, "version_id": version_id, "tracked_change_ids": ids}


@router.get("/projects/{project_id}/agent/documents/{document_id}/read")
def read_project_agent_document(
    project_id: str,
    document_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    current = _agent_documents().read_current_document(
        project_id=project_id,
        user_id=str(current_user.id),
        document_id=document_id,
    )
    if not current:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return current


@router.get("/projects/{project_id}/agent/documents/{document_id}/find")
def find_in_project_agent_document(
    project_id: str,
    document_id: str,
    q: str = Query(..., min_length=1),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    result = _agent_documents().find_in_document(
        project_id=project_id,
        user_id=str(current_user.id),
        document_id=document_id,
        query=q,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return result


@router.post("/projects/{project_id}/agent/documents/{document_id}/replicate")
def replicate_project_agent_document(
    project_id: str,
    document_id: str,
    request: AgentDocumentReplicateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    results = _agent_documents().replicate_document(
        project_id=project_id,
        user_id=str(current_user.id),
        document_id=document_id,
        count=request.count,
    )
    if results is None:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return {"documents": [result.to_payload(contract_id=f"project:{project_id}") for result in results]}


@router.post("/projects/{project_id}/agent/documents/{document_id}/edits")
def edit_project_agent_document(
    project_id: str,
    document_id: str,
    request: AgentDocumentEditRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    if not request.edits:
        raise HTTPException(status_code=400, detail="At least one edit is required.")
    result = _agent_documents().edit_document(
        project_id=project_id,
        user_id=str(current_user.id),
        document_id=document_id,
        edits=request.edits,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return {
        "document_id": result.document_id,
        "version_id": result.version_id,
        "version_number": result.version_number,
        "filename": result.filename,
        "download_url": result.download_url,
        "edit_annotations": result.annotations,
        "errors": result.errors,
    }


@router.post("/projects/{project_id}/agent/documents/{document_id}/edits/{edit_id}/accept")
def accept_project_agent_document_edit(
    project_id: str,
    document_id: str,
    edit_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    result = _agent_documents().resolve_tracked_edit(
        project_id=project_id,
        user_id=str(current_user.id),
        document_id=document_id,
        edit_id=edit_id,
        mode="accept",
    )
    if not result:
        raise HTTPException(status_code=404, detail="Tracked edit not found.")
    return result


@router.post("/projects/{project_id}/agent/documents/{document_id}/edits/{edit_id}/reject")
def reject_project_agent_document_edit(
    project_id: str,
    document_id: str,
    edit_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    result = _agent_documents().resolve_tracked_edit(
        project_id=project_id,
        user_id=str(current_user.id),
        document_id=document_id,
        edit_id=edit_id,
        mode="reject",
    )
    if not result:
        raise HTTPException(status_code=404, detail="Tracked edit not found.")
    return result


@router.get("/contracts/{contract_id}/agent/artifacts/{artifact_id}/download")
def download_contract_agent_artifact(
    contract_id: str,
    artifact_id: str,
    current_user: UserInDB = Depends(get_current_user_from_ticket_or_session),
) -> StreamingResponse:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one(
        {"_id": contract_oid},
        {"_id": 1, "ownerType": 1, "ownerId": 1},
    )
    check_contract_access(contract, current_user)

    grid_out = fs.find_one({
        "metadata.artifact_id": artifact_id,
        "metadata.contract_id": contract_id,
        "metadata.user_id": str(current_user.id),
        "metadata.source": "agent_work_product",
    })
    if not grid_out:
        raise HTTPException(status_code=404, detail="Agent artifact not found.")

    return StreamingResponse(
        grid_out,
        media_type=grid_out.content_type or "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": content_disposition("attachment", grid_out.filename, "Contract Work Product.docx"),
            "Cache-Control": "private, max-age=60",
        },
    )


@router.get("/contracts/{contract_id}/agent/documents")
def list_contract_agent_documents(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    documents = _agent_documents().list_documents(contract_id=contract_id, user_id=str(current_user.id))
    return {"documents": documents}


@router.post("/contracts/{contract_id}/agent/documents/copy")
def create_contract_agent_editable_copy(
    contract_id: str,
    request: AgentDocumentCopyRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    contract = get_contract_and_verify_access(
        contract_id,
        current_user,
        {
            "_id": 1,
            "contract_name": 1,
            "ownerType": 1,
            "ownerId": 1,
            "projectId": 1,
            "index.status": 1,
            "index.content": 1,
        },
    )

    index_data = contract.get("index", {})
    source_text = index_data.get("content") or ""
    if index_data.get("status") != "success" or not source_text.strip():
        raise HTTPException(status_code=400, detail="Contract is not indexed yet.")

    user_id_text = str(current_user.id)
    project_id = contract.get("projectId")
    project_id_text = str(project_id) if project_id else None
    session = _agent_memory().ensure_session(
        contract_id=contract_id,
        user_id=user_id_text,
        session_id=request.session_id,
        contract_name=contract.get("contract_name", contract_id),
        project_id=project_id_text,
        title_seed="Create editable contract copy",
    )
    result = _agent_documents().create_plain_copy(
        contract_id=contract_id,
        project_id=project_id_text,
        user_id=user_id_text,
        session_id=session["session_id"],
        contract_name=contract.get("contract_name", contract_id),
        source_text=source_text,
    )
    payload = result.to_payload(contract_id=contract_id)
    payload["session_id"] = session["session_id"]
    return payload


@router.get("/contracts/{contract_id}/agent/documents/{document_id}/versions/{version_id}")
def preview_contract_agent_document_version(
    contract_id: str,
    document_id: str,
    version_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    preview = _agent_documents().get_version_preview(
        contract_id=contract_id,
        user_id=str(current_user.id),
        document_id=document_id,
        version_id=version_id,
    )
    if not preview:
        raise HTTPException(status_code=404, detail="Agent document version not found.")
    return preview


@router.post("/contracts/{contract_id}/agent/documents/{document_id}/versions")
def save_contract_agent_document_text_version(
    contract_id: str,
    document_id: str,
    request: AgentDocumentTextSaveRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    result = _agent_documents().save_text_version(
        contract_id=contract_id,
        user_id=str(current_user.id),
        document_id=document_id,
        body_text=request.body_text,
        change_summary=request.change_summary or "Saved from live editor",
    )
    if not result:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return result.to_payload(contract_id=contract_id)


@router.get("/contracts/{contract_id}/agent/documents/{document_id}/versions/{version_id}/download")
def download_contract_agent_document_version(
    contract_id: str,
    document_id: str,
    version_id: str,
    current_user: UserInDB = Depends(get_current_user_from_ticket_or_session),
) -> StreamingResponse:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})

    version, grid_out = _agent_documents().get_version_file(
        contract_id=contract_id,
        user_id=str(current_user.id),
        document_id=document_id,
        version_id=version_id,
    )
    if not version or not grid_out:
        raise HTTPException(status_code=404, detail="Agent document version not found.")

    return StreamingResponse(
        grid_out,
        media_type=grid_out.content_type or "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": content_disposition("attachment", version.get("filename") or grid_out.filename, "Contract Work Product.docx"),
            "Cache-Control": "private, max-age=60",
        },
    )


@router.get("/contracts/{contract_id}/agent/documents/{document_id}/tracked-change-ids")
def list_contract_agent_document_tracked_change_ids(
    contract_id: str,
    document_id: str,
    version_id: Optional[str] = Query(None),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    ids = _agent_documents().tracked_change_ids(
        contract_id=contract_id,
        user_id=str(current_user.id),
        document_id=document_id,
        version_id=version_id,
    )
    if ids is None:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return {"document_id": document_id, "version_id": version_id, "tracked_change_ids": ids}


@router.get("/contracts/{contract_id}/agent/documents/{document_id}/read")
def read_contract_agent_document(
    contract_id: str,
    document_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    current = _agent_documents().read_current_document(
        contract_id=contract_id,
        user_id=str(current_user.id),
        document_id=document_id,
    )
    if not current:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return current


@router.get("/contracts/{contract_id}/agent/documents/{document_id}/find")
def find_in_contract_agent_document(
    contract_id: str,
    document_id: str,
    q: str = Query(..., min_length=1),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    result = _agent_documents().find_in_document(
        contract_id=contract_id,
        user_id=str(current_user.id),
        document_id=document_id,
        query=q,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return result


@router.post("/contracts/{contract_id}/agent/documents/{document_id}/replicate")
def replicate_contract_agent_document(
    contract_id: str,
    document_id: str,
    request: AgentDocumentReplicateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    results = _agent_documents().replicate_document(
        contract_id=contract_id,
        user_id=str(current_user.id),
        document_id=document_id,
        count=request.count,
    )
    if results is None:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return {"documents": [result.to_payload(contract_id=contract_id) for result in results]}


@router.post("/contracts/{contract_id}/agent/documents/{document_id}/edits")
def edit_contract_agent_document(
    contract_id: str,
    document_id: str,
    request: AgentDocumentEditRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    if not request.edits:
        raise HTTPException(status_code=400, detail="At least one edit is required.")
    result = _agent_documents().edit_document(
        contract_id=contract_id,
        user_id=str(current_user.id),
        document_id=document_id,
        edits=request.edits,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Agent document not found.")
    return {
        "document_id": result.document_id,
        "version_id": result.version_id,
        "version_number": result.version_number,
        "filename": result.filename,
        "download_url": result.download_url,
        "edit_annotations": result.annotations,
        "errors": result.errors,
    }


@router.post("/contracts/{contract_id}/agent/documents/{document_id}/edits/{edit_id}/accept")
def accept_contract_agent_document_edit(
    contract_id: str,
    document_id: str,
    edit_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    result = _agent_documents().resolve_tracked_edit(
        contract_id=contract_id,
        user_id=str(current_user.id),
        document_id=document_id,
        edit_id=edit_id,
        mode="accept",
    )
    if not result:
        raise HTTPException(status_code=404, detail="Tracked edit not found.")
    return result


@router.post("/contracts/{contract_id}/agent/documents/{document_id}/edits/{edit_id}/reject")
def reject_contract_agent_document_edit(
    contract_id: str,
    document_id: str,
    edit_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    result = _agent_documents().resolve_tracked_edit(
        contract_id=contract_id,
        user_id=str(current_user.id),
        document_id=document_id,
        edit_id=edit_id,
        mode="reject",
    )
    if not result:
        raise HTTPException(status_code=404, detail="Tracked edit not found.")
    return result


@router.post("/contracts/{contract_id}/agent/query", response_model=AgentQueryResponse)
def query_contract_agent(
    contract_id: str,
    request: AgentQueryRequest,
    current_user: UserInDB = Depends(get_current_active_user)
) -> AgentQueryResponse:
    contract = get_contract_and_verify_access(
        contract_id,
        current_user,
        {
            "_id": 1,
            "contract_name": 1,
            "ownerType": 1,
            "ownerId": 1,
            "projectId": 1,
            "index.status": 1,
            "index.content": 1,
            "index.vector_namespace": 1,
            "index.vector_backend": 1,
        }
    )

    index_data = contract.get("index", {})
    index_content = index_data.get("content") or ""
    if index_data.get("status") != "success" or not index_content.strip():
        direct_response = _run_stream_agent_gate(
            user_id=str(current_user.id),
            message=request.message,
            context=AgentContext(
                surface=AgentSurface.CONTRACT,
                project_id=str(contract.get("projectId")) if contract.get("projectId") else None,
                contract_id=contract_id,
                selected_document_ids=[contract_id],
                displayed_document=request.displayed_document or {
                    "document_id": contract_id,
                    "filename": contract.get("contract_name", contract_id),
                },
                attached_documents=request.attached_documents or [],
                visible_state={
                    "scope": "contract",
                    "contract_name": contract.get("contract_name", contract_id),
                    "index_status": index_data.get("status"),
                },
            ),
            ai_provider=request.ai_provider,
        )
        if _enum_value(direct_response.workflow) in {AgentWorkflow.CHAT.value, AgentWorkflow.SECURITY_DENIAL.value}:
            return AgentQueryResponse(
                answer=direct_response.answer,
                confidence=direct_response.confidence,
                citation=direct_response.citation_details.get("source_pages_display") or "",
                reason=direct_response.reason,
                citation_details=direct_response.citation_details,
                citation_annotations=direct_response.citation_annotations,
                citations=direct_response.citation_annotations,
                tools_called=direct_response.tools_called,
                agent_trace=direct_response.agent_trace,
                token_usage=direct_response.token_usage.model_dump(mode="json"),
                cost_usd=direct_response.cost_usd,
                artifacts=direct_response.artifacts,
                session_id=None,
                vector_namespace=None,
                vector_backend=None,
            )
        raise HTTPException(status_code=400, detail="Contract is not indexed yet.")

    user_id_text = str(current_user.id)
    project_id = contract.get("projectId")
    project_id_text = str(project_id) if project_id else None
    memory = _agent_memory()
    session = memory.ensure_session(
        contract_id=contract_id,
        user_id=user_id_text,
        session_id=request.session_id,
        contract_name=contract.get("contract_name", contract_id),
        project_id=project_id_text,
        title_seed=request.message,
    )
    session_id = session["session_id"]
    memory.append_message(
        session_id=session_id,
        contract_id=contract_id,
        user_id=user_id_text,
        role="user",
        content=request.message.strip(),
        metadata={
            "ai_provider": request.ai_provider,
            "reference_contract_ids": request.reference_contract_ids or [],
            "displayed_document": request.displayed_document,
            "attached_documents": request.attached_documents or [],
        },
    )
    memory_scope = MemoryScope(
        user_id=user_id_text,
        question=request.message.strip(),
        session_id=session_id,
        contract_id=contract_id,
        project_id=project_id_text,
        surface="contract",
    )

    reference_contract_oids: List[ObjectId] = []
    contract_oid = ObjectId(contract_id)
    seen_reference_ids = set()
    for raw_reference_id in request.reference_contract_ids or []:
        try:
            reference_oid = ObjectId(raw_reference_id)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid referenced contract ID: {raw_reference_id}")
        reference_id_text = str(reference_oid)
        if reference_id_text not in seen_reference_ids:
            reference_contract_oids.append(reference_oid)
            seen_reference_ids.add(reference_id_text)

    try:
        rag_system = ContractRAGSystem(ai_provider=request.ai_provider)
        project_documents: List[Dict[str, Any]] = []

        if isinstance(project_id, ObjectId):
            try:
                project_doc = verify_project_access(str(project_id), current_user)
                project_query = build_accessible_contract_query(project_doc, current_user)
                project_filters: List[Dict[str, Any]] = [
                    project_query,
                    {"index.status": "success"},
                    {"index.content": {"$type": "string", "$ne": ""}},
                ]
                scoped_reference_oids = [contract_oid] + [
                    oid for oid in reference_contract_oids if oid != contract_oid
                ]
                project_filters.append({"_id": {"$in": scoped_reference_oids}})

                project_documents = list(collection.find(
                    {"$and": project_filters},
                    {
                        "_id": 1,
                        "contract_name": 1,
                        "projectId": 1,
                        "index.content": 1,
                        "index.vector_namespace": 1,
                        "index.vector_backend": 1,
                    }
                ))
                found_reference_ids = {str(document["_id"]) for document in project_documents}
                expected_reference_ids = {str(oid) for oid in scoped_reference_oids}
                if missing_reference_ids := expected_reference_ids - found_reference_ids:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            "One or more referenced documents are not indexed or not accessible yet: "
                            + ", ".join(sorted(missing_reference_ids))
                        ),
                    )
            except HTTPException:
                raise
            except Exception as project_query_error:
                log_exception(logger, f"Failed to load project documents for agent query on {contract_id}", project_query_error)
                project_documents = []
        elif reference_contract_oids:
            raise HTTPException(
                status_code=400,
                detail="Referenced documents can only be used when the active contract belongs to a project.",
            )

        scoped_kpis = _kpi_manager().list_project_kpis(
            str(project_id),
            contract_ids=[str(document["_id"]) for document in project_documents],
        ) if project_documents and project_id else _kpi_manager().list_contract_kpis(contract_id)
        kpi_context_contract_ids = (
            [str(document["_id"]) for document in project_documents]
            if project_documents
            else [contract_id]
        )
        kpi_operational_context = _load_kpi_agent_operational_context(kpi_context_contract_ids)
        kpi_context = _compact_kpi_context(
            scoped_kpis,
            source_configs=kpi_operational_context["source_configs"],
            actuals=kpi_operational_context["actuals"],
            breaches=kpi_operational_context["breaches"],
        )
        # One assembly point. The composer decides what each memory tier is
        # worth against a single budget; this route only supplies the KPI
        # context, because reading it needs the document set already resolved
        # and access-checked above.
        memory_context = _memory_composer(memory).compose(
            memory_scope, kpi_context=kpi_context, extra_blocks=_preference_blocks(current_user)
        ).text

        operational_payload = _build_operational_kpi_answer(
            request.message.strip(),
            scoped_kpis,
            source_configs=kpi_operational_context["source_configs"],
            actuals=kpi_operational_context["actuals"],
            breaches=kpi_operational_context["breaches"],
        )
        if operational_payload:
            validated_payload = dict(operational_payload)
            assistant_metadata = {
                "confidence": validated_payload.get("confidence"),
                "citation": validated_payload.get("citation"),
                "reason": validated_payload.get("reason"),
                "citation_details": validated_payload.get("citation_details", {}),
                "citation_annotations": validated_payload.get("citation_annotations", []),
                "vector_namespace": None,
                "vector_backend": None,
                "artifacts": [],
                "source": "operational_kpi_register",
            }
            answer_text = str(validated_payload.get("answer") or "")
            memory.append_message(
                session_id=session_id,
                contract_id=contract_id,
                user_id=user_id_text,
                role="assistant",
                content=answer_text,
                metadata=assistant_metadata,
            )
            _remember_if_durable(
                memory,
                contract_id=contract_id,
                user_id=user_id_text,
                session_id=session_id,
                question=request.message.strip(),
                answer=answer_text,
                metadata=assistant_metadata,
            )
            return AgentQueryResponse(
                answer=answer_text,
                confidence=str(validated_payload.get("confidence") or "high"),
                citation=str(validated_payload.get("citation") or ""),
                reason=str(validated_payload.get("reason") or ""),
                citation_details=validated_payload.get("citation_details", {}),
                citation_annotations=validated_payload.get("citation_annotations", []),
                citations=validated_payload.get("citation_annotations", []),
                tools_called=list(dict.fromkeys(rag_system.last_agent_trace.get("tools", []))) if getattr(rag_system, "last_agent_trace", None) else [],
                artifacts=[],
                session_id=session_id,
                vector_namespace=None,
                vector_backend=None,
            )

        deep_displayed_document = request.displayed_document or {
            "document_id": contract_id,
            "filename": contract.get("contract_name", contract_id),
        }
        deep_attached_documents = request.attached_documents or []
        if not deep_attached_documents and reference_contract_oids and project_documents:
            reference_id_texts = {str(oid) for oid in reference_contract_oids if oid != contract_oid}
            deep_attached_documents = [
                {
                    "document_id": str(document["_id"]),
                    "filename": document.get("contract_name") or str(document["_id"]),
                }
                for document in project_documents
                if str(document["_id"]) in reference_id_texts
            ]
        deep_selected_document_ids = (
            [str(document["_id"]) for document in project_documents]
            if project_documents
            else [contract_id]
        )
        deep_agent_context = AgentContext(
            surface=AgentSurface.CONTRACT,
            project_id=project_id_text,
            contract_id=contract_id,
            session_id=session_id,
            selected_document_ids=deep_selected_document_ids,
            reference_contract_ids=[str(oid) for oid in reference_contract_oids],
            displayed_document=deep_displayed_document,
            attached_documents=deep_attached_documents,
            visible_state={
                "scope": "contract",
                "contract_name": contract.get("contract_name", contract_id),
                "document_count": len(deep_selected_document_ids),
            },
        )
        deep_agent_response = _run_stream_agent_gate(
            user_id=user_id_text,
            message=request.message,
            context=deep_agent_context,
            ai_provider=request.ai_provider,
            memory_context=memory_context,
        )
        _persist_stream_agent_gate_message(
            memory=memory,
            session_id=session_id,
            scope_id=contract_id,
            project_id=project_id_text,
            user_id=user_id_text,
            question=request.message.strip(),
            response=deep_agent_response,
        )
        return AgentQueryResponse(
            answer=deep_agent_response.answer,
            confidence=deep_agent_response.confidence,
            citation=deep_agent_response.citation_details.get("source_pages_display") or "",
            reason=deep_agent_response.reason,
            citation_details=deep_agent_response.citation_details,
            citation_annotations=deep_agent_response.citation_annotations,
            citations=deep_agent_response.citation_annotations,
            tools_called=deep_agent_response.tools_called,
            agent_trace=deep_agent_response.agent_trace,
            token_usage=deep_agent_response.token_usage.model_dump(mode="json"),
            cost_usd=deep_agent_response.cost_usd,
            artifacts=deep_agent_response.artifacts,
            session_id=session_id,
            vector_namespace=None,
            vector_backend=None,
        )

        if project_documents:
            displayed_document = request.displayed_document or {
                "document_id": contract_id,
                "filename": contract.get("contract_name", contract_id),
            }
            attached_documents = request.attached_documents
            if attached_documents is None and reference_contract_oids:
                reference_id_texts = {str(oid) for oid in reference_contract_oids if oid != contract_oid}
                attached_documents = [
                    {
                        "document_id": str(document["_id"]),
                        "filename": document.get("contract_name") or str(document["_id"]),
                    }
                    for document in project_documents
                    if str(document["_id"]) in reference_id_texts
                ]
            qa = rag_system.answer_project_question(
                project_documents=project_documents,
                project_id=str(project_id),
                question=request.message.strip(),
                user_id=user_id_text,
                displayed_document=displayed_document,
                attached_documents=attached_documents or [],
                memory_context=memory_context,
            )
        else:
            qa = rag_system.answer_agent_question(
                contract_text=index_content,
                contract_name=contract.get("contract_name", contract_id),
                contract_id=contract_id,
                project_id=project_id_text,
                question=request.message.strip(),
                user_id=user_id_text,
                vector_namespace=index_data.get("vector_namespace"),
                vector_backend=index_data.get("vector_backend"),
                memory_context=memory_context,
            )

        vector_namespace = getattr(rag_system, "current_namespace", None)
        vector_backend = getattr(rag_system, "current_vector_backend", None)
        if (
            not project_documents and
            (vector_namespace != index_data.get("vector_namespace") or vector_backend != index_data.get("vector_backend"))
        ):
            collection.update_one(
                {"_id": contract_oid},
                {"$set": {
                    "index.vector_namespace": vector_namespace,
                    "index.vector_backend": vector_backend,
                    "index.vector_count": getattr(rag_system, "current_vector_count", 0),
                    "index.chunk_schema_version": getattr(settings, "chunk_schema_version", 2),
                    "index.embedding_status": "success",
                    "index.embedded_at": datetime.utcnow(),
                }}
            )

        validated_payload = {
            "answer": qa.answer,
            "question": qa.question,
            "confidence": qa.confidence,
            "citation": qa.citation,
            "reason": qa.reason,
            "citation_details": qa.citation_details,
            "citation_annotations": get_formatted_citations(qa.citation_details),
            "vector_namespace": vector_namespace,
            "vector_backend": vector_backend,
        }

        assistant_metadata = {
            "confidence": validated_payload.get("confidence"),
            "citation": validated_payload.get("citation"),
            "reason": validated_payload.get("reason"),
            "citation_details": validated_payload.get("citation_details", {}),
            "citation_annotations": validated_payload.get("citation_annotations", []),
            "vector_namespace": vector_namespace,
            "vector_backend": vector_backend,
        }
        artifacts: List[Dict[str, Any]] = []
        created_artifact = _create_agent_document_if_needed(
            contract_id=contract_id,
            project_id=project_id_text,
            user_id=user_id_text,
            session_id=session_id,
            contract_name=contract.get("contract_name", contract_id),
            question=request.message.strip(),
            answer=str(validated_payload.get("answer") or ""),
            source_text=index_content,
        )
        if created_artifact:
            artifacts.append(created_artifact)
            assistant_metadata["artifacts"] = artifacts
        memory.append_message(
            session_id=session_id,
            contract_id=contract_id,
            user_id=user_id_text,
            role="assistant",
            content=str(validated_payload.get("answer") or ""),
            metadata=assistant_metadata,
        )
        _remember_if_durable(
            memory,
            contract_id=contract_id,
            user_id=user_id_text,
            session_id=session_id,
            question=request.message.strip(),
            answer=str(validated_payload.get("answer") or ""),
            metadata=assistant_metadata,
        )
        memory.record_draft_if_any(
            contract_id=contract_id,
            project_id=project_id_text,
            user_id=user_id_text,
            session_id=session_id,
            question=request.message.strip(),
            answer=str(validated_payload.get("answer") or ""),
            metadata=assistant_metadata,
            artifact=created_artifact,
        )

        tools_called = list(dict.fromkeys(rag_system.last_agent_trace.get("tools", []))) if getattr(rag_system, "last_agent_trace", None) else []
        return AgentQueryResponse(
            answer=str(validated_payload.get("answer") or ""),
            confidence=str(validated_payload.get("confidence") or "low"),
            citation=str(validated_payload.get("citation") or ""),
            reason=str(validated_payload.get("reason") or ""),
            citation_details=validated_payload.get("citation_details", {}),
            citation_annotations=validated_payload.get("citation_annotations", []),
            citations=validated_payload.get("citation_annotations", []),
            tools_called=tools_called,
            artifacts=artifacts,
            session_id=session_id,
            vector_namespace=vector_namespace,
            vector_backend=vector_backend,
        )
    except HTTPException:
        raise
    except Exception as e:
        log_exception(logger, f"Agent query failed for contract {contract_id}", e)
        raise HTTPException(status_code=500, detail="Agent query failed.")

@router.post("/projects/{project_id}/agent/query/stream")
def stream_project_agent(
    project_id: str,
    request: AgentQueryRequest,
    http_request: Request,
    current_user: UserInDB = Depends(get_current_active_user)
) -> StreamingResponse:
    project_doc = verify_project_access(project_id, current_user)
    project_name = project_doc.get("name") or "Project"
    user_id_text = str(current_user.id)
    project_scope_id = _project_agent_scope_id(project_id)

    memory = _agent_memory()
    session = memory.ensure_session(
        contract_id=project_scope_id,
        user_id=user_id_text,
        session_id=request.session_id,
        contract_name=project_name,
        project_id=project_id,
        title_seed=request.message,
    )
    session_id = session["session_id"]
    memory_scope = MemoryScope(
        user_id=user_id_text,
        question=request.message.strip(),
        session_id=session_id,
        contract_id=project_scope_id,
        project_id=project_id,
        surface="project",
    )

    async def event_stream():
        try:
            # The session event goes out before any of the loading below. All
            # of it used to run before the StreamingResponse was constructed,
            # so the browser sat on a blank panel for the whole of it —
            # measured at six to seven seconds — with nothing to say anything
            # had started. What gets loaded is unchanged; when the first byte
            # reaches the client is not.
            yield format_sse_event("session", {"session_id": session_id})
            yield format_sse_event("status", {"message": "reading the project"})

            # Recording the user's turn is four round trips and nothing before
            # the first byte needs it — only the memory composition below does,
            # and that runs after. Ahead of the response it was a second of
            # blank panel.
            memory.append_message(
                session_id=session_id,
                contract_id=project_scope_id,
                user_id=user_id_text,
                role="user",
                content=request.message.strip(),
                metadata={
                    "ai_provider": request.ai_provider,
                    "reference_contract_ids": request.reference_contract_ids or [],
                    "displayed_document": request.displayed_document,
                    "attached_documents": request.attached_documents or [],
                    "scope": "project",
                },
            )

            # Ids only. The deep agent reads document bodies through its own tools,
            # which load them per document as they are actually needed
            # (`_load_scoped_documents`), so pulling every body here was work whose
            # result was thrown away after `_id` was read off it.
            project_documents = _load_indexed_project_documents(
                project_id=project_id,
                current_user=current_user,
                reference_contract_ids=request.reference_contract_ids,
                include_content=False,
                project_doc=project_doc,
            )
            project_contract_ids = [str(document["_id"]) for document in project_documents]

            # The KPI list first, and the operational context only if there is
            # something for it to describe. `_compact_kpi_context` returns an empty
            # string the moment the KPI list is empty, so on a project with no KPIs —
            # most of them, and every project before someone sets one up — the
            # three-queries-per-contract loop was building a result thrown away one
            # line later. Measured at 3.5s of the wait before the agent said anything.
            project_kpis = _kpi_manager().list_project_kpis(
                project_id, contract_ids=project_contract_ids
            )
            kpi_operational_context: Dict[str, List[Dict[str, Any]]] = {
                "source_configs": [], "actuals": [], "breaches": []
            }
            if project_kpis:
                kpi_operational_context = _load_kpi_agent_operational_context(project_contract_ids)
            project_kpi_context = _compact_kpi_context(
                project_kpis,
                source_configs=kpi_operational_context["source_configs"],
                actuals=kpi_operational_context["actuals"],
                breaches=kpi_operational_context["breaches"],
            )
            composed_memory = _memory_composer(memory).compose(
                memory_scope, kpi_context=project_kpi_context, extra_blocks=_preference_blocks(current_user)
            )
            memory_context = composed_memory.text

            deep_agent_context = AgentContext(
                surface=AgentSurface.PROJECT,
                project_id=project_id,
                session_id=session_id,
                selected_document_ids=project_contract_ids,
                reference_contract_ids=request.reference_contract_ids or [],
                displayed_document=request.displayed_document,
                attached_documents=request.attached_documents or [],
                visible_state={
                    "scope": "project",
                    "project_name": project_name,
                    "document_count": len(project_contract_ids),
                },
            )

            yield format_sse_event("memory", _memory_disclosure_payload(composed_memory))
            yield format_sse_event("status", {"message": "planning"})

            stream_result: Dict[str, Any] = {}
            async for frame in stream_agent_run(
                http_request=http_request,
                run_agent=lambda on_event, cancel_check: _run_stream_agent_gate(
                    user_id=user_id_text,
                    message=request.message,
                    context=deep_agent_context,
                    ai_provider=request.ai_provider,
                    memory_context=memory_context,
                    on_event=on_event,
                    cancel_check=cancel_check,
                ),
                format_event=format_sse_event,
                result=stream_result,
            ):
                yield frame

            if stream_result.get("client_gone"):
                # Nothing left to stream to — the background thread will
                # observe cancel_check on its next iteration checkpoint and
                # stop there. Persisting a run whose request context may
                # already be torn down is out of scope for this cancellation
                # path; the run's own trace still records run_cancelled.
                return

            deep_agent_response = stream_result.get("response")
            if not deep_agent_response:
                raise RuntimeError("Agent failed to produce a response.")

            if _should_interrupt_stream_for_agent(deep_agent_response):
                try:
                    _persist_stream_agent_gate_message(
                        memory=memory,
                        session_id=session_id,
                        scope_id=project_scope_id,
                        project_id=project_id,
                        user_id=user_id_text,
                        question=request.message.strip(),
                        response=deep_agent_response,
                    )
                except Exception as memory_error:
                    log_exception(logger, f"Failed to persist deep agent gate for project {project_id}", memory_error)

                if not deep_agent_response.citation_annotations:
                    yield format_sse_event("citations", {
                        "citation": getattr(deep_agent_response, "citation", "") or "",
                        "citation_details": deep_agent_response.citation_details,
                        "citation_annotations": [],
                    })

                event_name = "approval_required" if deep_agent_response.requires_approval else "final"
                yield format_sse_event(event_name, deep_agent_response.model_dump(mode="json"))
                yield format_sse_event("done", {})
                return

            # `_should_interrupt_stream_for_agent` is true for every outcome
            # `DeepContractAgentRunner.run()` can produce — COMPLETED always
            # carries a non-empty answer (`_finish_answer`/
            # `_finish_cannot_answer` both set one), WAITING_APPROVAL and
            # SECURITY_DENIAL are each covered directly — so the branch above
            # always returns. Everything past this point (the operational-KPI
            # shortcut, the legacy `rag_system.stream_project_*` calls, and
            # the artifact-copy-approval path) was unreachable (F-12); deleted
            # rather than kept as a fallback that could never run (3.4).
            raise RuntimeError("Deep agent response did not resolve to a terminal outcome.")
        except HTTPException as scope_error:
            # Loading moved inside the stream, so what used to be a 400 with a
            # usable message now arrives after the response has started. Its
            # detail still has to reach the user — "Agent stream failed" for a
            # document that simply has not finished indexing sends someone
            # looking for a bug that is not there.
            logger.info(
                "Agent stream rejected for project %s: %s", project_id, scope_error.detail
            )
            yield format_sse_event("error", {"detail": str(scope_error.detail)})
        except Exception as stream_error:
            log_exception(logger, f"Agent stream failed for project {project_id}", stream_error)
            yield format_sse_event("error", {"detail": "Agent stream failed."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "Content-Encoding": "identity",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/contracts/{contract_id}/agent/query/stream")
def stream_contract_agent(
    contract_id: str,
    request: AgentQueryRequest,
    http_request: Request,
    current_user: UserInDB = Depends(get_current_active_user)
) -> StreamingResponse:
    contract = get_contract_and_verify_access(
        contract_id,
        current_user,
        {
            "_id": 1,
            "contract_name": 1,
            "ownerType": 1,
            "ownerId": 1,
            "projectId": 1,
            "index.status": 1,
            "index.content": 1,
            "index.vector_namespace": 1,
            "index.vector_backend": 1,
        }
    )

    index_data = contract.get("index", {})
    index_content = index_data.get("content") or ""
    if index_data.get("status") != "success" or not index_content.strip():
        direct_response = _run_stream_agent_gate(
            user_id=str(current_user.id),
            message=request.message,
            context=AgentContext(
                surface=AgentSurface.CONTRACT,
                project_id=str(contract.get("projectId")) if contract.get("projectId") else None,
                contract_id=contract_id,
                selected_document_ids=[contract_id],
                displayed_document=request.displayed_document or {
                    "document_id": contract_id,
                    "filename": contract.get("contract_name", contract_id),
                },
                attached_documents=request.attached_documents or [],
                visible_state={
                    "scope": "contract",
                    "contract_name": contract.get("contract_name", contract_id),
                    "index_status": index_data.get("status"),
                },
            ),
            ai_provider=request.ai_provider,
        )
        if _enum_value(direct_response.workflow) in {AgentWorkflow.CHAT.value, AgentWorkflow.SECURITY_DENIAL.value}:
            def direct_event_stream():
                yield format_sse_event("final", direct_response.model_dump(mode="json"))
                yield format_sse_event("done", {})

            return StreamingResponse(
                direct_event_stream(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache, no-transform",
                    "Connection": "keep-alive",
                    "Content-Encoding": "identity",
                    "X-Accel-Buffering": "no",
                },
            )
        raise HTTPException(status_code=400, detail="Contract is not indexed yet.")

    user_id_text = str(current_user.id)
    project_id = contract.get("projectId")
    project_id_text = str(project_id) if project_id else None
    memory = _agent_memory()
    session = memory.ensure_session(
        contract_id=contract_id,
        user_id=user_id_text,
        session_id=request.session_id,
        contract_name=contract.get("contract_name", contract_id),
        project_id=project_id_text,
        title_seed=request.message,
    )
    session_id = session["session_id"]
    memory.append_message(
        session_id=session_id,
        contract_id=contract_id,
        user_id=user_id_text,
        role="user",
        content=request.message.strip(),
        metadata={
            "ai_provider": request.ai_provider,
            "reference_contract_ids": request.reference_contract_ids or [],
            "displayed_document": request.displayed_document,
            "attached_documents": request.attached_documents or [],
        },
    )
    memory_scope = MemoryScope(
        user_id=user_id_text,
        question=request.message.strip(),
        session_id=session_id,
        contract_id=contract_id,
        project_id=project_id_text,
        surface="contract",
    )

    reference_contract_oids: List[ObjectId] = []
    contract_oid = ObjectId(contract_id)
    seen_reference_ids = set()
    for raw_reference_id in request.reference_contract_ids or []:
        try:
            reference_oid = ObjectId(raw_reference_id)
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid referenced contract ID: {raw_reference_id}")
        reference_id_text = str(reference_oid)
        if reference_id_text not in seen_reference_ids:
            reference_contract_oids.append(reference_oid)
            seen_reference_ids.add(reference_id_text)

    project_documents: List[Dict[str, Any]] = []

    if isinstance(project_id, ObjectId):
        try:
            project_doc = verify_project_access(str(project_id), current_user)
            project_query = build_accessible_contract_query(project_doc, current_user)
            project_filters: List[Dict[str, Any]] = [
                project_query,
                {"index.status": "success"},
                {"index.content": {"$type": "string", "$ne": ""}},
            ]
            scoped_reference_oids = [contract_oid] + [
                oid for oid in reference_contract_oids if oid != contract_oid
            ]
            project_filters.append({"_id": {"$in": scoped_reference_oids}})

            project_documents = list(collection.find(
                {"$and": project_filters},
                {
                    "_id": 1,
                    "contract_name": 1,
                    "projectId": 1,
                    "index.content": 1,
                    "index.vector_namespace": 1,
                    "index.vector_backend": 1,
                }
            ))
            found_reference_ids = {str(document["_id"]) for document in project_documents}
            expected_reference_ids = {str(oid) for oid in scoped_reference_oids}
            if missing_reference_ids := expected_reference_ids - found_reference_ids:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "One or more referenced documents are not indexed or not accessible yet: "
                        + ", ".join(sorted(missing_reference_ids))
                    ),
                )
        except HTTPException:
            raise
        except Exception as project_query_error:
            log_exception(logger, f"Failed to load project documents for agent stream on {contract_id}", project_query_error)
            project_documents = []
    elif reference_contract_oids:
        raise HTTPException(
            status_code=400,
            detail="Referenced documents can only be used when the active contract belongs to a project.",
        )

    scoped_kpis = _kpi_manager().list_project_kpis(
        str(project_id),
        contract_ids=[str(document["_id"]) for document in project_documents],
    ) if project_documents and project_id else _kpi_manager().list_contract_kpis(contract_id)
    kpi_context_contract_ids = (
        [str(document["_id"]) for document in project_documents]
        if project_documents
        else [contract_id]
    )
    kpi_operational_context = _load_kpi_agent_operational_context(kpi_context_contract_ids)
    kpi_context = _compact_kpi_context(
        scoped_kpis,
        source_configs=kpi_operational_context["source_configs"],
        actuals=kpi_operational_context["actuals"],
        breaches=kpi_operational_context["breaches"],
    )
    composed_memory = _memory_composer(memory).compose(
        memory_scope, kpi_context=kpi_context, extra_blocks=_preference_blocks(current_user)
    )
    memory_context = composed_memory.text

    deep_displayed_document = request.displayed_document or {
        "document_id": contract_id,
        "filename": contract.get("contract_name", contract_id),
    }
    deep_attached_documents = request.attached_documents or []
    if not deep_attached_documents and reference_contract_oids and project_documents:
        reference_id_texts = {str(oid) for oid in reference_contract_oids if oid != contract_oid}
        deep_attached_documents = [
            {
                "document_id": str(document["_id"]),
                "filename": document.get("contract_name") or str(document["_id"]),
            }
            for document in project_documents
            if str(document["_id"]) in reference_id_texts
        ]
    deep_selected_document_ids = (
        [str(document["_id"]) for document in project_documents]
        if project_documents
        else [contract_id]
    )
    deep_agent_context = AgentContext(
        surface=AgentSurface.CONTRACT,
        project_id=project_id_text,
        contract_id=contract_id,
        session_id=session_id,
        selected_document_ids=deep_selected_document_ids,
        reference_contract_ids=[str(oid) for oid in reference_contract_oids],
        displayed_document=deep_displayed_document,
        attached_documents=deep_attached_documents,
        visible_state={
            "scope": "contract",
            "contract_name": contract.get("contract_name", contract_id),
            "document_count": len(deep_selected_document_ids),
        },
    )

    async def event_stream():
        try:
            yield format_sse_event("session", {"session_id": session_id})
            yield format_sse_event("memory", _memory_disclosure_payload(composed_memory))
            yield format_sse_event("status", {"message": "planning"})

            stream_result: Dict[str, Any] = {}
            async for frame in stream_agent_run(
                http_request=http_request,
                run_agent=lambda on_event, cancel_check: _run_stream_agent_gate(
                    user_id=user_id_text,
                    message=request.message,
                    context=deep_agent_context,
                    ai_provider=request.ai_provider,
                    memory_context=memory_context,
                    on_event=on_event,
                    cancel_check=cancel_check,
                ),
                format_event=format_sse_event,
                result=stream_result,
            ):
                yield frame

            if stream_result.get("client_gone"):
                # Nothing left to stream to — the background thread will
                # observe cancel_check on its next iteration checkpoint and
                # stop there. Persisting a run whose request context may
                # already be torn down is out of scope for this cancellation
                # path; the run's own trace still records run_cancelled.
                return

            deep_agent_response = stream_result.get("response")
            if not deep_agent_response:
                raise RuntimeError("Agent failed to produce a response.")

            if _should_interrupt_stream_for_agent(deep_agent_response):
                try:
                    _persist_stream_agent_gate_message(
                        memory=memory,
                        session_id=session_id,
                        scope_id=contract_id,
                        project_id=project_id_text,
                        user_id=user_id_text,
                        question=request.message.strip(),
                        response=deep_agent_response,
                    )
                except Exception as memory_error:
                    log_exception(logger, f"Failed to persist deep agent gate for contract {contract_id}", memory_error)

                yield format_sse_event("citations", {
                    "citation": getattr(deep_agent_response, "citation", "") or "",
                    "citation_details": deep_agent_response.citation_details,
                    "citation_annotations": deep_agent_response.citation_annotations,
                })

                event_name = "approval_required" if deep_agent_response.requires_approval else "final"
                yield format_sse_event(event_name, deep_agent_response.model_dump(mode="json"))
                yield format_sse_event("done", {})
                return

            # `_should_interrupt_stream_for_agent` is true for every outcome
            # `DeepContractAgentRunner.run()` can produce (see the identical
            # note in stream_project_agent), so the branch above always
            # returns. Everything past this point — the legacy RAG-system
            # fallback and the operational-KPI shortcut — was unreachable
            # (F-12); deleted rather than kept as dead weight (3.4).
            raise RuntimeError("Deep agent response did not resolve to a terminal outcome.")
        except Exception as stream_error:
            log_exception(logger, f"Agent stream failed for contract {contract_id}", stream_error)
            yield format_sse_event("error", {"detail": "Agent stream failed."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "Content-Encoding": "identity",
            "X-Accel-Buffering": "no",
        },
    )
