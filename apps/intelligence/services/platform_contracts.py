"""One contract, two copies: link the lifecycle API's contract to its analysis here.

The lifecycle API owns a contract — its title, status, Space and approvals.
This tier owns what ContractSense knows about it: the extracted text, clauses,
obligations, KPIs and the index that Q&A and citations read. Until now the two
were separate uploads of the same file with nothing joining them, so the same
contract was analysed twice and neither side could find the other's view.

`platformContractId` is the join. It sits on this tier's contracts document,
under a unique partial index, so there is at most one analysis copy per
platform contract. The lifecycle API pushes a stored file here after upload
(POST /internal/contracts/link); `link_platform_contract` upserts the copy into
the org's team and the contract's Space, and queues ingestion.

After that the copy follows its platform contract: services/space_watcher
applies Space moves and deletes from the platform's contracts collection.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Any, Callable, Dict, Optional

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from services.space_projects import ensure_space_project

logger = logging.getLogger(__name__)


class PlatformContractError(Exception):
    """The request names a contract, org or user this tier cannot accept."""


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def project_for_space(
    space_id: Optional[str],
    team_oid: ObjectId,
    *,
    projects,
    platform_db,
    ensure_default: Callable[[str, ObjectId], Dict[str, Any]],
) -> Dict[str, Any]:
    """The project a platform contract belongs in: its Space's, or Unfiled."""
    if space_id:
        project = ensure_space_project(space_id, team_oid, projects=projects, platform_db=platform_db)
        if project is not None:
            return project
        # A Space that is gone or in another org must not strand the contract;
        # it lands in Unfiled and the watcher moves it if that changes.
        logger.warning("Space %s not usable for team %s; filing the contract as Unfiled.", space_id, team_oid)
    return ensure_default("team", team_oid)


def link_platform_contract(
    *,
    platform_contract_id: str,
    org_id: str,
    content: bytes,
    filename: str,
    mime_type: str,
    page_count: int,
    uploader,
    contracts,
    projects,
    platform_db,
    store_file: Callable[..., ObjectId],
    queue_ingestion: Callable[..., Optional[str]],
    ensure_default: Callable[[str, ObjectId], Dict[str, Any]],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Create or refresh this tier's copy of a platform contract.

    Idempotent: re-sending the same bytes changes nothing and queues nothing,
    so the API can retry its job freely. New bytes (a new version uploaded on
    the lifecycle side) replace the file and re-run ingestion.
    """
    platform = platform_db["contracts"].find_one(
        {"_id": platform_contract_id},
        {"orgId": 1, "spaceId": 1, "title": 1, "deletedAt": 1},
    )
    # The shared secret proves the caller is the API, not that the ids agree.
    # Checking the contract's org here means a bug on that side cannot file
    # one org's contract under another org's team.
    if not platform:
        raise PlatformContractError("no such platform contract")
    if platform.get("orgId") != org_id:
        raise PlatformContractError("contract belongs to another organisation")
    if platform.get("deletedAt") is not None:
        raise PlatformContractError("contract is deleted")

    team_id = (getattr(uploader, "teamIds", None) or [None])[0]
    if not team_id:
        raise PlatformContractError("uploader belongs to no organisation")
    team_oid = ObjectId(str(team_id))
    user_oid = ObjectId(str(uploader.id))

    project = project_for_space(
        platform.get("spaceId"), team_oid,
        projects=projects, platform_db=platform_db, ensure_default=ensure_default,
    )
    digest = _sha256(content)
    now = now or datetime.utcnow()

    existing = contracts.find_one(
        {"platformContractId": platform_contract_id},
        {"_id": 1, "contentSha256": 1, "projectId": 1},
    )
    if existing and existing.get("contentSha256") == digest:
        return {"contract_id": str(existing["_id"]), "status": "unchanged", "project_id": str(existing.get("projectId"))}

    file_id = store_file(
        content,
        filename=filename,
        content_type=mime_type,
        metadata={
            "uploaded_by_user_id": user_oid,
            "ownerType": "team",
            "ownerId": team_oid,
            "projectId": project["_id"],
            "page_count": page_count,
            "platformContractId": platform_contract_id,
        },
    )

    fields = {
        "contract_name": platform.get("title") or filename,
        "ownerType": "team",
        "ownerId": team_oid,
        "projectId": project["_id"],
        "spaceId": platform.get("spaceId"),
        "status": "Uploaded",
        "file_size": len(content),
        "file_type": mime_type,
        "page_count": page_count,
        "file_id": file_id,
        "contentSha256": digest,
        "index": {"status": "pending", "content": None, "updated_at": None},
        "process": {"status": "pending", "updated_at": None},
        "platformDeleted": False,
        "linkedAt": now,
    }
    try:
        doc = contracts.find_one_and_update(
            {"platformContractId": platform_contract_id},
            {
                "$set": fields,
                "$setOnInsert": {
                    "platformContractId": platform_contract_id,
                    "uploaded_by": user_oid,
                    "uploaded_at": now,
                    # Billed by the platform, not by ContractSense's page credits.
                    "billing": "platform",
                    "credits_deducted": False,
                    "workflowRoles": {"editorUserId": None, "approverUserId": None},
                    "submittedBy": None,
                    "approvedOrRejectedBy": None,
                    "rejectedReason": None,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        # A concurrent retry of the same job inserted first; take its copy.
        doc = contracts.find_one({"platformContractId": platform_contract_id})

    contract_id = str(doc["_id"])
    job_id = queue_ingestion(
        contract_id=contract_id,
        contract_oid=doc["_id"],
        file_id=file_id,
        file_name=filename,
        user_id=str(user_oid),
    )
    return {
        "contract_id": contract_id,
        "status": "created" if not existing else "updated",
        "project_id": str(project["_id"]),
        "job_id": job_id,
    }


def find_by_platform_id(platform_contract_id: str, org_team_oid: ObjectId, *, contracts) -> Optional[Dict[str, Any]]:
    """This tier's copy of a platform contract, scoped to the caller's org team."""
    return contracts.find_one({
        "platformContractId": platform_contract_id,
        "ownerType": "team",
        "ownerId": org_team_oid,
        "platformDeleted": {"$ne": True},
    })
