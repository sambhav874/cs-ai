"""Personas: the bundles of privileges an account owner configures.

Managing these needs ``account.personas``, which by default only the Owner
persona carries. Everything here writes an audit entry — who may do what is
exactly the history a security review asks to see.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import personas_collection, teams_collection, users_collection
from core.privileges import ALL_PRIVILEGES, PRIVILEGE_LABELS, ACCOUNT_PERSONAS
from core.security import get_current_active_user
from models.domain import (
    AssignPersonaRequest,
    GrantPrivilegeRequest,
    PersonaCreateRequest,
    PersonaUpdateRequest,
    UserInDB,
)
from api.dependencies import account_id_for_context, privileges_for
from services.personas import effective_privileges, seed_account_personas
from utils.audit_logger import create_audit_log

logger = logging.getLogger(__name__)

personas_router = APIRouter()


def _account_and_privileges(current_user: UserInDB, context_id: Optional[str]):
    account_oid = account_id_for_context(current_user, context_id)
    if account_oid is None:
        raise HTTPException(
            status_code=400,
            detail="Personas belong to a team account. Switch to a team to manage them.",
        )
    return account_oid, privileges_for(current_user, account_oid)


def _require(privileges: set, needed: str) -> None:
    if needed not in privileges:
        raise HTTPException(status_code=403, detail=f"Your persona does not include: {needed}")


def _serialize(persona: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(persona["_id"]),
        "name": persona.get("name"),
        "privileges": persona.get("privileges") or [],
        "isSystem": bool(persona.get("isSystem")),
        "updatedAt": persona.get("updatedAt"),
    }


def _clean_privileges(requested: List[str]) -> List[str]:
    """Drop anything not in the catalog rather than storing a typo that will
    never match a check."""
    unknown = [p for p in requested if p not in ALL_PRIVILEGES]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown privileges: {', '.join(sorted(unknown))}")
    # Preserve catalog order so two personas with the same set look the same.
    return [p for p in ALL_PRIVILEGES if p in set(requested)]


@personas_router.get("/privileges")
def list_privileges(current_user: UserInDB = Depends(get_current_active_user)) -> Dict[str, Any]:
    """The catalog, with the wording the persona editor shows."""
    return {
        "privileges": [
            {"privilege": privilege, "label": PRIVILEGE_LABELS.get(privilege, privilege)}
            for privilege in ALL_PRIVILEGES
        ]
    }


@personas_router.get("/accounts/{account_id}/personas")
def list_personas(
    account_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Every persona in the account, and what the caller themselves holds."""
    if not ObjectId.is_valid(account_id):
        raise HTTPException(status_code=400, detail="Invalid account id.")
    account_oid = ObjectId(account_id)

    team = teams_collection.find_one({"_id": account_oid})
    if not team:
        raise HTTPException(status_code=404, detail="Account not found.")
    if not any(str(m.get("userId")) == str(current_user.id) for m in team.get("members") or []):
        raise HTTPException(status_code=403, detail="Access denied to this account.")

    # First read of an account seeds the shipped personas and puts every member
    # on one derived from their team_role — nobody's access moves.
    personas = seed_account_personas(
        team=team,
        personas_collection=personas_collection,
        teams_collection=teams_collection,
    )
    team = teams_collection.find_one({"_id": account_oid})

    member_oids = [m.get("userId") for m in team.get("members") or [] if isinstance(m.get("userId"), ObjectId)]
    names = {
        str(user["_id"]): user.get("username")
        for user in users_collection.find({"_id": {"$in": member_oids}}, {"username": 1})
    } if member_oids else {}

    personas_by_id = {str(p["_id"]): p for p in personas}
    members = []
    for member in team.get("members") or []:
        user_id = str(member.get("userId"))
        persona = personas_by_id.get(str(member.get("personaId")))
        members.append({
            "userId": user_id,
            "username": names.get(user_id),
            "personaId": str(member["personaId"]) if member.get("personaId") else None,
            "personaName": persona.get("name") if persona else None,
            "grants": [
                {
                    "privilege": grant.get("privilege"),
                    "until": grant.get("until"),
                    "reason": grant.get("reason"),
                }
                for grant in (member.get("grants") or [])
                if not grant.get("revokedAt")
            ],
        })

    return {
        "personas": [_serialize(persona) for persona in personas],
        "members": members,
        "myPrivileges": sorted(
            effective_privileges(team=team, user_id=current_user.id, personas=personas)
        ),
    }


