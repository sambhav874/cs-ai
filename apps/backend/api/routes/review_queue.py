"""What is waiting on you.

Roles existed but were invisible: to find out whether anything needed your
approval you opened contracts one at a time. This is the single place that
answers "what is waiting on me", across every artifact the workflow governs.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import collection, kpi_db, projects_collection, users_collection
from core.security import get_current_active_user
from models.domain import DelegateWorkflowRoleRequest, UserInDB
from utils.audit_logger import create_audit_log

logger = logging.getLogger(__name__)

review_queue_router = APIRouter()

# What each role is expected to act on, rather than merely see.
APPROVER_ACTIONABLE_STATUSES = ["Pending Approval", "Pending Re-edit Approval"]
EDITOR_ACTIONABLE_STATUSES = ["Ready to Edit", "Editing", "Rejected", "Re-edit Denied"]

# A KPI sitting in draft or reviewed is waiting for a human to certify it.
KPI_PENDING_GOVERNANCE_STATUSES = ["draft", "reviewed"]


def _project_oids_for_role(user_oid: ObjectId, role_key: str) -> List[ObjectId]:
    if projects_collection is None:
        return []
    return [
        project["_id"]
        for project in projects_collection.find(
            {f"workflowRoles.{role_key}": user_oid}, {"_id": 1}
        )
    ]


def _delegators_to(user_oid: ObjectId, role: str) -> List[ObjectId]:
    """Whose role is this user currently covering?"""
    if users_collection is None:
        return []
    now = datetime.utcnow()
    delegators = []
    for user in users_collection.find(
        {"workflowDelegations.delegateUserId": user_oid}, {"workflowDelegations": 1}
    ):
        for delegation in user.get("workflowDelegations") or []:
            if (
                delegation.get("role") == role
                and delegation.get("delegateUserId") == user_oid
                and not delegation.get("revokedAt")
                and (delegation.get("until") is None or delegation["until"] > now)
            ):
                delegators.append(user["_id"])
                break
    return delegators


def _contract_clauses(user_oid: ObjectId, role_key: str, statuses: List[str]) -> List[Dict[str, Any]]:
    """Contracts this user holds `role_key` on — assigned, inherited, or covered.

    Someone standing in for a colleague has to see that colleague's queue, or
    the delegation moves the permission without moving the work.
    """
    role = "approver" if role_key == "approverUserId" else "editor"
    holder_oids = [user_oid] + _delegators_to(user_oid, role)

    clauses: List[Dict[str, Any]] = [
        {f"workflowRoles.{role_key}": {"$in": holder_oids}, "status": {"$in": statuses}}
    ]
    inherited_project_oids: List[ObjectId] = []
    for holder_oid in holder_oids:
        inherited_project_oids.extend(_project_oids_for_role(holder_oid, role_key))
    if inherited_project_oids:
        clauses.append(
            {
                "projectId": {"$in": inherited_project_oids},
                f"workflowRoles.{role_key}": None,
                "status": {"$in": statuses},
            }
        )
    return clauses


def _waiting_since(doc: Dict[str, Any]) -> Optional[datetime]:
    return doc.get("updatedAt") or doc.get("uploaded_at")


def _contract_items(user_oid: ObjectId, role: str, statuses: List[str]) -> List[Dict[str, Any]]:
    role_key = "approverUserId" if role == "approver" else "editorUserId"
    clauses = _contract_clauses(user_oid, role_key, statuses)
    documents = collection.find(
        {"$or": clauses},
        {
            "contract_name": 1,
            "status": 1,
            "projectId": 1,
            "updatedAt": 1,
            "uploaded_at": 1,
            "rejectedReason": 1,
            "reEditRequest.reason": 1,
        },
    )
    items = []
    for doc in documents:
        items.append(
            {
                "artifact_type": "contract",
                "artifact_id": str(doc["_id"]),
                "title": doc.get("contract_name") or "Untitled contract",
                "contract_id": str(doc["_id"]),
                "project_id": str(pid) if (pid := doc.get("projectId")) else None,
                "state": doc.get("status"),
                "assigned_role": role,
                "waiting_since": _waiting_since(doc),
                "note": (doc.get("reEditRequest") or {}).get("reason") or doc.get("rejectedReason"),
            }
        )
    return items


def _kpi_items(user_oid: ObjectId) -> List[Dict[str, Any]]:
    """KPIs on contracts this user approves that nobody has certified yet."""
    if kpi_db is None:
        return []
    approver_contract_ids = [
        str(doc["_id"])
        for doc in collection.find(
            {"$or": _contract_clauses(user_oid, "approverUserId", APPROVER_ACTIONABLE_STATUSES + ["Approved"])},
            {"_id": 1},
        )
    ]
    if not approver_contract_ids:
        return []

    items = []
    for kpi in kpi_db.contract_kpis.find(
        {
            "contract_id": {"$in": approver_contract_ids},
            "governance_status": {"$in": KPI_PENDING_GOVERNANCE_STATUSES},
        },
        {"contract_id": 1, "kpi_id": 1, "name": 1, "governance_status": 1, "updated_at": 1},
    ):
        items.append(
            {
                "artifact_type": "kpi",
                "artifact_id": str(kpi.get("kpi_id") or kpi["_id"]),
                "title": kpi.get("name") or "Untitled KPI",
                "contract_id": kpi.get("contract_id"),
                "project_id": None,
                "state": kpi.get("governance_status"),
                "assigned_role": "approver",
                "waiting_since": kpi.get("updated_at"),
                "note": None,
            }
        )
    return items


@review_queue_router.get("/me/review-queue")
def get_my_review_queue(
    include_kpis: bool = Query(True, description="Include KPIs awaiting certification."),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Everything waiting on this user, in one list."""
    user_oid = ObjectId(current_user.id)

    approvals = _contract_items(user_oid, "approver", APPROVER_ACTIONABLE_STATUSES)
    edits = _contract_items(user_oid, "editor", EDITOR_ACTIONABLE_STATUSES)
    if include_kpis:
        approvals.extend(_kpi_items(user_oid))

    # Oldest first: the thing that has been waiting longest is the thing most
    # likely to be forgotten.
    def _sort_key(item):
        waiting = item.get("waiting_since")
        return waiting or datetime.min

    approvals.sort(key=_sort_key)
    edits.sort(key=_sort_key)

    return {
        "awaiting_my_approval": approvals,
        "awaiting_my_edit": edits,
        "counts": {
            "approvals": len(approvals),
            "edits": len(edits),
            "total": len(approvals) + len(edits),
        },
    }


