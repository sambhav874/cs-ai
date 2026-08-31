from pydantic import BaseModel, EmailStr, Field, ConfigDict, BeforeValidator
from typing import Optional, List, Literal, Annotated, Dict
from datetime import datetime
from bson import ObjectId
from decimal import Decimal

# Helper function to convert ObjectId to string
def convert_objectid_to_str(v):
    if isinstance(v, ObjectId):
        return str(v)
    # Allow None values to pass through without error
    if v is None:
        return None
    # Allow existing strings to pass through
    if isinstance(v, str):
        return v
    # Handle other types if necessary, or raise error
    raise TypeError(f"Cannot convert type {type(v)} to string for ObjectIdStr")

# Create a type that handles ObjectId conversion
ObjectIdStr = Annotated[Optional[str], BeforeValidator(convert_objectid_to_str)]

# --- User Models ---
class User(BaseModel):
    username: str
    email: EmailStr
    hashed_password: str
    tokens: int = 0
    teamIds: List[ObjectIdStr] = Field(default_factory=list)
    ownedAccountId: ObjectIdStr = None

class UserInDB(User):
    id: str = Field(alias="_id")
    disabled: Optional[bool] = False
    username: str
    email: EmailStr
    hashed_password: str
    tokens: int
    teamIds: List[ObjectIdStr] = Field(default_factory=list)
    ownedAccountId: ObjectIdStr = None 
    
    model_config = ConfigDict(
        populate_by_name = True,
        json_encoders={ObjectId: str}
    )

class Token(BaseModel):
    access_token: str
    token_type: str
    
class TokenData(BaseModel):
    username: Optional[str] = None
    
class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    tokens: int = 0
    coupon_code: Optional[str] = None
    ga_client_id: Optional[str] = None

class ContractAccess(BaseModel):
    contract_id: str
    contract_name: str

class UserAccess(BaseModel):
    user_id: str
    contracts: List[ContractAccess] = []

class TeamMember(BaseModel):
    """Represents a member within a team's members list."""
    userId: ObjectIdStr = Field(description="The _id of the user who is a member.")
    username: Optional[str] = Field(None, description="The username of the user who is a member.")
    team_role: Literal['admin', 'member'] = Field(description="Role of the user within this team.")
    addedAt: datetime = Field(default_factory=datetime.utcnow)
    addedBy: ObjectIdStr = Field(description="The _id of the user who added this member.")
    
    model_config = ConfigDict(
        json_encoders={ObjectId: str}
    )

class Team(BaseModel):
    """Base model for Team data."""
    name: str = Field(..., description="Name of the team.")
    creatorId: ObjectIdStr = Field(description="The _id of the user who created the team.")
    members: List[TeamMember] = Field(default_factory=list)
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)
    
    model_config = ConfigDict(
        json_encoders={ObjectId: str}
    )

class TeamInDB(Team):
    """Model representing a Team document stored in MongoDB."""
    id: str = Field(alias="_id")
    
    model_config = ConfigDict(
        populate_by_name = True,
        json_encoders={ObjectId: str}
    )

class TeamBasicInfo(BaseModel):
    """Basic team info, often used in lists."""
    id: str
    name: str

class JobStatus(BaseModel):
    job_id: str
    job_type: str
    contract_id: str
    user_id: str
    status: str  # "pending", "IN_PROGRESS", "COMPLETED", "FAILED"
    message: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class TeamCreateRequest(BaseModel):
    """Request body model for creating a new team."""
    name: str = Field(..., min_length=1, description="The desired name for the new team.")
    contracts: List[ContractAccess] = []

class AccountBase(BaseModel):
    user_id: str
    page_credits: int = 10  # Default 10 credits
    created_at: datetime = datetime.utcnow()
    updated_at: datetime = datetime.utcnow()

class AccountCreate(AccountBase):
    pass

class Account(AccountBase):
    id: str
    
    class Config:
        from_attributes = True


class AccessibleAccountInfo(BaseModel):
    id: str
    name: str
    role: Literal['owner', 'member', 'individual']
    type: Literal['personal', 'team'] = 'personal'


# models for role assignment

class AssignWorkflowRolesRequest(BaseModel):
    # Use Optional[str] - frontend sends string IDs, allow None to clear a role
    editorUserId: Optional[str] = Field(None, description="User ID (string) of the assigned Editor. Null to clear.")
    approverUserId: Optional[str] = Field(None, description="User ID (string) of the assigned Approver. Null to clear.")
    
class RejectContractRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=1000) # Optional reason, limit length


class UpdateMemberRoleRequest(BaseModel):
    new_role: Literal['admin', 'member'] = Field(description="New role to assign to the team member.")


