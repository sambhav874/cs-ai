"""Who may use evaluations.

Only two routes checked anything, against a context id the client chose, so any
signed-in user could read run reports, CSVs and datasets; and no platform user
is in ContractSense's evaluation team, so no one could open the screen.
"""
from fastapi import HTTPException
import asyncio

import pytest

from api.routes import evaluations
from models.domain import UserInDB


def user(**over):
    base = dict(_id="u1", username="a@x.io", email="a@x.io", hashed_password="!", tokens=0,
                teamIds=["650000000000000000000001"], ownedAccountId=None, platformOrgId="org_ops")
    base.update(over)
    return UserInDB(**base)


def test_admins_of_an_evaluation_org_are_evaluators(monkeypatch):
    monkeypatch.setenv("EVALUATION_ORG_IDS", "org_ops, org_other")
    admin = user(ownedAccountId="650000000000000000000001")
    assert evaluations.is_evaluator(admin)
    assert not evaluations.is_evaluator(user())                                   # member, not admin
    assert not evaluations.is_evaluator(user(ownedAccountId="650000000000000000000001", platformOrgId="org_tenant"))


def test_no_platform_org_is_an_evaluator_by_default(monkeypatch):
    monkeypatch.delenv("EVALUATION_ORG_IDS", raising=False)
    assert not evaluations.is_evaluator(user(ownedAccountId="650000000000000000000001"))


def test_standalone_contractsense_keeps_its_evaluation_team():
    assert evaluations.is_evaluator(user(platformOrgId=None, teamIds=[evaluations.EVAL_CONTEXT_ID]))


def test_every_route_is_guarded():
    guards = [d.dependency for d in evaluations.router.dependencies]
    assert evaluations.require_evaluator in guards
    with pytest.raises(HTTPException) as refused:
        asyncio.run(evaluations.require_evaluator(user()))
    assert refused.value.status_code == 403
