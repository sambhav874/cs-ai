"""Baltia Airlines / Swissport USA JFK GHA Recoveries Management demo.

Contract-filename gated, like the retired airport-charges demo it replaces.
Loads pre-validated ground-truth obligations and mock actuals from the
repo-root demo_data/ directory and seeds them into the *generic* KPI
pipeline -- contract_kpis, contract_kpi_integration_profiles,
contract_kpi_source_configs, contract_kpi_actuals, contract_kpi_breaches.
No demo-specific evaluation logic: every KPI here rides the same
threshold engine, source adapters, and breach/recoveries/heatmap panels
every other contract uses.

Deliberately does NOT auto-accept KPIs or auto-create/fetch sources at
extraction time. The pitch's flow requires each of those to be a real,
visible UI action (accept KPIs -> unlocks Actual Sources -> Use All
Sources -> connect -> ingest), so this module only ever seeds the KPI
register and the "Recent Connections" integration profiles.
"""

import json

from core.config import settings
import logging
import os
from datetime import datetime, timedelta
from hashlib import sha1
from pathlib import Path
from typing import Any, Dict, List, Optional

from pymongo import UpdateOne

from services.kpi_manager import ContractKPIManager, KPI_RULE_VERSION

logger = logging.getLogger(__name__)

# The demo scenario's data is optional: set DEMO_DATA_DIR to enable it. When
# the files are absent everything below degrades to inert (see the try/except).
#
# This used to walk parents[3] up to the old repo root. In the container that
# path does not exist, and the IndexError fired at import time -- which took
# down the API and the Celery worker, since both import this module.
_env_demo_data_dir = os.environ.get("DEMO_DATA_DIR")
DEMO_DATA_DIR = Path(_env_demo_data_dir) if _env_demo_data_dir else Path(__file__).resolve().parent.parent / "demo_data"
DEMO_SCENARIO_ID = "baltia_jfk_gha"
DEMO_OPS_EMAIL = "recoveries@baltia-air.com"
DEMO_EXTRACTION_MODE = "baltia_jfk_ground_truth"
DEMO_NAMESPACE = "baltia_jfk"


def _load_json(name: str) -> Any:
    with open(DEMO_DATA_DIR / name, "r", encoding="utf-8") as fh:
        return json.load(fh)


# Both api/routes/kpis.py and worker/tasks.py import this module at load
# time, so a missing/misconfigured demo_data/ (wrong mount, wrong
# DEMO_DATA_DIR) must never crash the whole backend/worker over one demo
# feature. On failure, everything below degrades to empty/inert: the gate
# function always returns False and the builder is simply never reached.
try:
    GROUND_TRUTH = _load_json("baltia_jfk_ground_truth.json")
    TELEMETRY = _load_json("baltia_jfk_telemetry.json")
    CONFIG = _load_json("baltia_jfk_demo_config.json")
    DEMO_DATA_LOADED = True
except Exception:
    logger.warning(
        "Baltia/Swissport JFK GHA demo data not found at %s (set DEMO_DATA_DIR or mount demo_data/) "
        "-- the demo gate will stay inactive; this does not affect any other contract.",
        DEMO_DATA_DIR,
        exc_info=True,
    )
    GROUND_TRUTH = {"kpis": []}
    TELEMETRY = {"sources": {}}
    CONFIG = {
        "contract": {"filename_hints": []},
        "tracked_kpi_codes": {"supplier_primary": [], "customer_secondary": []},
        "breached_kpi_codes": [],
        "sources": [],
        "breach_summary": [],
    }
    DEMO_DATA_LOADED = False

GROUND_TRUTH_KPIS: List[Dict[str, Any]] = GROUND_TRUTH["kpis"]
FILENAME_HINTS: List[str] = [str(h).lower() for h in CONFIG["contract"]["filename_hints"]]
TRACKED_SUPPLIER_CODES = set(CONFIG["tracked_kpi_codes"]["supplier_primary"])
TRACKED_CUSTOMER_CODES = set(CONFIG["tracked_kpi_codes"]["customer_secondary"])
TRACKED_KPI_CODES = TRACKED_SUPPLIER_CODES | TRACKED_CUSTOMER_CODES
BREACHED_KPI_CODES = set(CONFIG["breached_kpi_codes"])
SOURCE_DEFS: List[Dict[str, Any]] = CONFIG["sources"]
BREACH_SUMMARY: List[Dict[str, Any]] = CONFIG["breach_summary"]

