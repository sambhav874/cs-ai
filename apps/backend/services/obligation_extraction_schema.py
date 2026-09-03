"""Agreement-first extraction envelope for trackable operational obligations.

The extraction envelope is intentionally separate from the persisted KPI V2
document.  It gives the model a richer, obligation-first contract while the
storage adapter can continue serving legacy KPI consumers.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional


EXTRACTION_SCHEMA_VERSION = "2.1"

RECORD_TYPES = {
    "trackable_operational_obligation",
    "supporting_measurement",
    "reporting_or_evidence_obligation",
    "financial_consequence",
    "reference_only",
    "process_only",
}

PARTY_ROLES = {"supplier", "client", "mutual"}

TRACKABILITY_STATUSES = {
    "trackable",
    "trackable_with_gap",
    "reference_only",
    "process_only",
}

LEGACY_RECORD_TYPE_MAP = {
    "kpi": "supporting_measurement",
    "obligation": "trackable_operational_obligation",
    "penalty": "financial_consequence",
    "measure": "supporting_measurement",
    "metric": "supporting_measurement",
    "recovery": "financial_consequence",
}


def normalize_record_type(value: Any) -> str:
    raw = str(value or "").strip().lower().replace("-", "_")
    return LEGACY_RECORD_TYPE_MAP.get(raw, raw if raw in RECORD_TYPES else "trackable_operational_obligation")


def normalize_party_role(value: Any) -> Optional[str]:
    """Return only the contractual party vocabulary, never an inferred default."""
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    if raw in PARTY_ROLES:
        return raw
    if raw in {"provider", "vendor", "contractor", "handler", "service_provider", "seller"}:
        return "supplier"
    if raw in {"customer", "carrier", "airline", "operator", "buyer", "client"}:
        return "client"
    if raw in {"both", "each_party", "each_party_mutual", "joint", "bilateral"}:
        return "mutual"
    return None


def _text(value: Any) -> str:
    return str(value or "").strip()


def _as_list(value: Any) -> List[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _notes_with(notes: Any, message: str) -> str:
    existing = _text(notes)
    return f"{existing}; {message}" if existing else message


def classify_trackability(phase1: Dict[str, Any]) -> Dict[str, Any]:
    """Classify whether an extracted record can be monitored later.

    This is intentionally conservative.  It never invents a party, target,
    evidence source, or remedy; missing elements become explicit review gaps.
    """
    record_type = normalize_record_type(phase1.get("record_type"))
    measurement = phase1.get("measurement") if isinstance(phase1.get("measurement"), dict) else {}
    evidence = phase1.get("evidence_hypothesis") if isinstance(phase1.get("evidence_hypothesis"), dict) else {}
    obligation = phase1.get("obligation") if isinstance(phase1.get("obligation"), dict) else {}
    party_role = normalize_party_role(phase1.get("party_role"))

    action = _text(
        phase1.get("obligation_action")
        or phase1.get("action")
        or obligation.get("action")
        or phase1.get("description")
    )
    trigger = _text(phase1.get("trigger") or phase1.get("trigger_condition") or obligation.get("trigger"))
    cadence = phase1.get("cadence") or obligation.get("cadence")
    scope = _text(phase1.get("scope") or phase1.get("measurement_scope") or obligation.get("scope"))
    acceptance = _text(
        phase1.get("acceptance_criteria")
        or phase1.get("acceptance_condition")
        or obligation.get("acceptance_criteria")
    )
    evidence_artifact = _text(evidence.get("evidence_artifact") or evidence.get("detection_signal"))
    has_target = any(
        measurement.get(key) is not None
        for key in ("threshold", "threshold_min", "threshold_max", "reference", "lookup_table", "composite", "formula")
    ) or bool(measurement.get("target_type") in {"deadline", "duration", "evidence", "conforms_to"})
    has_timing = bool(trigger or cadence or measurement.get("measurement_window"))
    has_observable = bool(action or acceptance or has_target)

    checks = {
        "operative_language": bool(_text(phase1.get("quote")) and record_type not in {"reference_only"}),
        "party_identified": bool(party_role),
        "observable_outcome": has_observable,
        "timing_or_trigger": has_timing,
        "acceptance_or_measurement": bool(acceptance or measurement or has_target),
        "evidence_identified": bool(evidence_artifact),
        "consequence_or_follow_up": bool(phase1.get("recovery") or phase1.get("precondition") or phase1.get("workshop_input")),
    }
    missing = [key for key, present in checks.items() if not present]

    if record_type == "reference_only":
        status = "reference_only"
    elif record_type == "process_only":
        status = "process_only"
    elif checks["operative_language"] and checks["party_identified"] and checks["observable_outcome"] and checks["timing_or_trigger"] and checks["evidence_identified"]:
        status = "trackable"
    else:
        status = "trackable_with_gap"

    score = round(sum(1 for value in checks.values() if value) / len(checks), 2)
    return {
        "status": status,
        "score": score,
        "checks": checks,
        "missing_elements": missing,
    }


def normalize_phase1_record(phase1: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize legacy and new model output into the obligation vocabulary."""
    normalized = deepcopy(phase1 or {})
    normalized["record_type"] = normalize_record_type(normalized.get("record_type"))

    party_role = normalize_party_role(
        normalized.get("party_role")
        or normalized.get("obligation_type")
        or normalized.get("party_type")
    )
    normalized["party_role"] = party_role

    obligation = normalized.get("obligation") if isinstance(normalized.get("obligation"), dict) else {}
    normalized["obligation"] = {
        **obligation,
        "action": normalized.get("obligation_action") or normalized.get("action") or obligation.get("action"),
        "trigger": normalized.get("trigger") or normalized.get("trigger_condition") or obligation.get("trigger"),
        "scope": normalized.get("scope") or normalized.get("measurement_scope") or obligation.get("scope"),
        "acceptance_criteria": normalized.get("acceptance_criteria") or obligation.get("acceptance_criteria"),
        "dependencies": _as_list(normalized.get("dependencies") or obligation.get("dependencies")),
        "exceptions": _as_list(normalized.get("exceptions") or obligation.get("exceptions")),
    }

    if not normalized.get("measurement"):
        normalized["measurement"] = None
    if not normalized.get("recovery"):
        normalized["recovery"] = None

    trackability = classify_trackability(normalized)
    normalized["trackability"] = trackability
    normalized["trackability_status"] = trackability["status"]
    normalized["needs_review"] = bool(normalized.get("needs_review"))

    if party_role is None and normalized["record_type"] not in {"reference_only", "process_only"}:
        normalized["needs_review"] = True
        normalized["notes"] = _notes_with(normalized.get("notes"), "Party ownership is unresolved; expected supplier, client, or mutual.")
    if trackability["missing_elements"]:
        normalized["needs_review"] = True

    return normalized


