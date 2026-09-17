
from fastapi import APIRouter, HTTPException
from celery.result import AsyncResult
import logging
from utils.secure_logger import log_exception
from fastapi.responses import JSONResponse
from fastapi import status
from core.security import get_current_active_user
from core.security import UserInDB
from fastapi import Depends

logger = logging.getLogger(__name__)
router = APIRouter(tags=["tasks"])


    
@router.get("/tasks/{task_id}/status", response_class=JSONResponse)
def get_task_status(
    task_id: str,
    current_user: UserInDB = Depends(get_current_active_user)
):
    """Check status of a Celery task"""
    try:
        task = AsyncResult(task_id)
        
        if task.state == "PENDING":
            return JSONResponse(
                content={"status": "PENDING", "state": task.state},
                status_code=status.HTTP_200_OK
            )
        elif task.state == "SUCCESS":
            return JSONResponse(
                content={
                    "status": "SUCCESS",
                    "state": task.state,
                    "result": task.result
                },
                status_code=status.HTTP_200_OK
            )
        elif task.state == "FAILURE":
            return JSONResponse(
                content={
                    "status": "FAILURE",
                    "state": task.state,
                    "error": str(task.result)
                },
                status_code=status.HTTP_200_OK
            )
        else:
            return JSONResponse(
                content={"status": task.state, "state": task.state},
                status_code=status.HTTP_200_OK
            )
            
    except Exception as e:
        log_exception(logger, f"Error checking task status", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check task status: {str(e)}"
        )
