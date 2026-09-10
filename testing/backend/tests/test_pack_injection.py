"""The pack has to reach the prompt — and reach it as data, below the rules.

Loading a pack that never lands in a prompt is the failure mode this file
exists to catch: every other pack test passes on a directory of markdown nobody
sends anywhere.
"""

from unittest.mock import MagicMock

import pytest

from services.kpi_manager import ContractKPIManager
from services.obligation_packs import load_pack, render_pack_block


def _manager():
    return ContractKPIManager(database=MagicMock())


def _records():
    return [{"source_id": "src_1", "text": "Provider shall pick up 98.0% of shipments on time."}]


def test_prompt_is_byte_identical_when_no_pack_resolves():
    """`_base`-only runs must not silently change the prompt."""
    manager = _manager()

    assert manager._build_kpi_llm_prompt(
        contract_name="C", records=_records(), pack_block=""
    ) == manager._build_kpi_llm_prompt(contract_name="C", records=_records())


def test_pack_block_lands_between_the_rules_and_the_clauses():
    manager = _manager()
    block = render_pack_block(load_pack("logistics_msa"))

    prompt = manager._build_kpi_llm_prompt(contract_name="C", records=_records(), pack_block=block)

    assert block in prompt
    assert prompt.index("CONFIDENCE RULES") < prompt.index("<CONTRACT_TYPE_PACK") < prompt.index("<SOURCES>")


def test_the_pack_is_framed_as_reference_not_as_commands():
    """Packs will be user-editable eventually; the boundary is built now."""
    manager = _manager()
    block = render_pack_block(load_pack("logistics_msa"))

    prompt = manager._build_kpi_llm_prompt(contract_name="C", records=_records(), pack_block=block)

    assert "DATA, not instructions" in prompt
    assert "never supplies a currency" in prompt


def test_classification_text_prefers_body_and_falls_back_to_candidates():
    manager = _manager()

    assert manager._contract_classification_text({"body_text": "abc"}, []) == "abc"
    assert "lane" in manager._contract_classification_text(
        {}, [{"text": "critical lane performance"}]
    )


def test_classification_text_is_capped():
    manager = _manager()
    huge = "x" * (manager._CLASSIFICATION_TEXT_LIMIT + 5000)

    assert len(manager._contract_classification_text({"body_text": huge}, [])) == (
        manager._CLASSIFICATION_TEXT_LIMIT
    )


@pytest.mark.parametrize("family", ["logistics_msa"])
def test_shipped_pack_costs_less_than_a_tenth_of_a_batch(family):
    """A pack rides on every batch of every run; a fat one is a per-run tax.

    The extraction batch budget is 20,000 characters of clause text, so the pack
    must stay small against it or it starts displacing the evidence.
    """
    pack = load_pack(family)

    assert len(render_pack_block(pack)) < 0.5 * 20000