@review_queue_router.get("/me/delegations")
def list_my_delegations(
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Roles this user has handed to someone else, and for how long."""
    user = users_collection.find_one(
        {"_id": ObjectId(current_user.id)}, {"workflowDelegations": 1}
    )
    delegations = (user or {}).get("workflowDelegations") or []
    now = datetime.utcnow()

    delegate_oids = [
        d["delegateUserId"] for d in delegations if isinstance(d.get("delegateUserId"), ObjectId)
    ]
    names = {}
    if delegate_oids:
        names = {
            str(u["_id"]): u.get("username")
            for u in users_collection.find({"_id": {"$in": delegate_oids}}, {"username": 1})
        }

    return {
        "delegations": [
            {
                "id": str(d.get("_id")),
                "role": d.get("role"),
                "delegateUserId": str(d.get("delegateUserId")),
                "delegate_name": names.get(str(d.get("delegateUserId"))),
                "until": d.get("until"),
                "reason": d.get("reason"),
                "createdAt": d.get("createdAt"),
                "revokedAt": d.get("revokedAt"),
                "active": (
                    not d.get("revokedAt")
                    and (d.get("until") is None or d.get("until") > now)
                ),
            }
            for d in delegations
        ]
    }


@review_queue_router.post("/me/delegations")
async def create_my_delegation(
    request: DelegateWorkflowRoleRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Hand one of your workflow roles to a colleague while you are away."""
    if not ObjectId.is_valid(request.delegateUserId):
        raise HTTPException(status_code=400, detail="Invalid delegateUserId.")

    delegate_oid = ObjectId(request.delegateUserId)
    user_oid = ObjectId(current_user.id)
    if delegate_oid == user_oid:
        raise HTTPException(status_code=400, detail="You cannot delegate a role to yourself.")

    if request.until is not None and request.until <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="The delegation end date is already in the past.")

    delegate = users_collection.find_one({"_id": delegate_oid}, {"_id": 1})
    if not delegate:
        raise HTTPException(status_code=404, detail="That user does not exist.")

    delegation = {
        "_id": ObjectId(),
        "role": request.role,
        "delegateUserId": delegate_oid,
        "until": request.until,
        "reason": request.reason,
        "createdAt": datetime.utcnow(),
        "revokedAt": None,
    }
    users_collection.update_one(
        {"_id": user_oid}, {"$push": {"workflowDelegations": delegation}}
    )

    await create_audit_log(
        user=current_user,
        action="WORKFLOW_ROLE_DELEGATED",
        details={
            "role": request.role,
            "delegateUserId": str(delegate_oid),
            "until": request.until.isoformat() if request.until else None,
            "reason": request.reason,
        },
    )

    return {"message": "Delegation created.", "id": str(delegation["_id"])}


@review_queue_router.delete("/me/delegations/{delegation_id}")
async def revoke_my_delegation(
    delegation_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Take a delegated role back before it lapses."""
    if not ObjectId.is_valid(delegation_id):
        raise HTTPException(status_code=400, detail="Invalid delegation id.")

    result = users_collection.update_one(
        {"_id": ObjectId(current_user.id), "workflowDelegations._id": ObjectId(delegation_id)},
        {"$set": {"workflowDelegations.$.revokedAt": datetime.utcnow()}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Delegation not found.")

    await create_audit_log(
        user=current_user,
        action="WORKFLOW_ROLE_DELEGATION_REVOKED",
        details={"delegationId": delegation_id},
    )
    return {"message": "Delegation revoked."}
