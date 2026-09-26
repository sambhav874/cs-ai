import logging
import os
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.security import get_current_active_user
from models.domain import UserInDB
from utils.eval_parser import EvaluationParser

logger = logging.getLogger(__name__)

#: ContractSense's evaluation workspace. Runs, reports and datasets are filed
#: under it; they are the platform's own quality data, not a tenant's.
EVAL_CONTEXT_ID = "600c00000000000000000001"


def evaluation_org_ids() -> set:
    """Platform orgs whose admins may use evaluations (EVALUATION_ORG_IDS, comma-separated)."""
    return {v.strip() for v in os.getenv("EVALUATION_ORG_IDS", "").split(",") if v.strip()}


def is_evaluator(user: UserInDB) -> bool:
    """An admin of an evaluation org, or a member of ContractSense's own
    evaluation team (standalone ContractSense)."""
    org = getattr(user, "platformOrgId", None)
    if org:
        is_admin = bool(user.ownedAccountId) and str(user.ownedAccountId) in [str(t) for t in user.teamIds]
        return is_admin and org in evaluation_org_ids()
    return EVAL_CONTEXT_ID in [str(t) for t in user.teamIds]


async def require_evaluator(current_user: UserInDB = Depends(get_current_active_user)) -> UserInDB:
    """Every evaluation route. Only the list and the run trigger used to check
    anything, and they checked a context id the client chose, so any signed-in
    user could read run reports, CSVs and datasets. In the merged platform no
    user is in ContractSense's evaluation team, so the platform names its own
    evaluator orgs instead."""
    if not is_evaluator(current_user):
        raise HTTPException(status_code=403, detail="Evaluations are restricted to the platform's evaluation admins.")
    return current_user


router = APIRouter(prefix="/evaluations", tags=["evaluations"], dependencies=[Depends(require_evaluator)])


@router.get("/access", response_model=Dict[str, Any])
async def evaluation_access(current_user: UserInDB = Depends(require_evaluator)) -> Dict[str, Any]:
    """Reached only by an evaluator (the router's guard refuses anyone else): the page's gate."""
    return {"allowed": True, "context_id": EVAL_CONTEXT_ID}


class EvaluationRunRequest(BaseModel):
    provider: str = "groq"
    dataset: str = "cuad"
    contract_count: int = 5
    repeat_default: Optional[int] = None
    repeat_security: Optional[int] = None
    smoke_profile: str = "none"
    dry_run: bool = True
    keep_fixtures: bool = False
    skip_citation_gate: bool = False
    model_name: Optional[str] = None
    max_cases_per_layer: Optional[int] = None
    threshold_profile: str = "default"
    no_checkpoint: bool = False
    allow_short_token: bool = False
    context_id: Optional[str] = None


@router.get("", response_model=List[Dict[str, Any]])
async def list_evaluations(
    context_id: Optional[str] = Query(None),
    current_user: UserInDB = Depends(get_current_active_user)
) -> List[Dict[str, Any]]:
    """List all historical evaluation runs scanned from the reports directory."""
    try:
        return EvaluationParser.list_runs(context_id=EVAL_CONTEXT_ID)
    except Exception as e:
        logger.error(f"Failed to list evaluation runs: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/config", response_model=Dict[str, Any])
