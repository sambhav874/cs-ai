from datetime import datetime
from unittest.mock import MagicMock

from services.airport_charges_demo import (
    AIRPORT_CHARGES_CONTRACT_ID,
    AIRPORT_CHARGES_FILENAME,
    AirportChargesDemoBuilder,
    GROUND_TRUTH_KPIS,
    TRACKED_KPI_CODES,
    is_airport_charges_demo,
)
from scripts.prepare_airport_charges_demo import (
    BREACHED_KPI_CODES_BY_SOURCE,
    RECORDS_PER_KPI,
    SOURCE_KPI_CODES,
    _kpi_rows,
)


class FakeCursor(list):
    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, count):
        return FakeCursor(self[:count])


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def create_index(self, *_args, **_kwargs):
        return "ok"

    def find(self, query=None, *_args, **_kwargs):
        query = query or {}
        return FakeCursor([
            doc for doc in self.docs
            if all(doc.get(key) == value for key, value in query.items() if not isinstance(value, dict))
        ])

    def find_one(self, query=None, *_args, **_kwargs):
        rows = self.find(query)
        return rows[0] if rows else None

    def insert_one(self, doc):
        self.docs.append(dict(doc))
        return MagicMock(inserted_id="inserted")

    def update_one(self, query, update, upsert=False):
        existing = self.find_one(query)
        if existing:
            existing.update(update.get("$set", {}))
            for key, value in update.get("$setOnInsert", {}).items():
                existing.setdefault(key, value)
            return MagicMock(upserted_id=None, modified_count=1)
        if upsert:
            doc = dict(query)
            doc.update(update.get("$setOnInsert", {}))
            doc.update(update.get("$set", {}))
            self.docs.append(doc)
            return MagicMock(upserted_id="new", modified_count=0)
        return MagicMock(upserted_id=None, modified_count=0)

    def delete_many(self, query):
        before = len(self.docs)
        self.docs[:] = [doc for doc in self.docs if not all(doc.get(key) == value for key, value in query.items() if not isinstance(value, dict))]
        return MagicMock(deleted_count=before - len(self.docs))

    def count_documents(self, query):
        return len(self.find(query))


class FakeDB:
    def __init__(self):
        self.collections = {}
        self.client = MagicMock()

    def __getitem__(self, name):
        self.collections.setdefault(name, FakeCollection())
        return self.collections[name]


def test_seeded_sources_have_real_airline_records_per_kpi():
    rows = _kpi_rows(GROUND_TRUTH_KPIS, "rest_api")
    counts = {definition["code"]: 0 for definition in GROUND_TRUTH_KPIS if definition["code"] in SOURCE_KPI_CODES["rest_api"]}
    for row in rows:
        counts[row["kpi_code"]] += 1
        assert row["airport_iata_code"] in {"ARN", "CPH", "OSL"}
        assert row["airline_iata_code"] == "SK"
        assert row["metric_value"] is not None
        assert row["observed_at"]
    assert len(rows) == len(SOURCE_KPI_CODES["rest_api"]) * RECORDS_PER_KPI
    assert all(count == RECORDS_PER_KPI for count in counts.values())


def test_demo_sources_use_distinct_kpi_sets_and_sap_preview_shape():
    all_codes = [code for codes in SOURCE_KPI_CODES.values() for code in codes]
    assert len(all_codes) == 10
    assert len(set(all_codes)) == 10
    assert len(set(SOURCE_KPI_CODES["csv"]).intersection(SOURCE_KPI_CODES["json"])) == 0
    assert len(set(SOURCE_KPI_CODES["rest_api"]).intersection(SOURCE_KPI_CODES["sap_s4hana"])) == 0

    sap_rows = _kpi_rows(GROUND_TRUTH_KPIS, "sap_s4hana")
    assert len(sap_rows) == len(SOURCE_KPI_CODES["sap_s4hana"]) * RECORDS_PER_KPI
    assert all("amount" in row and "posting_date" in row and "document_id" in row for row in sap_rows)
    assert all(row["kpi_code"] in SOURCE_KPI_CODES["sap_s4hana"] for row in sap_rows)


def test_airport_demo_detection_is_filename_only_and_marker_free():
    assert is_airport_charges_demo("different-id", AIRPORT_CHARGES_FILENAME)
    assert is_airport_charges_demo("another-id", "/uploads/AIRPORT-CHARGES-2025.PDF")
    assert not is_airport_charges_demo(AIRPORT_CHARGES_CONTRACT_ID, "other.pdf")


def test_mock_dispatch_is_logged_without_external_delivery():
    database = FakeDB()
    database.collections["contract_kpis"] = FakeCollection()
    database.collections["contract_kpi_dispatched_alerts"] = FakeCollection()
    manager = __import__("services.kpi_manager", fromlist=["ContractKPIManager"]).ContractKPIManager(database)

    result = manager.dispatch_escalation_alert(
        contract_id=AIRPORT_CHARGES_CONTRACT_ID,
        user_id="demo-user",
        kpi_id="demo-kpi",
        recipient="demo@example.invalid",
        subject="Demo breach",
        body="Demo alert",
        breach_id="demo-breach",
    )

    assert result["status"] == "mock_dispatched"
    assert result["delivery_mode"] == "mock"
    assert result["email_sent"] is False
    assert result["external_authority_called"] is False


