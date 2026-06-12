import pytest
from datetime import datetime
from unittest.mock import MagicMock, patch
from services.kpi_manager import ContractKPIManager

def test_calibrate_confidence():
    manager = ContractKPIManager()

    # 1. Definitions cap (capped at 0.80)
    calibrated, reason = manager._calibrate_confidence(0.95, "Article I: Definitions", "sla", "some text")
    assert calibrated == 0.80
    assert "Definitions" in reason

    # 2. SLA / KPI / Article IV boost (boosted to 1.00)
    calibrated, reason = manager._calibrate_confidence(0.75, "Article IV: Service Level Agreements", "sla", "some text")
    assert calibrated == 1.00
    assert "SLA/KPI" in reason

    # 3. Payment / Pricing boost (boosted to 0.95)
    calibrated, reason = manager._calibrate_confidence(0.70, "Article III: Fees and Payment", "financial", "some text")
    assert calibrated == 0.95
    assert "financial/payment" in reason

    # 4. Penalty / Termination boost (boosted to 0.90)
    calibrated, reason = manager._calibrate_confidence(0.70, "Article V: Penalties", "penalty", "some text")
    assert calibrated == 0.90
    assert "penalty/termination" in reason

    # 5. Retained default
    calibrated, reason = manager._calibrate_confidence(0.81, "Misc", "other", "some text")
    assert calibrated == 0.81
    assert "Retained" in reason

@patch("services.kpi_manager.requests.Session")
def test_rerank_candidates_with_voyage(mock_session_cls):
    mock_session = MagicMock()
    mock_session_cls.return_value = mock_session

    # Setup manager with fake key and mocked session
    manager = ContractKPIManager()
    manager.voyageai_api_key = "fake-key"
    manager.http_session = mock_session

    # Mock Voyage API response
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "object": "list",
        "data": [
            {"index": 1, "relevance_score": 0.95},
            {"index": 0, "relevance_score": 0.40}
        ]
    }
    mock_session.post.return_value = mock_response

    candidates = [
        {"text": "Candidate 1", "page_number": 1},
        {"text": "Candidate 2", "page_number": 2}
    ]

    reranked = manager._rerank_candidates_with_voyage(candidates)

    # Assertions
    assert len(reranked) == 2
    # Candidate 2 (original index 1) should be first because score is 0.95
    assert reranked[0]["text"] == "Candidate 2"
    assert reranked[0]["rerank_score"] == 0.95
    # Candidate 1 (original index 0) should be second because score is 0.40
    assert reranked[1]["text"] == "Candidate 1"
    assert reranked[1]["rerank_score"] == 0.40

def test_clause_filtering():
    manager = ContractKPIManager()

    # Candidate with general incentive context
    candidate = {
        "text": "Key Performance Incentive Plan and Midpoint Awards table details",
        "value_types": ["percentage"]
    }

    # A raw table row like "CEO – 50%" should now pass the permissive filter
    assert manager._clause_has_kpi_signal("CEO – 50%", candidate) is True

    # A performance rating row like "3.00 or greater 100%" should pass
    assert manager._clause_has_kpi_signal("3.00 or greater 100%", candidate) is True

    # A generic sentence without digits or keywords should fail
    assert manager._clause_has_kpi_signal("This plan is governed by state laws.", candidate) is False


def test_clause_filtering_rejects_reference_numbers():
    manager = ContractKPIManager()
    candidate = {
        "text": "Key Performance Incentive Plan and Midpoint Awards table details",
        "value_types": ["percentage"],
        "section_path": "Exhibit 10.33 > COO – 45%",
    }

    assert manager._clause_has_kpi_signal(
        "Disputes If an employee has an unresolved dispute or claim regarding the Key Performance Plan, "
        "the employee may request review by a Board of Review per Company Policy 62.02.",
        candidate,
    ) is False
    assert manager._clause_has_kpi_signal(
        "Incentive pay is included in the definition of pay for matching contributions in the 401(k).",
        candidate,
    ) is False
    assert manager._clause_has_kpi_signal(
        "EX-10.33 6 a2147227zex-10_33.htm EXHIBIT 10.33",
        candidate,
    ) is False
    assert manager._clause_has_kpi_signal(
        "Performance Measures: Earnings per Share (EPS) – 70% of the award will be based on EPS.",
        candidate,
    ) is True


def test_deterministic_kpi_contains_recommendation_metadata():
    manager = ContractKPIManager()
    candidate = {
        "text": "Performance Measures: Earnings per Share (EPS) – 70% of the award will be based on EPS.",
        "value_types": ["percentage"],
        "section_path": "Exhibit 10.33 > Performance Measures",
        "segment_id": "chunk-1",
        "chunk_level": "micro",
        "page_start": 1,
        "page_end": 1,
    }

    item = manager._kpi_from_clause(
        clause="Performance Measures: Earnings per Share (EPS) – 70% of the award will be based on EPS.",
        candidate=candidate,
        contract_id="contract-1",
        project_id="project-1",
        contract_name="Contract.pdf",
        user_id="user-1",
        run_id="run-1",
    )

    assert item is not None
    assert item["is_recommended"] is True
    assert item["tracking_status"] == "recommended"
    assert "measurable threshold/value" in item["recommendation_reason"]
    assert item["source_chunk_id"] == "chunk-1"
    assert item["post_extraction_ai_allowed"] is False
    assert item["evaluation_rule"]["ai_used"] is False
    assert item["source_config_status"] == "not_configured"


