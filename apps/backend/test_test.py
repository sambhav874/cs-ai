import sys
from pymongo import MongoClient
sys.path.append("/Users/kunaldhamiwal/dev/contractsense/apps/backend")
from services.kpi_source_ingestion import KpiSourceIngestionService
from core.database import kpi_db

service = KpiSourceIngestionService(database=kpi_db)
config = kpi_db.contract_kpi_source_configs.find_one({"source_type": "scanned_images"})
if config:
    print(f"Found config: {config.get('source_type')}")
    try:
        res = service.test_source(
            contract_id=config["contract_id"],
            source_config_id=config["source_config_id"],
            user_id="test_user",
            payload=None
        )
        print("Success, first record:", res.get("normalized_preview", [{}])[0])
    except Exception as e:
        import traceback
        traceback.print_exc()
