from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from bson import ObjectId
from typing import Optional, List
from core.security import get_current_active_user, UserInDB
import logging
from core.database import collection
from utils.helpers import JobManager, get_job_manager as get_shared_job_manager
from core.config import Settings
from utils.secure_logger import log_exception
from core.config import settings

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

status_router = APIRouter()

class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    job_type: Optional[str]
    contract_id: Optional[str]
    user_id: Optional[str]
    progress: Optional[float]
    current_step: Optional[str]
    error: Optional[str]
    timestamp: Optional[str]

class ContractStatusResponse(BaseModel):
    contract_id: str
    status: str
    index_status: Optional[str]
    process_status: Optional[str]
    jobs: List[JobStatusResponse]

def get_job_manager():
    settings = Settings()
    return get_shared_job_manager(mongo_uri=settings.mongodb_uri, db_name="contract_analysis_db")

@status_router.get("/contract-status/{contract_id}", response_model=ContractStatusResponse)
def get_contract_status(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
    job_manager: JobManager = Depends(get_job_manager)
):
    try:
        # Validate contract_id
        try:
            contract_oid = ObjectId(contract_id)
        except Exception:
            logger.warning(f"Invalid contract_id format: {contract_id}")
            raise HTTPException(status_code=400, detail="Invalid contract_id format")

        # Fetch contract document
        contract_doc = collection.find_one({"_id": contract_oid})
        if not contract_doc:
            logger.warning(f"Contract not found: {contract_id}")
            raise HTTPException(status_code=404, detail="Contract not found")

        # Verify user access
        owner_id = contract_doc.get("ownerId")
        owner_type = contract_doc.get("ownerType")
        if owner_type == "user" and str(owner_id) != str(current_user.id):
            logger.warning(f"User {current_user.id} not authorized to access contract {contract_id}")
            raise HTTPException(status_code=403, detail="Not authorized to access this contract")

        # Fetch jobs
        jobs = job_manager.get_jobs_for_document(document_id=contract_id)
        job_statuses = [
            JobStatusResponse(
                job_id=job["job_id"],
                status=job["status"],
                job_type=job.get("job_type"),
                contract_id=str(job.get("contract_id")),
                user_id=str(job.get("user_id")),
                progress=job.get("progress"),
                current_step=job.get("current_step"),
                error=job.get("error"),
                timestamp=job.get("updated_at").isoformat() if job.get("updated_at") else None
            )
            for job in jobs
        ]

        # Check job statuses
        processing_jobs = [job for job in jobs if job.get("job_type") in ["indexing", "summarizing", "processing"]]
        
        # Check for any failed jobs
        has_failed_jobs = any(job["status"] == "FAILED" for job in processing_jobs)
        
        # Check if processing job is completed with 100% progress
        processing_complete = any(
            job["status"] == "COMPLETED" and 
            job.get("job_type") == "processing" and
            job.get("progress", 0) >= 100
            for job in jobs
        )
        
        # Check for any in-progress jobs (excluding completed processing job)
        has_in_progress_jobs = any(
            job["status"] in ["PENDING", "IN_PROGRESS"] or
            (job["status"] == "COMPLETED" and 
             job.get("progress", 0) < 100 and
             job.get("job_type") != "processing")
            for job in processing_jobs
        )

        # Compute contract status
        if has_failed_jobs:
            status = "Error"
        elif processing_complete:
            status = "Ingested"
        elif has_in_progress_jobs:
            status = "Processing"
        else:
            status = contract_doc.get("status", "unknown")

        return ContractStatusResponse(
            contract_id=contract_id,
            status=status,
            index_status=contract_doc.get("index", {}).get("status"),
            process_status=contract_doc.get("process", {}).get("status"),
            jobs=job_statuses
        )
    except HTTPException as he:
        raise he
    except Exception as e:
        log_exception(logger, f"Error fetching contract status {contract_id}", e)
        raise HTTPException(status_code=500, detail="Unable to retrieve contract status. Please try again later.")


import asyncio
from jose import JWTError, jwt
from celery.result import AsyncResult
from fastapi import WebSocket, WebSocketDisconnect, status, Query
from core.security import AUTH_COOKIE_NAME, AUTH_COOKIE_SENTINEL, get_user
from api.dependencies import check_contract_access

# --- WS Helper ---
def _websocket_origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if not origin:
        return True
    raw_origins = settings.allowed_origins
    if isinstance(raw_origins, str):
        allowed = {item.strip().rstrip("/") for item in raw_origins.split(",") if item.strip()}
    else:
        allowed = {str(item).strip().rstrip("/") for item in raw_origins if str(item).strip()}
    return origin.rstrip("/") in allowed




# --- WS and Job Status Routes ---
@status_router.get("/job-status/{job_id}", response_model=JobStatusResponse)
def get_job_status_endpoint(
    job_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
) -> JobStatusResponse:
    """
    Check the status of a background job
    """
    try:
        # First check our database job tracking
        job = get_shared_job_manager(settings.mongodb_uri).get_job_status(job_id)
        if job and str(job.get("user_id")) != str(current_user.id):
            raise HTTPException(status_code=403, detail="Not authorized to view this job")
    
        # Add more detailed status information
        if job:
            job_status = str(job.get("status", "")).lower()
            return JobStatusResponse(
                job_id=job_id,
                status=job_status,
                progress=job.get('progress', 0),  # Add progress tracking
                current_step=job.get('current_step'),
                result=job.get("result") if job_status == "completed" else None,
                error=job.get("error") if job_status == "failed" else None,
                created_at=job.get("created_at"),
                updated_at=job.get("updated_at")
            )

        # Fall back to Celery task result
        task_result = AsyncResult(job_id)
        
        # Map Celery states to our standardized status values
        status_map = {
            'PENDING': 'in_progress',
            'STARTED': 'in_progress',
            'RETRY': 'in_progress',
            'FAILURE': 'failed',
            'SUCCESS': 'completed'
        }
        
        # Get the mapped status or default to the lowercase state
        status = status_map.get(task_result.state, task_result.state.lower())
        
        return JobStatusResponse(
            job_id=job_id,
            status=status,
            result=task_result.result if task_result.ready() else None,
            error=str(task_result.traceback) if task_result.failed() else None
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking job status {job_id}: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Error checking job status: {str(e)}"
        )


