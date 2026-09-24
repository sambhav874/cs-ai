"""Groq is a provider an org can bring a key for.

The router resolves a Groq-only deployment for every chat tier, the agents'
model builder makes a Groq client with the org's key, and ContractSense's
model factory builds Groq with the model the platform chose — including model
ids that carry their own slash ("openai/gpt-oss-120b").
"""
import pytest

import services.platform_models as pm
from agents_service import config as agents_config
from agents_service import providers, router
from services.contract_agent.graph import model_factory
from services.platform_models import PlatformModel, clear_cache, use_platform_org


@pytest.fixture()
def groq_only(monkeypatch):
    for attr in ("anthropic_api_key", "openai_api_key", "google_api_key", "openrouter_api_key"):
        monkeypatch.setattr(router.settings, attr, "", raising=False)
    monkeypatch.setattr(router.settings, "groq_api_key", "gsk_platform", raising=False)


@pytest.mark.parametrize("tier,model", [
    ("reasoning", "openai/gpt-oss-120b"),
    ("default", "openai/gpt-oss-120b"),
    ("fast", "openai/gpt-oss-20b"),
])
def test_a_groq_only_deployment_resolves_the_chat_tiers(groq_only, tier, model):
    assert router._platform_resolve(tier) == ("groq", model, "gsk_platform")


def test_groq_is_the_agents_fallback_provider(groq_only):
    assert agents_config.active_provider() == "groq"
    assert agents_config.is_provider_configured("groq")
    assert agents_config.smart_model() == "openai/gpt-oss-120b"


def test_build_llm_makes_a_groq_client_with_the_given_key():
    llm = providers.build_llm("groq", "openai/gpt-oss-120b", streaming=False, api_key="gsk_org")
    assert type(llm).__name__ == "ChatGroq"
    assert llm.model_name == "openai/gpt-oss-120b"
    assert llm.groq_api_key.get_secret_value() == "gsk_org"


def test_every_groq_tier_model_is_buildable():
    for tier, candidates in router._PLATFORM_TIERS.items():
        for provider, model in candidates:
            if provider == "groq":
                providers.get_model_option(provider, model)  # raises if unknown


def test_contractsense_builds_groq_with_the_platform_choice(monkeypatch):
    monkeypatch.setenv("API_URL", "http://api:8080")
    monkeypatch.setenv("INTERNAL_SERVICE_SECRET", "s3cret")
    clear_cache()
    monkeypatch.setattr(pm, "resolve_platform_model",
                        lambda org_id, tier, **_: PlatformModel("groq", "openai/gpt-oss-120b", "gsk_org", "byok", tier))
    built = {}
    monkeypatch.setattr(model_factory, "_build_groq", lambda **kw: built.update(kw) or "groq-model")
    with use_platform_org("org1"):
        assert model_factory.build_chat_model(purpose="classify") == "groq-model"
    assert built["model_name"] == "openai/gpt-oss-120b" and built["api_key"] == "gsk_org"
    clear_cache()


def test_the_light_groq_model_is_one_groq_still_serves():
    assert model_factory._LIGHTWEIGHT_MODELS["groq"] == "openai/gpt-oss-20b"


def test_agents_groq_calls_get_room_for_reasoning_and_the_answer():
    llm = providers.build_llm("groq", "openai/gpt-oss-120b", streaming=False, api_key="gsk_org")
    assert llm.max_tokens == providers.GROQ_MAX_OUTPUT_TOKENS >= 16_384


def test_a_short_gpt_oss_call_reasons_briefly_on_top_of_its_answer_budget():
    llm = model_factory._build_groq(
        model_name="openai/gpt-oss-20b", api_key="gsk", temperature=0.0, max_tokens=256,
        streaming=False, reasoning=False, message="", task_type="default",
    )
    assert llm.reasoning_effort == "low"
    assert llm.max_tokens == 256 + 1024


def test_a_non_reasoning_groq_model_keeps_its_budget():
    llm = model_factory._build_groq(
        model_name="qwen/qwen3.8-27b", api_key="gsk", temperature=0.0, max_tokens=256,
        streaming=False, reasoning=False, message="", task_type="default",
    )
    assert llm.max_tokens == 256
