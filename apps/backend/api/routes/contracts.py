import logging
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from bson import ObjectId
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, Query, Request, status, BackgroundTasks
from fastapi.responses import StreamingResponse
from jose import jwt

from core.config import settings
from core.rate_limiter import limiter
from core.database import (
    db,
    async_db,
    collection,
    users_collection,
    teams_collection,
    projects_collection,
    fs,
)
from core.security import get_current_active_user
from models.domain import UserInDB, AccessibleAccountInfo
from models.response_types import (
    ProcessResponse, IndexResponse,
    ContractResponse, ContractAnalysis, IndexRequest, ProcessRequest, LastSaveResponse, Category,
    DraftSaveRequest, DraftSubmitRequest, WorkflowRoles, JobStatusResponse
)
from core.validators import validate_pdf_upload, extract_pdf_page_count
from api.routes.projects import verify_project_access, ensure_default_project
from api.dependencies import (
    deduct_credits,
    queue_contract_ingestion,
    check_contract_access,
    get_contract_and_verify_access,
    get_project_and_verify_access,
    get_current_user_from_ticket_or_session,
)
from utils.audit_logger import create_audit_log
from utils.secure_logger import log_exception
from utils.http_headers import content_disposition
from core.cache import cache

logger = logging.getLogger(__name__)

contracts_router = APIRouter()

@contracts_router.post("/contracts/{contract_id}/ticket")
def create_contract_download_ticket(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    get_contract_and_verify_access(contract_id, current_user, {"_id": 1, "ownerType": 1, "ownerId": 1})
    
    expires = datetime.utcnow() + timedelta(seconds=60)
    payload = {
        "sub": str(current_user.id),
        "resource_id": contract_id,
        "resource_type": "contract",
        "exp": expires,
        "jti": str(uuid.uuid4()),
        "ticket": True
    }
    ticket = jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)
    return {"ticket": ticket}

@contracts_router.post("/projects/{project_id}/ticket")
def create_project_download_ticket(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    
    expires = datetime.utcnow() + timedelta(seconds=60)
    payload = {
        "sub": str(current_user.id),
        "resource_id": project_id,
        "resource_type": "project",
        "exp": expires,
        "jti": str(uuid.uuid4()),
        "ticket": True
    }
    ticket = jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)
    return {"ticket": ticket}

