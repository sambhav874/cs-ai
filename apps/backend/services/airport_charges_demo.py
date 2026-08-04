"""Deterministic airport-charges KPI demo data.

This module is intentionally invoked only by the KPI extraction route for the
fixed airport-charges demo contract. PDF upload and contract ingestion remain
on their normal path.
"""

import os
from datetime import datetime
from hashlib import sha1
from typing import Any, Dict, List, Optional

from services.kpi_manager import ContractKPIManager


AIRPORT_CHARGES_CONTRACT_ID = "6a71d49dbd424d8f3b673721"
AIRPORT_CHARGES_FILENAME = "airport-charges-2025.pdf"
AIRPORT_CHARGES_EXTRACTION_MODE = "airport_charges_ground_truth"
DEMO_OPS_EMAIL = "ops@scandinavian-airlines.aero"

GROUND_TRUTH_KPIS: List[Dict[str, Any]] = [
    {
        "code": "SGHA-1.1-LANDING",
        "name": "Landing Charge",
        "description": "Landing charges follow the agreed MTOW price schedule.",
        "kpi_type": "financial", "category": "ground_handling", "operator": ">=",
        "value": 77, "unit": "SEK per tonne", "rule_type": "tiered",
        "target_schedule": [{"condition": "less than 25 tonnes", "value": 77, "price": 77, "unit": "SEK per tonne", "minimum_fee": 655}, {"condition": "25 tonnes or more", "value": 123, "base": 1193, "price": 123, "unit": "SEK per tonne"}],
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "consequence_value": 12000, "consequence_unit": "SEK per overbilled landing charge",
        "remediation": "Reconcile the landing invoice against the MTOW schedule and credit the overbilled amount.",
        "remediation_sla": "7 days",
        "quote": "Domestic and international: Price: Less than 25 tonnes 77:- per tonne (655:- minimum fee) 25 tonnes or more 1193:- + 123:- per tonne",
        "section": "PARAGRAPH 1. AIRPORT CHARGES · 1.1 Landing charge", "page_start": 1, "page_end": 1,
    },
    {
        "code": "SGHA-1.3-PASSENGER",
        "name": "Passenger Charge",
        "description": "A passenger charge is payable for each departing passenger.",
        "kpi_type": "financial", "category": "passenger", "operator": "=",
        "value": 141, "unit": "SEK per departing passenger", "rule_type": "threshold",
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "Passenger charge shall be paid for each departing passenger. Price: Per passenger, domestic and international 141:-",
        "section": "PARAGRAPH 1. AIRPORT CHARGES · 1.3 Passenger charge", "page_start": 1, "page_end": 1,
    },
    {
        "code": "SGHA-1.4-INFRASTRUCTURE",
        "name": "Infrastructure Security Fee",
        "description": "The infrastructure fee is charged per MTOW tonne and departing passenger.",
        "kpi_type": "financial", "category": "security", "operator": "=",
        "value": 16, "unit": "SEK per tonne plus 27 SEK per departing passenger", "rule_type": "threshold",
        "formula": "16 * mtow_tonnes + 27 * departing_passengers", "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "Infrastructure fee shall be paid for each departing passenger and per tonne. Price: Per tonne (MTOW) 16:- plus per dep. passenger 27:-",
        "section": "PARAGRAPH 1. AIRPORT CHARGES · 1.4 Infrastructure fee", "page_start": 1, "page_end": 2,
    },
    {
        "code": "SGHA-1.5-PARKING",
        "name": "Apron Parking Charge",
        "description": "Apron parking is free below six hours and charged by MTOW and days thereafter.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 32, "unit": "SEK per MTOW tonne-day", "rule_type": "tiered",
        "target_schedule": [{"condition": "less than 6 hours", "value": 0, "price": 0, "unit": "SEK"}, {"condition": "6 hours or more", "value": 32, "formula": "MTOW * days * 32", "minimum_charge": 249, "unit": "SEK"}],
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "On the apron: Price: Less than 6 hours, no charge 6 hours or more, MTOW * days * 32:- (min charge 249: -)",
        "section": "PARAGRAPH 1. AIRPORT CHARGES · 1.5 Parking charge", "page_start": 2, "page_end": 2,
    },
    {
        "code": "SGHA-1.6-EXTRA-HOURS",
        "name": "Extra Opening Hours",
        "description": "Extra opening outside scheduled airport movements is charged per manhour, with a three-hour minimum outside published hours.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 1244, "unit": "SEK per manhour", "rule_type": "threshold",
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "remediation": "Verify the extra opening hours log against the published airport timetable and correct the overbilling.",
        "remediation_sla": "5 days",
        "quote": "30 minutes before or after the first or last scheduled aircraft movement according to applicable timetable, overtime will be charged for each 30 min or part of 30 min. Extra opening hours: 1244:- per manhour. Extra opening outside the airports published opening hours will be charged with 1244:- per manhour, minimum time 3 hours.",
        "section": "PARAGRAPH 1. AIRPORT CHARGES · 1.6 Extra opening hours", "page_start": 2, "page_end": 2,
    },
    {
        "code": "SGHA-2.3-PASSENGER-SERVICES",
        "name": "Passenger Services Turnaround Rate",
        "description": "Passenger services are priced per turnaround by aircraft seat band.",
        "kpi_type": "financial", "category": "passenger", "operator": "=",
        "value": 3051, "unit": "SEK per turnaround for 0-40 seats", "rule_type": "tiered",
        "target_schedule": [{"seats": "0-40", "value": 3051, "price": 3051}, {"seats": "41-70", "value": 3538, "price": 3538}, {"seats": "71-100", "value": 3868, "price": 3868}, {"seats": "101-190", "value": 4679, "price": 4679}],
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "consequence_value": 15000, "consequence_unit": "SEK per turnaround billing discrepancy",
        "remediation": "Recalculate the turnaround charge for the correct seat band and issue a corrected invoice.",
        "remediation_sla": "7 days",
        "quote": "Passenger services: Price: Aircraft 0-40 seats, 3051:- per turn around Aircraft 41-70 seats, 3538:- per turn around Aircraft 71-100 seats, 3868:- per turn around Aircraft 101-190 seats, 4679:- per turn around",
        "section": "PARAGRAPH 2. HANDLING CHARGES · 2.3 Ground handling · Passenger services", "page_start": 2, "page_end": 3,
    },
    {
        "code": "SGHA-2.3-RAMP-HANDLING",
        "name": "Ramp Handling Turnaround Rate",
        "description": "Ramp handling is priced per turnaround by aircraft seat band.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 3543, "unit": "SEK per turnaround for 0-40 seats", "rule_type": "tiered",
        "target_schedule": [{"seats": "0-40", "value": 3543, "price": 3543}, {"seats": "41-70", "value": 4030, "price": 4030}, {"seats": "71-100", "value": 4523, "price": 4523}, {"seats": "101-190", "value": 5172, "price": 5172}],
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "Ramp handling: Price: Aircraft 0-40 seats, 3543:- per turn around Aircraft 41-70 seats, 4030:- per turn around Aircraft 71-100 seats, 4523:- per turn around Aircraft 101-190 seats, 5172:- per turn around",
        "section": "PARAGRAPH 2. HANDLING CHARGES · 2.3 Ground handling · Ramp handling", "page_start": 3, "page_end": 3,
    },
    {
        "code": "SGHA-2.8-DEICING-SERVICE",
        "name": "De-Icing Service Charge",
        "description": "De-icing and anti-icing are carried out according to the operator instruction and priced with a fixed charge plus fluid usage.",
        "kpi_type": "financial", "category": "de_icing", "operator": "=",
        "value": 1731, "unit": "SEK fixed charge plus daily price per litre", "rule_type": "threshold",
        "formula": "1731 + daily_price_per_litre * litres", "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "De-/Antiicing is to be carried out according to the Operators De-/Ant-Icing instruction. Price: 1731: - (fixed charge) + daily price/ litre de-icing agent (type I and II)",
        "section": "PARAGRAPH 2. HANDLING CHARGES · 2.8 De-Icing/Anti-Icing Services", "page_start": 4, "page_end": 4,
    },
    {
        "code": "SGHA-2.9-TOWING",
        "name": "Tow and Pushback Charge",
        "description": "Tow/pushback pricing differs for nonscheduled and scheduled flights.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 287, "unit": "SEK per occasion for nonscheduled flights", "rule_type": "tiered",
        "target_schedule": [{"flight_type": "nonscheduled", "value": 287, "price": 287, "unit": "SEK per occasion"}, {"flight_type": "scheduled", "value": 8180, "price": 8180, "unit": "SEK per month"}],
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "For nonscheduled flights (non RPL) Price: 287:- per occasion For scheduled flights only, (RPL) Price: 8180:- per month",
        "section": "PARAGRAPH 2. HANDLING CHARGES · 2.9 Tow in and/or pushback", "page_start": 4, "page_end": 4,
    },
    {
        "code": "SGHA-2.10-TOILET-WATER",
        "name": "Toilet and Water Service",
        "description": "Toilet and water service is charged per occasion.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 595, "unit": "SEK per occasion", "rule_type": "threshold",
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "2.10 Toilet and/or Water service Price: 595:- per occasion",
        "section": "PARAGRAPH 2. HANDLING CHARGES · 2.10 Toilet and/or Water service", "page_start": 4, "page_end": 4,
    },
    {
        "code": "SGHA-2.8-DEICING",
        "name": "De-icing Fluid Charge",
        "description": "De-icing with type II fluid is invoiced per charged liter.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 17.31, "unit": "SEK per liter type II fluid", "rule_type": "threshold",
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "consequence_value": 62000, "consequence_unit": "SEK per billing season exposure",
        "remediation": "Reconcile the de-icing statement against the dispenser readings and apply the agreed type II fluid price.",
        "remediation_sla": "10 days",
        "quote": "De-icing fluid type II: 17,31:- per liter charged liter",
        "section": "PARAGRAPH 2. HANDLING CHARGES · 2.8 De-icing", "page_start": 3, "page_end": 3,
    },
    {
        "code": "SGHA-2.12-CANCELLATION",
        "name": "Cancellation Notice Charge",
        "description": "Cancellation with less than 24 hours notice results in passenger and ramp handling charges at the specified percentages.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "<",
        "value": 24, "unit": "hours notice", "rule_type": "tiered",
        "target_schedule": [{"notice": "less than 6 hours", "value": 6, "charge_percent": 100}, {"notice": "more than 6 but less than 24 hours", "value": 24, "charge_percent": 50}],
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "Cancellation of flights with less than 24 hrs notice will result in charges för passenger services and ramp handling being chargeable at the following rates: 100% of charge for less than 6 hrs notice and 50% of charge for more than 6 hrs but less than 24 hrs notice.",
        "section": "PARAGRAPH 2. HANDLING CHARGES · 2.12 Cancellation of flights", "page_start": 4, "page_end": 4,
    },
    {
        "code": "SGHA-4.1-DISBURSEMENT",
        "name": "Disbursement Accounting Surcharge",
        "description": "Disbursements made by the Handling Company on behalf of the Carrier are reimbursed at cost plus the accounting surcharge.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 8, "unit": "percent accounting surcharge", "rule_type": "threshold",
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "Any disbursements made by the Handling Company on behalf of the Carrier will be reimbursed by the Carrier at cost price plus an accounting surcharge of 8,0 %.",
        "section": "PARAGRAPH 4. DISBURSEMENTS · 4.1", "page_start": 5, "page_end": 5,
    },
    {
        "code": "SGHA-5.1-LIABILITY",
        "name": "Aircraft Liability Limit",
        "description": "The liability limit per incident is USD 150,000 for the listed aircraft types.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 150000, "unit": "USD per incident", "rule_type": "threshold",
        "record_type": "financial_consequence", "party": "Handling Company", "party_role": "supplier",
        "target_schedule": [{"aircraft_type": "FOKKER 50", "value": 150000, "limit": 150000}, {"aircraft_type": "SAAB 340", "value": 150001, "limit": 150000}, {"aircraft_type": "ATR 72", "value": 150002, "limit": 150000}],
        "quote": "The limit of liability referred to in SubArticle 8.5 of the Main Agreement shall be as follows: FOKKER 50 USD 150.000; SAAB 340 USD 150.000; ATR 72 USD 150.000.",
        "section": "PARAGRAPH 5. LIMIT OF LIABILITY · 5.1", "page_start": 5, "page_end": 5,
    },
    {
        "code": "SGHA-2.7-ELECTRICITY",
        "name": "Ground Power Electricity Charge",
        "description": "Electricity supplied from a ground power outlet is charged per day as a minimum fee, varying by voltage/amperage.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 119, "unit": "SEK per day (minimum fee) for 220V 10A", "rule_type": "tiered",
        "target_schedule": [{"outlet": "220V 10A", "value": 119, "price": 119, "unit": "SEK/day (min fee)"}, {"outlet": "380V 16A", "value": 151, "price": 151, "unit": "SEK/day (min fee)"}],
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "From power outlet: Price: 220V 10A 380V 16A 119:-/day (min fee) 151:-/day (min fee)",
        "section": "PARAGRAPH 2. HANDLING CHARGES · 2.7 Electricity", "page_start": 3, "page_end": 4,
    },
    {
        "code": "SGHA-2.15-TECHNICAL-LANDING",
        "name": "Technical Landing Rate Reduction",
        "description": "Handling for a technical landing for other than commercial purposes is charged at half the standard rates, provided no physical change of load occurs.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 50, "unit": "percent of standard rates", "rule_type": "threshold",
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "Handling in case of technical landing for other than commercial purposes will be charged at 50% of the above rates, provided that a physical change of load is not involved.",
        "section": "PARAGRAPH 2. HANDLING CHARGES · 2.15", "page_start": 4, "page_end": 4,
    },
    {
        "code": "SGHA-2.16-RETURN-TO-RAMP",
        "name": "Return to Ramp Charge Waiver",
        "description": "Return to ramp is not charged extra unless a physical change of load is involved, in which case it is charged as a standard commercial flight.",
        "kpi_type": "financial", "category": "ground_handling", "operator": "=",
        "value": 0, "unit": "SEK additional charge (no load change)", "rule_type": "tiered",
        "target_schedule": [{"condition": "no physical change of load", "value": 0, "price": 0, "unit": "SEK extra"}, {"condition": "physical change of load involved", "value": 1, "note": "charged as for handling a commercial flight at standard rate"}],
        "record_type": "financial_consequence", "party": "Carrier", "party_role": "client",
        "quote": "Handling in case of return to ramp will not be charged extra, provided that a physical change of load is not involved. Handling in case of return to ramp involving a physical change of load will be charged as for handling a commercial flight at the above mentioned rate.",
        "section": "PARAGRAPH 2. HANDLING CHARGES · 2.16-2.17", "page_start": 4, "page_end": 4,
    },
    {
        "code": "SGHA-10.1-INDEX-ADJUSTMENT",
        "name": "Annual CPI Index Adjustment",
        "description": "All prices except de-icing fluid are indexed to the Swedish consumer price index using the October 2022 base index.",
        "kpi_type": "deadline", "category": "ground_handling", "operator": "=",
        "value": 384.04, "unit": "CPI base index number (October 2022, base year 1980)", "rule_type": "threshold",
        "record_type": "trackable_operational_obligation", "party": "Handling Company", "party_role": "supplier",
        "quote": "All prices above, except deicing fluid, is matched to the index number for October month stated year (= base) according to consumer price index (total index) with 1980 as base year. 100% of the base rent is adapted to October index 2022. Base numbers 384,04. First adjustment 2024-01-01.",
        "section": "PARAGRAPH 10. INDEX DISCLAIMER · 10.1", "page_start": 6, "page_end": 6,
    },
    {
        "code": "SGHA-8.1-SETTLEMENT",
        "name": "Settlement Net Days",
        "description": "Settlement of account is due 30 days net through invoices between the Handling Company and the Carrier.",
        "kpi_type": "deadline", "category": "ground_handling", "operator": "<=",
        "value": 30, "unit": "days net", "rule_type": "deadline",
        "record_type": "trackable_operational_obligation", "party": "Carrier", "party_role": "client",
        "quote": "Settlement of account shall be effected 30 days net. All price’s excluding VAT. Settlement shall be effected through invoices sent between the Handling company and the Carrier.",
        "section": "PARAGRAPH 8. SETTLEMENT · 8.1", "page_start": 5, "page_end": 5,
    },
]


