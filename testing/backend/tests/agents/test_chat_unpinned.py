"""An unpinned chat turn reaches the model router unpinned.

The request used to default provider to anthropic, swap it for whichever
provider had a key, and pass that down as an explicit override — so the
team's Admin → AI settings never chose the assistant's model.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agents_service.routes import chat as route


@pytest.fixture()
def seen(monkeypatch):
    calls = []

    async def fake_stream(**kw):
        calls.append(kw)
        yield {"type": "done", "provider": "groq", "model": "openai/gpt-oss-120b", "tier": "default"}

    monkeypatch.setattr(route, "run_agent_chat_stream", fake_stream)
    return calls


def client():
    app = FastAPI()
    app.include_router(route.router)
    return TestClient(app)


def test_unpinned_turn_stays_unpinned(seen):
    r = client().post("/chat", json={"message": "hi", "agent_mode": True, "org_id": "o1"})
    assert r.status_code == 200 and "[DONE]" in r.text
    assert seen[0]["provider"] is None and seen[0]["model_id"] is None


def test_an_explicit_pin_is_still_honoured(seen, monkeypatch):
    monkeypatch.setattr(route, "resolve_provider", lambda p: p)
    monkeypatch.setattr(route, "get_model_option", lambda p, m: None)
    client().post("/chat", json={"message": "hi", "agent_mode": True, "provider": "groq", "model_id": "openai/gpt-oss-20b"})
    assert seen[0]["provider"] == "groq" and seen[0]["model_id"] == "openai/gpt-oss-20b"
