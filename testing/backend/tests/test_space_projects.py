"""resolve_space_project: a Space's intelligence half, created on first use.

A Space belongs to the lifecycle API. This tier may only ever see the one the
caller's organisation owns, and must produce exactly one projects document for
it however many requests arrive at once.
"""
from types import SimpleNamespace
from unittest.mock import patch

import mongomock
import pytest
from bson import ObjectId
from pymongo import ASCENDING
from pymongo.errors import DuplicateKeyError

from services.space_projects import SpaceAccessError, resolve_space_project

ORG, OTHER_ORG = "cmorg00000000000000000001", "cmorg00000000000000000002"
SPACE = "cmspace000000000000000001"


def _world(space=None):
    client = mongomock.MongoClient()
    projects = client.cs.projects
    projects.create_index(
        [("spaceId", ASCENDING)],
        name="project_space_unique",
        unique=True,
        partialFilterExpression={"spaceId": {"$type": "string"}},
    )
    teams = client.cs.teams
    team_id = ObjectId()
    teams.insert_one({"_id": team_id, "platformOrgId": ORG})
    platform = client.platform
    platform.spaces.insert_one(space or {"_id": SPACE, "name": "Heathrow GHA", "description": "Ground handling", "orgId": ORG, "deletedAt": None})
    user = SimpleNamespace(id=str(ObjectId()), teamIds=[str(team_id)], ownedAccountId=str(team_id))
    return projects, teams, platform, user


def resolve(space_id, projects, teams, platform, user):
    return resolve_space_project(space_id, user, projects=projects, teams=teams, platform_db=platform)


def test_creates_one_project_and_mirrors_the_space():
    projects, teams, platform, user = _world()
    got = resolve(SPACE, projects, teams, platform, user)
    assert got["spaceId"] == SPACE
    assert got["name"] == "Heathrow GHA"
    assert got["description"] == "Ground handling"
    assert got["ownerType"] == "team"
    assert projects.count_documents({}) == 1


def test_second_call_returns_the_same_project_and_picks_up_a_rename():
    projects, teams, platform, user = _world()
    first = resolve(SPACE, projects, teams, platform, user)
    platform.spaces.update_one({"_id": SPACE}, {"$set": {"name": "Heathrow GHA 2027"}})
    second = resolve(SPACE, projects, teams, platform, user)
    assert first["_id"] == second["_id"]
    assert second["name"] == "Heathrow GHA 2027"
    assert projects.count_documents({}) == 1


def test_a_space_in_another_org_is_refused_and_creates_nothing():
    projects, teams, platform, user = _world({"_id": SPACE, "name": "Theirs", "orgId": OTHER_ORG, "deletedAt": None})
    with pytest.raises(SpaceAccessError):
        resolve(SPACE, projects, teams, platform, user)
    assert projects.count_documents({}) == 0


def test_unknown_and_deleted_spaces_are_refused():
    projects, teams, platform, user = _world()
    with pytest.raises(SpaceAccessError):
        resolve("cmspace000000000000000009", projects, teams, platform, user)
    platform.spaces.update_one({"_id": SPACE}, {"$set": {"deletedAt": "2026-09-01"}})
    with pytest.raises(SpaceAccessError):
        resolve(SPACE, projects, teams, platform, user)
    assert projects.count_documents({}) == 0


def test_a_user_outside_any_organisation_is_refused():
    projects, teams, platform, _ = _world()
    stray = SimpleNamespace(id=str(ObjectId()), teamIds=[], ownedAccountId=None)
    with pytest.raises(SpaceAccessError):
        resolve(SPACE, projects, teams, platform, stray)


def test_losing_the_race_returns_the_winner():
    projects, teams, platform, user = _world()
    winner = projects.insert_one({"spaceId": SPACE, "name": "Heathrow GHA"}).inserted_id

    class Racing:
        def find_one_and_update(self, *a, **k):
            raise DuplicateKeyError("E11000 duplicate key")

        def find_one(self, query):
            return projects.find_one(query)

    got = resolve(SPACE, Racing(), teams, platform, user)
    assert got["_id"] == winner
