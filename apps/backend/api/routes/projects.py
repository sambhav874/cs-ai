import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import collection, projects_collection, teams_collection
from core.security import get_current_active_user
from models.domain import ProjectCreate, ProjectInDB, ProjectUpdate, UserInDB

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects")


def _serialize_project(project: Dict[str, Any], stats: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    payload = {
        "_id": str(project["_id"]),
        "name": project.get("name", "Untitled Project"),
        "description": project.get("description"),
        "ownerId": str(project.get("ownerId")),
        "ownerType": project.get("ownerType"),
        "createdAt": project.get("createdAt"),
        "updatedAt": project.get("updatedAt"),
    }
    if stats is not None:
        payload["stats"] = stats
    return payload


def _resolve_owner(
    current_user: UserInDB,
    context_id: Optional[str] = None,
) -> Tuple[str, ObjectId]:
    if context_id and context_id.lower() != "personal":
        if not ObjectId.is_valid(context_id):
            raise HTTPException(status_code=400, detail="Invalid context_id format.")

        is_owner = current_user.ownedAccountId == context_id
        is_member = context_id in (current_user.teamIds or [])
        if not is_owner and not is_member:
            raise HTTPException(status_code=403, detail="Access denied to this account.")

        team_oid = ObjectId(context_id)
        if not teams_collection.find_one({"_id": team_oid}, {"_id": 1}):
            raise HTTPException(status_code=404, detail="Account not found.")
        return "team", team_oid

    return "user", ObjectId(current_user.id)


def build_accessible_contract_query(
    project: Dict[str, Any],
    current_user: UserInDB,
) -> Dict[str, Any]:
    user_oid = ObjectId(current_user.id)
    owner_type = project.get("ownerType")
    owner_id = project.get("ownerId")
    base: Dict[str, Any] = {
        "projectId": project["_id"],
        "ownerType": owner_type,
        "ownerId": owner_id,
    }

    if owner_type == "user":
        base["ownerId"] = user_oid
        return base

    owner_id_str = str(owner_id)
    if current_user.ownedAccountId == owner_id_str:
        return base

    base["$or"] = [
        {"uploaded_by": user_oid},
        {"workflowRoles.editorUserId": user_oid},
        {"workflowRoles.approverUserId": user_oid},
    ]
    return base


def _project_stats(project: Dict[str, Any], current_user: UserInDB) -> Dict[str, int]:
    query = build_accessible_contract_query(project, current_user)
    processing_statuses = ["Indexing", "Summarizing", "Processing", "queued", "pending", "processing", "Queued"]
    empty_stats = {
        "total_documents": 0,
        "processing_count": 0,
        "uploaded_count": 0,
        "ready_to_edit_count": 0,
        "editing_count": 0,
        "pending_approval_count": 0,
        "rejected_count": 0,
        "completed_count": 0,
        "error_count": 0,
    }

    pipeline = [
        {"$match": query},
        {
            "$group": {
                "_id": None,
                "total_documents": {"$sum": 1},
                "processing_count": {"$sum": {"$cond": [{"$in": ["$status", processing_statuses]}, 1, 0]}},
                "uploaded_count": {"$sum": {"$cond": [{"$eq": ["$status", "Uploaded"]}, 1, 0]}},
                "ready_to_edit_count": {"$sum": {"$cond": [{"$in": ["$status", ["Ready to Edit", "Ingested"]]}, 1, 0]}},
                "editing_count": {"$sum": {"$cond": [{"$eq": ["$status", "Editing"]}, 1, 0]}},
                "pending_approval_count": {"$sum": {"$cond": [{"$eq": ["$status", "Pending Approval"]}, 1, 0]}},
                "rejected_count": {"$sum": {"$cond": [{"$eq": ["$status", "Rejected"]}, 1, 0]}},
                "completed_count": {"$sum": {"$cond": [{"$in": ["$status", ["Completed", "Ingested"]]}, 1, 0]}},
                "error_count": {
                    "$sum": {
                        "$cond": [
                            {
                                "$or": [
                                    {"$in": ["$status", ["Error", "Index Error", "Summarize Error", "Process Error", "error"]]},
                                    {"$ne": [{"$type": "$error"}, "missing"]},
                                ]
                            },
                            1,
                            0,
                        ]
                    }
                },
            }
        },
    ]
    stats = next(collection.aggregate(pipeline), None)
    if not stats:
        return empty_stats
    stats.pop("_id", None)
    return {key: int(stats.get(key, 0)) for key in empty_stats}


def ensure_default_project(owner_type: str, owner_id: ObjectId) -> Dict[str, Any]:
    project = projects_collection.find_one({
        "ownerType": owner_type,
        "ownerId": owner_id,
        "name": "Default Project",
    })
    if project:
        return project

    now = datetime.utcnow()
    result = projects_collection.insert_one({
        "name": "Default Project",
        "description": "Contracts that have not been moved into a specific project.",
        "ownerType": owner_type,
        "ownerId": owner_id,
        "createdAt": now,
        "updatedAt": now,
    })
    return projects_collection.find_one({"_id": result.inserted_id})


def assign_unprojected_contracts(owner_type: str, owner_id: ObjectId, project_id: ObjectId) -> int:
    result = collection.update_many(
        {
            "ownerType": owner_type,
            "ownerId": owner_id,
            "$or": [{"projectId": {"$exists": False}}, {"projectId": None}],
        },
        {"$set": {"projectId": project_id}},
    )
    return result.modified_count


def verify_project_access(project_id: str, current_user: UserInDB) -> Dict[str, Any]:
    if not ObjectId.is_valid(project_id):
        raise HTTPException(status_code=400, detail="Invalid project_id format.")

    project = projects_collection.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    owner_type = project.get("ownerType")
    owner_id_str = str(project.get("ownerId"))
    if owner_type == "user" and owner_id_str != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied to this project.")
    if owner_type == "team":
        is_owner = current_user.ownedAccountId == owner_id_str
        is_member = owner_id_str in (current_user.teamIds or [])
        if not is_owner and not is_member:
            raise HTTPException(status_code=403, detail="Access denied to this project.")
    return project


@router.get("/", response_model=List[ProjectInDB])
def list_projects(
    context_id: Optional[str] = Query(None, description="Account/team id, or personal"),
    current_user: UserInDB = Depends(get_current_active_user),
):
    owner_type, owner_id = _resolve_owner(current_user, context_id)
    default_project = ensure_default_project(owner_type, owner_id)
    assign_unprojected_contracts(owner_type, owner_id, default_project["_id"])

    projects = list(projects_collection.find({"ownerType": owner_type, "ownerId": owner_id}).sort("updatedAt", -1))
    return [_serialize_project(project, _project_stats(project, current_user)) for project in projects]


@router.post("/", response_model=ProjectInDB)
def create_project(
    request: ProjectCreate,
    current_user: UserInDB = Depends(get_current_active_user),
):
    owner_type, owner_id = _resolve_owner(current_user, request.ownerId)
    now = datetime.utcnow()
    result = projects_collection.insert_one({
        "name": request.name.strip(),
        "description": request.description,
        "ownerType": owner_type,
        "ownerId": owner_id,
        "createdAt": now,
        "updatedAt": now,
    })
    project = projects_collection.find_one({"_id": result.inserted_id})
    return _serialize_project(project, _project_stats(project, current_user))


@router.get("/{project_id}", response_model=ProjectInDB)
def get_project(project_id: str, current_user: UserInDB = Depends(get_current_active_user)):
    project = verify_project_access(project_id, current_user)
    return _serialize_project(project, _project_stats(project, current_user))


@router.patch("/{project_id}", response_model=ProjectInDB)
def update_project(
    project_id: str,
    request: ProjectUpdate,
    current_user: UserInDB = Depends(get_current_active_user),
):
    project = verify_project_access(project_id, current_user)
    if project.get("ownerType") == "team" and current_user.ownedAccountId != str(project.get("ownerId")):
        raise HTTPException(status_code=403, detail="Only the account owner can update this project.")

    update: Dict[str, Any] = {"updatedAt": datetime.utcnow()}
    if request.name is not None:
        update["name"] = request.name.strip()
    if request.description is not None:
        update["description"] = request.description

    projects_collection.update_one({"_id": project["_id"]}, {"$set": update})
    updated = projects_collection.find_one({"_id": project["_id"]})
    return _serialize_project(updated, _project_stats(updated, current_user))


@router.delete("/{project_id}")
def delete_project(project_id: str, current_user: UserInDB = Depends(get_current_active_user)):
    project = verify_project_access(project_id, current_user)
    if project.get("ownerType") == "team" and current_user.ownedAccountId != str(project.get("ownerId")):
        raise HTTPException(status_code=403, detail="Only the account owner can delete this project.")

    fallback = ensure_default_project(project.get("ownerType"), project.get("ownerId"))
    if fallback["_id"] == project["_id"]:
        raise HTTPException(status_code=400, detail="The default project cannot be deleted.")

    collection.update_many({"projectId": project["_id"]}, {"$set": {"projectId": fallback["_id"]}})
    projects_collection.delete_one({"_id": project["_id"]})
    return {"message": "Project deleted", "movedContractsTo": str(fallback["_id"])}


@router.get("/{project_id}/stats", response_model=Dict[str, int])
def get_project_stats(project_id: str, current_user: UserInDB = Depends(get_current_active_user)):
    project = verify_project_access(project_id, current_user)
    return _project_stats(project, current_user)
