"""Service-to-service routes: the lifecycle API calling this tier.

No user session here. Every route requires the shared INTERNAL_SERVICE_SECRET
in `X-Internal-Secret`, compared in constant time, and fails closed when the
secret is not configured. The caller also names the org and user it acts for;
the services re-check those against the platform database rather than trusting
them.
"""
from __future__ import annotations

import hmac
import logging
import os
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from api.dependencies import queue_contract_ingestion
from api.routes.projects import ensure_default_project
from core.database import collection, fs, projects_collection
from core.platform_identity import PlatformIdentityError, _platform_db, platform_roles, resolve_platform_user
from core.validators import extract_pdf_page_count, validate_pdf_upload
from bson import ObjectId
from models.domain import UserInDB
from utils.audit_logger import create_audit_log
from services.platform_contracts import PlatformContractError, link_platform_contract
from services.platform_retrieval import search_platform_contracts

logger = logging.getLogger(__name__)

internal_router = APIRouter(prefix="/internal", tags=["internal"])


def require_internal_secret(x_internal_secret: Optional[str] = Header(None)) -> None:
    expected = os.environ.get("INTERNAL_SERVICE_SECRET", "")
    if not expected:
        # Fail closed: an unset secret must not mean "anyone may call".
        raise HTTPException(status_code=503, detail="Internal routes are not configured.")
    if not x_internal_secret or not hmac.compare_digest(x_internal_secret, expected):
        raise HTTPException(status_code=401, detail="Invalid internal secret.")


@internal_router.post("/contracts/link", dependencies=[Depends(require_internal_secret)])
async def link_contract(
    file: UploadFile = File(...),
    platform_contract_id: str = Form(...),
    org_id: str = Form(...),
    user_id: str = Form(...),
) -> Dict[str, Any]:
    content = await file.read()
    filename = validate_pdf_upload(content, file.filename or "contract.pdf")
    page_count = extract_pdf_page_count(content)

    try:
        # Same mapping a signed-in request gets: the platform user must exist
        # and belong to org_id, and their shadow user and org team are synced.
        roles = platform_roles(user_id)
        shadow = resolve_platform_user({"sub": user_id, "orgId": org_id, "type": "access", "roles": roles})
    except PlatformIdentityError as e:
        raise HTTPException(status_code=422, detail=f"Unknown platform user: {e}")
    uploader = SimpleNamespace(id=shadow["_id"], teamIds=shadow.get("teamIds") or [])

    try:
        result = link_platform_contract(
            platform_contract_id=platform_contract_id,
            org_id=org_id,
            content=content,
            filename=filename,
            mime_type="application/pdf",
            page_count=page_count,
            uploader=uploader,
            contracts=collection,
            projects=projects_collection,
            platform_db=_platform_db(),
            store_file=fs.put,
            queue_ingestion=queue_contract_ingestion,
            ensure_default=ensure_default_project,
        )
    except PlatformContractError as e:
        raise HTTPException(status_code=422, detail=str(e))

    # The same audit entry ContractSense's own upload writes, attributed to the
    # platform user who uploaded, so the analysis side's audit trail and
    # analytics see linked contracts too. A retry of identical bytes is not a
    # new upload and records nothing.
    if result.get("status") != "unchanged":
        try:
            await create_audit_log(
                user=UserInDB.model_validate(shadow),
                action="CONTRACT_UPLOADED",
                contract_id=ObjectId(result["contract_id"]),
                contract_name_override=filename,
                account_id_override=ObjectId(str(uploader.teamIds[0])),
                details={
                    "source": "platform",
                    "platformContractId": platform_contract_id,
                    "linkStatus": result.get("status"),
                    "page_count": page_count,
                    "file_size": len(content),
                },
            )
        except Exception:
            logger.exception("Could not write the audit entry for linked contract %s", platform_contract_id)
    return result


class RetrievalRequest(BaseModel):
    org_id: str = Field(..., min_length=1)
    query: str = Field(..., min_length=1, max_length=4000)
    limit: int = Field(20, ge=1, le=100)
    platform_contract_ids: Optional[List[str]] = None


@internal_router.post("/retrieval/search", dependencies=[Depends(require_internal_secret)])
def retrieval_search(body: RetrievalRequest) -> Dict[str, Any]:
    """Passages from the org's analysed contracts, ranked by ContractSense's
    hybrid retrieval. Replaces the lifecycle API's pgvector clause search."""
    hits = search_platform_contracts(
        body.org_id, body.query,
        limit=body.limit, contracts=collection,
        platform_contract_ids=body.platform_contract_ids,
    )
    return {"hits": hits}


class ExtractObligationsRequest(BaseModel):
    org_id: str = Field(..., min_length=1)
    user_id: str = Field(..., min_length=1)


