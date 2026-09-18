"""
LLM provider registry.
Add new providers/models here — the rest of the system picks them up automatically.
"""
from dataclasses import dataclass
from langchain_core.language_models.chat_models import BaseChatModel
from app.config import settings


@dataclass
class ModelOption:
    provider: str
    model_id: str
    display_name: str
    context_window: int  # tokens


# ─── Supported models ────────────────────────────────────────────────────────

MODEL_REGISTRY: list[ModelOption] = [
    # ─── Anthropic ─────────────────────────────────────────────────────
    ModelOption("anthropic", "claude-opus-4-7",     "Claude Opus 4.7",     1_000_000),  # latest reasoning
    ModelOption("anthropic", "claude-opus-4-6",     "Claude Opus 4.6",     200_000),
    ModelOption("anthropic", "claude-sonnet-4-6",   "Claude Sonnet 4.6",   1_000_000),  # 1M GA
    ModelOption("anthropic", "claude-haiku-4-5",    "Claude Haiku 4.5",    200_000),
    ModelOption("anthropic", "claude-haiku-4-5-20251001", "Claude Haiku 4.5 (dated)", 200_000),
    # ─── OpenAI ─────────────────────────────────────────────────────────
    ModelOption("openai",    "gpt-5",               "GPT-5",               400_000),    # latest reasoning (preview)
    ModelOption("openai",    "gpt-4.1",             "GPT-4.1",             1_000_000),  # workhorse
    ModelOption("openai",    "gpt-4.1-mini",        "GPT-4.1 Mini",        1_000_000),  # fast tier
    ModelOption("openai",    "gpt-4.1-nano",        "GPT-4.1 Nano",        1_000_000),  # cheapest
    ModelOption("openai",    "gpt-4o",              "GPT-4o",              128_000),
    ModelOption("openai",    "gpt-4o-mini",         "GPT-4o Mini",         128_000),
    ModelOption("openai",    "gpt-4-turbo",         "GPT-4 Turbo",         128_000),
    # ─── Google ─────────────────────────────────────────────────────────
    ModelOption("google",    "gemini-2.5-pro",      "Gemini 2.5 Pro",      2_000_000),  # retrieval workhorse
    ModelOption("google",    "gemini-2.5-flash",    "Gemini 2.5 Flash",    1_000_000),
    ModelOption("google",    "gemini-1.5-pro",      "Gemini 1.5 Pro",      2_000_000),
    ModelOption("google",    "gemini-1.5-flash",    "Gemini 1.5 Flash",    1_000_000),
    ModelOption("google",    "gemini-2.0-flash",    "Gemini 2.0 Flash",    1_000_000),
    # ─── OpenRouter ─────────────────────────────────────────────────────
    # Single API key gateway. Model id is the OpenRouter slug
    # ("provider/model") and is passed through verbatim to their /v1.
    ModelOption("openrouter", "google/gemini-2.5-flash", "Gemini 2.5 Flash (OpenRouter)", 1_000_000),
    ModelOption("openrouter", "openai/gpt-4.1",          "GPT-4.1 (OpenRouter)",          1_000_000),
]

DEFAULT_PROVIDER = "anthropic"
DEFAULT_MODEL    = "claude-sonnet-4-6"

# Indexed for fast lookup
_registry_index: dict[tuple[str, str], ModelOption] = {
    (m.provider, m.model_id): m for m in MODEL_REGISTRY
}


def get_model_option(provider: str, model_id: str) -> ModelOption:
    key = (provider, model_id)
    if key not in _registry_index:
        raise ValueError(
            f"Unknown provider/model: {provider}/{model_id}. "
            f"Valid options: {[f'{m.provider}/{m.model_id}' for m in MODEL_REGISTRY]}"
        )
    return _registry_index[key]


def build_llm(
    provider: str,
    model_id: str,
    streaming: bool = True,
    api_key: str | None = None,
) -> BaseChatModel:
    """
    Instantiate the LangChain chat model for the given provider + model.

    If `api_key` is provided, it overrides the platform env key for this
    instance — used by the BYOK path in router.resolve_llm() to inject the
    org's own key without mutating env state.
    """
    get_model_option(provider, model_id)  # validates

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model_id,
            api_key=api_key or settings.anthropic_api_key,
            streaming=streaming,
        )

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model_id,
            api_key=api_key or settings.openai_api_key,
            streaming=streaming,
        )

    if provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model_id,
            google_api_key=api_key or settings.google_api_key,
            streaming=streaming,
        )

    if provider == "openrouter":
        # OpenRouter speaks the OpenAI Chat Completions schema, so we reuse
        # ChatOpenAI with base_url overridden. model_id is the OpenRouter
        # slug verbatim ("google/gemini-2.5-flash", "openai/gpt-4.1", ...).
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model_id,
            api_key=api_key or settings.openrouter_api_key,
            base_url="https://openrouter.ai/api/v1",
            streaming=streaming,
        )

    raise ValueError(f"Unsupported provider: {provider}")


def list_models() -> list[dict]:
    """Return all supported models as dicts (for the /models API endpoint)."""
    return [
        {
            "provider": m.provider,
            "model_id": m.model_id,
            "display_name": m.display_name,
            "context_window": m.context_window,
        }
        for m in MODEL_REGISTRY
    ]
