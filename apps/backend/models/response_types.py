from pydantic import BaseModel, Field, ConfigDict, BeforeValidator , validator
from typing import Dict, List, Union, Optional, Any, Annotated, Literal
from datetime import datetime
from bson import ObjectId
from models.contract_types import QuestionAnswer
from models.contract_types import QuestionCategory


def convert_objectid_to_str(v):
    if isinstance(v, ObjectId): return str(v)
    if v is None: return None
    if isinstance(v, str): return v # Allow strings too
    # Optionally raise error for other types if needed
    return v # Or return as is if other types are expected

ObjectIdStr = Annotated[Optional[str], BeforeValidator(convert_objectid_to_str)]


class Category(BaseModel):
    name: str
    questions: List[str]



class ReportInfo(BaseModel):
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    generated_by: str
    report_content: Dict[str, Any]
    questions_answers: List[Dict[str, Any]]  # Original Q&A used to generate report
    is_draft: bool = Field(default=True, description="Whether the report is a draft (not from a completed contract)")

# The third level response
class ContractAnalysis(BaseModel):
    model_config = ConfigDict(
        extra='allow',
        validate_assignment=True
    )
    version: int = Field(default=1)
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    contract_name: Optional[str] = Field(default="")
    results: List[QuestionAnswer] = Field(
        default_factory=list,
        description="List of question answers with confidence scores"
    )
    report_info: Optional[ReportInfo] = None


class IndexResponse(BaseModel):
    status: str
    contract_name: Optional[str] = None
    content: Optional[str] = None
    html_content: Optional[str] = None
    message: Optional[str] = None
    job_id: Optional[str] = None


class LastSaveResponse(BaseModel):
    savedAt: datetime
    data: ContractAnalysis = Field(
        description="Includes confidence scores in analysis results"
    )

class ContractActionRequest(BaseModel):
    contract_id: str = Field(..., description="The unique identifier of the target contract.")

class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    progress: int = Field(default=0)
    current_step: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

# The second level
class ProcessResponse(BaseModel):
    status: str = Field(default="success")
    contract_name: Optional[str] = None
    results: List[ContractAnalysis] = Field(
        default_factory=list,
        description="Analyses with confidence-annotated results"
    )
    dynamic_results: List[Any] = Field(default_factory=list)
    lastSave: Optional[LastSaveResponse] = None
    process: Optional["ProcessResponse"] = None
    think: Optional[str] = None
    job_id: Optional[str] = None

class WorkflowRoles(BaseModel):
    editorUserId: ObjectIdStr = None # Use ObjectIdStr if storing strings, or ObjectIdStr if handled by encoders
    approverUserId: ObjectIdStr = None

class ReEditRequestInfo(BaseModel):
    requestedByUserId: ObjectIdStr
    reason: str
    requestedAt: datetime
    denialReason: Optional[str] = None
    reviewedByUserId: Optional[ObjectIdStr] = None
    reviewedAt: Optional[datetime] = None
    
    model_config = ConfigDict(
        populate_by_name = True,
        json_encoders={ObjectId: str}
    )


# The top most response
class ContractResponse(BaseModel):
    id: str= Field(..., alias = "_id",description="The ID of the contract to display")
    status: str
    workflowRoles: Optional[WorkflowRoles] = None
    submittedBy: ObjectIdStr = None
    approvedOrRejectedBy: ObjectIdStr = None
    reEditRequest: Optional[ReEditRequestInfo] = None
    rejectedReason: Optional[str] = None
    contract_name: str
    uploaded_by: ObjectIdStr
    uploaded_by_name: Optional[str] = None
    uploaded_at: datetime
    ownerType: Optional[Literal['user', 'team']] = None 
    ownerId: ObjectIdStr = None 
    projectId: ObjectIdStr = None
    index: IndexResponse
    process: ProcessResponse = Field(description="Contains confidence-annotated processing results")

    model_config = ConfigDict(
        populate_by_name=True,
        json_encoders={
            ObjectId: lambda oid: str(oid)
        },
        arbitrary_types_allowed=True
    )

# Request bodies
class IndexRequest(BaseModel):
    # file_name: str
    contract_id: str= Field(..., description="The ID of the contract to index")
    context_id: Optional[str] = None  


class ProcessRequest(BaseModel):
    contract_id: str
    questions: Optional[List[str]] = None
    categories: Optional[List[QuestionCategory]] = None
    context_id: Optional[str] = None    
    ai_provider: Optional[str] = Field(None, description="The AI provider to use for processing (e.g., 'groq', 'openai', 'auto').")


class CustomQuestionRequest(BaseModel):
    #file_name: str
    contract_id: str = Field(..., description="The ID of the contract to process")
    questions: List[str]


class ProcessAllRequest(BaseModel):
    contract_name: str
    use_existing_questions: bool = Field(
        default=True,
        description="Whether to use existing questions or custom questions."
    )
    custom_questions: Optional[List[str]] = Field(
        default=None,
        description="List of custom questions if use_existing_questions is False."
    )


class ProcessEditRequest(BaseModel):
    results: List[ContractAnalysis]


class DraftSaveRequest(BaseModel):
    results: List[Dict[str, Any]]
    categories: Optional[List[Dict]] = None
    report_info: Optional[Dict[str, Any]] = None

class DraftSubmitRequest(BaseModel):
    results: List[Dict[str, Any]]





# Fix circular reference
ProcessResponse.model_rebuild()
