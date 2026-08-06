import argparse
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("HUGGINGFACE_TOKEN", "test")
os.environ.setdefault("GROQ_API_KEY", "test")
os.environ.setdefault("SUPPORT_EMAIL_ADDRESS", "test@example.com")
os.environ.setdefault("AZURE_COMMUNICATION_CONNECTION_STRING", "endpoint=https://example.com/;accesskey=test")
os.environ.setdefault("AZURE_SENDER_ADDRESS", "test@example.com")
os.environ.setdefault("SECRET_KEY", "test-secret")

from core.database import collection, kpi_db
from services.airport_charges_demo import (
    AIRPORT_CHARGES_CONTRACT_ID,
    AIRPORT_CHARGES_FILENAME,
    AirportChargesDemoBuilder,
    GROUND_TRUTH_KPIS,
    SOURCE_KPI_CODES,
    SOURCE_DEFS,
    DEDUPE_KEY_BY_SOURCE,
    WATERMARK_FIELD_BY_SOURCE,
    FILE_FORMAT_BY_SOURCE,
)
from services.kpi_manager import ContractKPIManager
from services.kpi_source_ingestion import KpiSourceIngestionService

SEED_USER_ID = "airport-charges-demo"
PROJECT_PROFILE_PREFIX = "airport_charges_2025"
RECORDS_PER_KPI = 8

# Exactly one breach-inducing row per breached KPI, placed on the most recent
# record so the "Latest" value is the breaching one. The upload demo has four
# deterministic open flags across its seven source-covered KPIs.
BREACHED_KPI_CODES_BY_SOURCE = {
    "scanned_images": {"SGHA-13.1-TURNAROUND-DELAY"},
    "file_upload": {"SGHA-13.3-BAGGAGE-CARGO-MISHANDLING"},
    "rest_api": {"SGHA-13.4-DEICING-FAILURE"},
    "sap_s4hana": {"SGHA-13.6-SAFETY-COMPLIANCE-BREACH"},
}


from services.airport_charges_demo import HARDCODED_DEMO_TELEMETRY

def _kpi_rows(kpis: List[Dict[str, Any]], source_type: str) -> List[Dict[str, Any]]:
    return HARDCODED_DEMO_TELEMETRY.get(source_type, [])


def _field_mappings(source_type: str) -> List[Dict[str, str]]:
    return AirportChargesDemoBuilder._field_mappings(source_type)


def _bindings(kpis: List[Dict[str, Any]], source_id: str, source_type: str, contract_id: str) -> List[Dict[str, Any]]:
    return AirportChargesDemoBuilder._bindings(kpis, source_id, source_type, contract_id)


