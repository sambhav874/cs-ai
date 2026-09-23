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
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

WATCHER_ID = "space_watcher"
CONTRACT_WATCHER_ID = "contract_watcher"
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


# Fields of a platform contract whose change matters to its analysis copy.
CONTRACT_WATCHED_FIELDS = ("spaceId", "title", "deletedAt")


def apply_contract_change(change: Dict[str, Any], contracts, *, place) -> bool:
    """Mirror one change to a platform contract onto its analysis copy.

    `place(space_id, team_oid)` returns the project the copy belongs in (its
    Space's, or Unfiled); injected so this stays testable without a database.
    Only contracts that were linked here are touched -- most platform
    contracts have no copy until their file is pushed.
    """
    op = change.get("operationType")
    platform_id = (change.get("documentKey") or {}).get("_id")
    if not platform_id:
        return False
    copy = contracts.find_one(
        {"platformContractId": platform_id},
        {"_id": 1, "ownerId": 1, "spaceId": 1, "contract_name": 1},
    )
    if not copy:
        return False

    if op == "delete":
        fields: Dict[str, Any] = {"platformDeleted": True}
    elif op in ("insert", "replace", "update"):
        if op == "update":
            desc = change.get("updateDescription") or {}
            touched = set((desc.get("updatedFields") or {}).keys()) | set(desc.get("removedFields") or [])
            if not touched & set(CONTRACT_WATCHED_FIELDS):
                return False
        doc = change.get("fullDocument")
        if doc is None:
            # updateLookup found nothing: the contract was removed in between.
            fields = {"platformDeleted": True}
        else:
            fields = {"platformDeleted": doc.get("deletedAt") is not None}
            if doc.get("title"):
                fields["contract_name"] = doc["title"]
            space_id = doc.get("spaceId")
            if space_id != copy.get("spaceId"):
                project = place(space_id, copy["ownerId"])
                fields["spaceId"] = space_id
                fields["projectId"] = project["_id"]
    else:
        return False

    result = contracts.update_one({"_id": copy["_id"]}, {"$set": fields})
    return bool(getattr(result, "matched_count", 0))


def _load_token(state, watcher_id: str = WATCHER_ID) -> Optional[Any]:
    doc = state.find_one({"_id": watcher_id})
    return (doc or {}).get("resumeToken")


def _save_token(state, token, watcher_id: str = WATCHER_ID) -> None:
    state.update_one({"_id": watcher_id}, {"$set": {"resumeToken": token}}, upsert=True)


def watch_collection(
    source,
    handle: Callable[[Dict[str, Any]], Any],
    state,
    stop: threading.Event,
    *,
    watcher_id: str,
    retry_seconds: float = 5.0,
) -> None:
    """Follow one platform collection's change stream until `stop` is set."""
    from pymongo.errors import PyMongoError

    while not stop.is_set():
        resume_after = _load_token(state, watcher_id)
        try:
            with source.watch(full_document="updateLookup", resume_after=resume_after) as stream:
                logger.info("%s following %s.", watcher_id, source.name)
                while not stop.is_set():
                    change = stream.try_next()
                    if change is None:
                        time.sleep(0.5)
                        continue
                    if change.get("operationType") == "invalidate":
                        # The collection was dropped or renamed (a restore
                        # does this). An invalidate token cannot be resumed
                        # after, and saving it made every later attempt fail
                        # the same way, forever. Start again from now.
                        logger.warning("%s's stream was invalidated (collection dropped or renamed); reopening.", watcher_id)
                        _save_token(state, None, watcher_id)
                        break
                    try:
                        handle(change)
                    except Exception:
                        logger.exception("%s could not apply a change; continuing.", watcher_id)
                    _save_token(state, stream.resume_token, watcher_id)
        except PyMongoError as e:
            # The saved token cannot be used: 286 ChangeStreamHistoryLost (older
            # than the oplog), 260 InvalidResumeToken, 280 ChangeStreamFatalError
            # (e.g. resuming after an invalidate). Retrying it would fail the
            # same way indefinitely.
            if getattr(e, "code", None) in (260, 280, 286) and resume_after is not None:
                logger.warning("%s's resume token cannot be used (%s); resynchronising from now.", watcher_id, getattr(e, "code", None))
                _save_token(state, None, watcher_id)
                continue
            logger.warning(f"{watcher_id} lost its change stream ({e}); retrying in {retry_seconds}s.")
            stop.wait(retry_seconds)
        except Exception:
            logger.exception("%s failed; retrying.", watcher_id)
            stop.wait(retry_seconds)


def watch_spaces(projects, platform_db, state, stop: threading.Event, *, retry_seconds: float = 5.0) -> None:
    """Follow the platform's spaces collection until `stop` is set."""
    watch_collection(
        platform_db["spaces"], lambda c: apply_change(c, projects), state, stop,
        watcher_id=WATCHER_ID, retry_seconds=retry_seconds,
    )


def start_space_watcher() -> Optional[threading.Event]:
    """Start the Space and contract watchers on daemon threads. Returns their stop signal."""
    from core.database import core_db
    from core.platform_identity import _platform_db
    from api.routes.projects import ensure_default_project
    from services.platform_contracts import project_for_space

    stop = threading.Event()
    projects = core_db["projects"]
    contracts = core_db["contracts"]
    state = core_db["watcher_state"]
    platform_db = _platform_db()

    def place(space_id, team_oid):
        return project_for_space(
            space_id, team_oid,
            projects=projects, platform_db=platform_db, ensure_default=ensure_default_project,
        )

    threading.Thread(
        target=watch_spaces,
        args=(projects, platform_db, state, stop),
        name="space-watcher",
        daemon=True,
    ).start()
    threading.Thread(
        target=watch_collection,
        args=(platform_db["contracts"], lambda c: apply_contract_change(c, contracts, place=place), state, stop),
        kwargs={"watcher_id": CONTRACT_WATCHER_ID},
        name="contract-watcher",
        daemon=True,
    ).start()
    return stop
