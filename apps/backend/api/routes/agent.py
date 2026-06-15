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
from services.contract_agent.graph.state import ApprovalRequest, ToolCallRecord
from services.contract_agent.graph.tools.executor import execute_mongo_read_tool
from services.contract_agent.rag.facade import ContractRAGSystem
from utils.secure_logger import log_exception

logger = logging.getLogger(__name__)

router = APIRouter()


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
    state = _require_owned_workflow(workflow_id, current_user)
    if not state.approval_request:
        raise HTTPException(status_code=400, detail="Workflow is not waiting for approval.")
    if request_data.decision == ApprovalDecision.REJECT:
        return _reject_state(state, request_data.feedback)
    if state.approval_request.action == "create_tabular_review":
        return _approve_tabular_workflow(state, request_data, current_user)
    if state.approval_request.action == "extract_kpis":
        return _approve_kpi_extraction_workflow(state, current_user)
    if state.approval_request.action in {
        "create_draft_artifact",
        "create_redline_artifact",
        "create_editable_copy",
        "duplicate_document_copy",
        "edit_document",
        "generate_docx",
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
    elif action == "edit_document":
        document_id = str(payload.get("document_id") or "")
        edits = payload.get("edits") if isinstance(payload.get("edits"), list) else []
        if not document_id or not edits:
            raise HTTPException(status_code=400, detail="Missing document_id or edits for tracked edit workflow.")
        result = _agent_documents().edit_document(
            contract_id=contract_id or None,
            project_id=str(project_id) if project_id else None,
            user_id=str(current_user.id),
            document_id=document_id,
            edits=edits,
        )
        if not result:
            raise HTTPException(status_code=404, detail="Agent document not found.")
        artifacts = [{
            "artifact_id": f"artifact-{result.version_id}",
            "document_id": result.document_id,
            "version_id": result.version_id,
            "version_number": result.version_number,
            "filename": result.filename,
            "download_url": result.download_url,
            "artifact_kind": "tracked_edit_document",
            "editable": True,
            "edit_annotations": result.annotations,
            "errors": result.errors,
        }]
    else:
        source_text = ""
        contract_name = str(payload.get("contract_name") or "Contract Work Product")
        if contract_id and ObjectId.is_valid(contract_id):
            contract_doc = collection.find_one(
                {"_id": ObjectId(contract_id)},
                {"contract_name": 1, "projectId": 1, "index.content": 1},
            )
            if contract_doc:
                contract_name = str(contract_doc.get("contract_name") or contract_name)
                source_text = str((contract_doc.get("index") or {}).get("content") or "")
                if not project_id and contract_doc.get("projectId"):
                    project_id = str(contract_doc.get("projectId"))
        question = str(payload.get("question") or state.message)
        answer = str(payload.get("answer") or state.answer)
        draft_type = payload.get("draft_type") or detect_work_product_type(question, answer)
        if action == "create_redline_artifact":
            raw_changes = payload.get("redline_changes") if isinstance(payload.get("redline_changes"), list) else []
            changes = [
                redline_change_from_payload(item)
                for item in raw_changes
                if isinstance(item, dict)
            ]
            result = _agent_documents().create_redline_from_agent_turn(
                contract_id=scope_id or contract_id,
                project_id=str(project_id) if project_id else None,
                user_id=str(current_user.id),
                session_id=session_id,
                contract_name=contract_name,
                question=question,
                source_text=source_text,
                changes=changes or None,
            )
        else:
            result = _agent_documents().create_from_agent_turn(
                contract_id=scope_id or contract_id,
                project_id=str(project_id) if project_id else None,
                user_id=str(current_user.id),
                session_id=session_id,
                contract_name=contract_name,
                question=question,
                answer=answer,
                source_text=source_text,
                draft_type=str(draft_type) if draft_type else None,
            )
        if result:
            artifacts = [result.to_payload(contract_id=scope_id or contract_id)]

    state.status = AgentStatus.COMPLETED
    state.approval_request = None
    state.artifacts = artifacts
    if artifacts and action == "create_redline_artifact":
        state.answer = "Approved. I created a DOCX redline copy with the approved tracked changes applied to the original contract text."
    elif artifacts and action == "edit_document":
        state.answer = "Approved. I created a tracked-edit DOCX version with deterministic source-text matches and pending edit cards."
    elif not artifacts:
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


def _agent_documents() -> AgentDocumentManager:
    return AgentDocumentManager(db, fs)


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
) -> AgentResponse:
    state = AgentRunState(
        user_id=user_id,
        message=message.strip(),
        context=context,
        ai_provider=ai_provider,
    )
    return DeepContractAgentRunner(
        store=_agent_run_store(),
        tool_executor=_stream_agent_tool_executor,
    ).run(state)


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
        memory.remember_turn(
            contract_id=scope_id,
            user_id=user_id,
            session_id=session_id,
            question=question,
            answer=response.answer,
        )


