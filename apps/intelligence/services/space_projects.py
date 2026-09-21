"""A Space's intelligence half.

A Space is one thing to a user. The lifecycle API owns it — name, status,
owner, counterparty, who may see it — in the platform's `spaces` collection.
This tier owns what it learns about that Space: project memory, the deal
family, KPIs, tables and the timeline. The two are joined by `spaceId` on the
projects document, and that document is created the first time anything here
needs it.

Nothing calls across tiers on the write path: creating a Space never waits on
this service. See the Spaces tab of the build plan.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)


class SpaceAccessError(Exception):
    """The Space does not exist, is deleted, or belongs to another org."""


class SpaceClosedError(Exception):
    """The Space is closed or archived, so its record is read-only."""


# A closed Space is a finished piece of work. Its history stays readable, but
# nothing new is recorded against it: no memory, no re-extraction, no uploads.
# Obligations and renewal alerts on its contracts keep running — closing the
# file should not silence a live obligation.
CLOSED_STATUSES = frozenset({"CLOSED", "ARCHIVED"})


def space_write_block(project) -> str | None:
    """Why this project cannot be written to, or None when it can."""
    if not project or not project.get("spaceId"):
        return None
    if project.get("spaceDeleted"):
        return "This Space has been deleted."
    status = (project.get("spaceStatus") or "OPEN").upper()
    if status in CLOSED_STATUSES:
        return f"This Space is {status.lower()}. Reopen it to make changes."
    return None


def assert_space_writable(project) -> None:
    reason = space_write_block(project)
    if reason:
        raise SpaceClosedError(reason)


def _team_org_id(teams, team_id: str) -> Optional[str]:
    team = teams.find_one({"_id": ObjectId(team_id)}, {"platformOrgId": 1})
    return (team or {}).get("platformOrgId")


def resolve_space_project(
    space_id: str,
    current_user,
    *,
    projects,
    teams,
    platform_db,
) -> Dict[str, Any]:
    """The projects document for a Space, created on first use.

    Raises SpaceAccessError unless the Space exists, is not deleted, and
    belongs to the organisation the caller signed in to.
    """
    team_id = (current_user.teamIds or [None])[0]
    if not team_id:
        raise SpaceAccessError("user belongs to no organisation")

    org_id = _team_org_id(teams, str(team_id))
    if not org_id:
        raise SpaceAccessError("organisation is not a platform organisation")

    space = platform_db["spaces"].find_one(
        {"_id": space_id},
        {"name": 1, "description": 1, "orgId": 1, "deletedAt": 1, "status": 1},
    )
    if not space:
        raise SpaceAccessError("no such Space")
    if space.get("deletedAt") is not None:
        raise SpaceAccessError("Space is deleted")
    # The Space must belong to the org this session is in. Without this an id
    # from another org would create a project here and leak its name.
    if space.get("orgId") != org_id:
        raise SpaceAccessError("Space belongs to another organisation")

    now = datetime.utcnow()
    mirrored = {
        "name": space.get("name") or "Space",
        "description": space.get("description"),
        # Mirrored so the closed-Space rule can be applied here without a
        # second call across tiers; the watcher keeps these current.
        "spaceStatus": space.get("status") or "OPEN",
        "spaceDeleted": False,
        "updatedAt": now,
    }
    query = {"spaceId": space_id}
    try:
        return projects.find_one_and_update(
            query,
            {
                "$set": mirrored,
                "$setOnInsert": {
                    "spaceId": space_id,
                    "ownerType": "team",
                    "ownerId": ObjectId(str(team_id)),
                    "createdAt": now,
                },
            },
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        # Another request created it between the query and the insert.
        return projects.find_one(query)
