"""Hand an extraction run's obligations to the lifecycle API.

This tier extracts; the lifecycle API is where an obligation gets an owner, a
due date and a reminder. After every run on a linked contract (one with a
`platformContractId`) the verified records and the clause ledger are pushed to
POST /api/internal/obligations/sync, which upserts them by `externalId`.

Only records whose quote verified against the source are sent. A quarantined
record (quote not verbatim, envelope invalid) is counted in the payload, never
written: an obligation nobody can check against the contract does not become a
task someone is chased for.

The push never fails the extraction. A delivery failure is recorded on the
contract (`obligations.platform_sync`) and the next run, or a manual re-sync,
delivers the whole register again.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

SYNC_PATH = "/api/internal/obligations/sync"
# Obligations the platform shows as a single row each. A register past this
# is almost certainly a runaway, and the API enforces the same cap.
MAX_RECORDS = 1000
MAX_TEXT = 4000


def _text(value: Any, limit: int = MAX_TEXT) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _page(value: Any) -> Optional[int]:
    try:
        page = int(value)
    except (TypeError, ValueError):
        return None
    return page if page >= 1 else None


def _num(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


MAX_TIERS = 50
MAX_LIST = 20


def _tiers(schedule: Any) -> List[Dict[str, Any]]:
    """Tier rows in one shape, whatever the extractor named their keys."""
    tiers: List[Dict[str, Any]] = []
    for index, raw in enumerate(schedule if isinstance(schedule, list) else []):
        if not isinstance(raw, dict):
            continue
        tiers.append({
            "label": _text(raw.get("tier") or raw.get("label") or raw.get("name"), 80) or f"Tier {index + 1}",
            "range": _text(raw.get("range") or raw.get("band") or raw.get("condition"), 160),
            "value": _num(raw.get("value") if raw.get("value") is not None else raw.get("amount")),
            "unit": _text(raw.get("unit"), 32),
            "currency": _text(raw.get("currency"), 8),
            "creditPct": _num(raw.get("credit_pct") if raw.get("credit_pct") is not None else raw.get("credit_percent")),
        })
        if len(tiers) >= MAX_TIERS:
            break
    return tiers


def _consequence(kpi: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    recovery = kpi.get("recovery")
    mechanism = recovery.get("mechanism") if isinstance(recovery, dict) else recovery
    consequence = {
        "value": _num(kpi.get("consequence_value")),
        "unit": _text(kpi.get("consequence_unit"), 40),
        "currency": _text(kpi.get("currency"), 8),
        "mechanism": _text(mechanism, 60),
    }
    return consequence if any(v is not None for v in consequence.values()) else None


def _texts(values: Any) -> List[str]:
    items = values if isinstance(values, list) else []
    out = [t for t in (_text(v, 300) for v in items if not isinstance(v, (dict, list))) if t]
    return out[:MAX_LIST]


def to_platform_terms(kpi: Dict[str, Any]) -> Dict[str, Any]:
    """What the obligation actually requires, in the API's vocabulary.

    The rule (operator, target, range or tiers), how it is measured, and what
    happens on a miss. This is the part of ContractSense's record that makes
    an obligation trackable — "on-time delivery" alone is not; "at least 95%
    monthly, 5% service credit per point below" is.
    """
    measurement = kpi.get("measurement") if isinstance(kpi.get("measurement"), dict) else {}
    return {
        "ruleType": _text(kpi.get("rule_type"), 40),
        "operator": _text(kpi.get("operator"), 40),
        "value": _num(kpi.get("value")),
        "valueMin": _num(kpi.get("value_min")),
        "valueMax": _num(kpi.get("value_max")),
        "unit": _text(kpi.get("unit"), 32),
        "aggregation": _text(kpi.get("aggregation_type") or measurement.get("aggregation"), 40),
        "period": _text(kpi.get("period_type"), 40),
        "tiers": _tiers(kpi.get("target_schedule")),
        "consequence": _consequence(kpi),
        "remediation": _text(kpi.get("remediation"), 1000),
        "remediationSla": _text(kpi.get("remediation_sla"), 200),
        "gracePeriodDays": _num(kpi.get("grace_period_days")),
        "action": _text(kpi.get("obligation_action"), 500),
        "exceptions": _texts(kpi.get("exceptions")),
        "collapsedRowCount": _num(kpi.get("collapsed_row_count")),
    }


def _measurement(kpi: Dict[str, Any]) -> Dict[str, Any]:
    m = kpi.get("measurement")
    return m if isinstance(m, dict) else {}


def to_platform_record(kpi: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """One extracted record in the API's vocabulary, or None if unverified."""
    quote = _text(kpi.get("quote") or kpi.get("source_quote"))
    external_id = _text(kpi.get("kpi_id"), 200)
    if not quote or not external_id or kpi.get("quarantined"):
        return None
    return {
        "externalId": external_id,
        "name": _text(kpi.get("name"), 200),
        "description": _text(kpi.get("description")) or quote[:500],
        "kpiType": _text(kpi.get("kpi_type"), 64),
        "obligationClass": _text(kpi.get("obligation_class"), 64),
        "partyRole": _text(kpi.get("party_role"), 32),
        # The extractor often leaves `frequency` empty and records the cadence
        # as the measurement period ("monthly", "per_invoice") instead.
        "frequency": _text(kpi.get("frequency") or kpi.get("period_type") or _measurement(kpi).get("aggregation"), 32),
        "trigger": _text(kpi.get("trigger") or kpi.get("trigger_condition"), 1000),
        "quote": quote,
        "page": _page(kpi.get("page_start")),
        "section": _text(kpi.get("section"), 300),
        "needsReview": bool(kpi.get("needs_review")),
        "packId": _text(kpi.get("pack_id"), 120),
        "packVersion": _text(kpi.get("pack_version"), 40),
        "terms": to_platform_terms(kpi),
    }


