import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks

from core.database import collection, projects_collection, teams_collection, users_collection
from core.security import get_current_active_user
from models.domain import (
    ProjectCreate,
    ProjectInDB,
    ProjectUpdate,
    UserInDB,
    PaginatedProjects,
    ProjectLightInDB,
    ProjectMemoryOverviewUpdate,
    ProjectFactCreate,
    ProjectScratchpadUpdate,
    ScheduleLinkDecision,
    TableClassificationUpdate,
    AssignWorkflowRolesRequest,
)
from utils.audit_logger import create_audit_log

logger = logging.getLogger(__name__)

# The space that holds contracts filed into no other space. Flagged, not
# found by name, so a user-made space cannot collide with it.
DEFAULT_PROJECT_NAME = "Unfiled"
DEFAULT_PROJECT_LEGACY_NAME = "Default Project"

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
                "completed_count": {"$sum": {"$cond": [{"$in": ["$status", ["Approved", "Completed", "Ingested"]]}, 1, 0]}},
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
    """The owner's Unfiled space, created on first use.

    Contracts that belong to no space live here. It is flagged `isDefault`
    rather than found by name, so renaming it in the UI is impossible and a
    user-made space called "Unfiled" cannot be mistaken for it. Documents
    created before the flag existed carry the old name, so the query accepts
    either and the upsert stamps the flag.

    One atomic upsert, not find-then-insert: the dashboard fires several
    requests at once on first load, and the old check-then-insert let two of
    them each create one (seen 3 ms apart). The unique partial index
    project_default_per_owner (core/database_indexes.py) makes a concurrent
    second insert fail instead, and that loser re-reads the winner.
    """
    now = datetime.utcnow()
    owner = {"ownerType": owner_type, "ownerId": owner_id}
    query = {**owner, "$or": [{"isDefault": True}, {"name": DEFAULT_PROJECT_LEGACY_NAME}]}
    try:
        return projects_collection.find_one_and_update(
            query,
            {
                "$set": {"isDefault": True, "name": DEFAULT_PROJECT_NAME},
                "$setOnInsert": {
                    **owner,
                    "description": "Contracts that have not been moved into a space.",
                    "createdAt": now,
                    "updatedAt": now,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        return projects_collection.find_one(query)


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


def _usernames_for(user_oids: List[Optional[ObjectId]]) -> Dict[str, str]:
    """Map user ids to usernames so a role reads as a person, not an ObjectId."""
    wanted = [oid for oid in user_oids if isinstance(oid, ObjectId)]
    if not wanted or users_collection is None:
        return {}
    return {
        str(user["_id"]): user.get("username")
        for user in users_collection.find({"_id": {"$in": wanted}}, {"username": 1})
    }


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


@router.get("/all", response_model=List[ProjectLightInDB])
def list_projects_all(
    context_id: Optional[str] = Query(None, description="Account/team id, or personal"),
    current_user: UserInDB = Depends(get_current_active_user),
):
    owner_type, owner_id = _resolve_owner(current_user, context_id)
    projects = list(projects_collection.find({"ownerType": owner_type, "ownerId": owner_id}).sort("updatedAt", -1))
    
    serialized_projects = []
    for project in projects:
        serialized_projects.append({
            "_id": str(project["_id"]),
            "name": project.get("name", "Untitled Project"),
            "ownerId": str(project.get("ownerId")),
            "ownerType": project.get("ownerType"),
            "createdAt": project.get("createdAt"),
            "updatedAt": project.get("updatedAt"),
        })
    return serialized_projects

def get_bulk_project_stats(project_ids: List[ObjectId], owner_type: str, owner_id: ObjectId, current_user: UserInDB) -> Dict[str, Dict[str, int]]:
    # This is an optimization to fetch stats for multiple projects at once
    # However, to be fully safe with existing access logic, we could just filter by project_ids and owner
    # For now, let's implement a single aggregation for all project_ids that belong to the user
    user_oid = ObjectId(current_user.id)
    match_query: Dict[str, Any] = {
        "projectId": {"$in": project_ids},
        "ownerType": owner_type,
        "ownerId": owner_id,
    }
    
    if owner_type == "team" and current_user.ownedAccountId != str(owner_id):
        match_query["$or"] = [
            {"uploaded_by": user_oid},
            {"workflowRoles.editorUserId": user_oid},
            {"workflowRoles.approverUserId": user_oid},
        ]
        
    processing_statuses = ["Indexing", "Summarizing", "Processing", "queued", "pending", "processing", "Queued"]
    
    pipeline = [
        {"$match": match_query},
        {
            "$group": {
                "_id": "$projectId",
                "total_documents": {"$sum": 1},
                "processing_count": {"$sum": {"$cond": [{"$in": ["$status", processing_statuses]}, 1, 0]}},
            }
        },
    ]
    
    stats_list = list(collection.aggregate(pipeline))
    stats_map = {}
    
    empty_stats = {
        "total_documents": 0,
        "processing_count": 0,
    }
    
    for stat in stats_list:
        pid = str(stat["_id"])
        stat.pop("_id", None)
        stats_map[pid] = {key: int(stat.get(key, 0)) for key in empty_stats}
        
    return stats_map

@router.get("/", response_model=PaginatedProjects)
def list_projects(
    background_tasks: BackgroundTasks,
    context_id: Optional[str] = Query(None, description="Account/team id, or personal"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    search: Optional[str] = Query(None, description="Search by project name"),
    current_user: UserInDB = Depends(get_current_active_user),
):
    owner_type, owner_id = _resolve_owner(current_user, context_id)
    default_project = ensure_default_project(owner_type, owner_id)
    
    # Run synchronously-blocking updates in background instead
    background_tasks.add_task(assign_unprojected_contracts, owner_type, owner_id, default_project["_id"])

    base_query = {"ownerType": owner_type, "ownerId": owner_id}
    if search:
        base_query["name"] = {"$regex": search, "$options": "i"}

    total = projects_collection.count_documents(base_query)
    projects = list(projects_collection.find(base_query).sort("updatedAt", -1).skip(skip).limit(limit))
    
    project_ids = [p["_id"] for p in projects]
    stats_map = get_bulk_project_stats(project_ids, owner_type, owner_id, current_user)
    
    empty_stats = {
        "total_documents": 0,
        "processing_count": 0,
    }

    serialized_items = []
    for project in projects:
        pid = str(project["_id"])
        p_stats = stats_map.get(pid, empty_stats)
        serialized_items.append(_serialize_project(project, p_stats))
        
    return {"items": serialized_items, "total": total}


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

    # The contracts move rather than being deleted, so their memory has to move
    # with them. Left behind it would sit under a project_id that no longer
    # exists, while the fallback project reported every document it just
    # inherited as having no overview.
    from core.database import db as core_db
    from services.project_memory import ProjectMemoryManager

    memory_result = {"memories_moved": 0, "notes_appended": False}
    try:
        memory_result = ProjectMemoryManager(core_db).transfer_project_memory(
            str(project["_id"]), str(fallback["_id"])
        )
    except Exception as exc:
        # Losing the project row matters more than moving its memory; an
        # orphaned overview is recoverable, a half-deleted project is not.
        logger.warning("Could not move project memory for %s: %s", project["_id"], exc)

    projects_collection.delete_one({"_id": project["_id"]})
    return {
        "message": "Project deleted",
        "movedContractsTo": str(fallback["_id"]),
        "memoriesMoved": memory_result["memories_moved"],
    }


@router.get("/{project_id}/timeline")
def get_project_timeline(project_id: str, current_user: UserInDB = Depends(get_current_active_user)):
    """Chronological, grouped document history for the project: what was
    uploaded when, what it's about, and how documents relate to each other
    (e.g. a schedule/annex/amendment nested under its main contract)."""
    verify_project_access(project_id, current_user)

    from core.database import db
    from services.project_memory import ProjectMemoryManager

    manager = ProjectMemoryManager(db)
    timeline = manager.build_project_timeline(project_id)
    # markdown is an internal input to the single project scratchpad (see GET
    # /{project_id}/memory) — not needed by the timeline UI's per-document
    # cards, drop it to keep the response lean.
    for entry in timeline:
        entry.pop("markdown", None)
        for child in entry.get("related_uploads") or []:
            child.pop("markdown", None)
    return {"project_id": project_id, "timeline": timeline}


@router.patch("/{project_id}/timeline/{contract_id}")
def update_project_timeline_entry(
    project_id: str,
    contract_id: str,
    request: ProjectMemoryOverviewUpdate,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Manually correct one document's project-memory overview — e.g. fixing a
    doc_type or relation the RAG extraction missed or got wrong (thin-evidence
    documents can come back empty/misclassified). Re-synthesizes the markdown
    memory section and re-syncs it into the project scratchpad so agent
    retrieval stays in sync with what the UI shows."""
    verify_project_access(project_id, current_user)

    from core.database import db
    from services.project_memory import ProjectMemoryManager

    updates = request.model_dump(exclude_unset=True)
    if "related_documents" in updates and updates["related_documents"] is not None:
        updates["related_documents"] = [dict(item) for item in updates["related_documents"]]

    manager = ProjectMemoryManager(db)
    updated = manager.update_document_overview(project_id=project_id, contract_id=contract_id, updates=updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Project memory entry not found.")

    return updated


@router.get("/{project_id}/memory")
def get_project_memory_notes(project_id: str, current_user: UserInDB = Depends(get_current_active_user)):
    """The project's human-written notes.

    Document overviews used to be glued into this same text; they are separate
    concepts now, rendered per document from their records, so this holds only
    what a person typed."""
    verify_project_access(project_id, current_user)

    from core.database import db
    from services.project_memory import ProjectMemoryManager

    return ProjectMemoryManager(db).get_notes(project_id)


@router.get("/{project_id}/memory/facts")
def list_project_facts(
    project_id: str,
    include_superseded: bool = False,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Durable facts recorded about this project."""
    verify_project_access(project_id, current_user)

    from core.database import db
    from services.project_memory import ProjectMemoryManager

    manager = ProjectMemoryManager(db)
    return {
        "project_id": project_id,
        "facts": manager.list_facts(project_id, include_superseded=include_superseded),
    }


@router.post("/{project_id}/memory/facts")
def create_project_fact(
    project_id: str,
    request: ProjectFactCreate,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Record a fact. A fact drawn from a contract must carry its source;
    something the user stated is recorded with origin="user" instead, so it is
    never presented with the authority of an extracted one."""
    verify_project_access(project_id, current_user)

    from core.database import db
    from services.project_memory import ProjectMemoryManager

    try:
        return ProjectMemoryManager(db).remember_fact(
            project_id=project_id,
            text=request.text,
            sources=[source.model_dump() for source in (request.sources or [])],
            tags=request.tags,
            origin=request.origin or "contract",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/{project_id}/memory/facts/{fact_id}")
def supersede_project_fact(
    project_id: str,
    fact_id: str,
    replaced_by: str = "",
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Retire a fact. Facts are never edited in place — a correction is a new
    fact pointing back at the one it replaces, so the record of what was
    believed when stays intact."""
    verify_project_access(project_id, current_user)

    from core.database import db
    from services.project_memory import ProjectMemoryManager

    if not ProjectMemoryManager(db).supersede_fact(project_id, fact_id, replaced_by or "retired"):
        raise HTTPException(status_code=404, detail="Fact not found.")
    return {"fact_id": fact_id, "superseded_by": replaced_by or "retired"}


@router.get("/{project_id}/memory/events")
def list_project_events(
    project_id: str,
    limit: int = 50,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Append-only history of what happened in this project. Read-only by
    design — a correction is a later event, not a rewrite of an earlier one."""
    verify_project_access(project_id, current_user)

    from core.database import db
    from services.project_memory import ProjectMemoryManager

    return {
        "project_id": project_id,
        "events": ProjectMemoryManager(db).list_events(project_id, limit=min(limit, 500)),
    }


@router.get("/{project_id}/memory/index")
def get_project_memory_index(project_id: str, current_user: UserInDB = Depends(get_current_active_user)):
    """Every document in the project, one line each — the same complete index
    the agent is given up front."""
    verify_project_access(project_id, current_user)

    from core.database import db
    from services.project_memory import ProjectMemoryManager

    return {"project_id": project_id, "index": ProjectMemoryManager(db).render_index(project_id)}


@router.get("/{project_id}/tables")
def list_project_tables(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Every table extracted from every accessible contract in the project.

    Bodies are read back out of each contract's stored ``index.content`` rather
    than stored separately, so this reflects exactly what was indexed. Contracts
    parsed before table sentinels existed simply contribute nothing.
    """
    project = verify_project_access(project_id, current_user)

    from core.database import collection as contracts_collection
    from services.table_classification import TABLE_CATEGORIES
    from services.table_extraction import extract_tables, merge_stored_metadata

    query = build_accessible_contract_query(project, current_user)
    query["index.content"] = {"$regex": "<!--TABLE:START"}

    contracts: List[Dict[str, Any]] = []
    total_tables = 0
    total_rows = 0

    cursor = contracts_collection.find(
        query,
        {
            "_id": 1, "contract_name": 1, "uploaded_at": 1,
            "index.content": 1, "index.tables": 1, "index.table_classifications": 1,
        },
    ).sort("uploaded_at", -1)

    for contract in cursor:
        index_data = contract.get("index") or {}
        tables = merge_stored_metadata(
            extract_tables(index_data.get("content") or ""),
            index_data.get("tables"),
        )
        # Labels are keyed by signature, so they survive tables being renumbered.
        by_signature = {
            record.get("signature"): record
            for record in (index_data.get("table_classifications") or [])
            if isinstance(record, dict)
        }
        for table in tables:
            record = by_signature.get(table.get("signature"))
            if not record:
                continue
            table["table_type"] = record.get("table_type") or table.get("table_type")
            table["classification_confidence"] = record.get("classification_confidence")
            table["classification_source"] = record.get("source")
            table["trackable"] = record.get("trackable")
        if not tables:
            continue
        total_tables += len(tables)
        total_rows += sum(int(table.get("rows") or 0) for table in tables)
        contracts.append({
            "contract_id": str(contract["_id"]),
            "contract_name": contract.get("contract_name"),
            "uploaded_at": contract.get("uploaded_at"),
            "table_count": len(tables),
            "tables": tables,
        })

    return {
        "project_id": project_id,
        "contracts": contracts,
        "categories": TABLE_CATEGORIES,
        "totals": {
            "contracts_with_tables": len(contracts),
            "table_count": total_tables,
            "row_count": total_rows,
        },
    }


def _schedule_links(project_oid: ObjectId) -> Dict[str, str]:
    """Confirmed and rejected schedule links for a project, keyed by link id."""
    from core.database import db as core_db

    try:
        return {
            record["link"]: record["decision"]
            for record in core_db["schedule_links"].find(
                {"project_id": project_oid}, {"link": 1, "decision": 1}
            )
            if record.get("link") and record.get("decision")
        }
    except Exception:
        # A missing decision means the link is simply unresolved again, which is
        # a worse answer but not a broken page.
        logger.warning("Could not read schedule links for project %s", project_oid)
        return {}


@router.put("/{project_id}/schedule-links")
def decide_schedule_link(
    project_id: str,
    request: ScheduleLinkDecision,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Confirm or reject that two schedules are the same one across revisions.

    Matching falls back to similarity when a column rename breaks the exact
    signature, and similarity cannot be certain. Recording the answer means the
    question is asked once rather than re-derived on every later ingestion.
    """
    project = verify_project_access(project_id, current_user)

    from core.database import collection as contracts_collection, db as core_db
    from services.table_extraction import extract_tables
    from services.table_tracking import link_key

    if request.decision not in ("confirmed", "rejected"):
        raise HTTPException(status_code=400, detail="decision must be 'confirmed' or 'rejected'.")
    if not ObjectId.is_valid(request.contract_id):
        raise HTTPException(status_code=400, detail="Invalid contract_id format.")

    # Authorize against the project's own contracts, so a signature from another
    # project cannot be linked into this one.
    query = build_accessible_contract_query(project, current_user)
    query["_id"] = ObjectId(request.contract_id)
    contract = contracts_collection.find_one(query, {"index.content": 1})
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found in this project.")

    signatures = {
        table.get("signature")
        for table in extract_tables((contract.get("index") or {}).get("content") or "")
    }
    if request.signature not in signatures:
        raise HTTPException(status_code=404, detail="No such schedule in that contract.")

    link = link_key(request.previous_signature, request.signature)
    record = {
        "project_id": project["_id"],
        "link": link,
        "decision": request.decision,
        "decided_by": str(current_user.id),
        "decided_at": datetime.utcnow(),
    }
    core_db["schedule_links"].update_one(
        {"project_id": project["_id"], "link": link},
        {"$set": record},
        upsert=True,
    )
    return {"link": link, "decision": request.decision}


@router.get("/{project_id}/table-lineages")
def list_project_table_lineages(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Each schedule in the project and every version of it, oldest first.

    Ordered by the date each contract states it takes effect rather than upload
    time, so a document uploaded late but effective early sits where it belongs
    in the history.
    """
    project = verify_project_access(project_id, current_user)

    from services.schedule_registry import project_schedules

    lineages, _documents = project_schedules(
        project_id,
        contract_query=build_accessible_contract_query(project, current_user),
        links=_schedule_links(project["_id"]),
    )

    return {
        "project_id": project_id,
        "lineages": lineages,
        "totals": {
            "schedules": len(lineages),
            "tracked": sum(1 for l in lineages if l["version_count"] > 1),
            "needs_review": sum(1 for l in lineages if l["needs_review"]),
        },
    }


@router.put("/{project_id}/tables/{signature}/classification")
def set_table_classification(
    project_id: str,
    signature: str,
    request: TableClassificationUpdate,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Correct a table's label by hand.

    Stored with ``source: "user"``, which every later classifier run skips — a
    correction that got overwritten on the next re-ingest would have to be made
    again every time, so the override has to outrank the model permanently.
    """
    project = verify_project_access(project_id, current_user)

    from core.database import collection as contracts_collection
    from services.table_classification import (
        TABLE_CATEGORIES,
        TRACKABLE_CATEGORIES,
        merge_classifications,
    )

    if request.table_type not in TABLE_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown table type. Expected one of: {', '.join(TABLE_CATEGORIES)}",
        )

    query = build_accessible_contract_query(project, current_user)
    query["_id"] = ObjectId(request.contract_id) if ObjectId.is_valid(request.contract_id) else None
    if query["_id"] is None:
        raise HTTPException(status_code=400, detail="Invalid contract_id format.")

    contract = contracts_collection.find_one(query, {"index.table_classifications": 1})
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found in this project.")

    record = {
        "signature": signature,
        "table_type": request.table_type,
        "classification_confidence": 1.0,
        "classification_version": None,
        "trackable": request.table_type in TRACKABLE_CATEGORIES,
        "classified_at": datetime.utcnow(),
        "source": "user",
        "classified_by": str(current_user.id),
    }
    existing = (contract.get("index") or {}).get("table_classifications") or []
    updated = [item for item in existing if item.get("signature") != signature]
    updated = merge_classifications(updated, [])
    updated.append(record)

    contracts_collection.update_one(
        {"_id": contract["_id"]},
        {"$set": {"index.table_classifications": updated}},
    )
    return record


@router.put("/{project_id}/memory")
def update_project_memory_notes(
    project_id: str,
    request: ProjectScratchpadUpdate,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Overwrite the project's notes. Nothing auto-writes here any more, so a
    human's text is never interleaved with generated document sections."""
    verify_project_access(project_id, current_user)

    from core.database import db
    from services.project_memory import ProjectMemoryManager

    return ProjectMemoryManager(db).update_notes(project_id, request.content)


@router.get("/{project_id}/stats", response_model=Dict[str, int])
def get_project_stats(project_id: str, current_user: UserInDB = Depends(get_current_active_user)):
    project = verify_project_access(project_id, current_user)
    return _project_stats(project, current_user)

@router.get("/{project_id}/dashboard/live-counts")
def get_project_dashboard_live_counts(project_id: str, current_user: UserInDB = Depends(get_current_active_user)):
    project = verify_project_access(project_id, current_user)
    contract_query = build_accessible_contract_query(project, current_user)
    
    from core.database import collection as contracts_collection, kpi_db
    contracts = list(contracts_collection.find(contract_query, {"_id": 1}))
    contract_ids = [str(c["_id"]) for c in contracts]
    
    if not contract_ids:
        return {
            "totalObligations": 0,
            "clientSide": 0,
            "supplierSide": 0,
            "byRuleType": {},
            "totalBreaches": 0,
            "breachesBySource": {},
            "dollarAtRiskOpen": 0,
        }
        
    contract_kpis_col = kpi_db["contract_kpis"]
    contract_kpi_breaches_col = kpi_db["contract_kpi_breaches"]
    
    kpis = list(contract_kpis_col.find({"contract_id": {"$in": contract_ids}}))
    total_obligations = len(kpis)
    client_side = 0
    supplier_side = 0
    by_rule_type = {}
    
    for kpi in kpis:
        party_role = str(kpi.get("party_role") or kpi.get("party_type") or "").lower()
        if party_role == "client":
            client_side += 1
        else:
            supplier_side += 1
            
        rt_raw = str(kpi.get("rule_type") or kpi.get("kpi_type") or "").lower()
        if "tiered" in rt_raw or "mtow" in rt_raw:
            rule_type = "Tiered"
        elif "deadline" in rt_raw:
            rule_type = "Deadline"
        elif "composite" in rt_raw or "combined" in rt_raw or "conditional" in rt_raw or "aggregate" in rt_raw:
            rule_type = "Composite"
        elif "seat_band" in rt_raw or "range" in rt_raw:
            rule_type = "Range"
        elif "qualitative" in rt_raw or "cross_referenced" in rt_raw:
            rule_type = "Qualitative"
        else:
            rule_type = "Threshold"
        
        by_rule_type[rule_type] = by_rule_type.get(rule_type, 0) + 1
        
    breaches = list(contract_kpi_breaches_col.find({
        "contract_id": {"$in": contract_ids},
        "is_breach": True,
        "status": {"$ne": "resolved"}
    }))
    total_breaches = len(breaches)
    breaches_by_source = {}
    dollar_at_risk_open = 0
    
    import re
    def _parse_numeric(val: Any) -> float:
        if isinstance(val, (int, float)):
            return float(val)
        if not isinstance(val, str):
            return 0.0
        s = re.sub(r'[^\d\.-]', '', val)
        try:
            return float(s)
        except ValueError:
            return 0.0
            
    for breach in breaches:
        src_raw = str(breach.get("source") or breach.get("detected_via") or breach.get("source_type") or "Unknown").lower()
        if "csv" in src_raw or "file_upload" in src_raw:
            source = "CSV Upload"
        elif "rest" in src_raw or "api" in src_raw:
            source = "Rest endpoints"
        elif "sap" in src_raw or "dispatch" in src_raw:
            source = "SAP Dispatch"
        elif "scanned" in src_raw or "ocr" in src_raw or "snowflake" in src_raw:
            source = "Snowflake"
        elif "salesforce" in src_raw:
            source = "Salesforce"
        elif "servicenow" in src_raw:
            source = "ServiceNow"
        else:
            source = "Rest endpoints"
        breaches_by_source[source] = breaches_by_source.get(source, 0) + 1
        
        penalty = breach.get("penalty_amount")
        if not penalty:
            kpi_id = breach.get("kpi_id")
            if kpi_id:
                matching_kpi = next((k for k in kpis if str(k.get("kpi_id")) == str(kpi_id)), None)
                if matching_kpi:
                    penalty = matching_kpi.get("consequence_value") or matching_kpi.get("penalty_amount")
        
        dollar_at_risk_open += abs(_parse_numeric(penalty))
        
    return {
        "totalObligations": total_obligations,
        "clientSide": client_side,
        "supplierSide": supplier_side,
        "byRuleType": by_rule_type,
        "totalBreaches": total_breaches,
        "breachesBySource": breaches_by_source,
        "dollarAtRiskOpen": dollar_at_risk_open,
    }


@router.get("/{project_id}/document-graph")
def get_project_document_graph(
    project_id: str,
    as_of: Optional[str] = None,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Which documents govern the project, and which have been replaced.

    ``as_of`` answers what applied on a past date rather than today, which is
    the question anyone reconciling a historic invoice is actually asking.
    """
    project = verify_project_access(project_id, current_user)

    from services.document_graph import build_document_graph

    nodes = build_document_graph(
        project_id,
        contract_query=build_accessible_contract_query(project, current_user),
        as_of=as_of,
    )
    live = {"in_force", "in_force_as_amended", "undated"}
    return {
        "project_id": project_id,
        "as_of": nodes[0]["as_of"] if nodes else as_of,
        "documents": nodes,
        "totals": {
            "documents": len(nodes),
            "governing": sum(1 for n in nodes if n["status"] in live),
            "superseded": sum(1 for n in nodes if n["status"] == "superseded"),
            "spent": sum(1 for n in nodes if n["status"] == "spent"),
        },
    }


@router.get("/{project_id}/conflicts")
def get_project_conflicts(
    project_id: str,
    as_of: Optional[str] = None,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Schedules stated differently by two documents that both still govern.

    A revision is not a conflict — the document graph accounts for anything the
    documents themselves say about replacing or amending each other. What is
    left is disagreement nobody has resolved.
    """
    project = verify_project_access(project_id, current_user)

    from services.conflict_detection import detect_conflicts

    conflicts = detect_conflicts(
        project_id,
        contract_query=build_accessible_contract_query(project, current_user),
        links=_schedule_links(project["_id"]),
        as_of=as_of,
    )
    return {
        "project_id": project_id,
        "as_of": conflicts[0]["as_of"] if conflicts else as_of,
        "conflicts": conflicts,
        "totals": {
            "total": len(conflicts),
            "needs_decision": sum(1 for c in conflicts if c["severity"] == "warning"),
        },
    }


@router.get("/{project_id}/escalation-check")
def get_project_escalation_check(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """What the documents promise about rate movement, and whether the rates
    kept to it.

    Read from the documents on each call rather than stored at ingestion: a
    stored rule would go stale the moment a later document changed it, which is
    exactly the project this matters in.
    """
    project = verify_project_access(project_id, current_user)

    from services.escalation import project_escalation

    clauses, findings = project_escalation(
        project_id,
        contract_query=build_accessible_contract_query(project, current_user),
        links=_schedule_links(project["_id"]),
    )
    return {
        "project_id": project_id,
        "clauses": clauses,
        "findings": findings,
        "totals": {
            "checked": len(findings),
            "above_promised": sum(1 for f in findings if f["status"] == "above_promised"),
            "below_promised": sum(1 for f in findings if f["status"] == "below_promised"),
        },
    }


@router.get("/{project_id}/roles")
def get_project_workflow_roles(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """The Editor and Approver every contract in this project inherits."""
    project = verify_project_access(project_id, current_user)
    roles = project.get("workflowRoles") or {}
    editor_oid = roles.get("editorUserId")
    approver_oid = roles.get("approverUserId")

    names = _usernames_for([editor_oid, approver_oid])
    return {
        "editorUserId": str(editor_oid) if editor_oid else None,
        "approverUserId": str(approver_oid) if approver_oid else None,
        "editor_name": names.get(str(editor_oid)),
        "approver_name": names.get(str(approver_oid)),
    }


@router.put("/{project_id}/roles")
async def assign_project_workflow_roles(
    project_id: str,
    request: AssignWorkflowRolesRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Set the project-wide Editor and Approver.

    Contracts in the project inherit these unless that contract carries its own
    assignment, so a matter can be staffed once instead of per document.
    """
    project = verify_project_access(project_id, current_user)
    owner_type = project.get("ownerType")
    owner_id_obj = project.get("ownerId")

    if owner_type != "team":
        raise HTTPException(
            status_code=400,
            detail="Workflow roles apply to team projects. A personal project has a single owner.",
        )

    is_account_owner = current_user.ownedAccountId == str(owner_id_obj)
    is_creator = str(project.get("createdBy") or "") == str(current_user.id)
    if not (is_account_owner or is_creator):
        raise HTTPException(
            status_code=403,
            detail="Only the account owner or the project creator can assign workflow roles.",
        )

    stored_roles = project.get("workflowRoles") or {}
    update_payload: Dict[str, Any] = {}
    assigned_oids: List[ObjectId] = []

    for field, key in (("editorUserId", "editorUserId"), ("approverUserId", "approverUserId")):
        value = getattr(request, field)
        if value is None:  # key absent from the request: leave the stored value alone
            continue
        if value == "":  # explicit clear
            update_payload[f"workflowRoles.{key}"] = None
            continue
        if not ObjectId.is_valid(value):
            raise HTTPException(status_code=400, detail=f"Invalid format for {field}: {value}")
        oid = ObjectId(value)
        update_payload[f"workflowRoles.{key}"] = oid
        assigned_oids.append(oid)

    if not update_payload:
        return {"message": "No role information provided to update.", "updated": False}

    if assigned_oids and teams_collection is not None:
        team = teams_collection.find_one({"_id": owner_id_obj}, {"members.userId": 1})
        if not team:
            raise HTTPException(status_code=404, detail="Associated account not found.")
        member_oids = {
            member.get("userId")
            for member in team.get("members", [])
            if isinstance(member.get("userId"), ObjectId)
        }
        for oid in assigned_oids:
            if oid not in member_oids:
                raise HTTPException(
                    status_code=400,
                    detail=f"User {oid} is not a member of this account and cannot be assigned a role.",
                )

    effective_editor = update_payload.get(
        "workflowRoles.editorUserId", stored_roles.get("editorUserId")
    )
    effective_approver = update_payload.get(
        "workflowRoles.approverUserId", stored_roles.get("approverUserId")
    )

    update_payload["updatedAt"] = datetime.utcnow()
    projects_collection.update_one({"_id": ObjectId(project_id)}, {"$set": update_payload})

    await create_audit_log(
        user=current_user,
        action="PROJECT_WORKFLOW_ROLES_UPDATED",
        account_id_override=owner_id_obj,
        details={
            "projectId": project_id,
            "projectName": project.get("name"),
            "oldEditorUserId": str(stored_roles.get("editorUserId") or "") or None,
            "oldApproverUserId": str(stored_roles.get("approverUserId") or "") or None,
            "newEditorUserId": str(effective_editor or "") or None,
            "newApproverUserId": str(effective_approver or "") or None,
        },
    )

    return {"message": "Project workflow roles updated.", "updated": True}