def normalize_extraction_envelope(
    payload: Dict[str, Any],
    *,
    source_ids: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    """Normalize a model response without mutating the caller's payload."""
    result = deepcopy(payload or {})
    result["schema_version"] = EXTRACTION_SCHEMA_VERSION
    records = result.get("records")
    if not isinstance(records, list):
        records = result.get("kpis") if isinstance(result.get("kpis"), list) else []

    allowed_sources = {str(item) for item in (source_ids or []) if item}
    normalized_records: List[Dict[str, Any]] = []
    for index, raw_record in enumerate(records, start=1):
        if not isinstance(raw_record, dict):
            continue
        record = deepcopy(raw_record)
        phase1 = record.get("phase1") if isinstance(record.get("phase1"), dict) else record
        phase1 = normalize_phase1_record(phase1)
        source_id = _text(phase1.get("source_id"))
        if allowed_sources and source_id not in allowed_sources:
            phase1["needs_review"] = True
            phase1["notes"] = _notes_with(phase1.get("notes"), "Source ID is not present in the supplied extraction batch.")
        record["record_id"] = _text(record.get("record_id") or phase1.get("record_id")) or f"OBL-{index:03d}"
        record["status"] = _text(record.get("status")) or "extracted"
        record["phase1"] = phase1
        record.setdefault("phase2", None)
        record.setdefault("phase3", None)
        record.setdefault("phase4", {})
        normalized_records.append(record)

    result["records"] = normalized_records
    result.setdefault("contract_meta", {})
    result.setdefault("coverage", {})
    result["needs_more_context"] = bool(
        result.get("needs_more_context")
        or any(record.get("phase1", {}).get("needs_review") for record in normalized_records)
    )
    return result


def validate_records(
    payload: Dict[str, Any],
    *,
    source_ids: Optional[Iterable[str]] = None,
) -> Dict[int, List[str]]:
    """Per-record validation errors, keyed by 1-based record index.

    Structured rather than flat strings so a caller can quarantine the record
    that is actually wrong instead of logging a line about the whole batch and
    persisting everything anyway.

    Validate BEFORE normalizing: :func:`normalize_extraction_envelope` coerces
    an unknown ``record_type`` into a trackable obligation and stamps the
    current ``schema_version``, so those two checks can never fire afterwards.
    """
    errors: Dict[int, List[str]] = {}
    records = payload.get("records")
    if not isinstance(records, list):
        return errors

    allowed_sources = {str(item) for item in (source_ids or []) if item}
    for index, record in enumerate(records, start=1):
        record_errors: List[str] = []
        phase1 = record.get("phase1") if isinstance(record, dict) else None
        if not isinstance(phase1, dict):
            errors[index] = ["missing phase1"]
            continue

        raw_record_type = str(phase1.get("record_type") or "").strip().lower().replace("-", "_")
        record_type = normalize_record_type(raw_record_type)
        if raw_record_type not in RECORD_TYPES and raw_record_type not in LEGACY_RECORD_TYPE_MAP:
            record_errors.append(f"unsupported record_type {phase1.get('record_type')!r}")
        if not _text(phase1.get("name")):
            record_errors.append("missing name")
        if not _text(phase1.get("quote")):
            record_errors.append("missing quote")
        source_id = _text(phase1.get("source_id"))
        if allowed_sources and source_id not in allowed_sources:
            record_errors.append(f"unknown source_id {source_id!r}")
        if record_type not in {"reference_only", "process_only"} and normalize_party_role(phase1.get("party_role")) is None:
            record_errors.append("party_role must be supplier, client, or mutual")

        if record_errors:
            errors[index] = record_errors
    return errors


def validate_extraction_envelope(
    payload: Dict[str, Any],
    *,
    source_ids: Optional[Iterable[str]] = None,
) -> List[str]:
    """Return actionable validation errors for the extraction envelope."""
    errors: List[str] = []
    if not isinstance(payload, dict):
        return ["Extraction response must be a JSON object."]
    if payload.get("schema_version") not in {EXTRACTION_SCHEMA_VERSION, "2.0", 2, None}:
        errors.append("Unsupported extraction schema version.")
    if not isinstance(payload.get("records"), list):
        errors.append("Top-level 'records' must be an array.")
        return errors

    for index, record_errors in sorted(validate_records(payload, source_ids=source_ids).items()):
        for message in record_errors:
            errors.append(f"records[{index}] {message}.")
    return errors