@contracts_router.post("/upload/", response_model=Dict[str, Any])
@limiter.limit("10/minute")
async def upload_contract(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    owner_team_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    logger.info(f"Upload request from user {current_user.id} ({current_user.username}) for file {file.filename}")
    
    try:
        content = await file.read()
        sanitized_filename = validate_pdf_upload(content, file.filename)
        page_count = extract_pdf_page_count(content)
        
        owner_type = "team" if owner_team_id else "user"
        owner_id_str = owner_team_id if owner_team_id else str(current_user.id)
        user_oid = ObjectId(current_user.id)
        team_doc_for_upload = None

        if owner_team_id:
            if not ObjectId.is_valid(owner_team_id):
                raise HTTPException(status_code=400, detail="Invalid owner_team_id format")
            
            team_oid = ObjectId(owner_team_id)
            is_owner = current_user.ownedAccountId == owner_team_id
            is_member = owner_team_id in (current_user.teamIds or [])
            
            if not is_owner and not is_member:
                team_membership = teams_collection.find_one(
                    {"_id": team_oid, "members.userId": user_oid},
                    {"_id": 1}
                )
                if not team_membership:
                    raise HTTPException(status_code=403, detail="No permission to upload to this team")

            team_doc_for_upload = teams_collection.find_one({"_id": team_oid}, {"_id": 1, "creatorId": 1, "name": 1})
            if not team_doc_for_upload:
                raise HTTPException(status_code=404, detail="Team not found")

            owner_id = team_oid
        else:
            owner_id = user_oid

        if project_id:
            project_doc = verify_project_access(project_id, current_user)
            if project_doc.get("ownerType") != owner_type or project_doc.get("ownerId") != owner_id:
                raise HTTPException(status_code=400, detail="Project does not belong to this upload context.")
        else:
            project_doc = ensure_default_project(owner_type, owner_id)
        project_oid = project_doc["_id"]

        file_id = fs.put(
            content,
            filename=sanitized_filename,
            content_type=file.content_type,
            metadata={
                "uploaded_by_user_id": user_oid,
                "ownerType": owner_type,
                "ownerId": owner_id,
                "projectId": project_oid,
                "page_count": page_count
            }
        )

        contract_doc = {
            "contract_name": sanitized_filename,
            "uploaded_by": user_oid,
            "uploaded_at": datetime.utcnow(),
            "ownerType": owner_type,
            "ownerId": owner_id,
            "projectId": project_oid,
            "status": "Uploaded",
            "file_size": len(content),
            "file_type": file.content_type,
            "page_count": page_count,
            "file_id": file_id,
            "credits_deducted": False,
            "index": {"status": "pending", "content": None, "updated_at": None},
            "process": {"status": "pending", "results": [], "dynamic_results": [], "lastSave":None, "updated_at": None},
            "workflowRoles":{
                "editorUserId": None,
                "approverUserId": None,
            },
            "submittedBy": None, 
            "approvedOrRejectedBy": None, 
            "rejectedReason": None 
        }

        result = collection.insert_one(contract_doc)
        contract_id_str = str(result.inserted_id)
        contract_oid = result.inserted_id
        ingestion_job_id = None
        ingestion_status = "not_started"

        account_to_deduct_from_pool_oid = user_oid
        if owner_type == "team":
            account_to_deduct_from_pool_oid = (team_doc_for_upload or {}).get("creatorId")
            if not isinstance(account_to_deduct_from_pool_oid, ObjectId):
                logger.error(f"Team {owner_team_id} has invalid/missing creatorId. Auto-ingestion cannot deduct credits.")
                collection.update_one(
                    {"_id": contract_oid},
                    {"$set": {
                        "index.status": "blocked",
                        "index.error": "Team credit account is not configured.",
                        "status": "Uploaded",
                    }}
                )
                account_to_deduct_from_pool_oid = None

        if isinstance(account_to_deduct_from_pool_oid, ObjectId):
            if page_count > 0:
                credits_deducted_successfully = await deduct_credits(account_to_deduct_from_pool_oid, page_count)
                if credits_deducted_successfully:
                    collection.update_one(
                        {"_id": contract_oid},
                        {"$set": {"credits_deducted": True}}
                    )
                else:
                    ingestion_status = "blocked_insufficient_credits"
                    collection.update_one(
                        {"_id": contract_oid},
                        {"$set": {
                            "index.status": "blocked",
                            "index.error": f"Insufficient credits. {page_count} credits required to ingest this document.",
                            "status": "Uploaded",
                        }}
                    )

            if ingestion_status != "blocked_insufficient_credits":
                try:
                    ingestion_job_id = queue_contract_ingestion(
                        contract_id=contract_id_str,
                        contract_oid=contract_oid,
                        file_id=file_id,
                        file_name=file.filename,
                        user_id=str(current_user.id),
                    )
                    ingestion_status = "queued" if ingestion_job_id else "failed_to_queue"
                except Exception as ingestion_error:
                    ingestion_status = "failed_to_queue"
                    log_exception(logger, f"Failed to queue auto-ingestion for uploaded contract {contract_id_str}", ingestion_error)

        audit_account_id = None
        if owner_type == "team" and isinstance(owner_id, ObjectId):
            audit_account_id = owner_id
        
        await create_audit_log(
            user=current_user,
            action="CONTRACT_UPLOADED",
            contract_id=contract_oid,
            contract_name_override=file.filename,
            account_id_override=audit_account_id,
            details={
                "filename": file.filename,
                "file_type": file.content_type,
                "file_size": contract_doc.get("file_size", 0),
                "page_count": page_count,
                "ownerType": owner_type,
                "ownerId": owner_id,
                "projectId": project_oid,
                "auto_ingestion_status": ingestion_status,
                "auto_ingestion_job_id": ingestion_job_id,
            }
        )
        
        logger.info(f"Contract {contract_id_str} ('{file.filename}') uploaded successfully by user {current_user.id}")
        
        return {
            "status": "success",
            "message": "Contract uploaded and ingestion queued" if ingestion_status == "queued" else "Contract uploaded",
            "contract_id": contract_id_str,
            "file_id": str(file_id),
            "project_id": str(project_oid),
            "ingestion_status": ingestion_status,
            "job_id": ingestion_job_id,
        }

    except HTTPException:
        raise
    except Exception as e:
        log_exception(logger, "Contract upload failed", e)
        raise HTTPException(status_code=500, detail="Contract upload failed")

@contracts_router.post("/index/", response_model=IndexResponse)
async def index_documents(
    request: IndexRequest,
    background_tasks: BackgroundTasks,
    current_user: UserInDB = Depends(get_current_active_user)
) -> IndexResponse:
    logger.info(
        f"Index request for contract_id: {request.contract_id}, "
        f"Context: {request.context_id}, "
        f"User: {current_user.id} ({current_user.username})"
    )

    try:
        contract_oid = ObjectId(request.contract_id)
    except Exception:
        logger.warning(f"Invalid contract_id format in index request: {request.contract_id}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid contract_id format.")

    if async_db is None or async_db.contracts is None or teams_collection is None:
        logger.error("/index/ endpoint: Database collections not properly initialized.")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database service unavailable.")
    
    contracts_collection_async = async_db.contracts

    contract_doc = await contracts_collection_async.find_one(
        {"_id": contract_oid},
        {"file_id": 1, "contract_name": 1, "ownerType": 1, "ownerId": 1, 
         "_id": 1, "page_count": 1, "credits_deducted": 1}
    )
    
    if not contract_doc:
        logger.warning(f"Contract not found during index request: {request.contract_id}")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found")

    owner_type = contract_doc.get("ownerType")
    owner_id_obj_from_db = contract_doc.get("ownerId")
    owner_id_str_for_check = str(owner_id_obj_from_db) if isinstance(owner_id_obj_from_db, ObjectId) else None
    user_oid_for_check = ObjectId(current_user.id)

    user_has_access = False
    if owner_type == "user":
        if owner_id_obj_from_db == user_oid_for_check: user_has_access = True
    elif owner_type == "team" and owner_id_str_for_check:
        is_account_owner = current_user.ownedAccountId == owner_id_str_for_check
        is_team_member = owner_id_str_for_check in (current_user.teamIds or [])
        if is_account_owner or is_team_member:
            user_has_access = True
        elif teams_collection and isinstance(owner_id_obj_from_db, ObjectId):
            team_membership_check_doc = teams_collection.find_one(
                {"_id": owner_id_obj_from_db, "members.userId": user_oid_for_check}, {"_id": 1}
            )
            if team_membership_check_doc: user_has_access = True
    
    if not user_has_access:
        logger.warning(f"User {current_user.id} forbidden access to contract {request.contract_id} owned by {owner_type}:{owner_id_str_for_check}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to access this contract.")

    account_to_deduct_from_pool_oid = None
    team_doc_for_context = None

    if request.context_id and request.context_id.lower() != "personal":
        if not ObjectId.is_valid(request.context_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid team context_id format.")
        
        team_context_oid = ObjectId(request.context_id)
        is_owner_of_context_team = current_user.ownedAccountId == request.context_id
        is_member_of_context_team = request.context_id in (current_user.teamIds or [])
        
        if not (is_owner_of_context_team or is_member_of_context_team):
            logger.warning(f"User {current_user.id} attempted to use team context {request.context_id} for credits without being owner or member.")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have permission to use this team context for credit deduction.")

        team_doc_for_context = teams_collection.find_one(
            {"_id": team_context_oid},
            {"creatorId": 1, "name": 1}
        )

        if not team_doc_for_context:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Team context {request.context_id} not found.")
        
        account_to_deduct_from_pool_oid = team_doc_for_context.get("creatorId")
        if not isinstance(account_to_deduct_from_pool_oid, ObjectId):
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Team configuration error related to credit account.")
    else:
        account_to_deduct_from_pool_oid = user_oid_for_check

    if not contract_doc.get("credits_deducted", False):
        page_count = contract_doc.get("page_count", 0)
        if page_count > 0:
            credits_deducted_successfully = await deduct_credits(account_to_deduct_from_pool_oid, page_count)
            
            if not credits_deducted_successfully:
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail=f"Insufficient credits. {page_count} credits required to process this document."
                )
            
            await contracts_collection_async.update_one(
                {"_id": contract_oid},
                {"$set": {"credits_deducted": True}}
            )

            audit_log_team_account_id_of_contract = None
            audit_log_team_account_name_of_contract = None

            if owner_type == "team" and isinstance(owner_id_obj_from_db, ObjectId):
                audit_log_team_account_id_of_contract = owner_id_obj_from_db
                if team_doc_for_context and team_doc_for_context.get("_id") == audit_log_team_account_id_of_contract:
                    audit_log_team_account_name_of_contract = team_doc_for_context.get("name")
                elif teams_collection:
                    temp_team_doc = teams_collection.find_one({"_id": audit_log_team_account_id_of_contract}, {"name": 1})
                    if temp_team_doc: audit_log_team_account_name_of_contract = temp_team_doc.get("name")
            
            await create_audit_log(
                user=current_user,
                action="PROCESSING_CREDITS_DEDUCTED",
                contract_id=contract_oid,
                contract_name_override=contract_doc.get("contract_name"),
                account_id_override=audit_log_team_account_id_of_contract,
                account_name_override=audit_log_team_account_name_of_contract,
                details={
                    "credits_deducted": page_count,
                    "service_description": "Contract Processing (Indexing Initiated)",
                    "deducted_from_pool_of_user_id": str(account_to_deduct_from_pool_oid),
                    "processing_context_id_in_request": request.context_id 
                }
            )
    
    file_id = contract_doc.get("file_id")
    if not isinstance(file_id, ObjectId): 
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Contract file reference error.")
    file_name = contract_doc.get("contract_name", f"{request.contract_id}.pdf")

    await contracts_collection_async.update_one(
        {"_id": contract_oid},
        {"$set": {
            "index.status": "processing",
            "index.started_at": datetime.utcnow(),
            "status": "Processing"
        }}
    )

    from worker.tasks import index_contract_task
    try:
        task = index_contract_task.delay(
                contract_id=request.contract_id,
                contract_oid_str=str(contract_oid),
                file_id_str=str(file_id),
                file_name=file_name,
                user_id=str(current_user.id) 
            )
        celery_task_id = task.id if hasattr(task, 'id') else None
    except Exception as celery_e:
        logger.error(f"Failed to submit Celery task for contract {request.contract_id}: {celery_e}")
        await contracts_collection_async.update_one(
            {"_id": contract_oid},
            {"$set": {
                "index.status": "queued",
                "index.queued_at": datetime.utcnow(),
                "index.retry_count": 0,
                "index.error": "Ingestion queued — will resume when the processing service is available.",
                "status": "Processing"
            }}
        )
        celery_task_id = None

    audit_log_task_account_id = None
    audit_log_task_account_name = None
    
    if owner_type == "team" and isinstance(owner_id_obj_from_db, ObjectId):
        audit_log_task_account_id = owner_id_obj_from_db
        if team_doc_for_context and team_doc_for_context.get("_id") == audit_log_task_account_id:
            audit_log_task_account_name = team_doc_for_context.get("name")
        elif teams_collection is not None:
            temp_team_doc_task = teams_collection.find_one({"_id": audit_log_task_account_id}, {"name": 1})
            if temp_team_doc_task: audit_log_task_account_name = temp_team_doc_task.get("name")
        
    task_initiation_details = {
        "background_task_type": "Celery"
    }
    if celery_task_id:
        task_initiation_details["celery_task_id"] = celery_task_id
    else:
        task_initiation_details["task_submission_error"] = "Failed to queue Celery task"
        
    await create_audit_log(
        user=current_user,
        action="INDEXING_TASK_STARTED",
        contract_id=contract_oid,
        contract_name_override=contract_doc.get("contract_name"),
        account_id_override=audit_log_task_account_id,
        account_name_override=audit_log_task_account_name,
        details=task_initiation_details
    )

    return IndexResponse(
        status="processing",
        contract_name=file_name,
        message="Contract indexing started. Refresh later for results.",
        content=None,
        job_id=celery_task_id
    )

@contracts_router.post("/process-chain/", response_model=ProcessResponse)
async def process_contract_chain_endpoint(
    request: ProcessRequest,
    current_user: UserInDB = Depends(get_current_active_user)
) -> ProcessResponse:
    logger.info(
        f"Process chain request for contract_id: {request.contract_id}, "
        f"Context: {request.context_id}, User: {current_user.id} ({current_user.username})"
    )

    contract_oid = None

    try:
        try:
            contract_oid = ObjectId(request.contract_id)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid contract_id format."
            )

        if (async_db is None or async_db.contracts is None or
           teams_collection is None or accounts_collection is None):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database service unavailable."
            )
        
        contracts_collection_async = async_db.contracts

        contract_doc = await contracts_collection_async.find_one(
            {"_id": contract_oid},
            {
                "file_id": 1, "contract_name": 1, "ownerType": 1, "ownerId": 1,
                "_id": 1, "page_count": 1, "credits_deducted": 1
            }
        )
        
        if not contract_doc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Contract not found"
            )

        owner_type = contract_doc.get("ownerType")
        owner_id_obj_from_db = contract_doc.get("ownerId")
        owner_id_str_for_check = str(owner_id_obj_from_db) if isinstance(owner_id_obj_from_db, ObjectId) else None
        user_oid_for_check = ObjectId(current_user.id)
        user_has_access = False
        
        if owner_type == "user":
            if owner_id_obj_from_db == user_oid_for_check:
                user_has_access = True
        elif owner_type == "team" and owner_id_str_for_check:
            is_account_owner = current_user.ownedAccountId == owner_id_str_for_check
            is_team_member = owner_id_str_for_check in (current_user.teamIds or [])
            if is_account_owner or is_team_member:
                user_has_access = True
            elif teams_collection and isinstance(owner_id_obj_from_db, ObjectId):
                team_membership_check_doc = teams_collection.find_one(
                    {"_id": owner_id_obj_from_db, "members.userId": user_oid_for_check},
                    {"_id": 1}
                )
                if team_membership_check_doc:
                    user_has_access = True
                    
        if not user_has_access:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to process this contract."
            )

        account_to_deduct_from_pool_oid = None
        team_doc_for_context = None
        
        if request.context_id and request.context_id.lower() != "personal":
            if not ObjectId.is_valid(request.context_id):
                raise HTTPException(
                    status_code=400,
                    detail="Invalid team context_id format."
                )
            team_context_oid = ObjectId(request.context_id)
            is_owner_of_context = current_user.ownedAccountId == request.context_id
            is_member_of_context = request.context_id in (current_user.teamIds or [])
            
            if not (is_owner_of_context or is_member_of_context):
                direct_team_check = teams_collection.find_one(
                    {"_id": team_context_oid, "members.userId": user_oid_for_check},
                    {"_id": 1}
                )
                if not direct_team_check:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Permission denied for team context credit deduction."
                    )
                    
            team_doc_for_context = teams_collection.find_one(
                {"_id": team_context_oid},
                {"creatorId": 1, "name": 1}
            )
            if not team_doc_for_context:
                raise HTTPException(
                    status_code=404,
                    detail=f"Team context {request.context_id} not found."
                )
                
            account_to_deduct_from_pool_oid = team_doc_for_context.get("creatorId")
            if not isinstance(account_to_deduct_from_pool_oid, ObjectId):
                raise HTTPException(
                    status_code=500,
                    detail="Team credit config error."
                )
        else:
            account_to_deduct_from_pool_oid = user_oid_for_check

        if not contract_doc.get("credits_deducted", False):
            page_count = contract_doc.get("page_count", 0)
            if page_count > 0:
                credits_deducted_successfully = await deduct_credits(
                    account_to_deduct_from_pool_oid,
                    page_count
                )
                if not credits_deducted_successfully:
                    raise HTTPException(
                        status_code=status.HTTP_402_PAYMENT_REQUIRED,
                        detail=f"Insufficient credits. You need {page_count} credits to process this document."
                    )
                
                await contracts_collection_async.update_one(
                    {"_id": contract_oid},
                    {"$set": {"credits_deducted": True}}
                )

                audit_log_team_id_of_contract = None
                audit_log_team_name_of_contract = None
                if owner_type == "team" and isinstance(owner_id_obj_from_db, ObjectId):
                    audit_log_team_id_of_contract = owner_id_obj_from_db
                    if (team_doc_for_context and
                       team_doc_for_context.get("_id") == audit_log_team_id_of_contract):
                        audit_log_team_name_of_contract = team_doc_for_context.get("name")
                    elif teams_collection:
                        temp_team_doc = teams_collection.find_one(
                            {"_id": audit_log_team_id_of_contract},
                            {"name": 1}
                        )
                        if temp_team_doc:
                            audit_log_team_name_of_contract = temp_team_doc.get("name")
                
                await create_audit_log(
                    user=current_user,
                    action="PROCESSING_CREDITS_DEDUCTED",
                    contract_id=contract_oid,
                    contract_name_override=contract_doc.get("contract_name"),
                    account_id_override=audit_log_team_id_of_contract,
                    account_name_override=audit_log_team_name_of_contract,
                    details={
                        "credits_deducted": page_count,
                        "service_description": "Contract Ingestion Initiated",
                        "deducted_from_pool_of_user_id": str(account_to_deduct_from_pool_oid),
                        "processing_context_id_in_request": request.context_id
                    }
                )

        file_id = contract_doc.get("file_id")
        if not isinstance(file_id, ObjectId):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Contract file reference error."
            )
        file_name = contract_doc.get("contract_name", f"{request.contract_id}.pdf")

        await contracts_collection_async.update_one(
            {"_id": contract_oid},
            {"$set": {
                "index.status": "processing",
                "process.status": "pending",
                "status": "Processing",
                "index.started_at": datetime.utcnow(),
                "process.lastSave": None
            }}
        )

        celery_ingestion_id = None
        audit_log_ingestion_account_id = None
        audit_log_ingestion_account_name = None
        from worker.tasks import index_contract_task
        try:
            task = index_contract_task.delay(
                contract_id=request.contract_id,
                contract_oid_str=str(contract_oid),
                file_id_str=str(file_id),
                file_name=file_name,
                user_id=str(current_user.id),
            )
            celery_ingestion_id = task.id if hasattr(task, 'id') else None

            if owner_type == "team" and isinstance(owner_id_obj_from_db, ObjectId):
                audit_log_ingestion_account_id = owner_id_obj_from_db
                if (team_doc_for_context and
                   team_doc_for_context.get("_id") == audit_log_ingestion_account_id):
                    audit_log_ingestion_account_name = team_doc_for_context.get("name")
                elif teams_collection:
                    temp_team_doc_ingestion = teams_collection.find_one(
                        {"_id": audit_log_ingestion_account_id},
                        {"name": 1}
                    )
                    if temp_team_doc_ingestion:
                        audit_log_ingestion_account_name = temp_team_doc_ingestion.get("name")
            
            await create_audit_log(
                user=current_user,
                action="CONTRACT_INGESTION_INITIATED",
                contract_id=contract_oid,
                contract_name_override=contract_doc.get("contract_name"),
                account_id_override=audit_log_ingestion_account_id,
                account_name_override=audit_log_ingestion_account_name,
                details={
                    "celery_task_id": celery_ingestion_id,
                    "legacy_batch_qa_disabled": True,
                }
            )

        except Exception as celery_e:
            logger.warning("Failed to queue ingestion task for contract %s (broker may be unavailable): %s", request.contract_id, celery_e)
            await contracts_collection_async.update_one(
                {"_id": contract_oid},
                {"$set": {
                    "status": "Queued",
                    "index.status": "queued",
                    "index.queued_at": datetime.utcnow(),
                    "index.retry_count": 0,
                    "error_detail": "Ingestion queued — will resume when the processing service is available."
                }}
            )
            await create_audit_log(
                user=current_user,
                action="CONTRACT_INGESTION_QUEUED_OFFLINE",
                contract_id=contract_oid,
                contract_name_override=contract_doc.get("contract_name"),
                account_id_override=audit_log_ingestion_account_id,
                account_name_override=audit_log_ingestion_account_name,
                details={
                    "error": str(celery_e)
                }
            )

        return ProcessResponse(
            status="queued" if celery_ingestion_id is None else "indexing",
            contract_name=file_name,
            message="Ingestion queued — it will resume when the processing service is available." if celery_ingestion_id is None else "Contract ingestion started. It will be ready for the agent after indexing completes.",
            job_id=celery_ingestion_id
        )

    except HTTPException as he:
        if contract_oid and contracts_collection_async is not None:
            try:
                current_contract_status_doc = await contracts_collection_async.find_one(
                    {"_id": contract_oid},
                    {"status": 1}
                )
                if (current_contract_status_doc and
                   current_contract_status_doc.get("status") not in ["Ready to Edit", "Approved", "Completed", "Ingested", "Error"]):
                    await contracts_collection_async.update_one(
                        {"_id": contract_oid},
                        {"$set": {
                            "status": "Error",
                            "error_detail": f"HTTPException: {he.detail}"
                        }}
                    )
            except Exception as e_status_update:
                logger.error(
                    f"Failed to update contract status to Error for {contract_oid} "
                    f"after HTTPException: {e_status_update}"
                )
        raise he
        
    except Exception as e:
        logger.exception(f"Unexpected error in /process-chain/: {str(e)}")
        if contract_oid and contracts_collection_async is not None:
            try:
                await contracts_collection_async.update_one(
                    {"_id": contract_oid},
                    {"$set": {
                        "status": "Error",
                        "error_detail": f"Unexpected error: {str(e)}"
                    }}
                )
            except Exception as e_status_final:
                logger.error(
                    f"Failed to update contract status to Error for {contract_oid} "
                    f"after general exception: {e_status_final}"
                )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error syncronizing contract."
        )

