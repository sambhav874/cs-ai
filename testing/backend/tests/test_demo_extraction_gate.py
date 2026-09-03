"""The demo contract must be scorable, and the demo must still work.

``demo_data/baltia_jfk_ground_truth.json`` is the only hand-labelled gold set
in the repo, but the contract it belongs to short-circuits extraction and
serves that file as the answer.  These tests pin the escape hatch: off by
default (the pitch flow is untouched), and when it is on only the *extraction*
substitution stops -- breach enrichment and the reseed script must still
recognise the contract.
"""

import os

os.environ.setdefault("HUGGINGFACE_TOKEN", "test")
os.environ.setdefault("GROQ_API_KEY", "test")
os.environ.setdefault("SUPPORT_EMAIL_ADDRESS", "test@example.com")
os.environ.setdefault("AZURE_COMMUNICATION_CONNECTION_STRING", "endpoint=https://example.com/;accesskey=test")
os.environ.setdefault("AZURE_SENDER_ADDRESS", "test@example.com")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/test")

import pytest  # noqa: E402

demo = pytest.importorskip(
    "services.baltia_jfk_demo",
    reason="backend dependencies (PyMuPDF et al.) are not installed in this environment",
)


CONTRACT_NAME = "Baltia Airlines / Swissport USA JFK Ground Handling Agreement"


@pytest.fixture(autouse=True)
def clear_flag(monkeypatch):
    monkeypatch.delenv(demo.REAL_EXTRACTION_ENV_VAR, raising=False)


def test_demo_serves_the_gold_register_by_default():
    assert demo.real_extraction_enabled() is False
    assert demo.use_demo_ground_truth_extraction(contract_name=CONTRACT_NAME) is True


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_flag_hands_the_demo_contract_to_the_real_extractor(monkeypatch, value):
    monkeypatch.setenv(demo.REAL_EXTRACTION_ENV_VAR, value)

    assert demo.real_extraction_enabled() is True
    assert demo.use_demo_ground_truth_extraction(contract_name=CONTRACT_NAME) is False


@pytest.mark.parametrize("value", ["0", "false", "no", "", "  "])
def test_unset_like_values_leave_the_demo_alone(monkeypatch, value):
    monkeypatch.setenv(demo.REAL_EXTRACTION_ENV_VAR, value)

    assert demo.use_demo_ground_truth_extraction(contract_name=CONTRACT_NAME) is True


def test_flag_does_not_stop_the_contract_being_recognised(monkeypatch):
    """Breach enrichment and scripts/prepare_baltia_jfk_demo.py depend on this."""
    monkeypatch.setenv(demo.REAL_EXTRACTION_ENV_VAR, "1")

    assert demo.is_baltia_jfk_demo(contract_name=CONTRACT_NAME) is True


def test_unrelated_contracts_are_never_gated(monkeypatch):
    assert demo.use_demo_ground_truth_extraction(contract_name="Acme Master Services Agreement") is False
    monkeypatch.setenv(demo.REAL_EXTRACTION_ENV_VAR, "1")
    assert demo.use_demo_ground_truth_extraction(contract_name="Acme Master Services Agreement") is False


def test_gold_set_is_present_and_the_expected_size():
    """The scorer's headline denominator. If this changes, baselines move."""
    assert len(demo.GROUND_TRUTH.get("kpis", [])) == 37