# Human-reviewed breach remediation emails for this demo's 9 curated breach
# occurrences, keyed by the evidence record's own record_id (stable across
# reseeds -- unlike breach_id, which is a fresh md5 hash every time the demo
# data is re-ingested). ContractKPIManager._compose_breach_email checks this
# map first for Baltia/Swissport breaches and, if a record_id matches, uses
# this text verbatim instead of recomputing a draft -- so what shipped after
# review is exactly what a user sees, run after run.
CURATED_BREACH_EMAIL_DRAFTS: Dict[str, str] = {
    "STAFF-20260723": (
        "Subject: Staffing Shortfall — Passenger Service Staffing/Manning Commitment, "
        "2026-07-23 [Supplier Breach] (Ref: STAFF-20260723 / OPS-TKT-4523)\n\n"
        "Hello,\n\n"
        "We've identified a staffing shortfall under Baltia Airlines / Swissport USA JFK "
        "Ground Handling Agreement that requires correction.\n\n"
        "On 2026-07-23, the recorded result for \"Passenger Service Staffing/Manning "
        "Commitment\" was 6 Check-in/Gate, 2 Arrivals staff, against the contract "
        "requirement of at least 8 Check-in/Gate, 3 Arrivals staff under Annex B P1.2 "
        "(\"Passenger Service Pricing is based upon the following mutually agreed "
        "manning\"). Check-in/Gate and Arrivals positions below the Annex B P1.2 mutually "
        "agreed manning table.\n\n"
        "This is not an isolated incident — the same \"Passenger Service Staffing/Manning "
        "Commitment\" issue also occurred on 2026-08-01, indicating a systemic issue on "
        "Swissport USA, Inc.'s side rather than a one-off error.\n\n"
        "We ask that you review STAFF-20260723 / OPS-TKT-4523, confirm the finding, and "
        "review the discrepancy and correct the invoice. Please respond with a corrective "
        "action plan within 7 days.\n\n"
        "Please confirm once reviewed.\n\n"
        "Regards,\nContract Compliance Team"
    ),
    "STAFF-20260801": (
        "Subject: Staffing Shortfall — Passenger Service Staffing/Manning Commitment, "
        "2026-08-01 [Supplier Breach] (Ref: STAFF-20260801 / OPS-TKT-4549)\n\n"
        "Hello,\n\n"
        "We've identified a staffing shortfall under Baltia Airlines / Swissport USA JFK "
        "Ground Handling Agreement that requires correction.\n\n"
        "On 2026-08-01, the recorded result for \"Passenger Service Staffing/Manning "
        "Commitment\" was 7 Check-in/Gate, 2 Arrivals staff, against the contract "
        "requirement of at least 8 Check-in/Gate, 3 Arrivals staff under Annex B P1.2 "
        "(\"Passenger Service Pricing is based upon the following mutually agreed "
        "manning\"). Second consecutive shortfall on Check-in/Gate and Arrivals "
        "positions -- same pattern as 2026-07-23.\n\n"
        "This is not an isolated incident — the same \"Passenger Service Staffing/Manning "
        "Commitment\" issue also occurred on 2026-07-23, indicating a systemic issue on "
        "Swissport USA, Inc.'s side rather than a one-off error.\n\n"
        "We ask that you review STAFF-20260801 / OPS-TKT-4549, confirm the finding, and "
        "review the discrepancy and correct the invoice. Please respond with a corrective "
        "action plan within 7 days.\n\n"
        "Please confirm once reviewed.\n\n"
        "Regards,\nContract Compliance Team"
    ),
    "RAMPRET-20260726": (
        "Subject: Billing Overcharge — Ramp Return With Load Change - Technical-Landing "
        "Rate Applies, Flight BQ100, 2026-07-26 [Supplier Breach] "
        "(Ref: RAMPRET-20260726 / OPS-TKT-4531)\n\n"
        "Hello,\n\n"
        "We've identified a billing overcharge under Baltia Airlines / Swissport USA JFK "
        "Ground Handling Agreement that requires correction.\n\n"
        "On 2026-07-26, flight BQ100 at John F. Kennedy International Airport (JFK), the "
        "recorded result for \"Ramp Return With Load Change - Technical-Landing Rate "
        "Applies\" was 4,165 USD, against the contract requirement of exactly 2,082.50 USD "
        "under Annex B P1.2.4 (\"will be charged as for handling in case of technical "
        "landing\"). Billed full standard turnaround rate instead of the Annex B P1.2.4 "
        "technical-landing rate (50%).\n\n"
        "This is not an isolated incident — the same \"Ramp Return With Load Change - "
        "Technical-Landing Rate Applies\" issue also occurred on 2026-08-02, indicating a "
        "systemic issue on Swissport USA, Inc.'s side rather than a one-off error.\n\n"
        "Recoverable overcharge amount: USD 2,082.50.\n\n"
        "We ask that you review RAMPRET-20260726 / OPS-TKT-4531, confirm the finding, and "
        "review the discrepancy and correct the invoice. Please respond with a corrective "
        "action plan within 7 days.\n\n"
        "Please confirm once reviewed.\n\n"
        "Regards,\nContract Compliance Team"
    ),
    "RAMPRET-20260802": (
        "Subject: Billing Overcharge — Ramp Return With Load Change - Technical-Landing "
        "Rate Applies, Flight BQ100, 2026-08-02 [Supplier Breach] "
        "(Ref: RAMPRET-20260802 / OPS-TKT-4552)\n\n"
        "Hello,\n\n"
        "We've identified a billing overcharge under Baltia Airlines / Swissport USA JFK "
        "Ground Handling Agreement that requires correction.\n\n"
        "On 2026-08-02, flight BQ100 at John F. Kennedy International Airport (JFK), the "
        "recorded result for \"Ramp Return With Load Change - Technical-Landing Rate "
        "Applies\" was 4,165 USD, against the contract requirement of exactly 2,082.50 USD "
        "under Annex B P1.2.4 (\"will be charged as for handling in case of technical "
        "landing\"). Same overcharge pattern recurs -- full standard rate billed instead "
        "of the Annex B P1.2.4 technical-landing rate (50%).\n\n"
        "This is not an isolated incident — the same \"Ramp Return With Load Change - "
        "Technical-Landing Rate Applies\" issue also occurred on 2026-07-26, indicating a "
        "systemic issue on Swissport USA, Inc.'s side rather than a one-off error.\n\n"
        "Recoverable overcharge amount: USD 2,082.50.\n\n"
        "We ask that you review RAMPRET-20260802 / OPS-TKT-4552, confirm the finding, and "
        "review the discrepancy and correct the invoice. Please respond with a corrective "
        "action plan within 7 days.\n\n"
        "Please confirm once reviewed.\n\n"
        "Regards,\nContract Compliance Team"
    ),
    "HOLIDAY-20260525": (
        "Subject: Billing Overcharge — No Night/Sunday/Holiday Surcharge, 2026-05-25 "
        "[Supplier Breach] (Ref: HOLIDAY-20260525 / OPS-TKT-4372)\n\n"
        "Hello,\n\n"
        "We've identified a billing overcharge under Baltia Airlines / Swissport USA JFK "
        "Ground Handling Agreement that requires correction.\n\n"
        "On 2026-05-25, the recorded result for \"No Night/Sunday/Holiday Surcharge\" was "
        "180 USD, against the contract requirement of exactly 0 USD under Annex B P1.2.5 "
        "(\"No extra charges will be made for providing the services at night\"). Annex B "
        "P1.2.5 prohibits extra charges for services on legal holidays.\n\n"
        "This is not an isolated incident — the same \"No Night/Sunday/Holiday Surcharge\" "
        "issue also occurred on 2026-06-19, 2026-07-04, indicating a systemic issue on "
        "Swissport USA, Inc.'s side rather than a one-off error.\n\n"
        "Recoverable overcharge amount: USD 180.\n\n"
        "We ask that you review HOLIDAY-20260525 / OPS-TKT-4372, confirm the finding, and "
        "review the discrepancy and correct the invoice. Please respond with a corrective "
        "action plan within 7 days.\n\n"
        "Please confirm once reviewed.\n\n"
        "Regards,\nContract Compliance Team"
    ),
    "HOLIDAY-20260619": (
        "Subject: Billing Overcharge — No Night/Sunday/Holiday Surcharge, 2026-06-19 "
        "[Supplier Breach] (Ref: HOLIDAY-20260619 / OPS-TKT-4415)\n\n"
        "Hello,\n\n"
        "We've identified a billing overcharge under Baltia Airlines / Swissport USA JFK "
        "Ground Handling Agreement that requires correction.\n\n"
        "On 2026-06-19, the recorded result for \"No Night/Sunday/Holiday Surcharge\" was "
        "180 USD, against the contract requirement of exactly 0 USD under Annex B P1.2.5 "
        "(\"No extra charges will be made for providing the services at night\"). Annex B "
        "P1.2.5 prohibits extra charges for services on legal holidays.\n\n"
        "This is not an isolated incident — the same \"No Night/Sunday/Holiday Surcharge\" "
        "issue also occurred on 2026-05-25, 2026-07-04, indicating a systemic issue on "
        "Swissport USA, Inc.'s side rather than a one-off error.\n\n"
        "Recoverable overcharge amount: USD 180.\n\n"
        "We ask that you review HOLIDAY-20260619 / OPS-TKT-4415, confirm the finding, and "
        "review the discrepancy and correct the invoice. Please respond with a corrective "
        "action plan within 7 days.\n\n"
        "Please confirm once reviewed.\n\n"
        "Regards,\nContract Compliance Team"
    ),
    "HOLIDAY-20260704": (
        "Subject: Billing Overcharge — No Night/Sunday/Holiday Surcharge, 2026-07-04 "
        "[Supplier Breach] (Ref: HOLIDAY-20260704 / OPS-TKT-4458)\n\n"
        "Hello,\n\n"
        "We've identified a billing overcharge under Baltia Airlines / Swissport USA JFK "
        "Ground Handling Agreement that requires correction.\n\n"
        "On 2026-07-04, the recorded result for \"No Night/Sunday/Holiday Surcharge\" was "
        "180 USD, against the contract requirement of exactly 0 USD under Annex B P1.2.5 "
        "(\"No extra charges will be made for providing the services at night\"). Third "
        "consecutive legal-holiday surcharge violation this year -- same billing-system "
        "defect as 2026-05-25 and 2026-06-19. Annex B P1.2.5 prohibits extra charges for "
        "services on legal holidays.\n\n"
        "This is not an isolated incident — the same \"No Night/Sunday/Holiday Surcharge\" "
        "issue also occurred on 2026-05-25, 2026-06-19, indicating a systemic issue on "
        "Swissport USA, Inc.'s side rather than a one-off error.\n\n"
        "Recoverable overcharge amount: USD 180.\n\n"
        "We ask that you review HOLIDAY-20260704 / OPS-TKT-4458, confirm the finding, and "
        "review the discrepancy and correct the invoice. Please respond with a corrective "
        "action plan within 7 days.\n\n"
        "Please confirm once reviewed.\n\n"
        "Regards,\nContract Compliance Team"
    ),
    "CPI-20250516-AUDIT": (
        "Subject: Rate Escalation Overcharge — Annual CPI Rate Escalation (Minimum 3%), "
        "2026-07-28 [Supplier Breach] (Ref: CPI-20250516-AUDIT / OPS-TKT-4200)\n\n"
        "Hello,\n\n"
        "We've identified a rate escalation overcharge under Baltia Airlines / Swissport "
        "USA JFK Ground Handling Agreement that requires correction.\n\n"
        "On 2026-07-28, the recorded result for \"Annual CPI Rate Escalation (Minimum 3%)\" "
        "was 4.50 %, against the contract requirement of at least 3 % under Annex B P10.3 "
        "(\"will be subject to an increase each anniversary date of the contract\"). "
        "Swissport applied a 4.5% escalation to the full Annex B turnaround rate card at "
        "the 2025-05-16 anniversary against a contracted floor of 3.0% (actual CPI 2.9%) "
        "-- a 1.5-point overcharge across 254 turnarounds ($1,057,910 base billed) for the "
        "12 months through 2026-05-15.\n\n"
        "Recoverable overcharge amount: USD 15,868.65.\n\n"
        "We ask that you review CPI-20250516-AUDIT / OPS-TKT-4200, confirm the finding, "
        "and review the discrepancy and correct the invoice. Please respond with a "
        "corrective action plan within 7 days.\n\n"
        "Please confirm once reviewed.\n\n"
        "Regards,\nContract Compliance Team"
    ),
    "OPS-20260714": (
        "Subject: Schedule / SLA Deviation — On-Schedule Handling Window (+/-60 minutes), "
        "Flight BQ100, 2026-07-14 [Customer Breach] (Ref: OPS-20260714)\n\n"
        "Hello,\n\n"
        "We've identified a schedule / SLA deviation under Baltia Airlines / Swissport USA "
        "JFK Ground Handling Agreement that requires correction.\n\n"
        "On 2026-07-14, flight BQ100 at John F. Kennedy International Airport (JFK), the "
        "recorded result for \"On-Schedule Handling Window (+/-60 minutes)\" was 105 "
        "minutes, against the contract requirement of no more than 60 minutes under Annex "
        "B P1.2.1 (\"flights operating within sixty (60) minutes of scheduled arrival or "
        "departure\"). Inbound mechanical delay; Handling Company did not apply "
        "off-schedule extra-services billing under Annex B Paragraph 2.\n\n"
        "We ask that you review OPS-20260714, confirm the finding, and review the "
        "discrepancy and correct the invoice. Please respond with a corrective action "
        "plan within 7 days.\n\n"
        "Please confirm once reviewed.\n\n"
        "Regards,\nContract Compliance Team"
    ),
}

