import os

os.environ.setdefault("MONGODB_URI", "mongodb+srv://sambhavjain:fRjXSAKOgiEm19Zv@contractlenscluster.3xbweqb.mongodb.net/")
os.environ.setdefault("HUGGINGFACE_TOKEN", "test")
os.environ.setdefault("GROQ_API_KEY", "test")
os.environ.setdefault("SUPPORT_EMAIL_ADDRESS", "test@example.com")
os.environ.setdefault("AZURE_COMMUNICATION_CONNECTION_STRING", "endpoint=https://example.com/;accesskey=test")
os.environ.setdefault("AZURE_SENDER_ADDRESS", "test@example.com")
os.environ.setdefault("SECRET_KEY", "test-secret")

from datetime import datetime, timedelta

from core.database import collection, kpi_db
from services.kpi_manager import ContractKPIManager
from services.kpi_source_ingestion import KpiSourceIngestionService


CONTRACT_ID = "6a6e6c4f3cf75b66cbb208bd"
SOURCE_CONFIG_ID = "src_cfg_iata_demo_operations"
SEED_USER_ID = "iata-demo-seed"


def main() -> None:
    manager = ContractKPIManager(kpi_db)
    ingestion = KpiSourceIngestionService(kpi_db)
    contract = collection.find_one({"_id": __import__("bson").ObjectId(CONTRACT_ID)}, {"projectId": 1}) or {}

    desired = [
        ("Disbursements Accounting Surcharge", 8, "percent", "clear"),
        ("Toilet and Water Service", 595, "SEK per occasion", "clear"),
        ("Hot Jug Service", 120, "SEK per Hot Jug", "breach"),
        ("Extra Opening Hours", 1244, "SEK per manhour", "clear"),
        ("Passenger Charge", 141, "SEK per passenger", "clear"),
        ("Settlement Net Days", 45, "days", "breach"),
        ("Aircraft Liability Limit per Aircraft Type", 100000, "USD per incident", "breach"),
    ]

    from services.kpi_schema import KPISchemaV1toV2Migrator

    kpis = []
    for name, value, unit, expected_state in desired:
        kpi = kpi_db["contract_kpis"].find_one({"contract_id": CONTRACT_ID, "name": name})
        if not kpi:
            print(f"KPI not found in Mongo: {name}")
            continue
        v2_kpi = KPISchemaV1toV2Migrator.migrate_doc(kpi)
        rule_type = v2_kpi.get("rule", {}).get("rule_type") or kpi.get("rule_type") or "threshold"
        print(f"Processing KPI: {name} -> rule_type: {rule_type}")
        if rule_type == "qualitative":
            print(f"Excluding qualitative/manual KPI from automated feed: {name}")
            continue
        manager.update_kpi(
            kpi_id=kpi["kpi_id"],
            contract_id=CONTRACT_ID,
            user_id=SEED_USER_ID,
            updates={"status": "approved", "tracking_status": "tracked", "is_tracked": True},
        )
        kpis.append({
            "kpi_id": kpi["kpi_id"],
            "kpi_name": name,
            "actual_value": value,
            "unit": unit,
            "timestamp": (datetime.utcnow() - timedelta(days=len(kpis))).isoformat(),
            "period": "2026-08-demo",
            "source_record_id": f"iata-demo-{kpi['kpi_id']}",
            "expected_demo_state": expected_state,
        })

    bindings = [
        {
            "binding_id": f"{SOURCE_CONFIG_ID}:{row['kpi_id']}",
            "kpi_id": row["kpi_id"],
            "enabled": True,
            "match_rule": {"field": "kpi_id", "operator": "equals", "value": row["kpi_id"]},
            "field_mappings": [],
            "aggregation": "latest",
        }
        for row in kpis
    ]
    config = manager.upsert_source_config(
        contract_id=CONTRACT_ID,
        project_id=str(contract.get("projectId")) if contract.get("projectId") else None,
        user_id=SEED_USER_ID,
        source_config_id=SOURCE_CONFIG_ID,
        payload={
            "display_name": "IATA Demo Operations Feed",
            "source_type": "json",
            "file_format": "json",
            "auth_type": "none",
            "status": "ready",
            "enabled": False,
            "schedule": {"cadence": "manual", "timezone": "UTC"},
            "sample_payload": kpis,
            "kpi_ids": [row["kpi_id"] for row in kpis],
            "kpi_bindings": bindings,
            "dedupe_key": "source_record_id",
            "watermark_field": "timestamp",
            "field_mappings": [
                {"kpi_field": "kpi_id", "source_field": "kpi_id", "transform": "string"},
                {"kpi_field": "kpi_name", "source_field": "kpi_name", "transform": "string"},
                {"kpi_field": "actual_value", "source_field": "actual_value", "transform": "number"},
                {"kpi_field": "unit", "source_field": "unit", "transform": "string"},
                {"kpi_field": "timestamp", "source_field": "timestamp", "transform": "datetime"},
                {"kpi_field": "period", "source_field": "period", "transform": "string"},
                {"kpi_field": "source_record_id", "source_field": "source_record_id", "transform": "string"},
            ],
            "validation_rules": [
                {"field": "actual_value", "rule": "required_numeric"},
                {"field": "timestamp", "rule": "required_datetime"},
            ],
        },
    )
    result = ingestion.fetch_source(
        contract_id=CONTRACT_ID,
        source_config_id=SOURCE_CONFIG_ID,
        user_id=SEED_USER_ID,
        trigger_type="demo_seed",
        payload=kpis,
        evaluate=True,
    )

    print({
        "contract_id": CONTRACT_ID,
        "source_config_id": config.get("source_config_id"),
        "kpis_prepared": len(kpis),
        "raw_records_parked": result.get("raw_records_parked"),
        "actuals_created": len(result.get("created_actuals") or []),
        "breaches_created": len([item for item in result.get("created_breaches") or [] if item.get("is_breach")]),
        "breach_names": [
            next((row["kpi_name"] for row in kpis if row["kpi_id"] == item.get("kpi_id")), item.get("kpi_id"))
            for item in result.get("created_breaches") or []
            if item.get("is_breach")
        ],
    })


if __name__ == "__main__":
    main()