def is_airport_charges_demo(contract_id: str, contract_name: Optional[str] = None) -> bool:
    del contract_id
    normalized_name = os.path.basename((contract_name or "").strip()).lower().replace("_", "-")
    return normalized_name == AIRPORT_CHARGES_FILENAME


# The ten source-covered obligations are the demo's tracked register. They map
# 1:1 to the four seeded data sources so every tracked KPI receives live actuals.
SOURCE_KPI_CODES: Dict[str, List[str]] = {
    "csv": ["SGHA-1.1-LANDING", "SGHA-1.3-PASSENGER", "SGHA-1.5-PARKING"],
    "json": ["SGHA-2.3-PASSENGER-SERVICES", "SGHA-2.3-RAMP-HANDLING"],
    "rest_api": ["SGHA-2.7-ELECTRICITY", "SGHA-2.8-DEICING", "SGHA-2.12-CANCELLATION"],
    "sap_s4hana": ["SGHA-1.6-EXTRA-HOURS", "SGHA-2.16-RETURN-TO-RAMP"],
}


def is_airport_charges_demo_source(config: Dict[str, Any]) -> bool:
    """Whether a source config belongs to the named airport demo connectors."""
    display_name = str(config.get("display_name") or "").lower()
    source_type = str(config.get("source_type") or "").lower()
    return source_type in SOURCE_KPI_CODES and (
        "airport" in display_name
        or "ground handling rest" in display_name
        or "ground operations" in display_name
    )

