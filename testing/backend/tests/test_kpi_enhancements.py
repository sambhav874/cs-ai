import pytest
from datetime import datetime
from unittest.mock import MagicMock, patch
from services.kpi_manager import ContractKPIManager
from services.kpi_schema import KPISchemaV1toV2Migrator, flatten_for_legacy_frontend

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


def test_phase_aware_record_preserves_measurement_and_recovery_separately():
    manager = ContractKPIManager.__new__(ContractKPIManager)
    phase = {
        "source_id": "src-1",
        "record_type": "penalty",
        "name": "KPI-TEL-09: Sev 1 MTTR",
        "description": "MTTR target with a financial consequence.",
        "party_role": "supplier",
        "party_name": "Provider",
        "quote": "Sev 1 MTTR must be less than 15 minutes; failure incurs $10,000 per incident.",
        "measurement": {"target_type": "scalar", "operator": "lt", "threshold": 15, "unit": "minutes"},
        "recovery": {
            "mechanism": "liquidated_damages",
            "direction": "recover_from_supplier",
            "consequence_value": 10000,
            "consequence_unit": "currency",
            "consequence_currency": "USD",
        },
        "confidence": 0.95,
        "needs_review": False,
    }
    row = {
        "phase1": phase,
        "_phase_record": {"record_id": "REC-1", "status": "source_mapped", "phase4": {"action": "claim damages"}},
    }
    item = manager._kpi_from_llm_row(
        row=row,
        record_lookup={"src-1": {"text": phase["quote"], "candidate": {"segment_id": "seg-1"}, "section_path": "Article V"}},
        contract_id="contract-1",
        project_id=None,
        contract_name="contract.pdf",
        user_id="user-1",
        run_id="run-1",
        provider="test",
    )

    assert item["value"] == 15
    assert item["unit"] == "minutes"
    assert item["consequence_value"] == 10000
    assert item["recovery"]["mechanism"] == "liquidated_damages"
    assert item["phase4"]["action"] == "claim damages"

    flat = flatten_for_legacy_frontend(KPISchemaV1toV2Migrator.migrate_doc(item))
    assert flat["rule"]["spec"]["target"] == 15
    assert flat["recovery"]["mechanism"] == "liquidated_damages"


def test_missing_measurement_does_not_promote_penalty_number_to_threshold():
    manager = ContractKPIManager.__new__(ContractKPIManager)
    parsed = manager._parse_quantitative_threshold(
        raw_value=None,
        raw_operator=None,
        raw_unit="minutes",
        quote="Failure incurs $10,000 per incident.",
    )
    assert parsed["value"] is None
    assert parsed["value_min"] is None
    assert parsed["operator"] == "specified"


def test_canonical_consolidation_merges_supporting_rows_without_losing_target():
    manager = ContractKPIManager.__new__(ContractKPIManager)
    rows = [
        {"name": "KPI-TEL-01: Core Uptime", "canonical_metric_key": "KPI-TEL-01", "value": 99.99, "unit": "%", "quote": "Core uptime target 99.99%.", "citation": {"source_id": "a"}, "confidence": 0.95},
        {"name": "KPI-TEL-01: Core Uptime Tier 1", "canonical_metric_key": "KPI-TEL-01", "value": None, "target_schedule": [{"tier": "Tier 1", "range": "99.990%-99.994%", "credit_pct": 5}], "recovery": {"mechanism": "service_credit"}, "quote": "99.990%-99.994%: 5% credit.", "citation": {"source_id": "b"}, "confidence": 0.90},
    ]
    result = manager._consolidate_and_group_kpis(rows)
    assert len(result) == 1
    assert result[0]["value"] == 99.99
    assert result[0]["target_schedule"][0]["credit_pct"] == 5
    assert result[0]["recovery"]["mechanism"] == "service_credit"
    assert len(result[0]["source_evidence"]) == 2

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


def test_validate_rule_spec_validates_tiered_range_and_budget():
    from services.kpi_schema import validate_rule_spec

    # 1. Valid range vs Invalid range (min >= max)
    assert validate_rule_spec("range", {"min": 10.0, "max": 20.0}) == []
    errors = validate_rule_spec("range", {"min": 25.0, "max": 20.0})
    assert len(errors) == 1
    assert "strictly less than" in errors[0]

    # 2. Overlapping / Unsorted Tiered spec
    invalid_tiers = {
        "tiers": [
            {"level": "T1", "value": 90.0, "funding_pct": 100},
            {"level": "T2", "value": 85.0, "funding_pct": 80},
        ],
        "interpolation": "step",
    }
    tier_errors = validate_rule_spec("tiered", invalid_tiers)
    assert len(tier_errors) == 1
    assert "sorted ascending" in tier_errors[0]

    # 3. Error budget == 0
    budget_errors = validate_rule_spec("error_budget", {"budget": 0})
    assert len(budget_errors) == 1
    assert "cannot be zero" in budget_errors[0]