def test_source_config_maps_kpis_without_ai():
    manager = ContractKPIManager()
    manager.source_configs = MagicMock()
    manager.kpis = MagicMock()
    manager.source_configs.find_one.return_value = {
        "source_config_id": "src_cfg_1",
        "contract_id": "contract-1",
        "display_name": "SAP Dispatch",
        "source_type": "sap_s4hana",
        "field_mappings": [{"kpi_field": "actual_value", "source_field": "dispatch_score"}],
        "kpi_ids": ["kpi-1"],
    }

    result = manager.upsert_source_config(
        contract_id="contract-1",
        project_id="project-1",
        user_id="user-1",
        source_config_id="src_cfg_1",
        payload={
            "display_name": "SAP Dispatch",
            "source_type": "sap_s4hana",
            "auth_type": "oauth2",
            "schedule": {"cadence": "hourly", "timezone": "UTC"},
            "field_mappings": [{"kpi_field": "actual_value", "source_field": "dispatch_score"}],
            "kpi_ids": ["kpi-1"],
        },
    )

    assert result["source_type"] == "sap_s4hana"
    manager.kpis.update_many.assert_called_once()
    update_payload = manager.kpis.update_many.call_args.args[1]["$set"]
    assert update_payload["source_config_id"] == "src_cfg_1"
    assert update_payload["source_config_status"] == "configured"


def test_flag_breach_remediation_email_uses_kpi_contact_email():
    manager = ContractKPIManager()
    stored_breach = {
        "breach_id": "breach-1",
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "is_breach": True,
        "actual_value": 90,
        "actual_unit": "%",
        "threshold_value": 95,
        "source_kpi": {"name": "On-time delivery", "contract_name": "Supply Agreement"},
    }
    manager.breaches = MagicMock()
    manager.kpis = MagicMock()
    manager.breaches.find_one.side_effect = lambda *_args, **_kwargs: stored_breach
    manager.breaches.update_one.side_effect = lambda _query, update: stored_breach.update(update["$set"]) or MagicMock(matched_count=1)
    manager.kpis.find_one.return_value = {
        "kpi_id": "kpi-1",
        "name": "On-time delivery",
        "contact_email": "supplier.notice@example.com",
        "breach_email_template": "Subject: {{kpi_name}}\n\nThreshold {{threshold}}, actual {{actual_value}}{{unit}}, penalty {{penalty_amount}}, remediate {{remediation}} by {{remediation_sla}} under {{contract_name}}.",
    }

    result = manager.flag_breach_remediation_email("breach-1", user_id="user-1", contract_id="contract-1")

    assert result["breach_email_to"] == "supplier.notice@example.com"
    assert result["breach_email_recipient_source"]["source"] == "kpi.contact_email"
    assert result["send_remediation_email"] is True


@patch("services.kpi_manager.collection")
def test_flag_breach_remediation_email_falls_back_to_contract_supplier_party_email(mock_contracts):
    manager = ContractKPIManager()
    stored_breach = {
        "breach_id": "breach-1",
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "is_breach": True,
        "actual_value": 90,
        "actual_unit": "%",
        "threshold_value": 95,
        "source_kpi": {"name": "On-time delivery", "contract_name": "Supply Agreement"},
    }
    manager.breaches = MagicMock()
    manager.kpis = MagicMock()
    manager.breaches.find_one.side_effect = lambda *_args, **_kwargs: stored_breach
    manager.breaches.update_one.side_effect = lambda _query, update: stored_breach.update(update["$set"]) or MagicMock(matched_count=1)
    manager.kpis.find_one.return_value = {
        "kpi_id": "kpi-1",
        "name": "On-time delivery",
        "party": "Supplier",
        "contact_email": None,
        "breach_email_template": "Subject: {{kpi_name}}\n\nThreshold {{threshold}}, actual {{actual_value}}{{unit}}, penalty {{penalty_amount}}, remediate {{remediation}} by {{remediation_sla}} under {{contract_name}}.",
    }
    mock_contracts.find_one.return_value = {
        "parties": [
            {"role": "customer", "name": "Buyer", "email": "buyer@example.com"},
            {"role": "supplier", "name": "Supplier", "email": "supplier.ops@example.com"},
        ],
        "index": {"content": "Notices shall be sent to supplier.ops@example.com."},
    }

    result = manager.flag_breach_remediation_email("breach-1", user_id="user-1", contract_id="contract-1")

    assert result["breach_email_to"] == "supplier.ops@example.com"
    assert result["breach_email_recipient_source"]["source"] == "contract.parties"
    assert result["breach_email_recipient_source"]["matched_party"] == "Supplier"