def _create_stream_artifact_approval(
    *,
    user_id: str,
    message: str,
    answer: str,
    context: AgentContext,
    action: str,
    title: str,
    description: str,
    payload: Dict[str, Any],
    ai_provider: Optional[str],
    workflow: AgentWorkflow,
) -> AgentResponse:
    state = AgentRunState(
        user_id=user_id,
        message=message.strip(),
        context=context,
        ai_provider=ai_provider,
        workflow=workflow,
        status=AgentStatus.WAITING_APPROVAL,
        answer=answer,
        reason="Human approval is required before creating or duplicating assistant work product.",
    )
    state.approval_request = ApprovalRequest(
        workflow_id=state.workflow_id,
        action=action,  # type: ignore[arg-type]
        title=title,
        description=description,
        tabular_review=None,
        payload={"idempotency_key": f"{state.workflow_id}:{action}", **payload},
    )
    state.add_trace("decide_action", action="request_approval", side_effect=action)
    state.add_trace("middleware:HumanInTheLoopMiddleware", action=action, decision="interrupt")
    state.add_trace("approval_gate", requires_approval=True)
    _agent_run_store().save(state)
    return DeepContractAgentRunner(store=_agent_run_store()).response_from_state(state)


def _artifact_approval_action(question: str, answer: str, draft_type: Optional[str]) -> str:
    del answer
    haystack = question
    should_edit = bool(re.search(
        r"\b(change|replace|revise|edit|amend|apply|redline)\b",
        haystack,
        flags=re.IGNORECASE,
    ))
    return "create_redline_artifact" if should_edit or draft_type == "edit_suggestions" else "create_draft_artifact"


def _redline_approval_details(
    *,
    question: str,
    source_text: str,
    contract_name: str,
) -> Tuple[str, str, str, Dict[str, Any]]:
    changes = build_redline_changes_from_request(
        question=question,
        source_text=source_text,
        contract_name=contract_name,
    )
    changes_payload = [redline_change_to_payload(change) for change in changes]
    if changes_payload:
        first_change = changes_payload[0]
        answer = (
            "I prepared a source-matched redline proposal. Review the change card below; "
            "on approval I will create a DOCX copy with Word tracked changes applied to the original contract text."
        )
        description = (
            f"{len(changes_payload)} proposed change: "
            f"{first_change.get('matched_text')} -> {first_change.get('suggested_revision') or '[delete]'}"
        )
    else:
        answer = (
            "I can create a redline artifact, but I could not confidently identify the exact source text to change. "
            "Approval will create a draft artifact rather than applying a tracked change."
        )
        description = "Approve before creating the redline artifact."
    return answer, "Approve redline changes", description, {"redline_changes": changes_payload}


def _kpi_manager() -> ContractKPIManager:
    return ContractKPIManager(db)

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
) -> List[Dict[str, Any]]:
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

    documents = list(collection.find(
        {"$and": project_filters},
        {
            "_id": 1,
            "contract_name": 1,
            "projectId": 1,
            "index.content": 1,
            "index.vector_namespace": 1,
            "index.vector_backend": 1,
        },
    ))

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


