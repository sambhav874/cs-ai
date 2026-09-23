"""POST /playbook-review with AI off answers 409 NO_PROVIDER, not a retried 502.

The worker records a 409 as "AI review is off" and stops; a 502 would spend
its retries on a failure that cannot succeed and show the review as failed.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents_service.router import NoProviderConfigured
from agents_service.routes import playbook_review as route

BODY = {"contractId": "c1", "orgId": "o1", "clauses": [{"id": "k1", "clauseType": "payment", "content": "Net 30"}],
        "playbookPositions": [{"clauseType": "Fees & Payment", "positionType": "preferred", "content": "Net 60"}]}


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(route.router)
    return TestClient(app)


def test_no_provider_is_409_no_provider(client, monkeypatch):
    async def off(**_):
        raise NoProviderConfigured("No provider configured for tier=reasoning.")
    monkeypatch.setattr(route, "run_playbook_review", off)
    r = client.post("/playbook-review", json=BODY)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "NO_PROVIDER"


def test_a_model_failure_is_still_502(client, monkeypatch):
    async def boom(**_):
        raise RuntimeError("upstream timed out")
    monkeypatch.setattr(route, "run_playbook_review", boom)
    assert client.post("/playbook-review", json=BODY).status_code == 502