# KPI-006's manning table covers 5 positions; the generic threshold engine
# compares one number to one target. Check-in/Gate is the largest position
# and the one the mock roster checks flag short, so it's tracked as the
# auto-evaluated proxy -- the full 5-position table stays visible via the
# KPI's own target_schedule for human review.
KPI_VALUE_OVERRIDES: Dict[str, Dict[str, Any]] = {
    # target_schedule is cleared for this runtime record: the schema
    # migrator unconditionally coerces any KPI with a non-empty
    # target_schedule to rule_type "tiered" (kpi_schema.py migrate_doc),
    # which then validates it as an ascending single-metric tier ladder --
    # a 5-position manning table isn't that, and every write fails
    # validation ("Tiers must be sorted ascending..."). The full table stays
    # readable in the KPI's own description/quote, just not as structured
    # target_schedule data.
    "BALTIA-JFK-GHA-006": {"value": 8, "unit": "Check-in/Gate staff", "rule_type": "threshold", "target_schedule": []},
}

# KPI-032 (CPI escalation) is recorded as a manual analyst finding rather
# than an auto-evaluated breach -- see MANUAL_FINDING_KPI_CODE below.
MANUAL_FINDING_KPI_CODE = "BALTIA-JFK-GHA-032"
MANUAL_FINDING_RECORD_ID = "CPI-20250516-AUDIT"
MANUAL_FINDING_SOURCE_ID = "supplier_obligations_log"
MANUAL_FINDING_SOURCE_DISPLAY_NAME = next(
    (s["display_name"] for s in SOURCE_DEFS if s["source_id"] == MANUAL_FINDING_SOURCE_ID),
    None,
)


