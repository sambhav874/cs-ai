"""One identity across both tiers — merge step 3.

The lifecycle API (Fastify, apps/api) owns login, passwords, orgs and roles, and
issues the access token. This tier never mints one; it verifies that token and
maps the platform identity onto the shapes ContractSense's code already uses.

Why an adapter instead of rewriting the routes
----------------------------------------------
191 routes resolve the user through ``get_current_active_user``, and 71 sites
call ``ObjectId(current_user.id)`` or ``ObjectId(team_id)``. Platform ids are
cuid strings (``cmu6s0r6s0008t03caopvo7j2``) — not valid ObjectIds — so passing
them straight through would 500 every one of those sites.

Instead, each platform id maps to a *deterministic* ObjectId, and a shadow user
and shadow team are kept at those ids:

    platform user  (cuid)  ->  users/<ObjectId>   username = email, no password
    platform org   (cuid)  ->  teams/<ObjectId>   one team per org

ContractSense already models a paid account AS a team document
(``{name, creatorId, members: [{userId, team_role}]}``), so one org maps to one
team, org ADMINs become team admins and account owners, and everyone else is a
member. The existing access check — ``teamIds`` / ``ownedAccountId`` /
``members.userId`` — then gives tenant isolation unchanged: an org-A user holds
only org A's team id.

The platform stays the single source of truth. Shadows carry no usable
password and are re-synced from the platform on use, so a role change or a
deactivation propagates within ``_CACHE_TTL_SECONDS``.

TODO(merge): collapse the shadows once ContractSense's collections move to
platform-owned ids; this module is the only place that should need to change.
"""
from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import jwt as pyjwt
from bson import ObjectId
from pymongo import MongoClient

from core.config import settings

logger = logging.getLogger(__name__)

PLATFORM_ADMIN_ROLES = frozenset({"ADMIN"})
_CACHE_TTL_SECONDS = 60


class PlatformIdentityError(Exception):
    """The token verified, but it does not resolve to a usable platform user."""


# ── Ids ────────────────────────────────────────────────────────────────────────

def derive_object_id(namespace: str, platform_id: str) -> ObjectId:
    """A stable ObjectId for a platform id.

    Namespaced so a user and an org sharing an id string can never collide.
    96 bits of SHA-256: collisions are not a practical concern at any realistic
    tenant count.
    """
    digest = hashlib.sha256(f"{namespace}:{platform_id}".encode("utf-8")).hexdigest()
    return ObjectId(digest[:24])


# ── Token ──────────────────────────────────────────────────────────────────────

def _platform_secret() -> str:
    return settings.platform_jwt_secret or os.getenv("JWT_SECRET", "")


