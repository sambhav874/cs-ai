"""GET /contracts/link/{ref}: either contract id resolves to both.

The platform's contract page uses the lifecycle id, this tier's KPI screen its
own ObjectId; without the join a link from one side 404'd on the other.
"""
from bson import ObjectId
from fastapi import HTTPException
import pytest

from api import dependencies
from api.routes import contracts
from models.domain import UserInDB

TEAM = ObjectId("650000000000000000000001")
DOC_ID = ObjectId("660000000000000000000002")
DOC = {"_id": DOC_ID, "ownerType": "team", "ownerId": TEAM, "projectId": None, "platformContractId": "cm_platform_1"}


class FakeCollection:
    def find_one(self, query, projection=None):
        if query.get("_id") == DOC_ID or query.get("platformContractId") == "cm_platform_1":
            return dict(DOC)
        return None


def user(team_ids):
    return UserInDB(_id="650000000000000000000009", username="a@example.com", email="a@example.com",
                    hashed_password="!", tokens=0, teamIds=team_ids, ownedAccountId=None)


@pytest.fixture(autouse=True)
def fake_collection(monkeypatch):
    monkeypatch.setattr(contracts, "collection", FakeCollection())


@pytest.mark.parametrize("ref", [str(DOC_ID), "cm_platform_1"])
def test_either_id_resolves_to_both(ref):
    out = contracts.get_contract_link(ref, current_user=user([str(TEAM)]))
    assert out == {"contract_id": str(DOC_ID), "platform_contract_id": "cm_platform_1", "project_id": None}


def test_an_unlinked_contract_is_not_found():
    with pytest.raises(HTTPException) as e:
        contracts.get_contract_link("cm_unknown", current_user=user([str(TEAM)]))
    assert e.value.status_code == 404


def test_another_team_cannot_resolve_it(monkeypatch):
    monkeypatch.setattr(dependencies, "teams_collection", None)
    with pytest.raises(HTTPException) as e:
        contracts.get_contract_link("cm_platform_1", current_user=user(["650000000000000000000003"]))
    assert e.value.status_code == 403
