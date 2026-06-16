# Update your existing support router file

from fastapi import APIRouter, HTTPException, status, Request
from pydantic import BaseModel, EmailStr, Field
from core.rate_limiter import limiter
from enum import Enum
import logging
from core.config import Settings

# Import your Celery tasks
from worker.tasks import send_feedback_email_task
from worker.tasks import send_contact_and_demo_confirmation

# NEW: DB + time imports
from core.database import db
from datetime import datetime
from utils.secure_logger import log_exception

settings = Settings()

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- API Router ---
support_sub_router = APIRouter()

# --- Pydantic Models (keep existing) ---
class FeedbackType(str, Enum):
    """Enumeration for the type of feedback."""
    BUG = "bug"
    FEEDBACK = "feedback"
    SUPPORT = "support"

class FeedbackRequest(BaseModel):
    """Model for incoming feedback requests."""
    feedback_type: FeedbackType = Field(..., description="The type of feedback (bug, feedback, or support).")
    message: str = Field(..., description="The feedback message from the user.")
    user_email: EmailStr = Field(..., description="The email address of the user providing feedback.")
    name: str | None = Field(None, description="The user's name (optional).")

class FeedbackResponse(BaseModel):
    """Model for the response after submitting feedback."""
    message: str
    details: dict

# NEW: Contact models
class ContactRequest(BaseModel):
    """Model for incoming contact/demo requests from the landing page modal."""
    name: str = Field(..., min_length=1)
    email: EmailStr
    company: str | None = Field(None, max_length=200)
    phone: str | None = Field(None, max_length=50)
    message: str | None = Field(None, max_length=5000)
    demo_date: str | None = Field(None, description="Demo date in YYYY-MM-DD format")
    demo_time: str | None = Field(None, description="Demo time in HH:MM format (UK timezone)")

class ContactResponse(BaseModel):
    message: str
    details: dict

# NEW: Mongo collection for contact messages
contact_messages_collection = db["contact_messages"]

# --- Updated API Endpoint ---
@support_sub_router.post("/feedback", status_code=status.HTTP_202_ACCEPTED, response_model=FeedbackResponse)
@limiter.limit("5/minute")
def create_feedback_endpoint(request: Request, feedback: FeedbackRequest):
    """
    Accepts feedback, bug reports, or support requests and queues them for email delivery.
    """
    # SECURITY: Do not log user PII (email addresses) at INFO level \u2014 ISO 27001 A.5.34 / GDPR Article 5
    logger.info(f"Received {feedback.feedback_type.value} feedback request")
    task_id = None
    try:
        task = send_feedback_email_task.delay(
            feedback_type=feedback.feedback_type.value,
            user_email=feedback.user_email,
            name=feedback.name,
            message=feedback.message
        )
        task_id = task.id
        logger.info("Queued feedback email task %s", task.id)
    except Exception as e:
        logger.warning("Failed to queue feedback email task (broker may be unavailable): %s", e)

    return {
        "message": "Feedback submitted successfully and will be processed shortly.",
        "details": {
            "task_id": task_id,
            "status": "queued" if task_id else "pending_retry",
            "feedback_type": feedback.feedback_type.value
        }
    }

# NEW: Contact endpoint
@support_sub_router.post("/contact", status_code=status.HTTP_202_ACCEPTED, response_model=ContactResponse)
@limiter.limit("3/minute")
def create_contact_endpoint(request: Request, contact: ContactRequest):
    """
    Accepts contact/demo requests, stores them in MongoDB, and emails support + user confirmation.
    """
    logger.info("Received contact request.")

    # 1) Persist to DB
    doc = {
        "name": contact.name,
        "email": contact.email,
        "company": contact.company,
        "phone": contact.phone,
        "message": contact.message,
        "demo_date": contact.demo_date,
        "demo_time": contact.demo_time,
        "source": "landing_modal",
        "status": "new",
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    try:
        insert_result = contact_messages_collection.insert_one(doc)
    except Exception as e:
        log_exception(logger, "Failed to persist contact request to DB", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to submit your request. Please try again later."
        )

    # 2) Queue email task (non-blocking — contact is already saved)
    task_id = None
    try:
        task_combined = send_contact_and_demo_confirmation.delay(
            name=contact.name,
            user_email=contact.email,
            company=contact.company,
            phone=contact.phone,
            message=contact.message,
            demo_date=contact.demo_date,
            demo_time=contact.demo_time,
            source="landing_modal",
        )
        task_id = task_combined.id
        logger.info("Queued combined contact+confirmation task %s; DB id: %s", task_id, insert_result.inserted_id)
    except Exception as e:
        logger.warning("Failed to queue contact email task (broker may be unavailable): %s", e)

    return {
        "message": "Thanks! Your request has been received.",
        "details": {
            "task_id": task_id,
            "status": "queued" if task_id else "pending_retry",
            "id": str(insert_result.inserted_id)
        }
    }