TRACKED_KPI_CODES: List[str] = sorted(
    {code for codes in SOURCE_KPI_CODES.values() for code in codes}
)

# Source config seeding data
SOURCE_DEFS = [
    ("src_demo_airport_csv", "Airport Operations CSV", "csv"),
    ("src_demo_airport_json", "Airport Charges JSON", "json"),
    ("src_demo_ground_rest", "Ground Handling REST Feed", "rest_api"),
    ("src_demo_airport_sap", "SAP S/4HANA Ground Operations", "sap_s4hana"),
]

DEDUPE_KEY_BY_SOURCE = {
    "csv": "event_id",
    "json": "record_id",
    "rest_api": "event_id",
    "sap_s4hana": "document_id",
}
WATERMARK_FIELD_BY_SOURCE = {
    "csv": "timestamp",
    "json": "recorded_at",
    "rest_api": "observed_at",
    "sap_s4hana": "posting_date",
}
FILE_FORMAT_BY_SOURCE = {
    "csv": "csv",
    "json": "json",
    "rest_api": "json",
    "sap_s4hana": "json",
}


class AirportChargesDemoBuilder:
    def __init__(self, database):
        self.db = database
        self.manager = ContractKPIManager(database)
        self.kpis = database["contract_kpis"]
        self.extraction_runs = database["contract_kpi_extraction_runs"]

    def extract_ground_truth(
        self,
        *,
        contract_doc: Dict[str, Any],
        user_id: str,
        replace_drafts: bool = True,
    ) -> Dict[str, Any]:
        contract_id = str(contract_doc["_id"])
        if not is_airport_charges_demo(contract_id, contract_doc.get("contract_name")):
            raise ValueError("Contract filename is not airport-charges-2025.pdf")

        now = datetime.utcnow()
        run_id = "airport_demo_run_" + sha1(f"{contract_id}:{now.date()}".encode()).hexdigest()[:14]
        self.extraction_runs.update_one(
            {"run_id": run_id},
            {"$set": {
                "run_id": run_id,
                "contract_id": contract_id,
                "project_id": str(contract_doc.get("projectId")) if contract_doc.get("projectId") else None,
                "contract_name": contract_doc.get("contract_name") or AIRPORT_CHARGES_FILENAME,
                "user_id": user_id,
                "status": "processing",
                "extraction_mode": AIRPORT_CHARGES_EXTRACTION_MODE,
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

        created = 0
        records: List[Dict[str, Any]] = []
        project_id = str(contract_doc.get("projectId")) if contract_doc.get("projectId") else None
        contract_name = contract_doc.get("contract_name") or AIRPORT_CHARGES_FILENAME
        for definition in GROUND_TRUTH_KPIS:
            kpi_id = f"{contract_id}:airport:{definition['code']}"
            is_tracked = definition["code"] in TRACKED_KPI_CODES
            existing = self.kpis.find_one({"contract_id": contract_id, "kpi_id": kpi_id}) or {}
            was_tracked = bool(
                existing.get("is_tracked") is True
                or str(existing.get("tracking_status") or "").lower() in {"tracked", "active"}
            )
            record = {
                **definition,
                "kpi_id": kpi_id,
                "contract_id": contract_id,
                "project_id": project_id,
                "contract_name": contract_name,
                # Extraction only proposes obligations. Tracking is an
                # explicit post-extraction user decision in Review & Track;
                # source mapping happens only after that decision.
                # A fresh extraction proposes the obligation. If the user
                # already accepted/tracked it, preserve that decision when
                # extraction is rerun or the demo is refreshed.
                "status": existing.get("status") if was_tracked else "draft",
                "tracking_status": existing.get("tracking_status") if was_tracked else "recommended",
                "is_tracked": was_tracked,
                "is_recommended": True,
                "recommendation_reason": (
                    "Ground-truth airport charges obligation. Accept to track."
                    if is_tracked
                    else "Ground-truth airport charges obligation prepared for review."
                ),
                "confidence": 1.0,
                "confidence_reason": "Deterministic airport-charges demo obligation.",
                "source_config_status": "not_configured",
                "source_requirements": {
                    "required_fields": ["actual_value", "timestamp", "source_record_id"],
                    "matching": "smart_match",
                },
                "evaluation_rule": {
                    "rule_type": definition["rule_type"],
                    "operator": definition["operator"],
                    "target": definition["value"],
                    "unit": definition["unit"],
                },
                "contact_email": DEMO_OPS_EMAIL,
                "quote": definition["quote"],
                "clause_text": definition["quote"],
                "section": definition["section"],
                "page_start": definition["page_start"],
                "page_end": definition["page_end"],
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
                "custom_attributes": {"demo_scenario": "airport_charges_2025", "ground_truth": True, "contract_supported": True},
                "updated_at": now,
                "updated_by": user_id,
            }
            result = self.kpis.update_one(
                {"contract_id": contract_id, "kpi_id": kpi_id},
                {"$set": record, "$setOnInsert": {"created_at": now, "created_by": user_id}},
                upsert=True,
            )
            if result.upserted_id is not None or result.modified_count:
                created += 1
            records.append(record)

        total = self.kpis.count_documents({"contract_id": contract_id})
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
        self.kpis.update_one(
            {"contract_id": contract_id},
            {"$set": {"last_demo_extraction_run_id": run_id}},
        )
        kpis = self.manager.list_contract_kpis(contract_id)
        return {
            "run_id": run_id,
            "contract_id": contract_id,
            "contract_name": contract_name,
            "project_id": project_id,
            "candidate_count": len(records),
            "kpi_count": len(kpis),
            "new_or_updated_count": created,
            "extraction_method": AIRPORT_CHARGES_EXTRACTION_MODE,
            "ai_used": False,
            "summary": self.manager.summarize_kpis(kpis),
            "kpis": kpis,
        }

    @staticmethod
    def _kpi_rows(kpis: List[Dict[str, Any]], source_type: str) -> List[Dict[str, Any]]:
        from datetime import timedelta

        rows: List[Dict[str, Any]] = []
        base = datetime.utcnow().replace(hour=9, minute=0, second=0, microsecond=0)
        airport_profiles = [
            ("ARN", "Stockholm Arlanda Airport", "T5"),
            ("CPH", "Copenhagen Airport", "T3"),
            ("OSL", "Oslo Airport", "T1"),
        ]
        allowed_codes = set(SOURCE_KPI_CODES.get(source_type, []))
        selected_kpis = [definition for definition in kpis if definition["code"] in allowed_codes]
        breached_codes = {
            "csv": {"SGHA-1.1-LANDING", "SGHA-1.3-PASSENGER", "SGHA-1.5-PARKING"},
            "json": set(),
            "rest_api": {"SGHA-2.7-ELECTRICITY", "SGHA-2.8-DEICING"},
            "sap_s4hana": {"SGHA-1.6-EXTRA-HOURS"},
        }.get(source_type, set())
        RECORDS_PER_KPI = 15
        for record_index in range(RECORDS_PER_KPI):
            timestamp = base - timedelta(days=14 * (RECORDS_PER_KPI - record_index - 1))
            airport_code, airport_name, terminal = airport_profiles[record_index % len(airport_profiles)]
            for kpi_index, definition in enumerate(selected_kpis):
                code = definition["code"]
                target = float(definition["value"])
                is_lower_better = definition["operator"] in {"<", "<="}
                is_breach_record = code in breached_codes and record_index == RECORDS_PER_KPI - 1
                if is_breach_record:
                    value = target * (1.18 if is_lower_better else 0.82)
                elif is_lower_better:
                    value = target * 0.85
                else:
                    value = target
                row = {
                    "kpi_code": code,
                    "kpi_name": definition["name"],
                    "metric_value": round(value, 2),
                    "observed_at": timestamp.isoformat(),
                    "event_id": f"{source_type}-{airport_code}-{code}-{record_index + 1:02d}",
                    "unit": definition["unit"],
                    "period": timestamp.strftime("%Y-%m-%d"),
                    "airport_iata_code": airport_code,
                    "airport_name": airport_name,
                    "airline_iata_code": "SK",
                    "airline_name": "SAS Scandinavian Airlines",
                    "flight_number": f"SK{410 + ((record_index + kpi_index) % 90)}",
                    "terminal": terminal,
                    "stand": f"{10 + ((record_index + kpi_index) % 40)}",
                    "supplier": definition["party"],
                    "source_type": source_type,
                }
                if source_type == "csv":
                    row.update({"actual_value": row.pop("metric_value"), "timestamp": row.pop("observed_at")})
                elif source_type == "json":
                    row.update({"measurement": row.pop("metric_value"), "recorded_at": row.pop("observed_at"), "record_id": row.pop("event_id")})
                elif source_type == "sap_s4hana":
                    row.update({"amount": row.pop("metric_value"), "posting_date": row.pop("observed_at"), "document_id": row.pop("event_id"), "company_code": "SAS-ARN"})
                rows.append(row)
        return rows

    @staticmethod
    def _field_mappings(source_type: str) -> List[Dict[str, str]]:
        fields = {
            "csv": ("actual_value", "timestamp", "event_id"),
            "json": ("measurement", "recorded_at", "record_id"),
            "rest_api": ("metric_value", "observed_at", "event_id"),
            "sap_s4hana": ("amount", "posting_date", "document_id"),
        }
        value_field, timestamp_field, record_id_field = fields[source_type]
        return [
            {"kpi_field": "kpi_name", "source_field": "kpi_name", "transform": "string"},
            {"kpi_field": "actual_value", "source_field": value_field, "transform": "number"},
            {"kpi_field": "timestamp", "source_field": timestamp_field, "transform": "datetime"},
            {"kpi_field": "source_record_id", "source_field": record_id_field, "transform": "string"},
            {"kpi_field": "unit", "source_field": "unit", "transform": "string"},
            {"kpi_field": "period", "source_field": "period", "transform": "string"},
        ]

    @staticmethod
    def _bindings(kpis: List[Dict[str, Any]], source_id: str, source_type: str, contract_id: str) -> List[Dict[str, Any]]:
        mappings = AirportChargesDemoBuilder._field_mappings(source_type)
        allowed_codes = set(SOURCE_KPI_CODES.get(source_type, []))
        return [
            {
                "binding_id": f"{source_id}:{definition['code']}",
                "kpi_id": f"{contract_id}:airport:{definition['code']}",
                "enabled": True,
                "match_rule": {"field": "kpi_code", "operator": "equals", "value": definition["code"]},
                "field_mappings": mappings,
                "aggregation": "latest",
            }
            for definition in kpis
            if definition["code"] in allowed_codes
        ]

    def seed_integration_profiles(self, owner_account_id: Optional[str] = None) -> List[str]:
        """Seed integration profiles for the demo.

        Creates 4 profiles (CSV, JSON, REST, SAP) in
        contract_kpi_integration_profiles so they appear in Recent Connections.
        The user then clicks "Use All" to create source configs from them.
        Safe to call idempotently.
        """
        profiles_col = self.db["contract_kpi_integration_profiles"]
        now = datetime.utcnow()
        profile_ids: List[str] = []
        for source_id, display_name, source_type in SOURCE_DEFS:
            rows = self._kpi_rows(GROUND_TRUTH_KPIS, source_type)
            profile_id = f"kpi_int_demo_{source_type}_{owner_account_id or 'global'}"
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
                "field_mappings": self._field_mappings(source_type),
                "sample_payload": rows,
                "dedupe_key": DEDUPE_KEY_BY_SOURCE[source_type],
                "watermark_field": WATERMARK_FIELD_BY_SOURCE[source_type],
                "schedule": {"cadence": "manual", "timezone": "UTC"},
                "notes": "Seeded for demo. Reusable across all contracts.",
                "created_at": now,
                "updated_at": now,
            }
            profiles_col.update_one(
                {"profile_id": profile_id},
                {"$set": profile},
                upsert=True,
            )
            profile_ids.append(profile_id)
        return profile_ids