@personas_router.post("/accounts/{account_id}/personas")
async def create_persona(
    account_id: str,
    request: PersonaCreateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    account_oid, privileges = _account_and_privileges(current_user, account_id)
    _require(privileges, ACCOUNT_PERSONAS)

    if personas_collection.find_one({"accountId": account_oid, "name": request.name.strip()}):
        raise HTTPException(status_code=400, detail="A persona with that name already exists.")

    now = datetime.utcnow()
    document = {
        "accountId": account_oid,
        "name": request.name.strip(),
        "privileges": _clean_privileges(request.privileges),
        "isSystem": False,
        "createdAt": now,
        "updatedAt": now,
    }
    document["_id"] = personas_collection.insert_one(document).inserted_id

    await create_audit_log(
        user=current_user,
        action="PERSONA_CREATED",
        account_id_override=account_oid,
        details={"personaName": document["name"], "privileges": document["privileges"]},
    )
    return _serialize(document)


@personas_router.patch("/accounts/{account_id}/personas/{persona_id}")
async def update_persona(
    account_id: str,
    persona_id: str,
    request: PersonaUpdateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    account_oid, privileges = _account_and_privileges(current_user, account_id)
    _require(privileges, ACCOUNT_PERSONAS)

    if not ObjectId.is_valid(persona_id):
        raise HTTPException(status_code=400, detail="Invalid persona id.")
    persona = personas_collection.find_one({"_id": ObjectId(persona_id), "accountId": account_oid})
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found.")

    updates: Dict[str, Any] = {"updatedAt": datetime.utcnow()}
    if request.name is not None:
        updates["name"] = request.name.strip()
    if request.privileges is not None:
        updates["privileges"] = _clean_privileges(request.privileges)

    # Editing the Owner bundle down to nothing would lock the account out of its
    # own settings, and no support call fixes that from inside the product.
    if persona.get("name") == "Owner" and "privileges" in updates:
        if ACCOUNT_PERSONAS not in updates["privileges"]:
            raise HTTPException(
                status_code=400,
                detail="The Owner persona has to keep 'Create and edit personas', or nobody can change these again.",
            )

    personas_collection.update_one({"_id": persona["_id"]}, {"$set": updates})

    await create_audit_log(
        user=current_user,
        action="PERSONA_UPDATED",
        account_id_override=account_oid,
        details={
            "personaName": updates.get("name", persona.get("name")),
            "oldPrivileges": persona.get("privileges") or [],
            "newPrivileges": updates.get("privileges", persona.get("privileges") or []),
        },
    )
    return _serialize({**persona, **updates})


@personas_router.delete("/accounts/{account_id}/personas/{persona_id}")
async def delete_persona(
    account_id: str,
    persona_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    account_oid, privileges = _account_and_privileges(current_user, account_id)
    _require(privileges, ACCOUNT_PERSONAS)

    if not ObjectId.is_valid(persona_id):
        raise HTTPException(status_code=400, detail="Invalid persona id.")
    persona_oid = ObjectId(persona_id)
    persona = personas_collection.find_one({"_id": persona_oid, "accountId": account_oid})
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found.")
    if persona.get("isSystem"):
        raise HTTPException(status_code=400, detail="A shipped persona cannot be deleted. Edit it instead.")

    holders = teams_collection.count_documents({"_id": account_oid, "members.personaId": persona_oid})
    if holders:
        raise HTTPException(
            status_code=400,
            detail="Someone still holds this persona. Move them to another one first.",
        )

    personas_collection.delete_one({"_id": persona_oid})
    await create_audit_log(
        user=current_user,
        action="PERSONA_DELETED",
        account_id_override=account_oid,
        details={"personaName": persona.get("name")},
    )
    return {"message": "Persona deleted."}


@personas_router.put("/accounts/{account_id}/members/{user_id}/persona")
async def assign_persona(
    account_id: str,
    user_id: str,
    request: AssignPersonaRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    account_oid, privileges = _account_and_privileges(current_user, account_id)
    _require(privileges, ACCOUNT_PERSONAS)

    if not (ObjectId.is_valid(user_id) and ObjectId.is_valid(request.personaId)):
        raise HTTPException(status_code=400, detail="Invalid id.")
    persona = personas_collection.find_one(
        {"_id": ObjectId(request.personaId), "accountId": account_oid}
    )
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found.")

    result = teams_collection.update_one(
        {"_id": account_oid, "members.userId": ObjectId(user_id)},
        {"$set": {"members.$.personaId": persona["_id"]}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="That member is not in this account.")

    await create_audit_log(
        user=current_user,
        action="MEMBER_PERSONA_ASSIGNED",
        account_id_override=account_oid,
        details={"memberUserId": user_id, "personaName": persona.get("name")},
    )
    return {"message": f"Persona set to {persona.get('name')}."}


@personas_router.post("/accounts/{account_id}/members/{user_id}/grants")
async def grant_privilege(
    account_id: str,
    user_id: str,
    request: GrantPrivilegeRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """One privilege, one person, outside their persona — with an expiry."""
    account_oid, privileges = _account_and_privileges(current_user, account_id)
    _require(privileges, ACCOUNT_PERSONAS)

    if request.privilege not in ALL_PRIVILEGES:
        raise HTTPException(status_code=400, detail=f"Unknown privilege: {request.privilege}")
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user id.")
    if request.until is not None and request.until <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="That expiry is already in the past.")

    grant = {
        "_id": ObjectId(),
        "privilege": request.privilege,
        "until": request.until,
        "reason": request.reason,
        "grantedBy": ObjectId(current_user.id),
        "grantedAt": datetime.utcnow(),
        "revokedAt": None,
    }
    result = teams_collection.update_one(
        {"_id": account_oid, "members.userId": ObjectId(user_id)},
        {"$push": {"members.$.grants": grant}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="That member is not in this account.")

    await create_audit_log(
        user=current_user,
        action="PRIVILEGE_GRANTED",
        account_id_override=account_oid,
        details={
            "memberUserId": user_id,
            "privilege": request.privilege,
            "until": request.until.isoformat() if request.until else None,
            "reason": request.reason,
        },
    )
    return {"message": "Granted.", "id": str(grant["_id"])}


@personas_router.delete("/accounts/{account_id}/members/{user_id}/grants/{grant_id}")
async def revoke_grant(
    account_id: str,
    user_id: str,
    grant_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    account_oid, privileges = _account_and_privileges(current_user, account_id)
    _require(privileges, ACCOUNT_PERSONAS)

    if not (ObjectId.is_valid(user_id) and ObjectId.is_valid(grant_id)):
        raise HTTPException(status_code=400, detail="Invalid id.")

    result = teams_collection.update_one(
        {"_id": account_oid, "members.userId": ObjectId(user_id)},
        {"$set": {"members.$[member].grants.$[grant].revokedAt": datetime.utcnow()}},
        array_filters=[
            {"member.userId": ObjectId(user_id)},
            {"grant._id": ObjectId(grant_id)},
        ],
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Grant not found.")

    await create_audit_log(
        user=current_user,
        action="PRIVILEGE_GRANT_REVOKED",
        account_id_override=account_oid,
        details={"memberUserId": user_id, "grantId": grant_id},
    )
    return {"message": "Revoked."}


@personas_router.get("/accounts/{account_id}/access-review")
def access_review(
    account_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Who holds what, for the question every security review asks.

    Grouped by privilege rather than by person, because the question is "who can
    approve here", not "what can Rob do".
    """
    account_oid, privileges = _account_and_privileges(current_user, account_id)
    _require(privileges, ACCOUNT_PERSONAS)

    team = teams_collection.find_one({"_id": account_oid})
    if not team:
        raise HTTPException(status_code=404, detail="Account not found.")
    personas = list(personas_collection.find({"accountId": account_oid}))

    member_oids = [m.get("userId") for m in team.get("members") or [] if isinstance(m.get("userId"), ObjectId)]
    names = {
        str(user["_id"]): user.get("username")
        for user in users_collection.find({"_id": {"$in": member_oids}}, {"username": 1})
    } if member_oids else {}

    holders: Dict[str, List[Dict[str, Any]]] = {privilege: [] for privilege in ALL_PRIVILEGES}
    outstanding_grants: List[Dict[str, Any]] = []
    now = datetime.utcnow()

    for member in team.get("members") or []:
        user_id = str(member.get("userId"))
        held = effective_privileges(
            team=team, user_id=member.get("userId"), personas=personas, now=now
        )
        for privilege in held:
            holders[privilege].append({"userId": user_id, "username": names.get(user_id)})
        for grant in member.get("grants") or []:
            if grant.get("revokedAt"):
                continue
            until = grant.get("until")
            if until is not None and until <= now:
                continue
            outstanding_grants.append({
                "userId": user_id,
                "username": names.get(user_id),
                "privilege": grant.get("privilege"),
                "until": until,
                "reason": grant.get("reason"),
            })

    return {
        "holders": {
            privilege: {
                "label": PRIVILEGE_LABELS.get(privilege, privilege),
                "members": people,
            }
            for privilege, people in holders.items()
        },
        "outstandingGrants": outstanding_grants,
    }
