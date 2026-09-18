"""Reset/reseed the Baltia Airlines / Swissport USA JFK GHA demo.

Usage:
    python scripts/prepare_baltia_jfk_demo.py [--reset]

Finds the already-uploaded Baltia/Swissport contract (upload
demo_data/baltia-jfk-gha1.pdf through the app first -- this script does not
upload it), re-seeds the 37 ground-truth obligations, and re-seeds the 5
Recent Connections integration profiles. Does NOT touch source configs,
actuals, or breaches unless --reset is passed -- accepting KPIs, connecting
sources, and ingesting are real UI actions in this demo, not something a
prepare script should fake.

--reset wipes all prior demo state for the contract (KPIs, source configs,
fetch runs, raw records, actuals, breaches, extraction runs, dispatched
alerts) before reseeding, so the pitch can be re-run clean.
"""

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("HUGGINGFACE_TOKEN", "test")
os.environ.setdefault("GROQ_API_KEY", "test")
os.environ.setdefault("SUPPORT_EMAIL_ADDRESS", "test@example.com")
os.environ.setdefault("AZURE_COMMUNICATION_CONNECTION_STRING", "endpoint=https://example.com/;accesskey=test")
os.environ.setdefault("AZURE_SENDER_ADDRESS", "test@example.com")
os.environ.setdefault("SECRET_KEY", "test-secret")

from core.database import collection, kpi_db
from services.baltia_jfk_demo import BaltiaJfkDemoBuilder, DEMO_SCENARIO_ID, is_baltia_jfk_demo

SEED_USER_ID = "baltia-jfk-demo"


def _find_contract() -> Optional[Dict[str, Any]]:
    for doc in collection.find({}, {"_id": 1, "contract_name": 1, "projectId": 1}):
        if is_baltia_jfk_demo(contract_name=doc.get("contract_name")):
            return doc
    return None


def _clean_demo_state(contract_id: str) -> None:
    kpi_db["contract_kpi_source_configs"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_fetch_runs"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_raw_records"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_actuals"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_breaches"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_dispatched_alerts"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpis"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_extraction_runs"].delete_many({"contract_id": contract_id})
    kpi_db["contract_kpi_integration_profiles"].delete_many({"notes": {"$regex": DEMO_SCENARIO_ID}})


def prepare(reset: bool = False) -> Dict[str, Any]:
    contract = _find_contract()
    if not contract:
        raise RuntimeError(
            "No Baltia Airlines / Swissport USA JFK GHA contract found. "
            "Upload demo_data/baltia-jfk-gha1.pdf through the app first."
        )
    contract_id = str(contract["_id"])

    if reset:
        _clean_demo_state(contract_id)

    builder = BaltiaJfkDemoBuilder(kpi_db)
    result = builder.extract_ground_truth(contract_doc=contract, user_id=SEED_USER_ID)

    summary = {
        "contract_id": contract_id,
        "contract_name": contract.get("contract_name"),
        "kpi_count": result["kpi_count"],
        "new_or_updated_count": result["new_or_updated_count"],
        "reset": reset,
    }
    print(summary)
    print(
        "Ground truth + Recent Connections reseeded. Next in the UI: "
        "accept the recommended KPIs -> Actual Sources -> Use All Sources -> "
        "connect each source -> ingest."
    )
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="Wipe all prior demo state for this contract before reseeding.")
    args = parser.parse_args()
    prepare(reset=args.reset)