def decode_platform_access_token(token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Verify a Fastify-issued ACCESS token. Returns claims, or None.

    None means "not a platform access token" — the caller decides whether to try
    the legacy path. It is returned for a bad signature, expiry, a missing
    claim, and for a REFRESH token: refresh tokens are signed with the same
    secret, so without the type check a stolen 7-day refresh token would work
    as an access token here.
    """
    secret = _platform_secret()
    if not secret or not token:
        return None
    try:
        claims = pyjwt.decode(
            token,
            secret,
            algorithms=["HS256"],  # pinned: never let the token choose, e.g. "none"
            options={"require": ["exp", "sub"]},
        )
    except pyjwt.PyJWTError:
        return None
    if claims.get("type") != "access" or not claims.get("orgId"):
        return None
    return claims


# ── Platform store ─────────────────────────────────────────────────────────────

_platform_client: Optional[MongoClient] = None
_client_lock = threading.Lock()


def _platform_db():
    global _platform_client
    url = settings.platform_database_url or os.getenv("DATABASE_URL", "")
    if not url:
        raise PlatformIdentityError(
            "No platform database: set PLATFORM_DATABASE_URL or DATABASE_URL "
            "(the lifecycle API's MongoDB)."
        )
    with _client_lock:
        if _platform_client is None:
            _platform_client = MongoClient(url)
    return _platform_client.get_default_database()


# ── Resolution ─────────────────────────────────────────────────────────────────

_cache: Dict[Tuple[str, str, Tuple[str, ...]], Tuple[float, Dict[str, Any]]] = {}
_cache_lock = threading.Lock()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sync_shadow_team(teams, org_oid: ObjectId, org_name: str, platform_org_id: str,
                      user_oid: ObjectId, is_admin: bool) -> None:
    now = _now()
    teams.update_one(
        {"_id": org_oid},
        {
            "$set": {"name": org_name, "platformOrgId": platform_org_id, "updatedAt": now},
            "$setOnInsert": {"creatorId": user_oid, "createdAt": now, "members": []},
        },
        upsert=True,
    )
    role = "admin" if is_admin else "member"
    # Update the role in place if the member exists ...
    updated = teams.update_one(
        {"_id": org_oid, "members.userId": user_oid},
        {"$set": {"members.$.team_role": role}},
    )
    if updated.matched_count == 0:
        # ... otherwise add them. The $ne guard makes this safe under concurrent
        # first requests: only one push can match.
        teams.update_one(
            {"_id": org_oid, "members.userId": {"$ne": user_oid}},
            {"$push": {"members": {"userId": user_oid, "team_role": role,
                                   "addedAt": now, "addedBy": user_oid}}},
        )


def _sync_shadow_user(users, user_oid: ObjectId, org_oid: ObjectId, email: str,
                      platform_user_id: str, platform_org_id: str,
                      is_admin: bool, disabled: bool) -> Dict[str, Any]:
    now = _now()
    fields = {
        "username": email,
        "email": email,
        # Not a hash of anything: no password can verify against it, so a shadow
        # can never log in through the legacy path.
        "hashed_password": "!",
        "teamIds": [org_oid],
        # ContractSense grants account-owner rights to whoever holds
        # ownedAccountId == team id. Platform ADMINs are that owner.
        "ownedAccountId": org_oid if is_admin else None,
        "disabled": disabled,
        "platformUserId": platform_user_id,
        "platformOrgId": platform_org_id,
        "source": "platform",
        "updatedAt": now,
    }
    users.update_one(
        {"_id": user_oid},
        {"$set": fields, "$setOnInsert": {"tokens": 0, "createdAt": now}},
        upsert=True,
    )
    return {**fields, "_id": str(user_oid), "tokens": 0,
            "teamIds": [str(org_oid)],
            "ownedAccountId": str(org_oid) if is_admin else None}


def resolve_platform_user(claims: Dict[str, Any], *, users=None, teams=None,
                          platform_db=None) -> Dict[str, Any]:
    """Map verified platform claims to a ContractSense user document.

    Returns a dict shaped for ``UserInDB.model_validate``. Raises
    PlatformIdentityError when the platform does not recognise the user, the
    user was deleted, or the token's org is not the user's org.
    """
    platform_user_id = str(claims["sub"])
    platform_org_id = str(claims["orgId"])
    roles = tuple(sorted(str(r) for r in (claims.get("roles") or [])))

    key = (platform_user_id, platform_org_id, roles)
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < _CACHE_TTL_SECONDS:
            return dict(hit[1])

    if users is None or teams is None:
        from core.database import teams_collection, users_collection
        users = users if users is not None else users_collection
        teams = teams if teams is not None else teams_collection
    pdb = platform_db if platform_db is not None else _platform_db()

    platform_user = pdb["users"].find_one(
        {"_id": platform_user_id},
        {"email": 1, "orgId": 1, "status": 1, "deletedAt": 1},
    )
    if not platform_user:
        raise PlatformIdentityError("token subject is not a platform user")
    if platform_user.get("deletedAt") is not None:
        raise PlatformIdentityError("platform user is deleted")
    # The token names an org; the user must actually belong to it. Without this
    # a token minted for one org could be replayed against another's data here.
    if platform_user.get("orgId") != platform_org_id:
        raise PlatformIdentityError("token org does not match the user's org")

    org = pdb["organizations"].find_one({"_id": platform_org_id}, {"name": 1}) or {}
    user_oid = derive_object_id("user", platform_user_id)
    org_oid = derive_object_id("org", platform_org_id)
    is_admin = bool(PLATFORM_ADMIN_ROLES.intersection(roles))
    disabled = platform_user.get("status") == "DEACTIVATED"

    _sync_shadow_team(teams, org_oid, org.get("name") or "Organization",
                      platform_org_id, user_oid, is_admin)
    doc = _sync_shadow_user(users, user_oid, org_oid, platform_user["email"],
                            platform_user_id, platform_org_id, is_admin, disabled)

    with _cache_lock:
        _cache[key] = (time.monotonic(), dict(doc))
    return doc


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
