"""Team model settings — which provider/model the account's agent calls use.

Reads are open to any member (everyone should be able to see which model their
answers came from); writes are admin-only, because the choice applies to every
member and drives the account's token spend.

No endpoint here accepts or returns an API key. `configured` on the catalog is
a boolean derived from server config, which is all the UI needs to grey out a
provider that would fail.
"""

import logging
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException

from core.database import db, teams_collection
from core.security import get_current_active_user
from models.domain import ModelSettingsUpdate, UserInDB
from services.model_settings import (
    ModelSettingsManager,
    catalog_payload,
    reset_active_model_settings,
    resolve_for_team,
    set_active_model_settings,
    team_id_for_user,
)

from services.platform_models import use_platform_org

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/model-settings", tags=["Model Settings"])


def apply_team_model_settings(current_user: UserInDB = Depends(get_current_active_user)):
    """Router-level dependency: publish the caller's team settings for the request.

    Attach to a router and every endpoint under it picks the settings up without
    threading a team id down into the RAG stack. Dependencies resolve before the
    endpoint runs — and before a sync endpoint is handed to the threadpool, which
    copies the context — so the value is visible either way.

    Never raises: failing to load settings degrades to the server defaults rather
    than failing an otherwise-valid request.
    """
    token = None
    org_scope = None
    try:
        resolved = resolve_for_team(db, team_id_for_user(current_user))
        if resolved:
            token = set_active_model_settings(resolved)
        # A platform user's calls run on their org's Admin → AI settings.
        platform_org = getattr(current_user, "platformOrgId", None)
        if platform_org:
            org_scope = use_platform_org(str(platform_org))
            org_scope.__enter__()
        yield resolved
    finally:
        if org_scope is not None:
            org_scope.__exit__(None, None, None)
        if token is not None:
            try:
                reset_active_model_settings(token)
            except ValueError:
                # Set and reset happened in different contexts (sync endpoint run
                # in a threadpool). The copied context dies with the request, so
                # there is nothing left to leak.
                pass


def _resolve_team(current_user: UserInDB, context_id: Optional[str]) -> ObjectId:
    """The team whose settings are being read or written."""
    team_id = context_id or current_user.ownedAccountId
    if not team_id:
        raise HTTPException(status_code=400, detail="No account in scope.")
    if not ObjectId.is_valid(str(team_id)):
        raise HTTPException(status_code=400, detail="Invalid account id.")

    team_id = str(team_id)
    is_owner = current_user.ownedAccountId == team_id
    is_member = team_id in (current_user.teamIds or [])
    if not is_owner and not is_member:
        raise HTTPException(status_code=403, detail="Access denied to this account.")

    team_oid = ObjectId(team_id)
    if not teams_collection.find_one({"_id": team_oid}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Account not found.")
    return team_oid


def _require_admin(current_user: UserInDB, team_oid: ObjectId) -> None:
    """Model choice applies account-wide and drives spend — admins only."""
    if current_user.ownedAccountId == str(team_oid):
        return
    member = teams_collection.find_one(
        {
            "_id": team_oid,
            "members": {"$elemMatch": {"userId": ObjectId(current_user.id), "team_role": "admin"}},
        },
        {"_id": 1},
    )
    if not member:
        raise HTTPException(status_code=403, detail="Only account admins can change model settings.")


@router.get("/catalog")
def get_model_catalog(current_user: UserInDB = Depends(get_current_active_user)):
    """Selectable providers/models plus which providers have a server-side key.

    Never includes key values — only whether each provider is configured, so the
    UI can disable a provider instead of letting a user pick one that 401s.
    """
    return catalog_payload()


@router.get("")
def get_model_settings(
    context_id: Optional[str] = None,
    current_user: UserInDB = Depends(get_current_active_user),
):
    team_oid = _resolve_team(current_user, context_id)
    saved = ModelSettingsManager(db).get_for_team(str(team_oid))
    return {"account_id": str(team_oid), "settings": saved}


@router.put("")
def update_model_settings(
    request: ModelSettingsUpdate,
    context_id: Optional[str] = None,
    current_user: UserInDB = Depends(get_current_active_user),
):
    """Replace the account's model settings.

    The body is a full replacement, not a patch: an omitted field clears back to
    the server default rather than keeping a previously-saved value, so what the
    settings form shows is exactly what the account runs.
    """
    team_oid = _resolve_team(current_user, context_id)
    _require_admin(current_user, team_oid)

    saved = ModelSettingsManager(db).save_for_team(
        str(team_oid), request.model_dump(exclude_none=True)
    )
    logger.info("Model settings updated for account %s by %s", team_oid, current_user.id)
    return {"account_id": str(team_oid), "settings": saved}
