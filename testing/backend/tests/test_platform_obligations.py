"""Handing an extraction run's obligations to the lifecycle API.

Only verified records cross over; a quarantined one is counted, never sent.
An error run carries no register, so it cannot be read as "no obligations"
and clear the platform's list. Delivery problems are reported, not raised.
"""
from types import SimpleNamespace

from services.platform_obligations import (
    MAX_RECORDS,
    MAX_TIERS,
    to_platform_terms,
    SYNC_PATH,
    build_sync_payload,
    push_to_platform,
    to_platform_record,
)

CONTRACT = "cmcontract0000000000000001"


def kpi(**over):
    base = {
        "kpi_id": "kpi_abc",
        "name": "On-time delivery",
        "description": "Deliver 95% of critical-lane loads on time",
        "kpi_type": "sla",
        "party_role": "supplier",
        "frequency": "monthly",
        "quote": "Critical Lane On-Time Delivery below 95.0% in any month.",
        "page_start": 3,
        "section": "Section 9.01",
        "needs_review": False,
        "quarantined": False,
        "pack_id": "logistics",
        "pack_version": "1.2.0",
    }
    base.update(over)
    return base


def test_verified_record_maps_to_platform_vocabulary():
    record = to_platform_record(kpi())
    assert record == {
        "externalId": "kpi_abc",
        "name": "On-time delivery",
        "description": "Deliver 95% of critical-lane loads on time",
        "kpiType": "sla",
        "obligationClass": None,
        "partyRole": "supplier",
        "frequency": "monthly",
        "trigger": None,
        "quote": "Critical Lane On-Time Delivery below 95.0% in any month.",
        "page": 3,
        "section": "Section 9.01",
        "needsReview": False,
        "packId": "logistics",
        "packVersion": "1.2.0",
        "terms": {
            "ruleType": None, "operator": None, "value": None, "valueMin": None, "valueMax": None,
            "unit": None, "aggregation": None, "period": None, "tiers": [], "consequence": None,
            "remediation": None, "remediationSla": None, "gracePeriodDays": None, "action": None,
            "exceptions": [], "collapsedRowCount": None,
        },
    }


def test_unverifiable_records_are_not_sent():
    assert to_platform_record(kpi(quarantined=True)) is None
    assert to_platform_record(kpi(quote="  ", source_quote=None)) is None
    assert to_platform_record(kpi(kpi_id=None)) is None


def test_bad_page_is_dropped_not_guessed():
    assert to_platform_record(kpi(page_start=0))["page"] is None
    assert to_platform_record(kpi(page_start="n/a"))["page"] is None


def test_success_payload_counts_quarantined_records_in_the_ledger():
    result = {
        "run_id": "kpi_run_1",
        "extraction_method": "hybrid_llm_once",
        "pack_id": "logistics",
        "pack_version": "1.2.0",
        "contract_family": "logistics",
        "clause_ledger": {"total": 10, "extracted": 7, "rejected": 2, "lost": 1},
        "kpis": [kpi(), kpi(kpi_id="kpi_q", quarantined=True)],
    }
    payload = build_sync_payload(CONTRACT, status="success", result=result)
    assert payload["platformContractId"] == CONTRACT
    assert [r["externalId"] for r in payload["records"]] == ["kpi_abc"]
    assert payload["ledger"] == {"total": 10, "extracted": 7, "rejected": 2, "lost": 1, "quarantined": 1}
    assert payload["truncated"] is False


def test_error_run_carries_no_register():
    payload = build_sync_payload(CONTRACT, status="error", error="No provider configured")
    assert payload["records"] is None
    assert payload["error"] == "No provider configured"
    assert payload["ledger"] is None


def test_runaway_register_is_capped_and_flagged():
    result = {"kpis": [kpi(kpi_id=f"k{i}") for i in range(MAX_RECORDS + 5)]}
    payload = build_sync_payload(CONTRACT, status="success", result=result)
    assert len(payload["records"]) == MAX_RECORDS
    assert payload["truncated"] is True


