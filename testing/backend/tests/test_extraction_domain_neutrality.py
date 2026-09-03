"""Extraction must not carry one client's contract shape into every contract.

The pipeline had a ground-handling demo's assumptions hardcoded into the path
every contract takes: amounts were rewritten to SEK unless the quote contained
a "$", party ownership was guessed from money words, unrelated obligations were
merged by domain synonym, and the prompt that actually shipped asked for a
different schema than the rest of the pipeline expects.

These tests pin the general behaviour so a future domain fix cannot be
implemented the same way again.
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

kpi_manager = pytest.importorskip(
    "services.kpi_manager",
    reason="backend dependencies (PyMuPDF et al.) are not installed in this environment",
)

ContractKPIManager = kpi_manager.ContractKPIManager


@pytest.fixture
def manager():
    return ContractKPIManager.__new__(ContractKPIManager)


def _candidates(*texts):
    return [{"text": text} for text in texts]


# ---------------------------------------------------------------------------
# The prompt that ships
# ---------------------------------------------------------------------------

def test_the_obligation_prompt_is_the_one_that_ships(manager):
    """The agreement-first prompt used to be built and then thrown away."""
    prompt = manager._build_kpi_llm_prompt(
        contract_name="Acme MSA",
        records=[{"source_id": "src-1", "text": "The Supplier shall respond within 4 hours."}],
    )

    assert "Trackable Operational Obligation Extraction Agent" in prompt
    assert '"schema_version":"2.1"' in prompt
    assert "trackable_operational_obligation" in prompt
    # The legacy KPI-first prompt asked for a schema nothing downstream reads.
    assert "# KPI Extraction Agent" not in prompt
    assert "Marcus Okafor" not in prompt


def test_prompts_do_not_assume_an_industry(manager):
    prompt = manager._build_kpi_llm_prompt(
        contract_name="Acme MSA",
        records=[{"source_id": "src-1", "text": "The Supplier shall respond within 4 hours."}],
    )

    for term in ("IATA", "SGHA", "ground-handling", "ground handling", "airline"):
        assert term.lower() not in prompt.lower(), f"prompt still assumes {term!r}"


def test_the_prompt_carries_the_source_text_and_ids(manager):
    prompt = manager._build_kpi_llm_prompt(
        contract_name="Acme MSA",
        records=[{"source_id": "src-42", "text": "Late delivery incurs 2% of the monthly fee."}],
    )

    assert "src-42" in prompt
    assert "Late delivery incurs 2% of the monthly fee." in prompt


# ---------------------------------------------------------------------------
# Currency comes from the document
# ---------------------------------------------------------------------------

def test_declared_currency_wins(manager):
    candidates = _candidates(
        "All amounts payable under this Agreement are in EUR.",
        "Handling charge $450.00 per unit.",
    )

    assert manager._resolve_contract_currency(candidates) == "EUR"


def test_currency_is_inferred_from_the_document_when_not_declared(manager):
    candidates = _candidates(
        "Ramp charge $2,395.00 per turnaround.",
        "Late fee $150.00 per day.",
    )

    assert manager._resolve_contract_currency(candidates) == "USD"


def test_no_currency_in_the_document_means_no_currency(manager):
    """The old rule answered 'SEK' here. Silence is the correct answer."""
    candidates = _candidates(
        "The Supplier shall respond to Severity 1 incidents within 4 hours.",
        "Reports are due by 08:00 local time each Monday.",
    )

    assert manager._resolve_contract_currency(candidates) is None


def test_an_ambiguous_document_says_nothing_rather_than_picking(manager):
    candidates = _candidates("Charge of $100 per unit.", "Charge of £100 per unit.")

    assert manager._resolve_contract_currency(candidates) is None


@pytest.mark.parametrize("stated,expected", [("USD", "USD"), ("GBP", "GBP"), ("INR", "INR")])
def test_a_stated_currency_is_never_rewritten(manager, stated, expected):
    item = {
        "quote": "Charge of 2,395.00 per turnaround.",
        "unit": f"{stated}/turnaround",
        "value": 2395.0,
        "measurement": {"unit": f"{stated}/turnaround", "currency": stated},
    }

    result = manager._normalize_extracted_record(item, contract_currency="SEK")

    assert result["measurement"]["currency"] == expected
    assert stated in result["unit"]


def test_a_record_with_no_currency_inherits_the_documents(manager):
    item = {
        "quote": "Charge of 2,395.00 per turnaround.",
        "unit": "2395.00/turnaround",
        "value": 2395.0,
        "consequence_value": 2395.0,
        "measurement": {"unit": "per turnaround"},
    }

    result = manager._normalize_extracted_record(item, contract_currency="USD")

    assert result["measurement"]["currency"] == "USD"


def test_a_non_monetary_record_gets_no_currency(manager):
    """A latency target is not denominated in anything."""
    item = {
        "quote": "Severity 1 response within 4 hours.",
        "unit": "hours",
        "value": 4,
        "measurement": {"unit": "hours", "operator": "<="},
    }

    result = manager._normalize_extracted_record(item, contract_currency="USD")

    assert result.get("currency") is None
    assert result["measurement"].get("currency") is None


# ---------------------------------------------------------------------------
# Ownership is never guessed
# ---------------------------------------------------------------------------

def test_ownership_is_not_inferred_from_money_words(manager):
    """The old rule read 'fee' and answered 'client'; no quote implies a party."""
    item = {
        "quote": "A handling fee of 450.00 is payable per movement.",
        "party_role": None,
        "unit": "USD",
        "measurement": {"unit": "USD"},
    }

    result = manager._normalize_extracted_record(item, contract_currency="USD")

    assert result.get("party_role") is None


def test_ownership_is_not_defaulted_to_supplier(manager):
    """And the old rule's else-branch answered 'supplier' for everything else."""
    item = {"quote": "Reports shall be provided each Monday.", "party_role": None}

    result = manager._normalize_extracted_record(item)

    assert result.get("party_role") is None


# ---------------------------------------------------------------------------
# Merge identity
# ---------------------------------------------------------------------------

def test_unrelated_obligations_are_not_merged_by_domain_synonym(manager):
    """'electricity'->'power' and 'supply'->'power' collapsed distinct records.

    The key seeds kpi_id, so those merges were permanent.
    """
    electricity = manager._extraction_metric_key({"name": "Electricity Charge", "value": 12.5, "unit": "USD"})
    supply = manager._extraction_metric_key({"name": "Water Supply Charge", "value": 12.5, "unit": "USD"})

    assert electricity != supply


def test_the_same_metric_still_converges(manager):
    """Removing the hacks must not break genuine convergence."""
    left = manager._extraction_metric_key({"name": "SLA-01: Monthly Availability", "value": 99.9, "unit": "%"})
    right = manager._extraction_metric_key({"name": "SLA-01 Availability Target", "value": 99.9, "unit": "%"})

    assert left == right


# ---------------------------------------------------------------------------
# Fee schedules
# ---------------------------------------------------------------------------

def test_a_schedule_with_no_stated_unit_does_not_invent_one(manager):
    items = [
        {"name": "Storage 0-10 tonnes", "value": 100, "unit": None, "quote": "0-10 tonnes 100"},
        {"name": "Storage 11-20 tonnes", "value": 200, "unit": None, "quote": "11-20 tonnes 200"},
    ]

    result = manager._consolidate_multi_tier_schedules(items)

    for record in result:
        assert record.get("unit") != "SEK"
        assert (record.get("measurement") or {}).get("currency") != "SEK"