def test_evaluate_safe_formula_rejects_eval_code_execution():
    from services.kpi_schema import evaluate_safe_formula

    # Valid arithmetic formula with context lookup
    context = {"kpi1": 100.0, "kpi2": 50.0}
    assert evaluate_safe_formula("kpi1 * 0.6 + kpi2 * 0.4", context) == 80.0
    assert evaluate_safe_formula("(kpi1 - kpi2) / 2", context) == 25.0

    # Rejection of unsafe function calls or code injection
    with pytest.raises(ValueError, match="Disallowed expression node type"):
        evaluate_safe_formula("__import__('os').system('ls')", context)

    with pytest.raises(ValueError, match="Undefined variable"):
        evaluate_safe_formula("unknown_var * 2", context)


def test_qualitative_kpi_rejects_auto_evaluation():
    manager = ContractKPIManager()
    manager.kpis = MagicMock()
    manager.kpis.find_one.return_value = {
        "kpi_id": "kpi-qual-1",
        "contract_id": "contract-1",
        "name": "Commercially reasonable efforts",
        "tracking_status": "tracked",
        "is_tracked": True,
        "rule_type": "qualitative",
        "rule": {
            "rule_type": "qualitative",
            "spec": {"description": "Contractor shall use commercially reasonable efforts."},
        },
    }

    with pytest.raises(ValueError, match="human judgment and cannot be auto-evaluated"):
        manager.evaluate_kpi(
            kpi_id="kpi-qual-1",
            actual_value="done",
            user_id="user-1",
            contract_id="contract-1",
        )


def test_composite_kpi_dag_cycle_detection():
    from services.kpi_schema import detect_composite_cycle

    contract_kpis = [
        {"kpi_id": "kpi_a", "schema_version": 2, "rule": {"rule_type": "composite", "spec": {"ref_kpi_ids": ["kpi_b"]}}},
        {"kpi_id": "kpi_b", "schema_version": 2, "rule": {"rule_type": "composite", "spec": {"ref_kpi_ids": ["kpi_c"]}}},
    ]

    # Valid DAG addition (c references d)
    cycle = detect_composite_cycle("kpi_c", ["kpi_d"], contract_kpis)
    assert cycle is None

    # Self reference cycle
    cycle_self = detect_composite_cycle("kpi_a", ["kpi_a"], contract_kpis)
    assert cycle_self == ["kpi_a", "kpi_a"]

    # Multi-hop transitive cycle (c references a -> creating a -> b -> c -> a)
    cycle_transitive = detect_composite_cycle("kpi_c", ["kpi_a"], contract_kpis)
    assert cycle_transitive is not None
    assert "kpi_a" in cycle_transitive


def test_v1_to_v2_migration_and_translation_shim():
    from services.kpi_schema import KPISchemaV1toV2Migrator, flatten_for_legacy_frontend

    v1_doc = {
        "_id": "507f1f77bcf86cd799439011",
        "kpi_id": "kpi_v1_legacy",
        "schema_version": 1,
        "contract_id": "contract-100",
        "name": "Legacy Uptime",
        "kpi_type": "sla",
        "operator": ">=",
        "value": 99.9,
        "unit": "%",
        "consequence_value": 1000.0,
        "consequence_unit": "USD",
        "is_tracked": True,
        "tracking_status": "tracked",
        "custom_tag": "enterprise_sla",
    }

    # Migrate to V2
    v2_doc = KPISchemaV1toV2Migrator.migrate_doc(v1_doc)
    assert v2_doc["schema_version"] == 2
    assert v2_doc["identity"]["name"] == "Legacy Uptime"
    assert v2_doc["rule"]["rule_type"] == "threshold"
    assert v2_doc["rule"]["spec"]["target"] == 99.9
    assert v2_doc["consequence"]["value"] == 1000.0
    assert v2_doc["custom_attributes"]["custom_tag"] == "enterprise_sla"

    # Flatten for legacy frontend shim
    flat = flatten_for_legacy_frontend(v2_doc)
    assert flat["kpi_id"] == "kpi_v1_legacy"
    assert flat["target_value"] == 99.9
    assert flat["name"] == "Legacy Uptime"
    assert flat["custom_tag"] == "enterprise_sla"