@contracts_router.get("/documents/")
def list_documents(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    context_id: Optional[str] = Query(None, description="Account/Team ID context"),
    project_id: Optional[str] = Query(None, description="Project ID"),
    search: Optional[str] = Query(None, description="Search query"),
    status: Optional[str] = Query(None, description="Filter by status (can be single or comma-separated list)"),
    exclude_status: Optional[List[str]] = Query(None, description="List of statuses to exclude"),
    sort_by: Optional[str] = Query("uploaded_at", description="Field to sort by"),
    sort_order: Optional[str] = Query("desc", description="Sort order (asc/desc)"),
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    """List documents with filtering, sorting and pagination"""
    logger.info(f"GET /documents/ - User: {current_user.id}, Context: {context_id}, Status: {status}")
    
    if collection is None or users_collection is None or teams_collection is None:
        raise HTTPException(status_code=500, detail="Database connection failure.")

    query_conditions = []
    user_oid = ObjectId(current_user.id)
    if context_id is None or context_id.lower() == "personal":
        query_conditions.append({"ownerType": "user", "ownerId": user_oid})
    else:
        if not ObjectId.is_valid(context_id):
            raise HTTPException(status_code=400, detail="Invalid context_id format.")
        account_oid = ObjectId(context_id)
        query_conditions.append({"ownerType": "team", "ownerId": account_oid})
        is_owner = current_user.ownedAccountId == context_id
        if not is_owner:
            active_statuses = ["Uploaded", "Processing", "Ingested", "Editing", "Pending Approval", "Approved", "Rejected", "Error"]
            
            permission_clauses = [
                {"uploaded_by": user_oid, "status": {"$in": active_statuses}},
                {"workflowRoles.editorUserId": user_oid},
                {
                    "workflowRoles.approverUserId": user_oid,
                    "status": {"$in": ["Pending Approval", "Approved", "Ingested", "Pending Re-edit Approval", "Re-edit Denied"]}
                }
            ]
            query_conditions.append({"$or": permission_clauses})
    if status:
        if ',' in status:
            status_list = [s.strip() for s in status.split(',')]
            query_conditions.append({"status": {"$in": status_list}})
        else:
            status_map = {
                "uploaded": {"$or": [{"status": "Uploaded"}, {"index.status": "pending"}]},
                "processing": {"$or": [{"status": {"$in": ["Indexing", "Summarizing", "Processing", "Queued"]}}]},
                "ingested": {"status": {"$in": ["Ingested", "Indexed", "Ready to Edit", "Approved", "Completed", "Editing", "Pending Approval", "Rejected"]}},
                "ready_to_edit": {"status": {"$in": ["Ingested", "Ready to Edit"]}},
                "editing": {"status": "Editing"},
                "pending_approval": {"status": "Pending Approval"},
                "rejected": {"status": "Rejected"},
                "completed": {"status": {"$in": ["Approved", "Ingested", "Completed"]}},
                "error": {"$or": [{"status": "Error"}, {"error": {"$exists": True}}]}
            }
            if status in status_map:
                query_conditions.append(status_map[status])

    if exclude_status:
        query_conditions.append({"status": {"$nin": exclude_status}})

    if project_id:
        if not ObjectId.is_valid(project_id):
            raise HTTPException(status_code=400, detail="Invalid project_id format.")
        project_doc = projects_collection.find_one({"_id": ObjectId(project_id)}, {"ownerType": 1, "ownerId": 1})
        if not project_doc:
            raise HTTPException(status_code=404, detail="Project not found.")
        query_conditions.append({"projectId": ObjectId(project_id)})

    final_query = {"$and": query_conditions} if query_conditions else {}

    sort_field_mapping = { "uploaded_at": "uploaded_at", "contract_name": "contract_name", "page_count": "page_count" }
    sort_field = sort_field_mapping.get(sort_by, "uploaded_at")
    sort_direction = -1 if sort_order == "desc" else 1
    sort = [(sort_field, sort_direction)]

    try:
        total_docs = collection.count_documents(final_query)
        skip = (page - 1) * per_page
        total_pages = (total_docs + per_page - 1) // per_page if per_page > 0 else 0
        projection = {
            "_id": 1,
            "contract_name": 1,
            "status": 1,
            "uploaded_at": 1,
            "page_count": 1,
            "ownerType": 1,
            "ownerId": 1,
            "projectId": 1,
            "uploaded_by": 1,
            "workflowRoles": 1,
            "rejectedReason": 1,
            "reEditRequest": 1,
            "index.status": 1,
            "process.status": 1,
            "process.job_id": 1,
            "error": 1
        }
        
        documents_cursor = collection.find(final_query, projection).sort(sort).skip(skip).limit(per_page)
        documents_list = list(documents_cursor)

        latest_jobs_by_contract = {}
        status_needs_job_snapshot = {"processing", "pending", "queued", "Syncronizing", "Indexing", "Summarizing", "Processing"}
        document_oids = [
            doc["_id"]
            for doc in documents_list
            if doc.get("status") in status_needs_job_snapshot
        ]
        if document_oids:
            jobs_pipeline = [
                {"$match": {"contract_id": {"$in": document_oids}}},
                {"$sort": {"contract_id": 1, "updated_at": -1, "created_at": -1}},
                {"$group": {"_id": "$contract_id", "job": {"$first": "$$ROOT"}}},
            ]
            latest_jobs_by_contract = {
                str(row["_id"]): row["job"]
                for row in db["jobs"].aggregate(jobs_pipeline)
                if row.get("_id") and row.get("job")
            }
        
        user_ids = set()
        for doc in documents_list:
            if isinstance(doc.get("uploaded_by"), ObjectId): user_ids.add(doc["uploaded_by"])
            if (wf := doc.get("workflowRoles")) and isinstance(wf.get("editorUserId"), ObjectId): user_ids.add(wf["editorUserId"])
            if (wf := doc.get("workflowRoles")) and isinstance(wf.get("approverUserId"), ObjectId): user_ids.add(wf["approverUserId"])
        user_map = {}
        if user_ids:
            users = list(users_collection.find({"_id": {"$in": list(user_ids)}}, {"_id": 1, "username": 1}))
            user_map = {str(user["_id"]): user.get("username") for user in users}
        
        processed_docs = []
        for doc in documents_list:
            workflow_roles = doc.get("workflowRoles") or {}
            re_edit_request = doc.get("reEditRequest") or {}

            processed = {
                "_id": str(doc["_id"]),
                "contract_name": doc.get("contract_name", "Unknown"),
                "status": doc.get("status", "Unknown"),
                "uploaded_at": doc.get("uploaded_at"),
                "page_count": doc.get("page_count", 0),
                "ownerType": doc.get("ownerType"),
                "ownerId": str(doc.get("ownerId")),
                "projectId": str(pid) if (pid := doc.get("projectId")) else None,
                "uploaded_by": str(doc.get("uploaded_by")),
                "uploader_name": user_map.get(str(doc.get("uploaded_by"))),
                "workflowRoles": {
                    "editorUserId": str(uid) if (uid := workflow_roles.get("editorUserId")) else None,
                    "approverUserId": str(uid) if (uid := workflow_roles.get("approverUserId")) else None,
                    "editor_name": user_map.get(str(workflow_roles.get("editorUserId"))),
                    "approver_name": user_map.get(str(workflow_roles.get("approverUserId")))
                },
                "rejectedReason": doc.get("rejectedReason"),
                "reEditRequest": {
                    "requestedByUserId": str(uid) if (uid := re_edit_request.get("requestedByUserId")) else None,
                    "reason": re_edit_request.get("reason"),
                    "requestedAt": re_edit_request.get("requestedAt"),
                    "denialReason": re_edit_request.get("denialReason"),
                    "reviewedByUserId": str(uid) if (uid := re_edit_request.get("reviewedByUserId")) else None,
                    "reviewedAt": re_edit_request.get("reviewedAt")
                } if re_edit_request else None,
                "index": doc.get("index"),
                "process": doc.get("process"),
            }
            latest_job = latest_jobs_by_contract.get(str(doc["_id"]))
            if latest_job:
                processed["latest_job"] = {
                    "job_id": latest_job.get("job_id"),
                    "status": latest_job.get("status"),
                    "job_type": latest_job.get("job_type"),
                    "contract_id": str(latest_job.get("contract_id")) if latest_job.get("contract_id") else None,
                    "user_id": str(latest_job.get("user_id")) if latest_job.get("user_id") else None,
                    "progress": latest_job.get("progress", 0),
                    "current_step": latest_job.get("current_step"),
                    "error": latest_job.get("error"),
                    "timestamp": latest_job.get("updated_at").isoformat() if latest_job.get("updated_at") else None,
                }
            if "error" in doc:
                processed["error"] = doc["error"]
            processed_docs.append(processed)
        
        return {
            "documents": processed_docs,
            "pagination": { "total": total_docs, "pages": total_pages, "current_page": page, "per_page": per_page }
        }
    
    except Exception as e:
        logger.exception(f"Error fetching documents: {e}")
        raise HTTPException(status_code=500, detail="Error retrieving documents")

@contracts_router.get("/contracts/{contract_id}", response_model=ContractResponse)
def get_contract(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """Gets full details for a specific contract if the user has access."""
    logger.debug(f"Request received for contract details: {contract_id}, User: {current_user.id}")

    try:
        try:
            contract_oid = ObjectId(contract_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid contract ID format.")

        projection = {
            "_id": 1,
            "contract_name": 1,
            "uploaded_by": 1,
            "uploaded_at": 1,
            "ownerType": 1,
            "ownerId": 1,
            "projectId": 1,
            "status": 1,
            "workflowRoles": 1,
            "submittedBy": 1,
            "approvedOrRejectedBy": 1,
            "rejectedReason": 1,
            "reEditRequest":1,
            "index.status": 1,
            "index.content": 1,
            "index.html_content": 1,
            "process.status": 1,
            "process.results": {"$slice": -1},
            "process.dynamic_results": 1,
            "process.lastSave": 1,
        }

        cache_key = f"contract:doc:{contract_id}"
        contract = cache.get(cache_key)
        if contract is not None:
            contract["_id"] = ObjectId(contract["_id"])
            if contract.get("ownerId"):
                contract["ownerId"] = ObjectId(contract["ownerId"])
            if contract.get("uploaded_by"):
                contract["uploaded_by"] = ObjectId(contract["uploaded_by"])
            if contract.get("projectId"):
                contract["projectId"] = ObjectId(contract["projectId"])
        else:
            contract = collection.find_one({"_id": contract_oid}, projection)
            if contract:
                cache.set(cache_key, contract, ttl=30)
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")

        owner_type = contract.get("ownerType")
        owner_id = contract.get("ownerId")
        user_oid = ObjectId(current_user.id)

        user_has_access = False
        
        if owner_type == "user":
            if owner_id == user_oid:
                user_has_access = True
        elif owner_type == "team":
            if owner_id:
                is_owner = str(owner_id) == current_user.ownedAccountId
                is_member = str(owner_id) in (current_user.teamIds or [])
                
                if is_owner or is_member:
                    user_has_access = True
                elif teams_collection:
                    team_membership = teams_collection.find_one(
                        {"_id": owner_id, "members.userId": user_oid}, 
                        {"_id": 1}
                    )
                    if team_membership:
                        user_has_access = True

        if not user_has_access:
            raise HTTPException(status_code=403, detail="You do not have permission to view this contract.")

        process_data = contract.get("process", {})
        uploaded_by = contract.get("uploaded_by")
        uploaded_by_oid = None
        user_lookup_ids = set()
        if isinstance(uploaded_by, ObjectId):
            uploaded_by_oid = uploaded_by
            user_lookup_ids.add(uploaded_by)
        elif uploaded_by and ObjectId.is_valid(str(uploaded_by)):
            uploaded_by_oid = ObjectId(str(uploaded_by))
            user_lookup_ids.add(uploaded_by_oid)

        for item in process_data.get("results", []):
            if isinstance(item, dict) and isinstance(item.get("results"), list):
                for qa_pair in item["results"]:
                    edited_by_user_id = qa_pair.get("edited_by_user_id") if isinstance(qa_pair, dict) else None
                    if edited_by_user_id and ObjectId.is_valid(str(edited_by_user_id)):
                        user_lookup_ids.add(ObjectId(str(edited_by_user_id)))

        user_display_map = {}
        if user_lookup_ids:
            try:
                user_docs = users_collection.find(
                    {"_id": {"$in": list(user_lookup_ids)}},
                    {"username": 1, "email": 1}
                )
                user_display_map = {
                    str(user["_id"]): user.get("username") or (
                        user["email"].split("@")[0] if user.get("email") else "Unknown"
                    )
                    for user in user_docs
                }
            except Exception as e:
                logger.warning(f"Error batch-fetching contract user display names: {str(e)}")

        uploaded_by_name = user_display_map.get(str(uploaded_by_oid)) if uploaded_by_oid else None
        main_results = []
        
        for item in process_data.get("results", []):
            if isinstance(item, dict):
                try:
                    if 'results' in item and isinstance(item['results'], list):
                        for qa_pair in item['results']:
                            edited_by_user_name = None
                            edited_by_user_id = qa_pair.get("edited_by_user_id")

                            if edited_by_user_id and ObjectId.is_valid(str(edited_by_user_id)):
                                edited_by_user_name = user_display_map.get(str(ObjectId(str(edited_by_user_id))))
                            
                            qa_pair["edited_by_user_name"] = edited_by_user_name

                    analysis = ContractAnalysis.model_validate(item)
                    main_results.append(analysis)
                except Exception as e:
                    logger.warning(f"Error processing result item: {str(e)}")
                    continue

        last_save = None
        last_save_data = process_data.get("lastSave", {})
        if last_save_data and isinstance(last_save_data, dict):
            try:
                last_save = LastSaveResponse(
                    savedAt=last_save_data.get("savedAt", datetime.utcnow()),
                    data=ContractAnalysis.model_validate(last_save_data["data"])
                )
            except Exception:
                pass

        workflow_roles = None
        if isinstance(contract.get("workflowRoles"), dict):
            try:
                workflow_roles = WorkflowRoles.model_validate(contract["workflowRoles"])
            except Exception:
                pass

        response = ContractResponse(
            _id=str(contract["_id"]),
            contract_name=contract.get("contract_name", ""),
            uploaded_by=str(uploaded_by) if uploaded_by else None,
            uploaded_by_name=uploaded_by_name,
            uploaded_at=contract.get("uploaded_at", datetime.utcnow()),
            ownerType=contract.get("ownerType"),
            ownerId=str(owner_id) if owner_id else None,
            projectId=str(pid) if (pid := contract.get("projectId")) else None,
            status=contract.get("status", "unknown"),
            workflowRoles=workflow_roles,
            submittedBy=contract.get("submittedBy"),
            approvedOrRejectedBy=contract.get("approvedOrRejectedBy"),
            rejectedReason=contract.get("rejectedReason"),
            reEditRequest=contract.get("reEditRequest"),
            index=IndexResponse(
                status=contract.get("index", {}).get("status", "unknown"),
                contract_name=contract.get("contract_name", ""),
                content=contract.get("index", {}).get("content", ""),
                html_content=contract.get("index", {}).get("html_content")
            ),
            process=ProcessResponse(
                status=process_data.get("status", "unknown"),
                results=main_results,
                dynamic_results=process_data.get("dynamic_results", []),
                lastSave=last_save,
            ),
        )
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unexpected error fetching contract {contract_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@contracts_router.get("/contracts/{contract_id}/render")
async def render_contract_pdf(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_user_from_ticket_or_session)
):
    """Streams the original PDF content of a contract if the user has access."""
    logger.debug(f"Render PDF request: {contract_id}, User: {current_user.id}")

    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    projection = {
        "file_id": 1,
        "contract_name": 1,
        "ownerType": 1,
        "ownerId": 1
    }

    try:
        contract = collection.find_one(
            {"_id": contract_oid},
            projection
        )
    except Exception as db_error:
        logger.error(f"Database error fetching contract {contract_id}: {db_error}")
        raise HTTPException(status_code=500, detail="Database operation failed")

    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    owner_type = contract.get("ownerType")
    owner_id_obj = contract.get("ownerId")
    owner_id_str = str(owner_id_obj) if isinstance(owner_id_obj, ObjectId) else None
    user_oid = ObjectId(current_user.id)

    user_has_access = False
    if owner_type == "user":
        if owner_id_obj == user_oid:
            user_has_access = True
    elif owner_type == "team" and owner_id_str:
        is_owner = current_user.ownedAccountId == owner_id_str
        is_member = owner_id_str in (current_user.teamIds or [])
        if is_owner or is_member:
            user_has_access = True
        else:
             if teams_collection and owner_id_obj:
                 if teams_collection.find_one({"_id": owner_id_obj, "members.userId": user_oid}, {"_id": 1}):
                     user_has_access = True

    if not user_has_access:
        raise HTTPException(status_code=403, detail="You do not have permission to view this contract's file.")

    try:
        file_id = contract.get("file_id")
        contract_name = contract.get("contract_name", "contract.pdf")
        
        if not file_id:
            raise HTTPException(status_code=404, detail="PDF file reference not found.")

        cache_key = f"pdf:{contract_id}"

        # Try cache first — PDFs are immutable after upload
        cached_bytes = cache.get_bytes(cache_key)
        if cached_bytes is not None:
            logger.debug(f"PDF cache hit for {contract_id}")
            return StreamingResponse(
                iter([cached_bytes]),
                media_type="application/pdf",
                headers={
                    "Content-Disposition": content_disposition("inline", contract_name, "contract.pdf"),
                    "Cache-Control": "private, max-age=3600",
                    "X-Cache": "HIT",
                }
            )

        # Cache miss — read from GridFS and cache
        logger.debug(f"PDF cache miss for {contract_id}, reading from GridFS")
        grid_out = fs.get(file_id)
        try:
            pdf_bytes = grid_out.read()
        finally:
            grid_out.close()

        # Cache for 1 hour (PDFs are immutable)
        cache.set_bytes(cache_key, pdf_bytes, ttl=3600)

        return StreamingResponse(
            iter([pdf_bytes]),
            media_type="application/pdf",
            headers={
                "Content-Disposition": content_disposition("inline", contract_name, "contract.pdf"),
                "Cache-Control": "private, max-age=3600",
                "X-Cache": "MISS",
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error rendering PDF {contract_id}: {e}")
        raise HTTPException(status_code=500, detail="Error rendering PDF.")

@contracts_router.get("/contracts-stats", response_model=Dict[str, int])
async def get_contract_stats(
    context_id: Optional[str] = Query(None, description="Account/Team ID context"),
    project_id: Optional[str] = Query(None, description="Project ID"),
    search: Optional[str] = Query(None, description="Search query"),
    status: Optional[str] = Query(None, description="Filter by status"),
    current_user: UserInDB = Depends(get_current_active_user)
):
    try:
        if not current_user:
            raise HTTPException(status_code=401, detail="Unauthorized")
        
        current_user_id = ObjectId(current_user.id)
        contracts_collection = async_db.contracts
        
        query: Dict[str, Any] = {}
        def combine_query(base: Dict[str, Any], extra: Dict[str, Any]) -> Dict[str, Any]:
            if not extra:
                return base
            if not base:
                return extra
            if set(base.keys()) == {"$and"}:
                return {"$and": [*base["$and"], extra]}
            return {"$and": [base, extra]}
        
        if context_id is None or context_id.lower() == "personal":
            query["$or"] = [
                {"ownerType": "user", "ownerId": current_user_id},
                {"uploaded_by": current_user_id}
            ]
        else:
            if not ObjectId.is_valid(context_id):
                raise HTTPException(status_code=400, detail="Invalid context_id format.")
            
            account_oid = ObjectId(context_id)
            is_owner = current_user.ownedAccountId == context_id
            
            team = await async_db.teams.find_one({
                "_id": account_oid,
                "$or": [
                    {"members.userId": current_user_id},
                    {"creatorId": current_user_id}
                ]
            })
            if not team:
                return {
                    "total_documents": 0,
                    "process_status_count": 0,
                    "ready_to_edit_count": 0,
                    "editing_count": 0,
                    "pending_approval_count": 0,
                    "rejected_count": 0,
                    "completed_count": 0,
                    "error_count": 0
                }
            
            if is_owner:
                query["ownerType"] = "team"
                query["ownerId"] = account_oid
            else:
                query["$or"] = [
                    {"ownerType": "team", "ownerId": account_oid, "workflowRoles.editorUserId": current_user_id, 
                     "status": {"$in": ["Ingested", "Ready to Edit", "Editing" , "Pending Approval", "Pending Your Approval", "Approved", "Rejected" , "Uploaded" , "Processing" , "Indexing" , "Summarizing" , "Completed" , "Error"]}},
                    {"ownerType": "team", "ownerId": account_oid, "workflowRoles.approverUserId": current_user_id, 
                     "status": {"$in": ["Pending Approval", "Pending Your Approval", "Rejected"]}},
                    {"ownerType": "team", "ownerId": account_oid, "workflowRoles.uploaded_by": current_user_id, 
                     "status": {"$in": ["Pending Approval", "Pending Your Approval", "Rejected"]}},
                    {"ownerType": "user", "ownerId": current_user_id, "teamId": account_oid}
                ]
        
        if search:
            search_query = {
                "$or": [
                    {"contract_name": {"$regex": search, "$options": "i"}},
                    {"uploader_name": {"$regex": search, "$options": "i"}},
                    {"workflowRoles.editor_name": {"$regex": search, "$options": "i"}},
                    {"workflowRoles.approver_name": {"$regex": search, "$options": "i"}}
                ]
            }
            query = combine_query(query, search_query)
        
        if status:
            status_map = {
                "uploaded": {"$or": [
                    {"status": "Uploaded"},
                    {"index.status": "pending", "process.status": "pending"}
                ]},
                "processing": {"$or": [
                    {"status": {"$in": ["Indexing", "Summarizing", "Processing", "Queued"]}},
                    {"index.status": "processing"},
                    {"process.status": "processing"}
                ]},
                "ingested": {"status": {"$in": ["Ingested", "Indexed", "Ready to Edit", "Approved", "Completed", "Editing", "Pending Approval", "Rejected"]}},
                "ready_to_edit": {"status": {"$in": ["Ingested", "Ready to Edit"]}},
                "editing": {"status": "Editing"},
                "pending_approval": {"status": {"$in": ["Pending Approval", "Pending Your Approval"]}},
                "rejected": {"status": "Rejected"},
                "completed": {"status": {"$in": ["Approved", "Ingested", "Completed"]}},
                "error": {"$or": [
                    {"status": "Error"},
                    {"error": {"$exists": True}}
                ]}
            }
            query = combine_query(query, status_map.get(status, {}))

        if project_id:
            if not ObjectId.is_valid(project_id):
                raise HTTPException(status_code=400, detail="Invalid project_id format.")
            project_filter = {"projectId": ObjectId(project_id)}
            query = combine_query(query, project_filter)

        empty_counts = {
            "total_documents": 0,
            "process_status_count": 0,
            "ready_to_edit_count": 0,
            "editing_count": 0,
            "pending_approval_count": 0,
            "rejected_count": 0,
            "completed_count": 0,
            "error_count": 0
        }
        stats_pipeline = [
            {"$match": query},
            {
                "$group": {
                    "_id": None,
                    "total_documents": {"$sum": 1},
                    "process_status_count": {
                        "$sum": {
                            "$cond": [
                                {
                                    "$or": [
                                        {"$in": ["$process.status", ["success", "processed", "Processed", "Completed"]]},
                                        {"$eq": ["$status", "Processing"]},
                                    ]
                                },
                                1,
                                0,
                            ]
                        }
                    },
                    "ready_to_edit_count": {"$sum": {"$cond": [{"$in": ["$status", ["Ready to Edit", "Ingested"]]}, 1, 0]}},
                    "editing_count": {"$sum": {"$cond": [{"$eq": ["$status", "Editing"]}, 1, 0]}},
                    "pending_approval_count": {"$sum": {"$cond": [{"$in": ["$status", ["Pending Approval", "Pending Your Approval"]]}, 1, 0]}},
                    "rejected_count": {"$sum": {"$cond": [{"$eq": ["$status", "Rejected"]}, 1, 0]}},
                    "completed_count": {"$sum": {"$cond": [{"$in": ["$status", ["Approved", "Completed", "Ingested"]]}, 1, 0]}},
                    "error_count": {
                        "$sum": {
                            "$cond": [
                                {
                                    "$or": [
                                        {"$in": ["$status", ["Error", "Index Error", "Summarize Error", "Process Error"]]},
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
        stats_docs = await contracts_collection.aggregate(stats_pipeline).to_list(length=1)
        counts = empty_counts
        if stats_docs:
            counts = {key: int(stats_docs[0].get(key, 0)) for key in empty_counts}

        return counts
    except HTTPException:
        raise
    except Exception as e:
        log_exception(logger, "Error getting contract stats", e)
        raise HTTPException(status_code=500, detail="Unable to retrieve contract statistics.")


@contracts_router.post("/contracts/debug_log")
async def frontend_debug_log(payload: Dict[str, Any]):
    logger.info(f"[FRONTEND DEBUG] {payload.get('message')} | Data: {payload.get('data')}")
    return {"status": "ok"}
