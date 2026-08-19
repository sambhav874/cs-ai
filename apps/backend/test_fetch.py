import sys
from pymongo import MongoClient

from services.kpi_source_ingestion import KpiSourceIngestionService
from core.database import kpi_db

service = KpiSourceIngestionService(database=kpi_db)

# Find the scanned_images config
config = kpi_db.contract_kpi_source_configs.find_one({"source_type": "scanned_images"})
if not config:
    config = kpi_db.contract_kpi_source_configs.find_one({"display_name": "Scanned Images"})
    
if config:
    print(f"Found config: {config.get('source_type')} - {config.get('display_name')}")
    try:
        res = service.fetch_source(
            contract_id=config["contract_id"],
            source_config_id=config["source_config_id"],
            user_id="test_user",
            trigger_type="manual",
            payload=None
        )
        print("Success:", res)
    except Exception as e:
        import traceback
        traceback.print_exc()
else:
    print("Config not found")
