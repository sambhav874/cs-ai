"""The platform org's Admin → AI settings drive ContractSense's model calls.

Resolution goes through the lifecycle API (BYOK, tier choice, cost cap), is
cached briefly, refuses when the cap refuses, and falls back to env config
when there is no answer. The model factory uses the org's provider, model and
key whenever an org is in scope and the caller named no provider.
"""
from types import SimpleNamespace

import pytest

import services.platform_models as pm
from services.contract_agent.graph import model_factory
from services.platform_models import (
    PlatformCostCapExceeded,
    PlatformModel,
    active_platform_org,
    clear_cache,
    resolve_platform_model,
    use_platform_org,
)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("API_URL", "http://api:8080")
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "s3cret")
    clear_cache()
    yield
    clear_cache()


def ok(provider="anthropic", model="claude-sonnet-5", source="byok"):
    return SimpleNamespace(status_code=200, json=lambda: {"provider": provider, "model": model, "apiKey": "sk-org", "source": source})


def test_resolves_and_caches_per_org_and_tier():
    calls = []

    def post(url, json, headers, timeout):
        calls.append((url, json, headers["x-internal-secret"]))
        return ok()

    first = resolve_platform_model("org1", "default", post=post)
    again = resolve_platform_model("org1", "default", post=post)
    other_tier = resolve_platform_model("org1", "fast", post=post)
    assert first == again == PlatformModel("anthropic", "claude-sonnet-5", "sk-org", "byok", "default")
    assert other_tier.tier == "fast"
    assert calls == [
        ("http://api:8080/api/internal/ai/resolve", {"orgId": "org1", "tier": "default"}, "s3cret"),
        ("http://api:8080/api/internal/ai/resolve", {"orgId": "org1", "tier": "fast"}, "s3cret"),
    ]


def test_cost_cap_refuses_rather_than_falling_back():
    with pytest.raises(PlatformCostCapExceeded):
        resolve_platform_model("org1", "default", post=lambda *a, **k: SimpleNamespace(status_code=429, json=lambda: {}))


def test_no_answer_falls_back_to_env():
    assert resolve_platform_model("org1", "default", post=lambda *a, **k: SimpleNamespace(status_code=503, json=lambda: {})) is None

    def down(*a, **k):
        raise ConnectionError("refused")

    clear_cache()
    assert resolve_platform_model("org1", "default", post=down) is None
    assert resolve_platform_model(None, "default", post=down) is None


def test_unconfigured_tier_does_not_call(monkeypatch):
    monkeypatch.delenv("API_URL")

    def never(*a, **k):
        raise AssertionError("must not be called")

    assert resolve_platform_model("org1", "default", post=never) is None


def test_org_scope_is_contextual():
    assert active_platform_org() is None
    with use_platform_org("org1"):
        assert active_platform_org() == "org1"
        with use_platform_org("org2"):
            assert active_platform_org() == "org2"
        assert active_platform_org() == "org1"
    assert active_platform_org() is None


def test_factory_uses_the_orgs_provider_model_and_key(monkeypatch):
    seen = {}

    def fake_resolve(org_id, tier, **_):
        seen["args"] = (org_id, tier)
        return PlatformModel("anthropic", "claude-sonnet-5", "sk-org-key", "byok", tier)

    monkeypatch.setattr(pm, "resolve_platform_model", fake_resolve)
    built = {}
    monkeypatch.setattr(model_factory, "_build_claude", lambda **kw: built.update(kw) or "claude-model")
    monkeypatch.setattr(model_factory, "_build_groq", lambda **kw: "groq-model")

    with use_platform_org("org1"):
        assert model_factory.build_chat_model(purpose="classify") == "claude-model"
    assert seen["args"] == ("org1", "default")
    assert built["model_name"] == "claude-sonnet-5" and built["api_key"] == "sk-org-key"

    with use_platform_org("org1"):
        model_factory.build_chat_model(purpose="light")
    assert seen["args"] == ("org1", "fast")


def test_an_explicit_provider_still_wins(monkeypatch):
    monkeypatch.setattr(pm, "resolve_platform_model", lambda *a, **k: pytest.fail("must not resolve"))
    monkeypatch.setattr(model_factory, "_build_groq", lambda **kw: "groq-model")
    with use_platform_org("org1"):
        assert model_factory.build_chat_model(provider="groq", purpose="classify", optional=False) == "groq-model"


def test_without_an_org_nothing_changes(monkeypatch):
    monkeypatch.setattr(pm, "resolve_platform_model", lambda org_id, tier, **_: None)
    monkeypatch.setattr(model_factory, "_build_groq", lambda **kw: "groq-model")
    assert model_factory.build_chat_model(purpose="classify") == "groq-model"


def test_an_explicit_platform_model_survives_a_worker_thread(monkeypatch):
    """Extraction batches run in a thread pool, where the org context is gone."""
    from concurrent.futures import ThreadPoolExecutor

    monkeypatch.setattr(pm, "resolve_platform_model", lambda *a, **k: None)
    built = {}
    monkeypatch.setattr(model_factory, "_build_openai", lambda **kw: built.update(kw) or "openai-model")
    resolved = PlatformModel("openai", "gpt-4.1-mini", "sk-org-key", "byok", "default")
    with use_platform_org("org1"), ThreadPoolExecutor(1) as pool:
        out = pool.submit(lambda: model_factory.build_chat_model(purpose="classify", platform_model=resolved)).result()
    assert out == "openai-model"
    assert built["model_name"] == "gpt-4.1-mini" and built["api_key"] == "sk-org-key"


def test_a_platform_user_with_an_internal_domain_is_a_valid_identity():
    """jane@corp.local signs in to the platform; the intelligence tier must accept her too."""
    from models.domain import UserInDB

    for email in ("jane@corp.local", "admin@selfhost.test", "ops@acme.internal"):
        user = UserInDB.model_validate({"_id": "u1", "username": email, "email": email, "hashed_password": "x", "tokens": 0})
        assert user.email == email
    with pytest.raises(Exception):
        UserInDB.model_validate({"_id": "u1", "username": "x", "email": "not-an-address", "hashed_password": "x", "tokens": 0})


def test_the_platform_database_derives_from_the_cluster(monkeypatch):
    from core import platform_identity as pi

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(pi.settings, "platform_database_url", "")
    monkeypatch.setattr(pi.settings, "mongodb_uri", "mongodb+srv://u:p@c0.ab.mongodb.net/?retryWrites=true&w=majority")
    assert pi.platform_database_url() == "mongodb+srv://u:p@c0.ab.mongodb.net/csai?retryWrites=true&w=majority"
    monkeypatch.setattr(pi.settings, "mongodb_uri", "mongodb://mongo:27017/?replicaSet=rs0&directConnection=true")
    assert pi.platform_database_url() == "mongodb://mongo:27017/csai?replicaSet=rs0&directConnection=true"
    monkeypatch.setenv("DATABASE_URL", "mongodb://explicit/db")
    assert pi.platform_database_url() == "mongodb://explicit/db"
