"""Linking a lifecycle contract to its analysis copy, and keeping it in step.

One platform contract has at most one analysis copy here, filed in its org's
team and its Space's project. Re-sending the same bytes is a no-op, so the
API's job can retry. The contract watcher then moves the copy when the
contract changes Space and flags it when the contract is deleted.
"""
from types import SimpleNamespace

import mongomock
import pytest
from bson import ObjectId
from pymongo import ASCENDING

from services.platform_contracts import (
    PlatformContractError,
    link_platform_contract,
    project_for_space,
)
from services.space_watcher import apply_contract_change

ORG, OTHER_ORG = "cmorg00000000000000000001", "cmorg00000000000000000002"
SPACE_A, SPACE_B = "cmspace000000000000000001", "cmspace000000000000000002"
CONTRACT = "cmcontract0000000000000001"
PDF = b"%PDF-1.4 contract bytes"


class World:
    def __init__(self, contract_space=SPACE_A, contract_org=ORG):
        client = mongomock.MongoClient()
        self.contracts = client.cs.contracts
        self.contracts.create_index(
            [("platformContractId", ASCENDING)], unique=True,
            partialFilterExpression={"platformContractId": {"$type": "string"}},
        )
        self.projects = client.cs.projects
        self.projects.create_index(
            [("spaceId", ASCENDING)], unique=True,
            partialFilterExpression={"spaceId": {"$type": "string"}},
        )
        self.team_oid = ObjectId()
        client.cs.teams.insert_one({"_id": self.team_oid, "platformOrgId": ORG})
        self.platform = client.platform
        for sid, name in ((SPACE_A, "Heathrow GHA"), (SPACE_B, "JFK GHA")):
            self.platform.spaces.insert_one({"_id": sid, "name": name, "orgId": ORG, "deletedAt": None})
        self.platform.contracts.insert_one({
            "_id": CONTRACT, "orgId": contract_org, "spaceId": contract_space,
            "title": "Ground handling — Heathrow", "deletedAt": None,
        })
        self.user = SimpleNamespace(id=str(ObjectId()), teamIds=[str(self.team_oid)])
        self.stored = []
        self.queued = []

    def ensure_default(self, owner_type, owner_id):
        return self.projects.find_one_and_update(
            {"ownerType": owner_type, "ownerId": owner_id, "isDefault": True},
            {"$setOnInsert": {"name": "Unfiled"}}, upsert=True, return_document=True,
        )

    def store_file(self, content, **meta):
        self.stored.append(meta)
        return ObjectId()

    def queue(self, **kw):
        self.queued.append(kw)
        return "job-1"

    def link(self, content=PDF, org_id=ORG):
        return link_platform_contract(
            platform_contract_id=CONTRACT, org_id=org_id, content=content,
            filename="gha.pdf", mime_type="application/pdf", page_count=3,
            uploader=self.user, contracts=self.contracts, projects=self.projects,
            platform_db=self.platform, store_file=self.store_file,
            queue_ingestion=self.queue, ensure_default=self.ensure_default,
        )

    def place(self, space_id, team_oid):
        return project_for_space(space_id, team_oid, projects=self.projects,
                                 platform_db=self.platform, ensure_default=self.ensure_default)


def test_link_creates_one_copy_in_the_spaces_project_and_queues_ingestion():
    w = World()
    out = w.link()
    assert out["status"] == "created"
    copy = w.contracts.find_one({"platformContractId": CONTRACT})
    project = w.projects.find_one({"_id": copy["projectId"]})
    assert project["spaceId"] == SPACE_A
    assert copy["ownerType"] == "team" and copy["ownerId"] == w.team_oid
    assert copy["contract_name"] == "Ground handling — Heathrow"
    assert copy["billing"] == "platform"
    assert len(w.queued) == 1


def test_same_bytes_again_is_a_noop_so_retries_are_safe():
    w = World()
    first = w.link()
    again = w.link()
    assert again["status"] == "unchanged"
    assert again["contract_id"] == first["contract_id"]
    assert w.contracts.count_documents({}) == 1
    assert len(w.queued) == 1 and len(w.stored) == 1


def test_new_bytes_replace_the_file_and_reingest_without_a_second_copy():
    w = World()
    w.link()
    out = w.link(content=PDF + b" v2")
    assert out["status"] == "updated"
    assert w.contracts.count_documents({}) == 1
    assert len(w.queued) == 2


def test_org_mismatch_is_refused():
    # The shared secret proves the caller is the API, not that the ids agree.
    w = World(contract_org=OTHER_ORG)
    with pytest.raises(PlatformContractError):
        w.link()
    assert w.contracts.count_documents({}) == 0


def test_unknown_contract_is_refused():
    w = World()
    w.platform.contracts.delete_many({})
    with pytest.raises(PlatformContractError):
        w.link()


