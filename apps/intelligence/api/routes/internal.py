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
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile

from api.dependencies import queue_contract_ingestion
from api.routes.projects import ensure_default_project
from core.database import collection, fs, projects_collection
from core.platform_identity import PlatformIdentityError, _platform_db, platform_roles, resolve_platform_user
from core.validators import extract_pdf_page_count, validate_pdf_upload
from services.platform_contracts import PlatformContractError, link_platform_contract

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
        return link_platform_contract(
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
