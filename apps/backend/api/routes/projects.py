import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks

from core.database import collection, projects_collection, teams_collection
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
)

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