def test_push_posts_with_the_secret():
    calls = []

    def post(url, json, headers, timeout):
        calls.append((url, json, headers))
        return SimpleNamespace(status_code=200, text="ok")

    out = push_to_platform({"x": 1}, post=post, api_url="http://api:8080/", secret="s3cret")
    assert out == {"status": "delivered"}
    assert calls == [(f"http://api:8080{SYNC_PATH}", {"x": 1}, {"x-internal-secret": "s3cret"})]


def test_push_reports_refusal_and_network_failure_without_raising():
    refused = push_to_platform(
        {}, post=lambda *a, **k: SimpleNamespace(status_code=404, text="Contract not found"),
        api_url="http://api", secret="s",
    )
    assert refused["status"] == "failed" and refused["http_status"] == 404

    def boom(*a, **k):
        raise ConnectionError("refused")

    down = push_to_platform({}, post=boom, api_url="http://api", secret="s")
    assert down["status"] == "failed" and "refused" in down["error"]


def test_push_without_configuration_does_nothing():
    def never(*a, **k):
        raise AssertionError("must not be called")

    assert push_to_platform({}, post=never, api_url="", secret="s") == {"status": "not_configured"}
    assert push_to_platform({}, post=never, api_url="http://api", secret="") == {"status": "not_configured"}


def test_run_level_fields_are_strings_even_when_packs_store_numbers():
    payload = build_sync_payload(CONTRACT, status="success", result={"pack_version": 1, "pack_id": "logistics", "kpis": []})
    assert payload["packVersion"] == "1"
    record = to_platform_record(kpi(pack_version=2))
    assert record["packVersion"] == "2"


def test_threshold_rule_and_consequence_cross_over():
    terms = to_platform_terms(kpi(
        rule_type="threshold", operator=">=", value=95.0, unit="%", aggregation_type="monthly_average",
        period_type="monthly", consequence_value=12000, consequence_unit="per 0.1 percentage point",
        currency="USD", recovery={"mechanism": "service_credit"}, remediation="Corrective action plan",
        remediation_sla="10 business days", grace_period_days=0, obligation_action="Deliver on time",
        exceptions=["Force Majeure", {"nested": True}, "  "],
    ))
    assert terms["ruleType"] == "threshold"
    assert (terms["operator"], terms["value"], terms["unit"]) == (">=", 95.0, "%")
    assert terms["aggregation"] == "monthly_average" and terms["period"] == "monthly"
    assert terms["consequence"] == {
        "value": 12000.0, "unit": "per 0.1 percentage point", "currency": "USD", "mechanism": "service_credit",
    }
    assert terms["remediationSla"] == "10 business days"
    assert terms["exceptions"] == ["Force Majeure"]


def test_tiers_normalise_whatever_the_extractor_called_their_keys():
    terms = to_platform_terms(kpi(rule_type="tiered", target_schedule=[
        {"tier": "Tier 1", "range": "99.990%-99.994%", "credit_pct": 5},
        {"band": "3,000-5,000 kg", "value": "420", "unit": "per turn", "currency": "EUR"},
        "not a tier",
    ]))
    assert terms["tiers"] == [
        {"label": "Tier 1", "range": "99.990%-99.994%", "value": None, "unit": None, "currency": None, "creditPct": 5.0},
        {"label": "Tier 2", "range": "3,000-5,000 kg", "value": 420.0, "unit": "per turn", "currency": "EUR", "creditPct": None},
    ]


def test_junk_numbers_and_runaway_tiers_are_contained():
    terms = to_platform_terms(kpi(value="n/a", value_min=float("nan"), value_max=True,
                                  target_schedule=[{"tier": str(i)} for i in range(MAX_TIERS + 10)]))
    assert terms["value"] is None and terms["valueMin"] is None and terms["valueMax"] is None
    assert len(terms["tiers"]) == MAX_TIERS
    assert to_platform_terms(kpi(recovery="liquidated_damages"))["consequence"]["mechanism"] == "liquidated_damages"


def test_cadence_falls_back_to_the_measurement_period():
    assert to_platform_record(kpi(frequency=None, period_type="monthly"))["frequency"] == "monthly"
    assert to_platform_record(kpi(frequency=None, measurement={"aggregation": "quarterly"}))["frequency"] == "quarterly"
    assert to_platform_record(kpi(frequency="weekly", period_type="monthly"))["frequency"] == "weekly"
    assert to_platform_record(kpi(frequency=None))["frequency"] is None
