# apps/backend/beta_route.py

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from motor.motor_asyncio import AsyncIOMotorClient
from core.rate_limiter import limiter

# We will need to import your async_db object and the Celery task.
# The exact import path might need adjustment based on your project structure.
# We are assuming they are accessible from your main application file or a tasks.py file.
from core.database import async_db  # Assuming async_db is defined in core.database
from worker.tasks import send_beta_welcome_email_task # This task doesn't exist yet, we will create it next.

# --- Router Setup ---
# We create a new router. We'll add this to our main FastAPI app later.
beta_router = APIRouter(
    tags=["Beta Program"]
)

# --- Pydantic Models for Data Validation and Structuring ---

class BetaUserSignup(BaseModel):
    """Defines the shape of the incoming request from the Next.js form."""
    name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    contractVolume: str = Field(..., min_length=1, max_length=120)
    reasonForSignup: str = Field(..., min_length=1, max_length=2000)
    marketingConsent: bool

class Coupon(BaseModel):
    """A sub-model for the coupon details."""
    code: str
    status: str = "issued"
    issuedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class BetaUserInDB(BetaUserSignup):
    """Defines the shape of the document we will store in MongoDB."""
    signupAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    coupon: Coupon
    redemptionInfo: dict = Field(default_factory=dict) # Empty dict to be populated on redemption

# --- Dependency for getting the database client ---
# This follows a standard FastAPI pattern and uses your existing async_db connection.
async def get_database() -> AsyncIOMotorClient:
    return async_db

# --- Helper Function ---
def generate_coupon_code() -> str:
    """Generates a unique, user-friendly coupon code like 'BETA-A8X3F1C2'."""
    return f"BETA-{uuid.uuid4().hex[:8].upper()}"


# --- API Endpoint ---

@beta_router.post("/beta-signup", status_code=201) # 201 Created is a good status code for this
@limiter.limit("3/minute")
async def signup_beta_user(
    request: Request,
    user_data: BetaUserSignup,
    db: AsyncIOMotorClient = Depends(get_database)
):
    """
    Handles the beta signup process:
    1. Checks if the user has already applied.
    2. Generates a unique coupon code.
    3. Stores the complete user application in the 'beta_signups' collection.
    4. Triggers a background Celery task to send the welcome email.
    """
    beta_collection = db["beta_signups"]

    # 1. Check for an existing user by email to prevent duplicate applications.
    existing_user = await beta_collection.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(
            status_code=409, # HTTP 409 Conflict
            detail="This email address has already been used to apply for the beta."
        )

    # 2. Generate the coupon and create the full database document object.
    coupon_code = generate_coupon_code()
    user_document = BetaUserInDB(
        **user_data.model_dump(),
        coupon=Coupon(code=coupon_code)
    )

    # 3. Insert the new user document into the database.
    # We use model_dump() to convert the Pydantic model to a Python dict.
    await beta_collection.insert_one(user_document.model_dump())

    # 4. Trigger the background Celery task to send the email.
    # The API will return a response to the user IMMEDIATELY without waiting for this to finish.
    send_beta_welcome_email_task.delay(
        recipient_email=user_data.email,
        name=user_data.name,
        coupon_code=coupon_code
    )

    return {"message": "Thank you for applying! If you are accepted into the program, you will receive an email with your coupon code shortly."}
