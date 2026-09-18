from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any, Union, Literal 
from datetime import datetime
from bson import ObjectId
class CitationDetails(BaseModel):
    text: str = Field(default="", description="The exact text from the citation")
    start_index: int = Field(default=0, description="Starting index of the citation in the source document")
    end_index: int = Field(default=0, description="Ending index of the citation in the source document")
    source: str = Field(default="", description="Source file path of the citation")

class QuestionAnswer(BaseModel):
    question: str = Field(default="", description="The question being asked.")
    answer: str = Field(default="", description="The detailed answer to the question.")
    confidence: Literal["high", "medium", "low"] = Field(
        default="low",
        description="Confidence level in the answer's accuracy"
    )
    citation: str = Field(default="", description="The page number or reference from which the answer was extracted.")
    reason: str = Field(default="", description="The reasoning or justification for the answer.")
    citation_details: Dict[str, Any] = Field(
        default_factory=dict,
        description="Detailed information about the citation source, text, and position"
    )
    is_edited: bool = Field(default=False, description="Flag indicating if the answer was manually edited.")
    edited_by_user_id: Optional[str] = Field(default=None, description="ID of the user who last edited this answer.")
    edited_at_timestamp: Optional[datetime] = Field(default=None, description="Timestamp of the last edit to this answer.")
    edited_by_user_name: Optional[str] = Field(default=None, description="Name of the user who last edited.")
    edited_reason: Optional[str] = Field(None, description="The justification provided by the editor for their change.")
    validation_override: Optional[bool] = Field(False, description="True if the editor saved the draft despite a validation failure.")
    
    model_config = ConfigDict(extra='allow')

class QuestionCategory(BaseModel):
    id: ObjectId = Field(default=None, alias="_id")
    name: str
    questions: List[str] 
    owner_id: ObjectId = Field(default=None)
    owner_type: Optional[str] = Field(default=None)
    user_id: Optional[ObjectId] = Field(default=None, alias="user_id")

    model_config = ConfigDict(
        populate_by_name=True,
        json_encoders={ObjectId: str},
        arbitrary_types_allowed=True,
        extra='ignore'
    )