def test_all_ground_truth_kpis_can_be_accepted():
    database = FakeDB()
    database.collections["contract_kpis"] = FakeCollection()
    database.collections["contract_kpi_extraction_runs"] = FakeCollection()
    manager = __import__("services.kpi_manager", fromlist=["ContractKPIManager"]).ContractKPIManager(database)
    builder = AirportChargesDemoBuilder(database)
    contract = {"_id": AIRPORT_CHARGES_CONTRACT_ID, "contract_name": AIRPORT_CHARGES_FILENAME, "projectId": "project-1"}
    builder.extract_ground_truth(contract_doc=contract, user_id="demo-user")

    for definition in GROUND_TRUTH_KPIS:
        kpi_id = f"{AIRPORT_CHARGES_CONTRACT_ID}:airport:{definition['code']}"
        updated = manager.update_kpi(kpi_id, {"status": "approved"}, user_id="demo-user", contract_id=AIRPORT_CHARGES_CONTRACT_ID)
        assert updated["status"] == "approved"


def test_ground_truth_extraction_is_deterministic_and_tracks_source_covered_kpis():
    database = FakeDB()
    database.collections["contract_kpis"] = FakeCollection()
    database.collections["contract_kpi_extraction_runs"] = FakeCollection()
    database.collections["contract_kpi_source_configs"] = FakeCollection()
    contract = {
        "_id": AIRPORT_CHARGES_CONTRACT_ID,
        "contract_name": AIRPORT_CHARGES_FILENAME,
        "projectId": "project-1",
        "index": {"status": "success", "content": "unrelated extracted text"},
    }
    builder = AirportChargesDemoBuilder(database)

    first = builder.extract_ground_truth(contract_doc=contract, user_id="demo-user")
    second = builder.extract_ground_truth(contract_doc=contract, user_id="demo-user")

    assert first["extraction_method"] == "airport_charges_ground_truth"
    assert first["ai_used"] is False
    assert first["candidate_count"] == len(GROUND_TRUTH_KPIS)
    assert second["kpi_count"] == first["kpi_count"]
    stored = database.collections["contract_kpis"].docs
    assert len(stored) == len(GROUND_TRUTH_KPIS)
    assert all(item["is_tracked"] is False for item in stored)
    assert all(item["status"] == "draft" for item in stored)
    assert all(item["tracking_status"] == "recommended" for item in stored)
    assert all(item["quote"] != "Airport charges ground-truth demo obligation" for item in stored)
    assert all(item.get("section") and item.get("page_start") and item.get("page_end") for item in stored)
    assert all(item.get("custom_attributes", {}).get("contract_supported") is True for item in stored)


def test_demo_breach_spec_is_deterministic_six_flags():
    all_codes = [code for codes in SOURCE_KPI_CODES.values() for code in codes]
    tracked_set = set(all_codes)
    breached = {code for codes in BREACHED_KPI_CODES_BY_SOURCE.values() for code in codes}
    penalty_codes = {
        definition["code"]
        for definition in GROUND_TRUTH_KPIS
        if definition.get("consequence_value")
    }
    assert tracked_set == set(TRACKED_KPI_CODES)
    assert len(breached) == 6
    assert breached.issubset(tracked_set)
    assert len(penalty_codes.intersection(breached)) == 3
    assert len(penalty_codes) == 3
    assert len(BREACHED_KPI_CODES_BY_SOURCE.get("sap_s4hana", set())) >= 1
    assert BREACHED_KPI_CODES_BY_SOURCE["sap_s4hana"].issubset(SOURCE_KPI_CODES["sap_s4hana"])

    for source_type, codes in BREACHED_KPI_CODES_BY_SOURCE.items():
        rows = _kpi_rows(GROUND_TRUTH_KPIS, source_type)
        value_key = {"csv": "actual_value", "json": "measurement", "sap_s4hana": "amount"}.get(source_type, "metric_value")
        definition_by_code = {definition["code"]: definition for definition in GROUND_TRUTH_KPIS}
        breach_rows = [
            row for row in rows
            if _would_breach(definition_by_code[row["kpi_code"]], float(row[value_key]))
        ]
        # each breached KPI contributes exactly one breach row
        assert {row["kpi_code"] for row in breach_rows} == codes
        assert len(breach_rows) == len(codes)


def _would_breach(definition, value):
    target = float(definition["value"])
    operator = definition["operator"]
    if operator in {"<=", "within", "no_later_than", "maximum", "at_most"}:
        return value > target
    if operator in {">=", "minimum", "at_least"}:
        return value < target
    if operator in {"=", "==", "exact"}:
        return value != target
    if operator == ">":
        return value <= target
    if operator == "<":
        return value >= target
    return value > target
