"""draftLegal's agent service, now served by the intelligence tier under /agents.

The move must keep the old service's contract: every route the lifecycle API
calls exists at the same path under /agents, and every one of them refuses a
caller without the shared internal secret -- failing closed when the secret
is not configured. Health stays open for probes.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents_service.mount import agents_health_router, agents_router

# Every path apps/api calls (AGENTS_URL + path), from a grep of apps/api/src.
CALLED_BY_THE_API = {
    "/agent/ask", "/agent/portfolio-query", "/agent/models", "/agent/chat",
    "/redline_propose", "/redline_propose_batch", "/playbook_judge",
    "/extract", "/check_compliance", "/classify",
    "/detect-binder", "/intake-classify", "/draft", "/redline",
    "/playbook-review", "/approval-summary", "/renewal_advice", "/assist",
    "/assist_stream", "/complete", "/compare", "/classify_clause",
}


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(agents_health_router)
    app.include_router(agents_router)
    return TestClient(app)


def test_every_path_the_api_calls_is_mounted_under_agents():
    mounted = {r.path for r in agents_router.routes}
    missing = {"/agents" + p for p in CALLED_BY_THE_API} - mounted
    assert not missing, f"not mounted: {sorted(missing)}"


def test_health_needs_no_secret(client):
    r = client.get("/agents/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


@pytest.mark.parametrize("path", sorted(CALLED_BY_THE_API))
def test_every_route_refuses_a_wrong_secret(client, monkeypatch, path):
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "s3cret-value")
    method = client.get if path == "/agent/models" else client.post
    assert method("/agents" + path).status_code == 401
    assert method("/agents" + path, headers={"X-Internal-Secret": "wrong"}).status_code == 401


def test_routes_fail_closed_when_no_secret_is_configured(client, monkeypatch):
    monkeypatch.delenv("INTERNAL_SERVICE_SECRET", raising=False)
    r = client.post("/agents/classify", headers={"X-Internal-Secret": ""})
    assert r.status_code == 503