def _requested_copy_count(message: str) -> Optional[int]:
    match = re.search(
        r"\b(?:create|make|generate|duplicate|copy)\s+(\d{1,2})\s+(?:more\s+)?cop(?:y|ies)\b",
        message or "",
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    return max(1, min(int(match.group(1)), 20))

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
    memory_context = memory.build_memory_context(
        session_id=session_id,
        contract_id=contract_id,
        user_id=user_id_text,
        question=request.message.strip(),
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
        if kpi_context:
            memory_context = f"{memory_context}\n\n{kpi_context}" if memory_context else kpi_context

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
            memory.remember_turn(
                contract_id=contract_id,
                user_id=user_id_text,
                session_id=session_id,
                question=request.message.strip(),
                answer=answer_text,
            )
            return AgentQueryResponse(
                answer=answer_text,
                confidence=str(validated_payload.get("confidence") or "high"),
                citation=str(validated_payload.get("citation") or ""),
                reason=str(validated_payload.get("reason") or ""),
                citation_details=validated_payload.get("citation_details", {}),
                citation_annotations=validated_payload.get("citation_annotations", []),
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
            "citation_annotations": qa.citation_details.get("annotations", []) if isinstance(qa.citation_details, dict) else [],
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
        memory.remember_turn(
            contract_id=contract_id,
            user_id=user_id_text,
            session_id=session_id,
            question=request.message.strip(),
            answer=str(validated_payload.get("answer") or ""),
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

        return AgentQueryResponse(
            answer=str(validated_payload.get("answer") or ""),
            confidence=str(validated_payload.get("confidence") or "low"),
            citation=str(validated_payload.get("citation") or ""),
            reason=str(validated_payload.get("reason") or ""),
            citation_details=validated_payload.get("citation_details", {}),
            citation_annotations=validated_payload.get("citation_annotations", []),
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
    memory_context = memory.build_memory_context(
        session_id=session_id,
        contract_id=project_scope_id,
        user_id=user_id_text,
        question=request.message.strip(),
    )

    rag_system = ContractRAGSystem(ai_provider=request.ai_provider)
    project_documents = _load_indexed_project_documents(
        project_id=project_id,
        current_user=current_user,
        reference_contract_ids=request.reference_contract_ids,
    )
    project_contract_ids = [str(document["_id"]) for document in project_documents]
    kpi_operational_context = _load_kpi_agent_operational_context(project_contract_ids)
    project_kpi_context = _compact_kpi_context(
        _kpi_manager().list_project_kpis(
            project_id,
            contract_ids=project_contract_ids,
        ),
        source_configs=kpi_operational_context["source_configs"],
        actuals=kpi_operational_context["actuals"],
        breaches=kpi_operational_context["breaches"],
    )
    if project_kpi_context:
        memory_context = f"{memory_context}\n\n{project_kpi_context}" if memory_context else project_kpi_context

    operational_payload = _build_operational_kpi_answer(
        request.message.strip(),
        _kpi_manager().list_project_kpis(
            project_id,
            contract_ids=project_contract_ids,
        ),
        source_configs=kpi_operational_context["source_configs"],
        actuals=kpi_operational_context["actuals"],
        breaches=kpi_operational_context["breaches"],
    )
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

    def event_stream():
        try:
            yield format_sse_event("session", {"session_id": session_id})
            yield format_sse_event("status", {"message": "planning"})
            deep_agent_response = _run_stream_agent_gate(
                user_id=user_id_text,
                message=request.message,
                context=deep_agent_context,
                ai_provider=request.ai_provider,
            )
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
                event_name = "approval_required" if deep_agent_response.requires_approval else "final"
                yield format_sse_event(event_name, deep_agent_response.model_dump(mode="json"))
                yield format_sse_event("done", {})
                return

            yield format_sse_event("status", {"message": "retrieving"})
            final_payload: Optional[Dict[str, Any]] = None
            if operational_payload:
                answer_text = str(operational_payload.get("answer") or "")
                yield format_sse_event("thinking", {"message": "Reading ContractSense KPI register."})
                for index in range(0, len(answer_text), 48):
                    yield format_sse_event("delta", {"text": answer_text[index:index + 48]})
                yield format_sse_event("content_done", {})
                final_payload = {**dict(operational_payload), "artifacts": []}
                yield format_sse_event("citations", {
                    "citation": final_payload.get("citation", ""),
                    "citation_details": final_payload.get("citation_details", {}),
                    "citation_annotations": final_payload.get("citation_annotations", []),
                })
                yield format_sse_event("final", final_payload)
                try:
                    assistant_metadata = {
                        "confidence": final_payload.get("confidence"),
                        "citation": final_payload.get("citation"),
                        "reason": final_payload.get("reason"),
                        "citation_details": final_payload.get("citation_details", {}),
                        "citation_annotations": final_payload.get("citation_annotations", []),
                        "agent_trace": final_payload.get("agent_trace"),
                        "vector_namespace": None,
                        "vector_backend": None,
                        "artifacts": [],
                        "source": "operational_kpi_register",
                    }
                    memory.append_message(
                        session_id=session_id,
                        contract_id=project_scope_id,
                        user_id=user_id_text,
                        role="assistant",
                        content=answer_text,
                        metadata=assistant_metadata,
                    )
                    memory.remember_turn(
                        contract_id=project_scope_id,
                        user_id=user_id_text,
                        session_id=session_id,
                        question=request.message.strip(),
                        answer=answer_text,
                    )
                except Exception as memory_error:
                    log_exception(logger, f"Failed to persist operational KPI stream for project {project_id}", memory_error)
                yield format_sse_event("done", {})
                return
            elif project_documents:
                stream_iterator = rag_system.stream_project_question(
                    project_documents=project_documents,
                    project_id=project_id,
                    question=request.message.strip(),
                    user_id=user_id_text,
                    displayed_document=request.displayed_document,
                    attached_documents=request.attached_documents or [],
                    memory_context=memory_context,
                )
            else:
                stream_iterator = rag_system.stream_project_chat_without_documents(
                    project_name=project_name,
                    question=request.message.strip(),
                    memory_context=memory_context,
                )

            for payload in stream_iterator:
                payload_for_event = dict(payload)
                event_type = payload_for_event.pop("type", "message")
                if event_type == "final":
                    final_payload = dict(payload_for_event)
                    continue
                if event_type == "citations":
                    # Re-emit validated citations after final payload assembly.
                    continue
                yield format_sse_event(event_type, payload_for_event)

            if final_payload:
                final_payload = dict(final_payload)
                answer_text = str(final_payload.get("answer") or "")
                yield format_sse_event("citations", {
                    "citation": final_payload.get("citation", ""),
                    "citation_details": final_payload.get("citation_details", {}),
                    "citation_annotations": final_payload.get("citation_annotations", []),
                })
                artifacts: List[Dict[str, Any]] = []
                created_artifact: Optional[Dict[str, Any]] = None
                copy_count = 0 if operational_payload else _requested_copy_count(request.message.strip())
                if copy_count:
                    approval_response = _create_stream_artifact_approval(
                        user_id=user_id_text,
                        message=request.message,
                        answer=answer_text,
                        context=deep_agent_context,
                        action="duplicate_document_copy",
                        title=f"Create {copy_count} project document copies",
                        description="Approve before duplicating assistant-created project work products.",
                        payload={
                            "scope_id": project_scope_id,
                            "project_id": project_id,
                            "session_id": session_id,
                            "count": copy_count,
                        },
                        ai_provider=request.ai_provider,
                        workflow=AgentWorkflow.DRAFT,
                    )
                    _persist_stream_agent_gate_message(
                        memory=memory,
                        session_id=session_id,
                        scope_id=project_scope_id,
                        project_id=project_id,
                        user_id=user_id_text,
                        question=request.message.strip(),
                        response=approval_response,
                    )
                    yield format_sse_event("approval_required", approval_response.model_dump(mode="json"))
                    yield format_sse_event("done", {})
                    return
                elif not operational_payload and should_generate_docx_work_product(
                    request.message.strip(),
                    answer_text,
                    detect_work_product_type(request.message, answer_text),
                ):
                    draft_type = detect_work_product_type(request.message, answer_text)
                    action = _artifact_approval_action(request.message, answer_text, draft_type)
                    approval_response = _create_stream_artifact_approval(
                        user_id=user_id_text,
                        message=request.message,
                        answer=answer_text,
                        context=deep_agent_context,
                        action=action,
                        title="Create assistant work product",
                        description="Approve before creating a DOCX artifact from this drafted answer.",
                        payload={
                            "scope_id": project_scope_id,
                            "project_id": project_id,
                            "session_id": session_id,
                            "contract_name": project_name,
                            "question": request.message.strip(),
                            "answer": answer_text,
                            "draft_type": draft_type,
                        },
                        ai_provider=request.ai_provider,
                        workflow=AgentWorkflow.REDLINE if action == "create_redline_artifact" else AgentWorkflow.DRAFT,
                    )
                    _persist_stream_agent_gate_message(
                        memory=memory,
                        session_id=session_id,
                        scope_id=project_scope_id,
                        project_id=project_id,
                        user_id=user_id_text,
                        question=request.message.strip(),
                        response=approval_response,
                    )
                    yield format_sse_event("approval_required", approval_response.model_dump(mode="json"))
                    yield format_sse_event("done", {})
                    return

                final_payload["artifacts"] = artifacts
                yield format_sse_event("final", final_payload)

                assistant_metadata = {
                    "confidence": final_payload.get("confidence"),
                    "citation": final_payload.get("citation"),
                    "reason": final_payload.get("reason"),
                    "citation_details": final_payload.get("citation_details", {}),
                    "citation_annotations": final_payload.get("citation_annotations", []),
                    "agent_trace": final_payload.get("agent_trace"),
                    "vector_namespace": final_payload.get("vector_namespace"),
                    "vector_backend": final_payload.get("vector_backend"),
                    "artifacts": artifacts,
                }
                memory.append_message(
                    session_id=session_id,
                    contract_id=project_scope_id,
                    user_id=user_id_text,
                    role="assistant",
                    content=answer_text,
                    metadata=assistant_metadata,
                )
                memory.remember_turn(
                    contract_id=project_scope_id,
                    user_id=user_id_text,
                    session_id=session_id,
                    question=request.message.strip(),
                    answer=answer_text,
                )
                memory.record_draft_if_any(
                    contract_id=project_scope_id,
                    project_id=project_id,
                    user_id=user_id_text,
                    session_id=session_id,
                    question=request.message.strip(),
                    answer=answer_text,
                    metadata=assistant_metadata,
                    artifact=created_artifact or (artifacts[0] if artifacts else None),
                )

            yield format_sse_event("done", {})
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
    memory_context = memory.build_memory_context(
        session_id=session_id,
        contract_id=contract_id,
        user_id=user_id_text,
        question=request.message.strip(),
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
    if kpi_context:
        memory_context = f"{memory_context}\n\n{kpi_context}" if memory_context else kpi_context

    operational_payload = _build_operational_kpi_answer(
        request.message.strip(),
        scoped_kpis,
        source_configs=kpi_operational_context["source_configs"],
        actuals=kpi_operational_context["actuals"],
        breaches=kpi_operational_context["breaches"],
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

    def event_stream():
        try:
            yield format_sse_event("session", {"session_id": session_id})
            yield format_sse_event("status", {"message": "planning"})
            deep_agent_response = _run_stream_agent_gate(
                user_id=user_id_text,
                message=request.message,
                context=deep_agent_context,
                ai_provider=request.ai_provider,
            )
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
                event_name = "approval_required" if deep_agent_response.requires_approval else "final"
                yield format_sse_event(event_name, deep_agent_response.model_dump(mode="json"))
                yield format_sse_event("done", {})
                return

            yield format_sse_event("status", {"message": "retrieving"})
            final_payload: Optional[Dict[str, Any]] = None
            if operational_payload:
                answer_text = str(operational_payload.get("answer") or "")
                yield format_sse_event("thinking", {"message": "Reading ContractSense KPI register."})
                for index in range(0, len(answer_text), 48):
                    yield format_sse_event("delta", {"text": answer_text[index:index + 48]})
                yield format_sse_event("content_done", {})
                final_payload = {**dict(operational_payload), "artifacts": []}
                yield format_sse_event("citations", {
                    "citation": final_payload.get("citation", ""),
                    "citation_details": final_payload.get("citation_details", {}),
                    "citation_annotations": final_payload.get("citation_annotations", []),
                })
                yield format_sse_event("final", final_payload)
                try:
                    assistant_metadata = {
                        "confidence": final_payload.get("confidence"),
                        "citation": final_payload.get("citation"),
                        "reason": final_payload.get("reason"),
                        "citation_details": final_payload.get("citation_details", {}),
                        "citation_annotations": final_payload.get("citation_annotations", []),
                        "agent_trace": final_payload.get("agent_trace"),
                        "vector_namespace": None,
                        "vector_backend": None,
                        "artifacts": [],
                        "source": "operational_kpi_register",
                    }
                    memory.append_message(
                        session_id=session_id,
                        contract_id=contract_id,
                        user_id=user_id_text,
                        role="assistant",
                        content=answer_text,
                        metadata=assistant_metadata,
                    )
                    memory.remember_turn(
                        contract_id=contract_id,
                        user_id=user_id_text,
                        session_id=session_id,
                        question=request.message.strip(),
                        answer=answer_text,
                    )
                except Exception as memory_error:
                    log_exception(logger, f"Failed to persist operational KPI stream for contract {contract_id}", memory_error)
                yield format_sse_event("done", {})
                return
            elif project_documents:
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
                stream_iterator = rag_system.stream_project_question(
                    project_documents=project_documents,
                    project_id=str(project_id),
                    question=request.message.strip(),
                    user_id=user_id_text,
                    displayed_document=displayed_document,
                    attached_documents=attached_documents or [],
                    memory_context=memory_context,
                )
            else:
                stream_iterator = rag_system.stream_agent_question(
                    contract_text=index_content,
                    contract_name=contract.get("contract_name", contract_id),
                    contract_id=contract_id,
                    project_id=project_id_text,
                    question=request.message.strip(),
                    user_id=user_id_text,
                    vector_namespace=index_data.get("vector_namespace"),
                    vector_backend=index_data.get("vector_backend"),
                    displayed_document=request.displayed_document or {
                        "document_id": contract_id,
                        "filename": contract.get("contract_name", contract_id),
                    },
                    attached_documents=request.attached_documents or [],
                    memory_context=memory_context,
                )

            for payload in stream_iterator:
                payload_for_event = dict(payload)
                event_type = payload_for_event.pop("type", "message")
                if event_type == "final":
                    final_payload = dict(payload_for_event)
                    continue
                if event_type == "citations":
                    # Re-emit validated citations after final payload assembly.
                    continue
                yield format_sse_event(event_type, payload_for_event)

            vector_namespace = getattr(rag_system, "current_namespace", None)
            vector_backend = getattr(rag_system, "current_vector_backend", None)
            if (
                not operational_payload and
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

            if final_payload:
                final_payload = dict(final_payload)
                answer_text = str(final_payload.get("answer") or "")
                yield format_sse_event("citations", {
                    "citation": final_payload.get("citation", ""),
                    "citation_details": final_payload.get("citation_details", {}),
                    "citation_annotations": final_payload.get("citation_annotations", []),
                })
                artifacts: List[Dict[str, Any]] = []
                should_emit_edit = False
                created_artifact: Optional[Dict[str, Any]] = None
                copy_count = 0 if operational_payload else _requested_copy_count(request.message.strip())
                if copy_count:
                    approval_response = _create_stream_artifact_approval(
                        user_id=user_id_text,
                        message=request.message,
                        answer=answer_text,
                        context=deep_agent_context,
                        action="duplicate_document_copy",
                        title=f"Create {copy_count} document copies",
                        description="Approve before duplicating assistant-created contract work products.",
                        payload={
                            "scope_id": contract_id,
                            "contract_id": contract_id,
                            "project_id": project_id_text,
                            "session_id": session_id,
                            "count": copy_count,
                        },
                        ai_provider=request.ai_provider,
                        workflow=AgentWorkflow.DRAFT,
                    )
                    _persist_stream_agent_gate_message(
                        memory=memory,
                        session_id=session_id,
                        scope_id=contract_id,
                        project_id=project_id_text,
                        user_id=user_id_text,
                        question=request.message.strip(),
                        response=approval_response,
                    )
                    yield format_sse_event("approval_required", approval_response.model_dump(mode="json"))
                    yield format_sse_event("done", {})
                    return
                elif not operational_payload and should_generate_docx_work_product(request.message.strip(), answer_text, detect_work_product_type(request.message, answer_text)):
                    draft_type = detect_work_product_type(request.message, answer_text)
                    action = _artifact_approval_action(request.message, answer_text, draft_type)
                    should_emit_edit = action == "create_redline_artifact"
                    approval_answer = answer_text
                    approval_title = "Create redline artifact" if should_emit_edit else "Create draft artifact"
                    approval_description = "Approve before creating a DOCX artifact from this assistant answer."
                    approval_payload_extra: Dict[str, Any] = {}
                    if should_emit_edit:
                        approval_answer, approval_title, approval_description, approval_payload_extra = _redline_approval_details(
                            question=request.message.strip(),
                            source_text=index_content,
                            contract_name=contract.get("contract_name", contract_id),
                        )
                    approval_response = _create_stream_artifact_approval(
                        user_id=user_id_text,
                        message=request.message,
                        answer=approval_answer,
                        context=deep_agent_context,
                        action=action,
                        title=approval_title,
                        description=approval_description,
                        payload={
                            "scope_id": contract_id,
                            "contract_id": contract_id,
                            "project_id": project_id_text,
                            "session_id": session_id,
                            "contract_name": contract.get("contract_name", contract_id),
                            "question": request.message.strip(),
                            "answer": answer_text,
                            "draft_type": draft_type,
                            **approval_payload_extra,
                        },
                        ai_provider=request.ai_provider,
                        workflow=AgentWorkflow.REDLINE if should_emit_edit else AgentWorkflow.DRAFT,
                    )
                    _persist_stream_agent_gate_message(
                        memory=memory,
                        session_id=session_id,
                        scope_id=contract_id,
                        project_id=project_id_text,
                        user_id=user_id_text,
                        question=request.message.strip(),
                        response=approval_response,
                    )
                    yield format_sse_event("approval_required", approval_response.model_dump(mode="json"))
                    yield format_sse_event("done", {})
                    return
                if artifacts:
                    final_payload["artifacts"] = artifacts
                yield format_sse_event("final", final_payload)

                assistant_metadata = {
                    "confidence": final_payload.get("confidence"),
                    "citation": final_payload.get("citation"),
                    "reason": final_payload.get("reason"),
                    "citation_details": final_payload.get("citation_details", {}),
                    "citation_annotations": final_payload.get("citation_annotations", []),
                    "agent_trace": final_payload.get("agent_trace"),
                    "vector_namespace": final_payload.get("vector_namespace"),
                    "vector_backend": final_payload.get("vector_backend"),
                    "artifacts": artifacts,
                }
                memory.append_message(
                    session_id=session_id,
                    contract_id=contract_id,
                    user_id=user_id_text,
                    role="assistant",
                    content=answer_text,
                    metadata=assistant_metadata,
                )
                memory.remember_turn(
                    contract_id=contract_id,
                    user_id=user_id_text,
                    session_id=session_id,
                    question=request.message.strip(),
                    answer=answer_text,
                )
                memory.record_draft_if_any(
                    contract_id=contract_id,
                    project_id=project_id_text,
                    user_id=user_id_text,
                    session_id=session_id,
                    question=request.message.strip(),
                    answer=answer_text,
                    metadata=assistant_metadata,
                    artifact=created_artifact,
                )

            yield format_sse_event("done", {})
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