def test_long_term_kpi_rule_uses_deterministic_window_aggregation():
    manager = ContractKPIManager()
    manager.kpis = MagicMock()
    manager.breaches = MagicMock()
    manager.actuals = MagicMock()
    manager.actuals.find.return_value = [
        {"value": 92},
        {"value": 94},
        {"value": 96},
    ]
    manager.kpis.find_one.return_value = {
        "kpi_id": "kpi-annual",
        "contract_id": "contract-1",
        "project_id": "project-1",
        "name": "Annual sustainable packaging target",
        "operator": ">=",
        "target_value": 95,
        "unit": "%",
        "aggregation_type": "avg",
        "period_type": "annual",
        "evaluation_window": "ytd",
        "tracking_status": "tracked",
        "is_tracked": True,
        "evaluation_rule": {
            "rule_type": "long_term_threshold",
            "operator": ">=",
            "target": 95,
            "unit": "%",
            "evaluation_window": "ytd",
            "aggregation": "avg",
            "ai_used": False,
        },
    }

    result = manager.evaluate_kpi(
        kpi_id="kpi-annual",
        actual_value=96,
        user_id="user-1",
        contract_id="contract-1",
        timestamp=manager._parse_datetime("2026-06-01"),
    )

    assert result["evaluation_mode"] == "deterministic_rule_engine"
    assert result["ai_used"] is False
    assert result["actual_value"] == 96
    assert result["threshold_value"] == 95
    assert result["is_breach"] is True
    assert result["sample_count"] == 3


def test_evaluate_kpi_requires_explicit_tracking():
    manager = ContractKPIManager()
    manager.kpis = MagicMock()
    manager.breaches = MagicMock()
    manager.kpis.find_one.return_value = {
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "name": "On-time delivery",
        "operator": ">=",
        "value": 95,
        "unit": "%",
        "tracking_status": "recommended",
        "is_tracked": False,
    }

    with pytest.raises(ValueError, match="Track it before evaluating"):
        manager.evaluate_kpi(
            kpi_id="kpi-1",
            actual_value=90,
            user_id="user-1",
            contract_id="contract-1",
        )

    manager.breaches.insert_one.assert_not_called()


def test_ingest_actuals_records_but_defers_untracked_evaluations():
    manager = ContractKPIManager()
    manager.list_contract_kpis = MagicMock(return_value=[{
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "name": "On-time delivery",
        "operator": ">=",
        "value": 95,
        "unit": "%",
        "tracking_status": "recommended",
        "is_tracked": False,
    }])
    manager.record_actual = MagicMock(return_value={
        "actual_id": "actual-1",
        "kpi_id": "kpi-1",
        "value": 90,
        "unit": "%",
        "source": "upload",
    })
    manager.evaluate_kpi = MagicMock()

    result = manager.ingest_actuals(
        contract_id="contract-1",
        user_id="user-1",
        rows=[{"kpi_id": "kpi-1", "value": 90}],
        source="upload",
        evaluate=True,
    )

    assert result["count"] == 1
    assert result["breaches"] == []
    assert result["deferred_evaluations"] == [{
        "row": 1,
        "kpi_id": "kpi-1",
        "kpi_name": "On-time delivery",
        "actual_id": "actual-1",
        "reason": "KPI is not tracked",
    }]
    manager.evaluate_kpi.assert_not_called()


def test_tracking_kpi_backfills_deferred_actuals():
    manager = ContractKPIManager()
    stored_kpi = {
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "name": "On-time delivery",
        "operator": ">=",
        "value": 95,
        "unit": "%",
        "tracking_status": "recommended",
        "is_tracked": False,
    }
    actual = {
        "actual_id": "actual-1",
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "value": 90,
        "unit": "%",
        "source": "upload",
        "timestamp": datetime(2026, 6, 1),
    }

    manager.kpis = MagicMock()
    manager.actuals = MagicMock()
    manager.breaches = MagicMock()

    manager.kpis.find_one.return_value = stored_kpi

    def update_kpi_doc(_query, update):
        stored_kpi.update(update.get("$set", {}))
        return MagicMock(matched_count=1)

    manager.kpis.update_one.side_effect = update_kpi_doc
    actual_cursor = MagicMock()
    actual_cursor.sort.return_value = [actual]
    manager.actuals.find.return_value = actual_cursor
    manager.breaches.find_one.return_value = None
    manager.evaluate_kpi = MagicMock(return_value={"breach_id": "breach-1", "is_breach": True})

    updated = manager.update_kpi(
        "kpi-1",
        {"is_tracked": True},
        user_id="user-1",
        contract_id="contract-1",
    )

    assert updated["is_tracked"] is True
    assert updated["tracking_status"] == "tracked"
    assert updated["last_tracking_backfill"]["created_breach_count"] == 1
    manager.evaluate_kpi.assert_called_once_with(
        kpi_id="kpi-1",
        actual_value=90,
        user_id="user-1",
        contract_id="contract-1",
        actual_unit="%",
        actual_id="actual-1",
        source="upload",
        timestamp=datetime(2026, 6, 1),
    )