class CreditPurchaseRequest(BaseModel):
    """Model for credit purchase requests"""
    page_quantity: int = Field(..., gt=0, description="Number of pages to purchase")
    payment_method_id: str = Field(..., description="Payment method ID from payment processor")
    context_id: Optional[str] = Field(
        None, 
        description="Team ID if purchasing for a team, or None for personal account"
    )

class CreditPriceTier(BaseModel):
    """Model representing pricing tiers"""
    min_pages: int
    price_per_page: Decimal
    currency: str = "USD"

    
class ReEditRequest(BaseModel):
    """
    Request body for an editor requesting to re-edit a completed contract.
    A reason is mandatory to provide context to the approver.
    """
    reason: str = Field(..., min_length=10, description="The reason for needing to re-edit the contract.")

class DenyReEditRequest(BaseModel):
    """
    Request body for an approver denying a re-edit request.
    A reason is mandatory for the audit trail and for the editor to understand the decision.
    """
    reason: str = Field(..., min_length=10, description="The reason for denying the re-edit request.")


class Project(BaseModel):
    name: str = Field(..., description="Name of the project")
    description: Optional[str] = Field(None, description="Short project description or matter note")
    ownerId: ObjectIdStr = Field(..., description="ID of the user or team owning the project")
    ownerType: Literal["user", "team"] = Field(..., description="Whether the project belongs to a user or team")
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)

    model_config = ConfigDict(json_encoders={ObjectId: str})


class ProjectInDB(Project):
    id: str = Field(alias="_id")
    stats: Optional[dict] = None

    model_config = ConfigDict(
        populate_by_name=True,
        json_encoders={ObjectId: str}
    )


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=500)
    ownerId: Optional[str] = Field(None, description="Optional team/account id. Omit for personal context.")


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=500)


class ModelSettingsUpdate(BaseModel):
    """Team model settings. Deliberately has no API-key field — keys stay in
    server config and are never accepted from a client."""

    provider: Optional[str] = Field(None, max_length=40)
    # provider id -> model name, e.g. {"claude": "claude-opus-5"}
    models: Optional[Dict[str, str]] = None
    temperature: Optional[float] = Field(None, ge=0.0, le=1.0)
    max_tokens: Optional[int] = Field(None, ge=256, le=128000)
    reasoning_effort: Optional[str] = Field(None, max_length=20)
    # Which engine turns an uploaded PDF into text. Validated against the
    # catalog in _sanitize; a field missing here is dropped before it gets
    # there, so the save appears to succeed and the value silently reverts.
    parser: Optional[str] = Field(None, max_length=40)


class ProjectMemoryRelatedDocumentUpdate(BaseModel):
    contract_id: Optional[str] = None
    filename: Optional[str] = None
    relation_type: Optional[str] = Field(None, max_length=40)
    evidence_quote: Optional[str] = Field(None, max_length=300)


class ProjectMemoryOverviewUpdate(BaseModel):
    doc_type: Optional[str] = Field(None, max_length=40)
    parties: Optional[List[str]] = None
    effective_date: Optional[str] = Field(None, max_length=60)
    purpose_summary: Optional[str] = Field(None, max_length=600)
    key_topics: Optional[List[str]] = None
    related_documents: Optional[List[ProjectMemoryRelatedDocumentUpdate]] = None


class ProjectScratchpadUpdate(BaseModel):
    content: str = Field(..., max_length=200_000)


class ScheduleLinkDecision(BaseModel):
    """A person's answer to "are these two the same schedule?"."""
    contract_id: str = Field(..., max_length=64)
    signature: str = Field(..., max_length=64)
    previous_signature: str = Field(..., max_length=64)
    decision: str = Field(..., max_length=16)


class TableClassificationUpdate(BaseModel):
    """A hand-set table label. Validated against the closed category set in the route."""
    contract_id: str = Field(..., max_length=64)
    table_type: str = Field(..., max_length=64)


class ProjectFactSource(BaseModel):
    contract_id: str = Field(..., max_length=64)
    quote: Optional[str] = Field(None, max_length=500)


class ProjectFactCreate(BaseModel):
    text: str = Field(..., max_length=1000)
    # Required for origin="contract" — a fact drawn from a document has to
    # carry the document and quote it came from, so it can be re-verified
    # before it is relied on. Facts the user simply stated use origin="user".
    sources: Optional[List[ProjectFactSource]] = None
    tags: Optional[List[str]] = None
    origin: Optional[str] = Field(None, max_length=20)


class ProjectLightInDB(BaseModel):
    id: str = Field(alias="_id")
    name: str
    ownerId: ObjectIdStr
    ownerType: Literal["user", "team"]
    createdAt: datetime
    updatedAt: datetime
    
    model_config = ConfigDict(
        populate_by_name=True,
        json_encoders={ObjectId: str}
    )

class PaginatedProjects(BaseModel):
    items: List[ProjectInDB]
    total: int