async def get_eval_config(
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    """Get the active evaluation baseline configuration settings."""
    try:
        return EvaluationParser.get_global_config()
    except Exception as e:
        logger.error(f"Failed to retrieve evaluation config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/datasets/{dataset_key}/cases", response_model=Dict[str, Any])
async def list_local_dataset_cases(
    dataset_key: str,
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    """Browse local repository test cases from the dataset manifest files."""
    try:
        if dataset_key not in {"cuad", "acord", "kpi"}:
            raise HTTPException(status_code=400, detail="Invalid dataset key. Must be cuad, acord, or kpi.")
        return EvaluationParser.list_local_cases(dataset_key, search, page, limit)
    except Exception as e:
        logger.error(f"Failed to list local cases for '{dataset_key}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/run", response_model=Dict[str, Any])
async def trigger_evaluation_run(
    payload: EvaluationRunRequest,
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    """Trigger a new evaluation run in the background via Celery."""
    payload.context_id = EVAL_CONTEXT_ID
    try:
        from worker.tasks import run_evaluation_suite_task
        from core.security import create_access_token
        from datetime import timedelta
        from core.config import settings
        
        # Generate auth token for the evaluator to make api calls to localhost backend
        token = create_access_token(
            data={"sub": current_user.username},
            expires_delta=timedelta(hours=4)
        )
        
        api_base_url = f"http://127.0.0.1:{settings.port if hasattr(settings, 'port') else 8000}/api/v1"
        
        params = payload.model_dump()
        params["auth_token"] = token
        params["api_base_url"] = api_base_url
        
        # Trigger background task with fallback if Celery broker (RabbitMQ/Redis) is offline
        try:
            task = run_evaluation_suite_task.delay(params)
            return {"status": "running", "task_id": task.id, "run_group": payload.dataset == "all"}
        except Exception as celery_err:
            logger.warning(f"Celery broker connection refused ({celery_err}). Executing evaluation run directly in background thread.")
            import uuid, asyncio
            fallback_id = f"local-eval-{uuid.uuid4().hex[:8]}"
            # Execute synchronously in a background thread
            asyncio.create_task(asyncio.to_thread(run_evaluation_suite_task, params))
            return {"status": "running", "task_id": fallback_id, "run_group": payload.dataset == "all"}
    except Exception as e:
        logger.error(f"Failed to trigger evaluation run: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/run/{task_id}/abort", response_model=Dict[str, Any])
async def abort_evaluation_run(
    task_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    """Terminate an active evaluation run task."""
    try:
        from celery_app import celery_app
        from core.database import eval_runs_collection
        
        # Revoke Celery task (terminate=True sends SIGTERM to the worker subprocess)
        celery_app.control.revoke(task_id, terminate=True, signal="SIGTERM")
        
        # Update run status in DB
        eval_runs_collection.update_many(
            {"celery_task_id": task_id, "status": "running"},
            {"$set": {"status": "aborted", "summary.error": "Aborted by user request"}}
        )
        
        return {"status": "aborted"}
    except Exception as e:
        logger.error(f"Failed to abort task '{task_id}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/run/{task_id}/status", response_model=Dict[str, Any])
async def get_run_progress_status(
    task_id: str,
    offset: int = Query(0, description="Offset in bytes to read from log file"),
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    """Fetch the execution status and incremental log console output of a running task."""
    try:
        from core.database import eval_runs_collection
        from utils.eval_parser import REPORTS_DIR
        
        run_doc = eval_runs_collection.find_one({"celery_task_id": task_id}, {"_id": 0})
        if not run_doc:
            celery_state = "PENDING"
            try:
                from celery.result import AsyncResult
                res = AsyncResult(task_id)
                celery_state = res.state
            except Exception:
                pass
            return {
                "task_id": task_id,
                "status": "pending",
                "celery_state": celery_state,
                "logs": "",
                "offset": 0
            }
            
        status = run_doc.get("status", "running")
        run_id = run_doc.get("run_id", "")
        dataset = run_doc.get("dataset_key", "cuad")
        
        if "__" in run_id:
            log_path = REPORTS_DIR / run_id.replace("__", "/") / "console.log"
        else:
            log_path = REPORTS_DIR / run_id / "console.log"
        
        logs = ""
        new_offset = offset
        
        if log_path.exists():
            try:
                file_size = log_path.stat().st_size
                if offset < file_size:
                    with open(log_path, "r", encoding="utf-8") as f:
                        f.seek(offset)
                        logs = f.read()
                        new_offset = f.tell()
            except Exception as log_err:
                logger.warning(f"Error reading log file at {log_path}: {log_err}")
                
        return {
            "task_id": task_id,
            "run_id": run_id,
            "status": status,
            "logs": logs,
            "offset": new_offset
        }
    except Exception as e:
        logger.error(f"Failed to get status for task '{task_id}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/groups/{run_group_id}", response_model=Dict[str, Any])
async def get_run_group_details(
    run_group_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    """Retrieve aggregated details and child runs for a daily benchmark run group."""
    try:
        return EvaluationParser.get_group_details(run_group_id)
    except Exception as e:
        logger.error(f"Failed to get group details for '{run_group_id}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{run_id}", response_model=Dict[str, Any])
async def get_evaluation_details(
    run_id: str,
    layer: Optional[str] = Query(None, description="Filter by layer: pac1, rag, or tools"),
    family: Optional[str] = Query(None, description="Filter by canonical family: sanity, functional, non_functional, or operational"),
    execution_mode: Optional[str] = Query(None, description="Filter by execution mode: live_agent, integration, or mocked"),
    benchmark_metric: Optional[bool] = Query(None, description="Filter by benchmark_metric flag"),
    status: Optional[str] = Query(None, description="Filter by status: passed or failed"),
    search: Optional[str] = Query(None, description="Search cases by prompt text or contract title"),
    page: int = Query(1, ge=1, description="Page number"),
    limit: int = Query(50, ge=1, le=200, description="Items per page"),
    current_user: UserInDB = Depends(get_current_active_user)
) -> Dict[str, Any]:
    """Retrieve details of a specific evaluation run, with filtering and pagination on results."""
    try:
        details = EvaluationParser.get_run_details(
            run_id=run_id,
            layer=layer,
            family=family,
            execution_mode=execution_mode,
            benchmark_metric=benchmark_metric,
            status=status,
            search=search,
            page=page,
            limit=limit
        )
        if not details:
            raise HTTPException(status_code=404, detail=f"Evaluation run '{run_id}' not found.")
        return details
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get evaluation details for '{run_id}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{run_id}/csv/{csv_name}", response_model=List[Dict[str, Any]])
async def get_evaluation_csv(
    run_id: str,
    csv_name: str,
    current_user: UserInDB = Depends(get_current_active_user)
) -> List[Dict[str, Any]]:
    """Retrieve tabular rows of an evaluation CSV file associated with a run."""
    try:
        rows = EvaluationParser.get_run_csv(run_id, csv_name)
        return rows
    except Exception as e:
        logger.error(f"Failed to get CSV '{csv_name}' for run '{run_id}': {e}")
        raise HTTPException(status_code=500, detail=str(e))