def _websocket_origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if not origin:
        return True
    raw_origins = settings.allowed_origins
    if isinstance(raw_origins, str):
        allowed = {item.strip().rstrip("/") for item in raw_origins.split(",") if item.strip()}
    else:
        allowed = {str(item).strip().rstrip("/") for item in raw_origins if str(item).strip()}
    return origin.rstrip("/") in allowed


@status_router.websocket("/ws/job-status/{client_id}")
async def websocket_job_status(
    websocket: WebSocket,
    client_id: str,
    token: str = Query(None),
):
    """
    Real-time job progress over WebSocket.

    Flow:
      1. Client connects with the HttpOnly auth cookie; legacy ?token=<jwt> is still accepted.
      2. Client sends {"type": "subscribe", "contract_id": "<id>"}
      3. Server polls MongoDB every 500 ms and pushes job updates until
         all jobs are in a terminal state or the client disconnects.

    Message format pushed to client:
      {"type": "job_update", "contract_id": "...", "jobs": [...]}
    """
    from services.ws_manager import ws_manager

    if not _websocket_origin_allowed(websocket):
        await websocket.close(code=4403)
        return

    await websocket.accept()

    # ── 1. Authenticate ──────────────────────────────────────────────
    resolved_token = token
    if not resolved_token or resolved_token == AUTH_COOKIE_SENTINEL:
        resolved_token = websocket.cookies.get(AUTH_COOKIE_NAME)

    if not resolved_token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = jwt.decode(resolved_token, settings.secret_key, algorithms=[settings.algorithm])
        username: str = payload.get("sub")
        if not username:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except JWTError:
        logger.warning(f"WS auth failed for client {client_id}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    current_user = get_user(username)
    if current_user is None or current_user.disabled:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # ── 2. Wait for subscribe message ────────────────────────────────
    try:
        init_msg = await asyncio.wait_for(websocket.receive_json(), timeout=10.0)
    except asyncio.TimeoutError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return
    except WebSocketDisconnect:
        return

    if init_msg.get("type") != "subscribe" or not init_msg.get("contract_id"):
        await websocket.send_json({"type": "error", "message": "Expected {type: subscribe, contract_id: ...}"})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    contract_id: str = init_msg["contract_id"]
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        await websocket.send_json({"type": "error", "message": "Invalid contract_id."})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    contract_doc = collection.find_one(
        {"_id": contract_oid},
        {"_id": 1, "ownerType": 1, "ownerId": 1},
    )
    try:
        check_contract_access(contract_doc, current_user)
    except HTTPException:
        await websocket.send_json({"type": "error", "message": "Not authorized to access this contract."})
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    job_mgr = get_shared_job_manager(settings.mongodb_uri)

    ws_manager.subscribe(contract_id, websocket)
    logger.info(f"WS client {client_id} subscribed to contract {contract_id}")

    # ── 3. Change Stream loop ────────────────────────────────────────
    try:
        from core.database import jobs_collection_async  # Fixed import
        
        pipeline = [
            {"$match": {"operationType": {"$in": ["insert", "update", "replace"]}, "fullDocument.contract_id": ObjectId(contract_id)}}
        ]

        # Send initial snapshot immediately so the UI isn't waiting for the first change event
        try:
           initial_snapshot = job_mgr.get_latest_job_snapshot(contract_id)
           if initial_snapshot:
               await websocket.send_json({
                   "type":        "job_update",
                   "contract_id": contract_id,
                   "jobs":        list(initial_snapshot.values()),
               })
               if job_mgr.is_terminal_snapshot(initial_snapshot):
                    await websocket.send_json({"type": "complete", "contract_id": contract_id})
                    return
        except Exception as e:
           logger.error(f"Error sending initial snapshot: {e}")

        # Watch the jobs collection for changes
        async with jobs_collection_async.watch(pipeline, full_document="updateLookup") as stream:
            async for change in stream:
                 try:
                     snapshot = job_mgr.get_latest_job_snapshot(contract_id)
                     if snapshot:
                         await ws_manager.broadcast(
                             contract_id,
                             {
                                 "type":        "job_update",
                                 "contract_id": contract_id,
                                 "jobs":        list(snapshot.values()),
                             },
                         )
                         if job_mgr.is_terminal_snapshot(snapshot):
                             logger.info(f"WS: all jobs terminal for contract {contract_id}, closing connection")
                             await websocket.send_json({"type": "complete", "contract_id": contract_id})
                             break
                 except Exception as exc:
                     logger.error(f"WS broadcast error for contract {contract_id}: {exc}")

    except WebSocketDisconnect:
        logger.info(f"WS client {client_id} disconnected from contract {contract_id}")
    except Exception as exc:
        logger.error(f"WS poll loop error for {client_id}: {exc}")
    finally:
        ws_manager.unsubscribe(contract_id, websocket)



