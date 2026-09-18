import logging
from utils.secure_logger import log_exception
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from core.security import get_current_active_user, UserInDB
from edit_validator import EditValidator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter() # No need for tags here, we'll add them in service.py

class ValidateEditRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    answer: str = Field(..., min_length=1, max_length=12000)
    reason: str = Field(..., min_length=1, max_length=4000)
    ai_provider: str = 'groq'

@router.post("/validate-edit") # Path is at the root of this router
async def validate_edit(
    request: ValidateEditRequest,
    _current_user: UserInDB = Depends(get_current_active_user),  # noqa: F841
):
    try:
        validator = EditValidator(ai_provider=request.ai_provider)
        result = validator.validate(request.question, request.answer, request.reason)
        return result
    except Exception as e:
        log_exception(logger, f"Error in validate_edit endpoint", e)
        raise HTTPException(status_code=500, detail="Failed to validate edit.")


