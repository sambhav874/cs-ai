"""ensure_default_project: one Default Project per owner, even under a race.

The dashboard fires several requests at once on first load. The old
check-then-insert let two of them each create a Default Project (seen in the
merge trial, 3 ms apart). Now it is one atomic upsert, backed by a unique
partial index; a request that loses the race re-reads the winner.
"""
from unittest.mock import patch

import mongomock
from bson import ObjectId
from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

import api.routes.projects as projects_module


def _collection():
    col = mongomock.MongoClient().db.projects
    col.create_index(
        [("ownerType", ASCENDING), ("ownerId", ASCENDING)],
        name="project_default_per_owner",
        unique=True,
        partialFilterExpression={"name": "Default Project"},
    )
    return col


def test_repeated_calls_return_one_project():
    col = _collection()
    owner = ObjectId()
    with patch.object(projects_module, "projects_collection", col):
        first = projects_module.ensure_default_project("team", owner)
        second = projects_module.ensure_default_project("team", owner)
    assert first["_id"] == second["_id"]
    assert col.count_documents({"ownerId": owner, "name": "Default Project"}) == 1
    assert first["description"].startswith("Contracts that have not been moved")


def test_owners_are_separate():
    col = _collection()
    with patch.object(projects_module, "projects_collection", col):
        a = projects_module.ensure_default_project("team", ObjectId())
        b = projects_module.ensure_default_project("user", ObjectId())
    assert a["_id"] != b["_id"]


def test_losing_the_race_returns_the_winner():
    """A concurrent upsert that hits the unique index re-reads, not raises."""
    col = _collection()
    owner = ObjectId()
    winner_id = col.insert_one({"ownerType": "team", "ownerId": owner, "name": "Default Project"}).inserted_id

    class RacingCollection:
        def find_one_and_update(self, *a, **k):
            raise DuplicateKeyError("E11000 duplicate key")

        def find_one(self, query):
            return col.find_one(query)

    with patch.object(projects_module, "projects_collection", RacingCollection()):
        got = projects_module.ensure_default_project("team", owner)
    assert got["_id"] == winner_id
