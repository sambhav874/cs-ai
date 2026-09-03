"""Personas, and the privileges a member effectively holds.

A persona is a named bundle of privileges an account owner edits. A member holds
one persona plus grants and revokes for the exceptions every real team has;
grants can expire, because temporary authority that needs someone to remember to
revoke it quietly becomes permanent.

    effective = persona.privileges + grants - revokes

Seeding derives a persona from the member's existing ``team_role``, so switching
this on moves nobody's access.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from bson import ObjectId

from core.privileges import (
    ALL_PRIVILEGES,
    DEFAULT_PERSONAS,
    ROLE_PRIVILEGE_REQUIRED,
    TEAM_ROLE_TO_PERSONA,
)

logger = logging.getLogger(__name__)


def naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Drop the timezone from an incoming timestamp, keeping the instant.

    Clients send ISO strings ending in Z, which parse as timezone-aware, while
    everything stored and compared here is naive UTC. Comparing the two raises
    TypeError, so an expiry date turned a grant into a 500.
    """
    if value is None or value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _oid(value: Any) -> Optional[ObjectId]:
    """Role and member ids arrive as ObjectIds from Mongo and as strings from
    the response cache; treating a cached string as "nobody" silently unassigns
    people."""
    if isinstance(value, ObjectId):
        return value
    if isinstance(value, str) and ObjectId.is_valid(value):
        return ObjectId(value)
    return None


def _active_grants(member: Dict[str, Any], now: datetime) -> Set[str]:
    granted: Set[str] = set()
    for grant in member.get("grants") or []:
        privilege = grant.get("privilege")
        if not privilege or grant.get("revokedAt"):
            continue
        until = grant.get("until")
        if until is not None and until <= now:
            continue
        granted.add(str(privilege))
    return granted


def find_member(team: Optional[Dict[str, Any]], user_id: Any) -> Optional[Dict[str, Any]]:
    user_oid = _oid(user_id)
    if not team or user_oid is None:
        return None
    for member in team.get("members") or []:
        if _oid(member.get("userId")) == user_oid:
            return member
    return None


def persona_for_member(
    member: Optional[Dict[str, Any]],
    personas_by_id: Dict[Any, Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    if not member:
        return None
    persona_id = _oid(member.get("personaId"))
    if persona_id is not None and persona_id in personas_by_id:
        return personas_by_id[persona_id]
    # No persona assigned yet — fall back to what the member's team_role implies,
    # so an account that has not been seeded still resolves sensibly.
    fallback_name = TEAM_ROLE_TO_PERSONA.get(str(member.get("team_role") or "member"))
    for persona in personas_by_id.values():
        if persona.get("name") == fallback_name:
            return persona
    return None


def effective_privileges(
    *,
    team: Optional[Dict[str, Any]],
    user_id: Any,
    personas: Optional[List[Dict[str, Any]]] = None,
    now: Optional[datetime] = None,
) -> Set[str]:
    """Everything this member may do in this account."""
    member = find_member(team, user_id)
    if member is None:
        return set()

    moment = now or datetime.utcnow()
    personas_by_id = {p["_id"]: p for p in (personas or []) if p.get("_id") is not None}
    persona = persona_for_member(member, personas_by_id)

    held: Set[str] = set(persona.get("privileges") or []) if persona else set()
    held |= _active_grants(member, moment)
    held -= {str(revoked) for revoked in (member.get("revokes") or [])}
    return {privilege for privilege in held if privilege in ALL_PRIVILEGES}


def can_hold_workflow_role(privileges: Set[str], role: str) -> bool:
    """Eligibility: a workflow role allocates work to someone who can do it.

    Assignment used to be trusted on its own, so anyone in the account could be
    named Approver whether or not they could approve anything.
    """
    required = ROLE_PRIVILEGE_REQUIRED.get(role)
    return required is None or required in privileges


def seed_account_personas(
    *,
    team: Dict[str, Any],
    personas_collection: Any,
    teams_collection: Any,
) -> List[Dict[str, Any]]:
    """Give an account the shipped personas and put every member on one.

    Idempotent, and derived from ``team_role``, so running it changes no one's
    access. New personas are only created for names the account lacks.
    """
    account_id = team["_id"]
    existing = list(personas_collection.find({"accountId": account_id}))
    by_name = {persona.get("name"): persona for persona in existing}
    now = datetime.utcnow()

    for name, privileges in DEFAULT_PERSONAS.items():
        if name in by_name:
            continue
        document = {
            "accountId": account_id,
            "name": name,
            "privileges": list(privileges),
            "isSystem": True,
            "createdAt": now,
            "updatedAt": now,
        }
        result = personas_collection.insert_one(document)
        document["_id"] = result.inserted_id
        by_name[name] = document

    updates = {}
    for index, member in enumerate(team.get("members") or []):
        if member.get("personaId"):
            continue
        persona_name = TEAM_ROLE_TO_PERSONA.get(str(member.get("team_role") or "member"))
        persona = by_name.get(persona_name)
        if persona:
            updates[f"members.{index}.personaId"] = persona["_id"]

    if updates:
        teams_collection.update_one({"_id": account_id}, {"$set": updates})
        logger.info("Seeded personas for %d member(s) of account %s", len(updates), account_id)

    return list(by_name.values())