def is_baltia_jfk_demo(
    contract_id: Optional[str] = None,
    filename: Optional[str] = None,
    contract_name: Optional[str] = None,
) -> bool:
    """Filename/contract-name gate. Requires >=2 hints to avoid matching an
    unrelated single-word filename (mirrors the retired airport-charges
    demo's normalize-compare pattern, generalized to two signals)."""
    del contract_id
    # Name matching alone is not enough to hand someone demo data. The hints are
    # ordinary words in this industry, and this gate diverts extraction, so a
    # genuine ground-handling agreement would silently receive the demo's
    # obligations instead of its own.
    if not getattr(settings, "enable_demo_contracts", False):
        return False
    haystacks = [str(v).lower() for v in (filename, contract_name) if v]
    for text in haystacks:
        if sum(1 for hint in FILENAME_HINTS if hint in text) >= 2:
            return True
    return False


class BaltiaJfkDemoBuilder:
    def __init__(self, database):
        self.db = database
        self.manager = ContractKPIManager(database)
        self.kpis = database["contract_kpis"]
        self.extraction_runs = database["contract_kpi_extraction_runs"]
        self.profiles = database["contract_kpi_integration_profiles"]
        self.source_configs = database["contract_kpi_source_configs"]
        self.breaches = database["contract_kpi_breaches"]
        self.actuals = database["contract_kpi_actuals"]

    # ------------------------------------------------------------------
    # Step 1-2 of the pitch flow: ingest -> extract obligations
    # ------------------------------------------------------------------
    def extract_ground_truth(
        self,
        *,
        contract_doc: Dict[str, Any],
        user_id: str,
        replace_drafts: bool = True,
    ) -> Dict[str, Any]:
        contract_id = str(contract_doc["_id"])
        now = datetime.utcnow()
        run_id = f"{DEMO_NAMESPACE}_run_" + sha1(f"{contract_id}:{now.date()}".encode()).hexdigest()[:14]
        project_id = str(contract_doc.get("projectId")) if contract_doc.get("projectId") else None
        contract_name = contract_doc.get("contract_name") or "Baltia Airlines / Swissport USA JFK GHA"

        logger.info(
            "BaltiaJfkDemoBuilder.extract_ground_truth start contract_id=%s run_id=%s "
            "demo_data_loaded=%s demo_data_dir=%s ground_truth_kpi_count=%s",
            contract_id, run_id, DEMO_DATA_LOADED, DEMO_DATA_DIR, len(GROUND_TRUTH_KPIS),
        )
        if not DEMO_DATA_LOADED or not GROUND_TRUTH_KPIS:
            logger.warning(
                "BaltiaJfkDemoBuilder.extract_ground_truth found ZERO ground-truth KPI definitions "
                "(demo_data_loaded=%s, demo_data_dir=%s) -- this run will upsert 0 KPIs. "
                "Check that demo_data/baltia_jfk_ground_truth.json is present at that path "
                "(set DEMO_DATA_DIR env var, or verify the volume/bind mount on this server).",
                DEMO_DATA_LOADED, DEMO_DATA_DIR,
            )

        self.extraction_runs.update_one(
            {"run_id": run_id},
            {"$set": {
                "run_id": run_id,
                "contract_id": contract_id,
                "project_id": project_id,
                "contract_name": contract_name,
                "user_id": user_id,
                "status": "processing",
                "extraction_mode": DEMO_EXTRACTION_MODE,
                "ai_used": False,
                "started_at": now,
                "stage": "ground_truth_loading",
            }},
            upsert=True,
        )

        if replace_drafts:
            self.kpis.delete_many({
                "contract_id": contract_id,
                "status": {"$in": ["draft", "ignored", "review"]},
            })

        # Prefetch every surviving doc (approved/tracked ones the delete_many
        # above didn't touch) in ONE query instead of a find_one per code --
        # a 37-code loop doing find_one+update_one each against remote Atlas
        # takes ~15-20s, and a page load mid-loop would catch a partially
        # seeded register (this is what caused KPI counts to show 4 or 7
        # instead of 37 right after upload).
        all_kpi_ids = [f"{contract_id}:{DEMO_NAMESPACE}:{d['code']}" for d in GROUND_TRUTH_KPIS]
        existing_by_kpi_id = {
            doc["kpi_id"]: doc
            for doc in self.kpis.find({"contract_id": contract_id, "kpi_id": {"$in": all_kpi_ids}})
        }

        created = 0
        records: List[Dict[str, Any]] = []
        operations: List[UpdateOne] = []
        for definition in GROUND_TRUTH_KPIS:
            code = definition["code"]
            kpi_id = f"{contract_id}:{DEMO_NAMESPACE}:{code}"
            is_recommended = code in TRACKED_KPI_CODES
            focus = "supplier" if code in TRACKED_SUPPLIER_CODES else ("customer" if code in TRACKED_CUSTOMER_CODES else None)
            existing = existing_by_kpi_id.get(kpi_id, {})
            override = KPI_VALUE_OVERRIDES.get(code, {})

            record = {
                **definition,
                **override,
                "kpi_id": kpi_id,
                "contract_id": contract_id,
                "project_id": project_id,
                "contract_name": contract_name,
                # Never re-draft a KPI the user has already reviewed/accepted.
                "status": existing.get("status") or "draft",
                # isKpiRecommended() on the frontend (page.tsx) treats
                # tracking_status === "recommended" as equivalent to
                # is_recommended -- so this must only be "recommended" for
                # the 22 tracked codes, or "Accept All" tracks all 37.
                "tracking_status": existing.get("tracking_status") or ("recommended" if is_recommended else "review"),
                "is_tracked": bool(existing.get("is_tracked")),
                "is_recommended": is_recommended,
                "recommendation_reason": (
                    f"Ground-truth JFK GHA {focus} obligation. Accept to start tracking."
                    if is_recommended else
                    "Extracted obligation; no source currently mapped."
                ),
                "confidence": 1.0,
                "confidence_reason": "Deterministic Baltia Airlines / Swissport USA JFK GHA demo obligation, validated against Annex B.",
                "source_config_status": "not_configured",
                "source_requirements": {
                    "required_fields": ["actual_value", "timestamp", "source_record_id"],
                    "matching": "smart_match",
                },
                "clause_text": definition["quote"],
                "citation": {
                    "page_start": definition["page_start"],
                    "page_end": definition["page_end"],
                    "section": definition["section"],
                    "quote": definition["quote"],
                },
                "source_evidence": [{
                    "source": contract_name,
                    "section": definition["section"],
                    "page_start": definition["page_start"],
                    "page_end": definition["page_end"],
                    "quote": definition["quote"],
                }],
                "custom_attributes": {
                    "demo_scenario": DEMO_SCENARIO_ID,
                    "ground_truth": True,
                    "obligation_focus": focus,
                },
                "contact_email": DEMO_OPS_EMAIL,
                "updated_at": now,
                "updated_by": user_id,
            }
            operations.append(UpdateOne(
                {"contract_id": contract_id, "kpi_id": kpi_id},
                {"$set": record, "$setOnInsert": {"created_at": now, "created_by": user_id}},
                upsert=True,
            ))
            records.append(record)

        if operations:
            bulk_result = self.kpis.bulk_write(operations, ordered=False)
            created = (bulk_result.upserted_count or 0) + (bulk_result.modified_count or 0)

        total = self.kpis.count_documents({"contract_id": contract_id})
        logger.info(
            "BaltiaJfkDemoBuilder.extract_ground_truth done contract_id=%s run_id=%s "
            "definitions=%s operations=%s upserted_or_modified=%s kpis_in_db=%s",
            contract_id, run_id, len(GROUND_TRUTH_KPIS), len(operations), created, total,
        )
        completed_at = datetime.utcnow()
        self.extraction_runs.update_one(
            {"run_id": run_id},
            {"$set": {
                "status": "completed",
                "stage": "completed",
                "finished_at": completed_at,
                "ai_used": False,
                "candidate_count": len(records),
                "kpi_count": total,
                "new_or_updated_count": created,
            }},
        )
        self.kpis.update_one({"contract_id": contract_id}, {"$set": {"last_demo_extraction_run_id": run_id}})

        try:
            from core.database import collection as contracts_collection
            from bson import ObjectId
            contracts_collection.update_one(
                {"_id": ObjectId(contract_id)},
                {"$set": {
                    "has_kpis": True,
                    "kpi_count": total,
                    "kpi_extracted_at": completed_at,
                    "status": "completed",
                }},
            )
        except Exception:
            pass
        try:
            from core.cache import cache
            cache.delete(f"kpi:list:{contract_id}")
            if project_id:
                cache.delete(f"portfolio:{project_id}")
        except Exception:
            pass

        # Recent Connections cards only -- not live source configs, and no
        # fetch. "Use All Sources" (a real UI action) creates the actual
        # contract_kpi_source_configs from these later.
        self.seed_integration_profiles(owner_account_id=user_id)

        kpis = self.manager.list_contract_kpis(contract_id)
        return {
            "run_id": run_id,
            "contract_id": contract_id,
            "contract_name": contract_name,
            "project_id": project_id,
            "candidate_count": len(records),
            "kpi_count": len(kpis),
            "new_or_updated_count": created,
            "extraction_method": DEMO_EXTRACTION_MODE,
            "ai_used": False,
            "summary": self.manager.summarize_kpis(kpis),
            "kpis": kpis,
        }

    # ------------------------------------------------------------------
    # Feeds the "Actual Sources" panel's Recent Connections. The identity
    # field_mappings work because every mock record already carries a
    # literal "actual_value" key (see baltia_jfk_telemetry.json's notes) --
    # sources mix KPIs whose native fields differ, and the frontend's Smart
    # Match guesses one field name per source, not per KPI.
    # ------------------------------------------------------------------
    def seed_integration_profiles(self, owner_account_id: Optional[str] = None) -> List[str]:
        # The frontend's "Recent Connections" picker dedupes profiles by
        # source_type, keeping the LAST entry of a newest-first-sorted list
        # -- i.e. whichever profile is OLDEST wins the slot for that type.
        # Any leftover profile (from unrelated earlier testing, any demo)
        # sharing one of our 5 connector types would silently shadow ours
        # -- wrong display name, and "Use All" would build the source
        # config from THEIR sample_payload, not the mock telemetry.
        my_source_types = [s["source_type"] for s in SOURCE_DEFS]
        self.profiles.delete_many({
            "source_type": {"$in": my_source_types},
            "profile_id": {"$not": {"$regex": f"^kpi_int_{DEMO_NAMESPACE}_"}},
        })

        profile_ids: List[str] = []
        now = datetime.utcnow()
        for source_def in SOURCE_DEFS:
            source_id = source_def["source_id"]
            source_type = source_def["source_type"]
            display_name = source_def["display_name"]
            rows = TELEMETRY["sources"][source_id]["records"]
            profile_id = f"kpi_int_{DEMO_NAMESPACE}_{source_id}_{owner_account_id or 'global'}"
            profile = {
                "profile_id": profile_id,
                "source_type": source_type,
                "display_name": display_name,
                "owner_account_id": owner_account_id,
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
                "field_mappings": [
                    {"kpi_field": "actual_value", "source_field": "actual_value", "transform": "number"},
                    {"kpi_field": "timestamp", "source_field": "timestamp", "transform": "datetime"},
                    {"kpi_field": "source_record_id", "source_field": "record_id", "transform": "string"},
                    {"kpi_field": "unit", "source_field": "unit", "transform": "string"},
                ],
                "sample_payload": rows,
                "dedupe_key": "record_id",
                "watermark_field": "timestamp",
                "schedule": {"cadence": "manual", "timezone": "UTC"},
                "notes": f"Seeded for the Baltia Airlines / Swissport USA JFK GHA demo ({DEMO_SCENARIO_ID}). Reusable across contracts.",
                "created_at": now,
                "updated_at": now,
            }
            self.profiles.update_one({"profile_id": profile_id}, {"$set": profile}, upsert=True)
            profile_ids.append(profile_id)
        return profile_ids

    # ------------------------------------------------------------------
    # KPI-032's contracted rule is a MINIMUM escalation floor (>=3%), so an
    # over-applied escalation (4.5% vs the floor) reads as compliant under
    # that operator's literal semantics -- the real violation needs the
    # external CPI benchmark the contract doesn't include (the same class
    # of gap the extraction already flagged on KPI-020's MAGSA cross-
    # reference). Recorded as a direct analyst finding, same shape as an
    # auto-evaluated breach so it renders identically in every panel.
    # Idempotent -- safe to call every time the source is fetched.
    # ------------------------------------------------------------------
    def seed_manual_findings(self, *, contract_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        kpi_id = f"{contract_id}:{DEMO_NAMESPACE}:{MANUAL_FINDING_KPI_CODE}"
        kpi = self.kpis.find_one({"contract_id": contract_id, "kpi_id": kpi_id})
        if not kpi or not self.manager._is_kpi_tracking_enabled(kpi):
            return None

        record = next(
            (r for r in TELEMETRY["sources"][MANUAL_FINDING_SOURCE_ID]["records"] if r["record_id"] == MANUAL_FINDING_RECORD_ID),
            None,
        )
        if not record:
            return None

        breach_id = f"breach_manual_{sha1(f'{kpi_id}:{MANUAL_FINDING_RECORD_ID}'.encode()).hexdigest()[:14]}"
        if self.breaches.find_one({"breach_id": breach_id}):
            return self.manager._serialize(self.breaches.find_one({"breach_id": breach_id}))

        actual = self.actuals.find_one({"contract_id": contract_id, "kpi_id": kpi_id, "metadata.record_id": MANUAL_FINDING_RECORD_ID})
        period_start = datetime.fromisoformat(record["anniversary_date"])
        period_end = period_start + timedelta(days=364)
        expected = float(record["contracted_minimum_percent"])
        actual_value = float(record["applied_escalation_percent"])
        now = datetime.utcnow()

        breach = {
            "breach_id": breach_id,
            "kpi_id": kpi_id,
            "contract_id": contract_id,
            "project_id": kpi.get("project_id"),
            "user_id": user_id,
            "actual_value": actual_value,
            "actual_unit": "%",
            "expected_value": expected,
            "threshold_value": expected,
            "operator": ">=",
            "is_breach": True,
            "status": "open",
            "severity": "high",
            "variance": round(actual_value - expected, 2),
            "variance_percent": round((actual_value - expected) / expected * 100, 2),
            "evaluation_mode": "manual_finding",
            "ai_used": False,
            "rule_version": KPI_RULE_VERSION,
            "evaluation_rule": kpi.get("evaluation_rule") or {},
            "period_start": period_start,
            "period_end": period_end,
            "period_locked": True,
            "blackout_applied": False,
            "deadline_at": None,
            "burn_rate": None,
            "remediation": kpi.get("remediation"),
            "remediation_sla": kpi.get("remediation_sla"),
            "actual_id": (actual or {}).get("actual_id"),
            "source": f"manual_finding:{MANUAL_FINDING_SOURCE_ID}",
            "timestamp": datetime.fromisoformat(record["timestamp"].replace("Z", "+00:00")).replace(tzinfo=None),
            "penalty_amount": float(record["overcharge_amount"]),
            "penalty_triggered": "CPI rate-card escalation overcharge (retroactive)",
            "sample_count": int(record.get("turnaround_count_period") or 1),
            "source_kpi": {
                "name": kpi.get("name"),
                "quote": kpi.get("quote"),
                "section": kpi.get("section"),
                "page_start": kpi.get("page_start"),
                "contract_name": kpi.get("contract_name"),
                "party": kpi.get("party"),
                "party_role": kpi.get("party_role"),
                "beneficiary": kpi.get("beneficiary"),
            },
            "send_remediation_email": False,
            "breach_email_draft": None,
            "created_at": now,
        }
        self.breaches.insert_one(breach)
        try:
            self.manager._trigger_alerts_for_breach(breach, kpi)
        except Exception:
            pass
        return self.manager._serialize(breach)

    # ------------------------------------------------------------------
    # Most of these clauses' dollar impact is per-occurrence (turnaround
    # rate x 50%, surcharge billed) rather than a flat penalty the contract
    # states -- so the tracked KPIs mostly have no consequence_value, and
    # the generic evaluate_kpi engine's _penalty_amount() falls back to 0
    # for every auto-evaluated breach. Enrich each breach's penalty_amount
    # from the validated recoverable-amount figure in
    # demo_data/baltia_jfk_demo_config.json, matched to the exact evidence
    # record via the underlying actual's metadata.source_record_id (set
    # from that record's own record_id during normalization). Idempotent
    # -- safe to call after every fetch.
    # ------------------------------------------------------------------
    def enrich_breach_penalties(self, *, contract_id: str) -> int:
        recoverable_by_record_id = {
            b["evidence_record_id"]: b["recoverable_amount_usd"]
            for b in BREACH_SUMMARY
            if b.get("recoverable_amount_usd")
        }
        if not recoverable_by_record_id:
            return 0
        updated = 0
        for breach in self.breaches.find({"contract_id": contract_id, "is_breach": True}):
            if breach.get("penalty_amount"):
                continue
            actual_id = breach.get("actual_id")
            if not actual_id:
                continue
            actual = self.actuals.find_one({"actual_id": actual_id})
            record_id = ((actual or {}).get("metadata") or {}).get("source_record_id")
            amount = recoverable_by_record_id.get(record_id)
            if amount is None:
                continue
            self.breaches.update_one({"breach_id": breach["breach_id"]}, {"$set": {"penalty_amount": amount}})
            updated += 1
        return updated