def test_contract_without_a_space_is_unfiled():
    w = World(contract_space=None)
    w.link()
    copy = w.contracts.find_one({"platformContractId": CONTRACT})
    assert w.projects.find_one({"_id": copy["projectId"]})["name"] == "Unfiled"


def test_space_from_another_org_falls_back_to_unfiled():
    w = World()
    w.platform.spaces.update_one({"_id": SPACE_A}, {"$set": {"orgId": OTHER_ORG}})
    w.link()
    copy = w.contracts.find_one({"platformContractId": CONTRACT})
    assert w.projects.find_one({"_id": copy["projectId"]})["name"] == "Unfiled"


# ── The contract watcher ─────────────────────────────────────────────────────

def _update(fields, full):
    return {
        "operationType": "update",
        "documentKey": {"_id": CONTRACT},
        "updateDescription": {"updatedFields": fields, "removedFields": []},
        "fullDocument": full,
    }


def test_moving_the_contract_to_another_space_moves_its_copy():
    w = World()
    w.link()
    full = {**w.platform.contracts.find_one({"_id": CONTRACT}), "spaceId": SPACE_B}
    assert apply_contract_change(_update({"spaceId": SPACE_B}, full), w.contracts, place=w.place)
    copy = w.contracts.find_one({"platformContractId": CONTRACT})
    assert copy["spaceId"] == SPACE_B
    assert w.projects.find_one({"_id": copy["projectId"]})["name"] == "JFK GHA"


def test_removing_the_space_files_the_copy_as_unfiled():
    w = World()
    w.link()
    full = {**w.platform.contracts.find_one({"_id": CONTRACT}), "spaceId": None}
    apply_contract_change(_update({"spaceId": None}, full), w.contracts, place=w.place)
    copy = w.contracts.find_one({"platformContractId": CONTRACT})
    assert w.projects.find_one({"_id": copy["projectId"]})["name"] == "Unfiled"


def test_soft_delete_and_hard_delete_flag_the_copy():
    w = World()
    w.link()
    full = {**w.platform.contracts.find_one({"_id": CONTRACT}), "deletedAt": "2026-09-22"}
    apply_contract_change(_update({"deletedAt": "2026-09-22"}, full), w.contracts, place=w.place)
    assert w.contracts.find_one({"platformContractId": CONTRACT})["platformDeleted"] is True

    w.contracts.update_one({"platformContractId": CONTRACT}, {"$set": {"platformDeleted": False}})
    apply_contract_change({"operationType": "delete", "documentKey": {"_id": CONTRACT}}, w.contracts, place=w.place)
    assert w.contracts.find_one({"platformContractId": CONTRACT})["platformDeleted"] is True


def test_unrelated_field_changes_are_ignored():
    w = World()
    w.link()
    before = w.contracts.find_one({"platformContractId": CONTRACT})
    full = w.platform.contracts.find_one({"_id": CONTRACT})
    assert not apply_contract_change(_update({"riskScore": 40}, full), w.contracts, place=w.place)
    assert w.contracts.find_one({"platformContractId": CONTRACT}) == before


def test_contracts_that_were_never_linked_are_ignored():
    w = World()
    full = {**w.platform.contracts.find_one({"_id": CONTRACT}), "spaceId": SPACE_B}
    assert not apply_contract_change(_update({"spaceId": SPACE_B}, full), w.contracts, place=w.place)
    assert w.contracts.count_documents({}) == 0


# ── The internal route's guard, and roles for service calls ─────────────────

def test_internal_secret_fails_closed_and_rejects_wrong_values(monkeypatch):
    from fastapi import HTTPException
    from api.routes.internal import require_internal_secret

    monkeypatch.delenv("INTERNAL_SERVICE_SECRET", raising=False)
    with pytest.raises(HTTPException) as unset:
        require_internal_secret("anything")
    assert unset.value.status_code == 503

    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "s3cret-value")
    for wrong in (None, "", "s3cret-valuE", "s3cret-value "):
        with pytest.raises(HTTPException) as bad:
            require_internal_secret(wrong)
        assert bad.value.status_code == 401
    assert require_internal_secret("s3cret-value") is None


def test_service_calls_read_the_users_real_roles():
    # Calling the identity adapter with no roles would demote an admin's shadow
    # membership, so a service call looks the roles up instead of guessing.
    from core.platform_identity import platform_roles

    pdb = mongomock.MongoClient().platform
    pdb.roles.insert_many([{"_id": "r1", "name": "ADMIN"}, {"_id": "r2", "name": "LEGAL"}])
    pdb.user_roles.insert_many([{"userId": "u1", "roleId": "r1"}, {"userId": "u1", "roleId": "r2"}])
    assert platform_roles("u1", platform_db=pdb) == ["ADMIN", "LEGAL"]
    assert platform_roles("nobody", platform_db=pdb) == []