def build_sync_payload(
    platform_contract_id: str,
    *,
    status: str,
    result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
) -> Dict[str, Any]:
    """The whole register for one contract, plus how it was produced. PURE."""
    result = result or {}
    records: List[Dict[str, Any]] = []
    quarantined = 0
    for kpi in result.get("kpis") or []:
        record = to_platform_record(kpi)
        if record is None:
            quarantined += 1
        else:
            records.append(record)
    ledger = result.get("clause_ledger") or {}
    return {
        "platformContractId": platform_contract_id,
        "status": status,
        "error": _text(error, 500),
        # Every run-level field goes through _text: pack versions are stored
        # as numbers in some packs, and the API's contract is strings.
        "runId": _text(result.get("run_id"), 120),
        "extractionMethod": _text(result.get("extraction_method"), 80),
        "packId": _text(result.get("pack_id"), 120),
        "packVersion": _text(result.get("pack_version"), 40),
        "contractFamily": _text(result.get("contract_family"), 80),
        "ledger": {
            "total": int(ledger.get("total") or 0),
            "extracted": int(ledger.get("extracted") or 0),
            "rejected": int(ledger.get("rejected") or 0),
            "lost": int(ledger.get("lost") or 0),
            "quarantined": quarantined,
        } if ledger or quarantined else None,
        # Only a completed run carries a register. An error run must not be
        # read as "this contract has no obligations" and clear the list.
        "records": records[:MAX_RECORDS] if status in {"success", "degraded"} else None,
        "truncated": len(records) > MAX_RECORDS,
    }


def push_to_platform(
    payload: Dict[str, Any],
    *,
    post: Optional[Callable[..., Any]] = None,
    api_url: Optional[str] = None,
    secret: Optional[str] = None,
) -> Dict[str, Any]:
    """POST the payload; return a small status dict for the contract doc."""
    api_url = (api_url if api_url is not None else os.getenv("API_URL", "")).rstrip("/")
    secret = secret if secret is not None else os.getenv("INTERNAL_SERVICE_SECRET", "")
    if not api_url or not secret:
        return {"status": "not_configured"}
    if post is None:
        import requests

        post = requests.post
    try:
        response = post(
            f"{api_url}{SYNC_PATH}",
            json=payload,
            headers={"x-internal-secret": secret},
            timeout=30,
        )
    except Exception as exc:  # network: the next run re-delivers everything
        logger.warning("Obligation sync to the platform failed: %s", exc)
        return {"status": "failed", "error": str(exc)[:300]}
    if getattr(response, "status_code", 500) >= 300:
        detail = str(getattr(response, "text", ""))[:300]
        logger.warning("Platform refused obligation sync (%s): %s", response.status_code, detail)
        return {"status": "failed", "http_status": response.status_code, "error": detail}
    return {"status": "delivered"}