@internal_router.post(
    "/contracts/{platform_contract_id}/extract-obligations",
    dependencies=[Depends(require_internal_secret)],
)
def extract_platform_obligations(platform_contract_id: str, body: ExtractObligationsRequest) -> Dict[str, Any]:
    """Re-run obligation extraction on a linked contract's analysis copy.

    The lifecycle API's "Extract obligations" action lands here; the result
    comes back to it through the usual post-run sync, not in this response.
    """
    from datetime import datetime, timedelta

    from api.routes.kpis import EXTRACTION_STALE_MINUTES
    from services.platform_contracts import find_by_platform_id
    from worker.tasks import extract_obligations_task

    try:
        roles = platform_roles(body.user_id)
        shadow = resolve_platform_user({"sub": body.user_id, "orgId": body.org_id, "type": "access", "roles": roles})
    except PlatformIdentityError as e:
        raise HTTPException(status_code=422, detail=f"Unknown platform user: {e}")
    team_ids = shadow.get("teamIds") or []
    if not team_ids:
        raise HTTPException(status_code=422, detail="Platform user has no org team.")

    contract = find_by_platform_id(platform_contract_id, ObjectId(str(team_ids[0])), contracts=collection)
    if contract is None:
        # Not linked yet (or linked under another org): nothing to extract from.
        raise HTTPException(status_code=404, detail="Contract has no analysis copy yet.")
    if (contract.get("index") or {}).get("status") != "success":
        raise HTTPException(status_code=409, detail="Contract is still being analysed.")

    obligations = contract.get("obligations") or {}
    started = obligations.get("started_at") or obligations.get("queued_at")
    stale_after = datetime.utcnow() - timedelta(minutes=EXTRACTION_STALE_MINUTES)
    if obligations.get("status") in {"queued", "running"} and (started is None or started > stale_after):
        raise HTTPException(status_code=409, detail="Obligation extraction is already running.")

    collection.update_one(
        {"_id": contract["_id"]},
        {"$set": {"obligations.status": "queued", "obligations.queued_at": datetime.utcnow()}},
    )
    try:
        extract_obligations_task.delay(contract_id=str(contract["_id"]), user_id=str(shadow["_id"]))
    except Exception as exc:
        collection.update_one(
            {"_id": contract["_id"]},
            {"$set": {"obligations.status": "error", "obligations.error": str(exc)[:500]}},
        )
        raise HTTPException(status_code=503, detail="Extraction queue is unavailable.")
    return {"status": "queued", "contract_id": str(contract["_id"])}


class AnalyseRequest(BaseModel):
    org_id: str = Field(..., min_length=1)
    version_id: str = Field(..., min_length=1)
    # The platform's own text: used when there is no analysis copy to read.
    plain_text: str = Field("", max_length=2_000_000)
    contract_type: Optional[str] = Field(None, max_length=40)
    custom_fields: List[Dict[str, Any]] = Field(default_factory=list, max_length=200)
    # False for a contract with no PDF or DOCX: it will never be linked, so
    # there is nothing to wait for.
    expect_linked: bool = True
    run_id: Optional[str] = Field(None, min_length=1, max_length=120)


@internal_router.post(
    "/contracts/{platform_contract_id}/analyse",
    dependencies=[Depends(require_internal_secret)],
)
def analyse_platform_contract(platform_contract_id: str, body: AnalyseRequest) -> Dict[str, Any]:
    """Start key-term analysis for a platform contract (replaces /agents/review).

    Answers at once; the result reaches the API through
    POST /api/internal/contracts/{id}/analysis/sync. A new request replaces any
    earlier one for the same contract, which then stops without syncing.
    """
    from core.database import db
    from services.platform_analysis import REQUESTS_COLLECTION, new_request
    from worker.tasks import analyse_platform_contract_task

    owner = _platform_db()["contracts"].find_one({"_id": platform_contract_id}, {"orgId": 1}) or {}
    if str(owner.get("orgId") or "") != body.org_id:
        # Unknown here, or another org's contract: the same answer for both.
        raise HTTPException(status_code=404, detail="Contract not found.")

    request = new_request(
        platform_contract_id,
        org_id=body.org_id,
        version_id=body.version_id,
        plain_text=body.plain_text,
        contract_type=body.contract_type,
        custom_fields=body.custom_fields,
        expect_linked=body.expect_linked,
        run_id=body.run_id,
    )
    db[REQUESTS_COLLECTION].replace_one({"_id": platform_contract_id}, request, upsert=True)
    try:
        analyse_platform_contract_task.delay(platform_contract_id=platform_contract_id, run_id=request["run_id"])
    except Exception as exc:
        logger.warning("Could not queue analysis for %s: %s", platform_contract_id, exc)
        raise HTTPException(status_code=503, detail="Analysis queue is unavailable.")
    return {"status": "queued", "run_id": request["run_id"]}


class WorkflowDecisionRequest(BaseModel):
    org_id: str = Field(..., min_length=1)
    user_id: str = Field(..., min_length=1)
    decision: str = Field("approve", pattern="^(approve|reject)$")
    feedback: Optional[str] = Field(None, max_length=2000)


@internal_router.post(
    "/agent/workflows/{workflow_id}/decide",
    dependencies=[Depends(require_internal_secret)],
)
def decide_agent_workflow(workflow_id: str, body: WorkflowDecisionRequest) -> Dict[str, Any]:
    """Apply (or decline) a ContractSense approval from the platform chat.

    The assistant's approval-gated writes — remember or correct a fact,
    extract KPIs, a tabular review — surface as the chat's Apply card; the
    lifecycle API routes Apply here after checking the caller's permission.
    The workflow must belong to the caller's shadow user, exactly as on the
    signed-in route.
    """
    from api.routes.agent import WorkflowApprovalRequest, decide_workflow
    from services.contract_agent.graph.state import ApprovalDecision

    try:
        roles = platform_roles(body.user_id)
        shadow = resolve_platform_user({"sub": body.user_id, "orgId": body.org_id, "type": "access", "roles": roles})
    except PlatformIdentityError as e:
        raise HTTPException(status_code=422, detail=f"Unknown platform user: {e}")
    user = UserInDB.model_validate(shadow)
    decision = ApprovalDecision.REJECT if body.decision == "reject" else ApprovalDecision.APPROVE
    response = decide_workflow(workflow_id, WorkflowApprovalRequest(decision=decision, feedback=body.feedback), user)
    return {
        "workflowId": workflow_id,
        "status": getattr(response.workflow_status, "value", str(response.workflow_status)),
        "answer": response.answer,
        "artifacts": response.artifacts,
    }
