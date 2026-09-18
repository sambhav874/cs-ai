from services.obligation_extraction_schema import (
    normalize_extraction_envelope,
    normalize_party_role,
    normalize_record_type,
    validate_extraction_envelope,
)


def _phase(**overrides):
    value = {
        "source_id": "src-1",
        "record_type": "trackable_operational_obligation",
        "name": "Operational service obligation",
        "description": "The responsible party must perform the stated service.",
        "party_role": "supplier",
        "party_name": "Ground Handler",
        "clause_ref": "3.1",
        "quote": "The Supplier shall perform the service within the stated time.",
        "obligation": {"action": "perform the service", "trigger": "on each service event"},
        "measurement": {"target_type": "scalar", "operator": "<=", "threshold": 20, "unit": "minutes"},
        "evidence_hypothesis": {"evidence_artifact": "operational service record"},
        "confidence": 0.95,
    }
    value.update(overrides)
    return value


def test_party_role_normalization_has_only_contract_roles_and_no_default():
    assert normalize_party_role("handler") == "supplier"
    assert normalize_party_role("airline") == "client"
    assert normalize_party_role("both") == "mutual"
    assert normalize_party_role("unclear party") is None


def test_legacy_record_types_map_to_obligation_first_types():
    assert normalize_record_type("kpi") == "supporting_measurement"
    assert normalize_record_type("obligation") == "trackable_operational_obligation"
    assert normalize_record_type("penalty") == "financial_consequence"


def test_envelope_normalizes_supplier_client_and_mutual_records():
    payload = {
        "records": [
            {"record_id": "OBL-001", "phase1": _phase()},
            {"record_id": "OBL-002", "phase1": _phase(party_role="client", measurement=None)},
            {"record_id": "OBL-003", "phase1": _phase(party_role="mutual")},
        ]
    }
    envelope = normalize_extraction_envelope(payload, source_ids=["src-1"])
    assert envelope["schema_version"] == "2.1"
    assert [record["phase1"]["party_role"] for record in envelope["records"]] == ["supplier", "client", "mutual"]
    assert all(record["phase1"]["trackability_status"] in {"trackable", "trackable_with_gap"} for record in envelope["records"])
    assert validate_extraction_envelope(envelope, source_ids=["src-1"]) == []


def test_ambiguous_ownership_is_reviewable_and_never_defaults_to_supplier():
    envelope = normalize_extraction_envelope({"records": [{"phase1": _phase(party_role="not stated")}]} )
    phase = envelope["records"][0]["phase1"]
    assert phase["party_role"] is None
    assert phase["needs_review"] is True
    assert "Party ownership is unresolved" in phase["notes"]
    assert any("party_role" in error for error in validate_extraction_envelope(envelope))


def test_reference_and_process_records_can_be_non_actionable():
    envelope = normalize_extraction_envelope(
        {
            "records": [
                {"phase1": _phase(record_type="reference_only", party_role=None, measurement=None)},
                {"phase1": _phase(record_type="process_only", party_role=None, measurement=None)},
            ]
        }
    )
    assert [record["phase1"]["trackability_status"] for record in envelope["records"]] == ["reference_only", "process_only"]
    assert validate_extraction_envelope(envelope) == []
