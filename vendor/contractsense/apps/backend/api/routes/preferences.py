"""Personal agent-answer preferences: practice area, jurisdiction, citation
style, verbosity.

Unlike model settings these carry no cost and apply to one person, so reads
and writes are both self-service — no admin gate, no team resolution.
"""

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from core.database import db
from core.security import get_current_active_user
from models.domain import UserInDB
from services.memory.preferences import UserPreferencesManager

router = APIRouter(prefix="/preferences", tags=["User Preferences"])


class UserPreferencesUpdate(BaseModel):
    practice_area: str = Field(default="", max_length=200)
    jurisdiction: str = Field(default="", max_length=200)
    citation_style: str = Field(default="", max_length=200)
    verbosity: str = Field(default="", max_length=200)


def _org_id(current_user: UserInDB) -> Optional[str]:
    owned = current_user.ownedAccountId
    if owned:
        return str(owned)
    team_ids = current_user.teamIds or []
    return str(team_ids[0]) if team_ids else None


@router.get("")
def get_preferences(current_user: UserInDB = Depends(get_current_active_user)):
    values = UserPreferencesManager(db).get(str(current_user.id), _org_id(current_user))
    return {"preferences": values}


@router.put("")
def update_preferences(
    request: UserPreferencesUpdate,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Full replacement, matching model settings: an omitted field clears back
    to unset rather than keeping a stale saved value."""
    saved = UserPreferencesManager(db).save(
        str(current_user.id), _org_id(current_user), request.model_dump()
    )
    return {"preferences": saved}
