"""Keep a Space's intelligence half in step with the lifecycle API.

The lifecycle API owns a Space — its name, description and status — and never
calls this service when one changes. Instead this watches the platform's
`spaces` collection with a MongoDB change stream (both databases sit on one
replica set, so there is no broker) and mirrors what changed onto the matching
projects document.

Only documents that already exist here are updated: a Space's half is created
on first use by services/space_projects, so a Space nobody has opened yet needs
nothing mirrored.

The resume token is stored after every batch, so a restart picks up where it
stopped rather than replaying from now and missing the renames in between. A
token the server has since dropped (it fell out of the oplog) is discarded and
the watcher resynchronises from the current point, which the resolver's
mirror-on-read then repairs lazily.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

WATCHER_ID = "space_watcher"
# Only these fields are ours to mirror; everything else about a Space stays on
# the lifecycle side.
WATCHED_FIELDS = ("name", "description", "status", "deletedAt")


def _mirror(space: Dict[str, Any]) -> Dict[str, Any]:
    fields: Dict[str, Any] = {}
    if "name" in space:
        fields["name"] = space.get("name") or "Space"
    if "description" in space:
        fields["description"] = space.get("description")
    if "status" in space:
        fields["spaceStatus"] = space.get("status")
    if "deletedAt" in space:
        fields["spaceDeleted"] = space.get("deletedAt") is not None
    return fields


def apply_change(change: Dict[str, Any], projects) -> bool:
    """Mirror one change-stream event. True when a project was updated.

    Handles the four events a Space can produce: created and replaced carry the
    whole document, updated carries only what changed (and what was unset), and
    deleted carries neither — for a hard delete the project is marked deleted
    by id alone.
    """
    op = change.get("operationType")
    space_id = (change.get("documentKey") or {}).get("_id")
    if not space_id:
        return False

    if op == "delete":
        fields = {"spaceDeleted": True}
    elif op in ("insert", "replace"):
        fields = _mirror(change.get("fullDocument") or {})
    elif op == "update":
        desc = change.get("updateDescription") or {}
        updated = desc.get("updatedFields") or {}
        removed = set(desc.get("removedFields") or [])
        touched = {k: v for k, v in updated.items() if k in WATCHED_FIELDS}
        # A removed field reads as absent, which for deletedAt means the Space
        # was restored.
        for field in removed & set(WATCHED_FIELDS):
            touched[field] = None
        fields = _mirror(touched) if touched else {}
    else:
        return False

    if not fields:
        return False
    result = projects.update_one({"spaceId": space_id}, {"$set": fields})
    return bool(getattr(result, "matched_count", 0))


def _load_token(state) -> Optional[Any]:
    doc = state.find_one({"_id": WATCHER_ID})
    return (doc or {}).get("resumeToken")


def _save_token(state, token) -> None:
    state.update_one({"_id": WATCHER_ID}, {"$set": {"resumeToken": token}}, upsert=True)


def watch_spaces(projects, platform_db, state, stop: threading.Event, *, retry_seconds: float = 5.0) -> None:
    """Follow the platform's spaces collection until `stop` is set."""
    from pymongo.errors import PyMongoError

    while not stop.is_set():
        resume_after = _load_token(state)
        try:
            with platform_db["spaces"].watch(
                full_document="updateLookup",
                resume_after=resume_after,
            ) as stream:
                logger.info("Space watcher following the lifecycle spaces collection.")
                while not stop.is_set():
                    change = stream.try_next()
                    if change is None:
                        time.sleep(0.5)
                        continue
                    try:
                        apply_change(change, projects)
                    except Exception:
                        logger.exception("Space watcher could not apply a change; continuing.")
                    _save_token(state, stream.resume_token)
        except PyMongoError as e:
            # 286 ChangeStreamHistoryLost: the token is older than the oplog.
            if getattr(e, "code", None) == 286 and resume_after is not None:
                logger.warning("Space watcher's resume token is too old; resynchronising from now.")
                _save_token(state, None)
                continue
            logger.warning(f"Space watcher lost its change stream ({e}); retrying in {retry_seconds}s.")
            stop.wait(retry_seconds)
        except Exception:
            logger.exception("Space watcher failed; retrying.")
            stop.wait(retry_seconds)


def start_space_watcher() -> Optional[threading.Event]:
    """Start the watcher on a daemon thread. Returns its stop signal."""
    from core.database import core_db
    from core.platform_identity import _platform_db

    stop = threading.Event()
    projects = core_db["projects"]
    state = core_db["watcher_state"]
    platform_db = _platform_db()

    thread = threading.Thread(
        target=watch_spaces,
        args=(projects, platform_db, state, stop),
        name="space-watcher",
        daemon=True,
    )
    thread.start()
    return stop
