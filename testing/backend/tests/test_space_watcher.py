"""The Space watcher mirrors the lifecycle API's changes onto the project.

A Space is renamed, closed or deleted on the lifecycle side, which never calls
this service. These tests pin what each change-stream event does — including
the update event, which carries only the fields that changed.
"""
import mongomock

from services.space_projects import space_write_block
from services.space_watcher import apply_change

SPACE = "cmspace000000000000000001"


def _projects(**extra):
    col = mongomock.MongoClient().db.projects
    col.insert_one({"spaceId": SPACE, "name": "Heathrow GHA", "spaceStatus": "OPEN", **extra})
    return col


def _doc(col):
    return col.find_one({"spaceId": SPACE})


def test_rename_is_mirrored():
    col = _projects()
    assert apply_change(
        {"operationType": "update", "documentKey": {"_id": SPACE},
         "updateDescription": {"updatedFields": {"name": "Heathrow GHA 2027"}}},
        col,
    )
    assert _doc(col)["name"] == "Heathrow GHA 2027"


def test_closing_makes_the_space_read_only():
    col = _projects()
    apply_change(
        {"operationType": "update", "documentKey": {"_id": SPACE},
         "updateDescription": {"updatedFields": {"status": "CLOSED", "closedAt": "2026-09-21"}}},
        col,
    )
    doc = _doc(col)
    assert doc["spaceStatus"] == "CLOSED"
    assert "closedAt" not in doc          # only the fields we mirror
    assert space_write_block(doc) == "This Space is closed. Reopen it to make changes."


def test_reopening_makes_it_writable_again():
    col = _projects(spaceStatus="CLOSED")
    apply_change(
        {"operationType": "update", "documentKey": {"_id": SPACE},
         "updateDescription": {"updatedFields": {"status": "OPEN"}}},
        col,
    )
    assert space_write_block(_doc(col)) is None


def test_soft_delete_and_restore():
    col = _projects()
    apply_change(
        {"operationType": "update", "documentKey": {"_id": SPACE},
         "updateDescription": {"updatedFields": {"deletedAt": "2026-09-21"}}},
        col,
    )
    assert space_write_block(_doc(col)) == "This Space has been deleted."
    # A removed field reads as absent, which means restored.
    apply_change(
        {"operationType": "update", "documentKey": {"_id": SPACE},
         "updateDescription": {"removedFields": ["deletedAt"]}},
        col,
    )
    assert space_write_block(_doc(col)) is None


def test_hard_delete_marks_the_project():
    col = _projects()
    assert apply_change({"operationType": "delete", "documentKey": {"_id": SPACE}}, col)
    assert _doc(col)["spaceDeleted"] is True


def test_replace_carries_the_whole_document():
    col = _projects()
    apply_change(
        {"operationType": "replace", "documentKey": {"_id": SPACE},
         "fullDocument": {"_id": SPACE, "name": "Gatwick GHA", "description": "Moved", "status": "OPEN", "deletedAt": None}},
        col,
    )
    doc = _doc(col)
    assert (doc["name"], doc["description"], doc["spaceDeleted"]) == ("Gatwick GHA", "Moved", False)


def test_a_space_nobody_opened_yet_is_left_alone():
    """The half is created on first use, so there is nothing to mirror."""
    col = mongomock.MongoClient().db.projects
    assert not apply_change(
        {"operationType": "update", "documentKey": {"_id": SPACE},
         "updateDescription": {"updatedFields": {"name": "Unopened"}}},
        col,
    )
    assert col.count_documents({}) == 0


def test_changes_we_do_not_mirror_are_ignored():
    col = _projects()
    assert not apply_change(
        {"operationType": "update", "documentKey": {"_id": SPACE},
         "updateDescription": {"updatedFields": {"tags": ["urgent"], "counterpartyId": "cp_1"}}},
        col,
    )
    assert _doc(col)["name"] == "Heathrow GHA"


def test_an_ordinary_project_is_never_blocked():
    col = mongomock.MongoClient().db.projects
    col.insert_one({"name": "Just a project"})
    assert space_write_block(col.find_one({})) is None


# ── Stream recovery ───────────────────────────────────────────────────────────

import threading

from pymongo.errors import OperationFailure

from services.space_watcher import watch_collection


class _State:
    def __init__(self, token=None):
        self.doc = {"_id": "w", "resumeToken": token} if token is not None else None

    def find_one(self, _q):
        return self.doc

    def update_one(self, _q, update, upsert=False):
        self.doc = {"_id": "w", **update["$set"]}


class _Stream:
    def __init__(self, changes, stop):
        self.changes, self.stop, self.resume_token = list(changes), stop, None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def try_next(self):
        if not self.changes:
            self.stop.set()
            return None
        change = self.changes.pop(0)
        self.resume_token = change["_id"]
        return change


class _Source:
    name = "spaces"

    def __init__(self, script):
        self.script, self.calls = script, []

    def watch(self, full_document=None, resume_after=None):
        self.calls.append(resume_after)
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def test_an_invalidate_is_not_saved_as_the_resume_point():
    stop = threading.Event()
    state = _State(token={"t": 1})
    seen = []
    source = _Source([
        _Stream([{"_id": {"t": 2}, "operationType": "insert"}, {"_id": {"t": 3}, "operationType": "invalidate"}], threading.Event()),
        _Stream([{"_id": {"t": 4}, "operationType": "insert"}], stop),
    ])
    watch_collection(source, seen.append, state, stop, watcher_id="w", retry_seconds=0)
    assert source.calls == [{"t": 1}, None]  # reopened from now, not after the invalidate
    assert [c["_id"]["t"] for c in seen] == [2, 4]
    assert state.doc["resumeToken"] == {"t": 4}


def test_an_unusable_token_is_dropped_not_retried_forever():
    stop = threading.Event()
    state = _State(token={"t": "invalidate"})
    source = _Source([
        OperationFailure("cannot resume after an invalidate", code=280),
        _Stream([{"_id": {"t": 9}, "operationType": "insert"}], stop),
    ])
    watch_collection(source, lambda c: None, state, stop, watcher_id="w", retry_seconds=0)
    assert source.calls == [{"t": "invalidate"}, None]