def _clean_demo_state(contract_id: str) -> None:
    kpi_db["contract_kpi_source_configs"].delete_many({"contract_id": contract_id})
    for run in kpi_db["contract_kpi_fetch_runs"].find(
        {"contract_id": contract_id}, {"source_config_id": 1}
    ):
        kpi_db["contract_kpi_fetch_runs"].delete_one({"_id": run["_id"]})
        if run.get("source_config_id"):
            kpi_db["contract_kpi_raw_records"].delete_many(
                {"contract_id": contract_id, "source_config_id": run["source_config_id"]}
            )
            kpi_db["contract_kpi_actuals"].delete_many(
                {"contract_id": contract_id, "metadata.source_config_id": run["source_config_id"]}
            )
    kpi_db["contract_kpi_raw_records"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_actuals"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_breaches"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_integration_profiles"].delete_many({"notes": {"$regex": "^Seeded for demo"}})
    kpi_db["contract_kpis"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_extraction_runs"].delete_many({"contract_id": contract_id})


def _seed_source_configs(
    manager: ContractKPIManager,
    contract: Dict[str, Any],
    enable_bindings: bool = False,
    contract_id: str = None,
) -> List[str]:
    """Seed source configs for the demo contract.

    Configs are seeded *unlinked* by default: bindings are disabled and no KPI
    ids are attached, so sources never auto-link during extraction. The user
    links them explicitly ("Use All" / Smart Match / Link All) from the Actual
    Sources workspace. ``enable_bindings=True`` is only used when ingesting
    historical actuals for testing the charts.
    """
    cid = contract_id or str(contract["_id"])
    configs: List[str] = []
    for source_id, display_name, source_type in SOURCE_DEFS:
        rows = _kpi_rows(GROUND_TRUTH_KPIS, source_type)
        kpi_items = _kpi_items(cid)
        payload: Dict[str, Any] = {
            "display_name": display_name,
            "source_type": source_type,
            "runtime_source_type": source_type,
            "file_format": FILE_FORMAT_BY_SOURCE[source_type],
            "status": "mapped" if enable_bindings else "ready",
            "enabled": False,
            "auth_type": "none",
            "endpoint": None,
            "record_path": None,
            "schedule": {"cadence": "monthly", "timezone": "UTC"},
            "schema_fields": [{"name": key, "type": "string"} for key in rows[0].keys()],
            "sample_payload": rows,
            "field_mappings": _field_mappings(source_type),
            "kpi_ids": [item["kpi_id"] for item in kpi_items if item["code"] in SOURCE_KPI_CODES[source_type]]
            if enable_bindings
            else [],
            "kpi_bindings": [
                {**binding, "enabled": enable_bindings}
                for binding in _bindings(GROUND_TRUTH_KPIS, source_id, source_type, cid)
            ],
            "dedupe_key": DEDUPE_KEY_BY_SOURCE[source_type],
            "watermark_field": WATERMARK_FIELD_BY_SOURCE[source_type],
            "validation_rules": [
                {"field": "actual_value", "rule": "required_numeric"},
                {"field": "timestamp", "rule": "required_datetime"},
            ],
            "notes": "Reusable airport-charges demo connection. Operational rows are stored in the parking layer.",
        }
        manager.upsert_source_config(
            contract_id=cid,
            project_id=str(contract.get("projectId")) if contract.get("projectId") else None,
            user_id=SEED_USER_ID,
            source_config_id=source_id,
            payload=payload,
        )
        configs.append(source_id)
    return configs


def _kpi_items(contract_id: str = None) -> List[Dict[str, Any]]:
    cid = contract_id or AIRPORT_CHARGES_CONTRACT_ID
    return [
        {**definition, "kpi_id": f"{cid}:airport:{definition['code']}"}
        for definition in GROUND_TRUTH_KPIS
    ]


def _seed_profiles() -> None:
    from core.database import users_collection, accounts_collection

    now_dt = datetime.utcnow()
    account_ids = {None}
    for user in users_collection.find({"ownedAccountId": {"$ne": None}}):
        account_ids.add(str(user["ownedAccountId"]))
    for account in accounts_collection.find({}):
        account_ids.add(str(account["_id"]))

    for account_id in account_ids:
        for source_id, display_name, source_type in SOURCE_DEFS:
            profile_id = f"kpi_int_seed_{source_type}_{account_id or 'global'}"
            rows = _kpi_rows(GROUND_TRUTH_KPIS, source_type)
            profile = {
                "profile_id": profile_id,
                "source_type": source_type,
                "display_name": display_name,
                "owner_account_id": account_id,
                "status": "ready",
                "enabled": False,
                "auth_type": "none",
                "endpoint": None,
                "method": "GET",
                "headers": {},
                "query_params": {},
                "body": None,
                "timeout_seconds": 30,
                "record_path": None,
                "data_path": None,
                "field_mappings": _field_mappings(source_type),
                "sample_payload": rows,
                "dedupe_key": DEDUPE_KEY_BY_SOURCE[source_type],
                "watermark_field": WATERMARK_FIELD_BY_SOURCE[source_type],
                "schedule": {"cadence": "manual", "timezone": "UTC"},
                "notes": "Seeded for demo. Reusable across all contracts.",
                "created_at": now_dt,
                "updated_at": now_dt,
            }
            kpi_db["contract_kpi_integration_profiles"].update_one(
                {"profile_id": profile_id},
                {"$set": profile},
                upsert=True,
            )


def prepare(ingest_history: bool = False, reset: bool = False, prelink: bool = False) -> Dict[str, Any]:
    contract = collection.find_one({"contract_name": AIRPORT_CHARGES_FILENAME})
    if not contract:
        raise RuntimeError(f"No contract named {AIRPORT_CHARGES_FILENAME!r} found. Upload it first.")
    contract_id = str(contract["_id"])

    if reset:
        _clean_demo_state(contract_id)

    # Ground-truth extraction is idempotent. All obligations remain proposed
    # until the user accepts/tracks them in Review & Track; source ingestion
    # happens only after that post-extraction step.
    AirportChargesDemoBuilder(kpi_db).extract_ground_truth(
        contract_doc=contract,
        user_id=SEED_USER_ID,
    )

    configs: List[str] = []
    if prelink or ingest_history:
        manager = ContractKPIManager(kpi_db)
        configs = _seed_source_configs(
            manager,
            contract,
            enable_bindings=prelink,
            contract_id=contract_id,
        )

    if ingest_history:
        ingestion = KpiSourceIngestionService(kpi_db)
        for source_id, _, source_type in SOURCE_DEFS:
            rows = _kpi_rows(GROUND_TRUTH_KPIS, source_type)
            ingestion.fetch_source(
                contract_id=contract_id,
                source_config_id=source_id,
                user_id=SEED_USER_ID,
                trigger_type="airport_demo_prepare",
                payload=rows,
                evaluate=True,
            )

    _seed_profiles()

    result = {
        "contract_id": contract_id,
        "contract_name": contract.get("contract_name"),
        "kpis": len(_kpi_items(contract_id)),
        "sources": len(configs),
        "records_per_kpi": RECORDS_PER_KPI,
        "history_ingested": ingest_history,
        "prelinked": prelink,
        "source_config_ids": configs,
    }
    print(result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ingest-history", action="store_true")
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--prelink", action="store_true")
    args = parser.parse_args()
    prepare(ingest_history=args.ingest_history, reset=args.reset, prelink=args.prelink)
