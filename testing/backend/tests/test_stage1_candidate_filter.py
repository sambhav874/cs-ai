"""Stage 1 must not turn a truncated response into a verdict.

Measured 2026-09-16 on the NHS Standard Contract 2026/27 Service Conditions
with gemini-2.5-pro: Stage 1 asked for 100 verdicts per call under a fixed
8192-token cap. The model spent 6.2–7.2k of that thinking, hit MAX_TOKENS on 4
of 5 batches, and the cut-off JSON parsed to {}. `_verify_batch` returned [] for
each, so 402 of 405 clauses were recorded as declined and the run finished as
`success` with 2 obligations. Groq on the same document produced 117.
"""

import logging
from types import SimpleNamespace
from unittest.mock import MagicMock

from services.kpi_manager import ContractKPIManager


def _manager():
    return ContractKPIManager(database=MagicMock())


def _records(*source_ids):
    return [{"source_id": sid, "text": f"The Provider must do {sid} within 5 Operational Days."} for sid in source_ids]


def test_stage1_uses_the_provider_extraction_cap_not_a_fixed_8192(monkeypatch):
    manager = _manager()
    seen = []

    def fake_query(prompt, *, provider, max_tokens_override=None):
        seen.append(max_tokens_override)
        return {"candidates": [{"source_id": "a", "is_obligation_candidate": True}]}

    monkeypatch.setattr(manager, "_query_kpi_llm_json", fake_query)
    manager._filter_kpi_candidates_with_llm(_records("a"), provider="gemini")

    assert seen == [None], "an override here beats the provider cap and starves reasoning models"
    assert ContractKPIManager._kpi_max_tokens("gemini", None) >= 32000
    assert ContractKPIManager._kpi_max_tokens("groq", None) <= 8192, "Groq still refuses larger requests"


def test_an_unusable_stage1_response_keeps_the_batch(monkeypatch):
    """Truncated or unparseable output is a failed call, not 'nothing here'."""
    manager = _manager()
    monkeypatch.setattr(manager, "_query_kpi_llm_json", lambda prompt, *, provider, max_tokens_override=None: {})

    kept = manager._filter_kpi_candidates_with_llm(_records("a", "b", "c"), provider="gemini")

    assert [r["source_id"] for r in kept] == ["a", "b", "c"]


def test_parsed_stage1_verdicts_still_filter(monkeypatch):
    manager = _manager()
    verdicts = {"candidates": [
        {"source_id": "a", "is_obligation_candidate": True},
        {"source_id": "b", "is_obligation_candidate": False},
        {"source_id": "c", "is_kpi_candidate": True},
    ]}
    monkeypatch.setattr(manager, "_query_kpi_llm_json", lambda prompt, *, provider, max_tokens_override=None: verdicts)

    kept = manager._filter_kpi_candidates_with_llm(_records("a", "b", "c"), provider="groq")

    assert [r["source_id"] for r in kept] == ["a", "c"], "failing open must not stop real verdicts from filtering"


def test_a_response_cut_off_by_the_output_cap_is_logged(monkeypatch, caplog):
    manager = _manager()
    monkeypatch.setattr(manager, "_meter", lambda result, prompt: None)
    truncated = SimpleNamespace(
        content='```json\n{"candidates": [{"source_id": "s0", "is_obligation',
        response_metadata={"finish_reason": "MAX_TOKENS"},
        usage_metadata={"output_tokens": 8188},
    )
    monkeypatch.setattr(
        "services.contract_agent.graph.model_factory.build_chat_model",
        lambda **kwargs: SimpleNamespace(invoke=lambda messages: truncated),
    )

    with caplog.at_level(logging.WARNING, logger="services.kpi_manager"):
        payload = manager._query_kpi_llm_json("prompt", provider="gemini")

    assert payload == {}
    assert "truncated by the output cap" in caplog.text
    assert "8188" in caplog.text
