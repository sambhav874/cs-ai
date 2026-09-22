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
