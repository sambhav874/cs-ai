"""What is waiting on you.

Roles existed but were invisible: to find out whether anything needed your
approval you opened contracts one at a time. This is the single place that
answers "what is waiting on me", across every artifact the workflow governs.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, Query

from core.database import collection, kpi_db, projects_collection
from core.security import get_current_active_user
from models.domain import UserInDB

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


def _contract_clauses(user_oid: ObjectId, role_key: str, statuses: List[str]) -> List[Dict[str, Any]]:
    """Contracts this user holds `role_key` on — assigned here or inherited."""
    clauses: List[Dict[str, Any]] = [
        {f"workflowRoles.{role_key}": user_oid, "status": {"$in": statuses}}
    ]
    inherited_project_oids = _project_oids_for_role(user_oid, role_key)
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
