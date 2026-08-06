import io
import zipfile
from datetime import datetime
from unittest.mock import MagicMock

from services.kpi_source_ingestion import (
    KpiSourceIngestionService,
    RestSourceAdapter,
    _parse_csv_bytes,
    _parse_json_bytes,
    _parse_xml_bytes,
    _parse_xlsx_bytes,
)
from services.kpi_manager import ContractKPIManager, USER_CONFIGURABLE_SOURCE_TYPES


class FakeCursor(list):
    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, count):
        return FakeCursor(self[:count])


def _nested_value(doc, dotted_key):
    current = doc
    for part in dotted_key.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def _matches(doc, query):
    for key, expected in (query or {}).items():
        value = _nested_value(doc, key) if "." in key else doc.get(key)
        if isinstance(expected, dict):
            if "$exists" in expected:
                exists = value is not None
                if exists != bool(expected["$exists"]):
                    return False
            if "$lte" in expected and not (value is not None and value <= expected["$lte"]):
                return False
            if "$in" in expected and value not in expected["$in"]:
                return False
        elif value != expected:
            return False
    return True


class FakeCollection:
    def __init__(self, name="fake", docs=None):
        if isinstance(name, (list, tuple, set)) and docs is None:
            docs = name
            name = "fake"
        self.name = name
        self.docs = [dict(d) for d in (docs or [])]

    def create_index(self, keys, **kwargs):
        return "index_ok"

    def drop_index(self, name):
        return None

    def find(self, query=None, *_args, **_kwargs):
        return FakeCursor([doc for doc in self.docs if _matches(doc, query or {})])

    def find_one(self, query=None, *_args, **_kwargs):
        for doc in self.find(query or {}):
            return doc
        return None

    def insert_one(self, doc):
        self.docs.append(dict(doc))
        return MagicMock(inserted_id="fake")

    def insert_many(self, docs, ordered=False):
        inserted = []
        for doc in docs:
            d = dict(doc)
            self.docs.append(d)
            inserted.append("fake")
        return MagicMock(inserted_ids=inserted)

    def update_one(self, query, update, upsert=False):
        for doc in self.docs:
            if _matches(doc, query):
                doc.update((update or {}).get("$set", {}))
                for key, value in (update or {}).get("$setOnInsert", {}).items():
                    doc.setdefault(key, value)
                return MagicMock(matched_count=1)
        if upsert:
            new_doc = dict(query)
            new_doc.update((update or {}).get("$setOnInsert", {}))
            new_doc.update((update or {}).get("$set", {}))
            self.docs.append(new_doc)
            return MagicMock(matched_count=0)
        return MagicMock(matched_count=0)

    def update_many(self, query, update):
        matched = 0
        for doc in self.docs:
            if _matches(doc, query):
                doc.update((update or {}).get("$set", {}))
                matched += 1
        return MagicMock(matched_count=matched)

    def delete_many(self, query):
        self.docs = [d for d in self.docs if not _matches(d, query)]
        return MagicMock(deleted_count=1)

    def count_documents(self, query):
        return len([d for d in self.docs if _matches(d, query)])


class FakeDB:
    def __init__(self):
        self.collections = {}
        self.client = MagicMock()

    def __getitem__(self, name):
        self.collections.setdefault(name, FakeCollection(name=name))
        return self.collections[name]


def _xlsx_bytes():
    shared_strings = """<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
  <si><t>kpi_id</t></si><si><t>value</t></si><si><t>timestamp</t></si><si><t>kpi-1</t></si><si><t>2026-06-01</t></si>
</sst>"""
    sheet = """<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>90</v></c><c r="C2" t="s"><v>4</v></c></row>
  </sheetData>
</worksheet>"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as workbook:
        workbook.writestr("xl/sharedStrings.xml", shared_strings)
        workbook.writestr("xl/worksheets/sheet1.xml", sheet)
    return buffer.getvalue()


def test_rest_adapter_fetches_record_path_from_mocked_payload():
    session = MagicMock()
    response = MagicMock()
    response.headers = {"content-type": "application/json"}
    response.json.return_value = {"data": {"records": [{"metric": "On-time delivery", "score": "92"}]}}
    response.raise_for_status.return_value = None
    session.request.return_value = response

    adapter = RestSourceAdapter({
        "source_type": "rest_api",
        "endpoint": "https://example.test/kpis",
        "method": "GET",
        "record_path": "data.records",
    }, session=session)

    assert adapter.fetch() == [{"metric": "On-time delivery", "score": "92"}]


def test_rest_adapter_test_connection_accepts_preview_payload():
    adapter = RestSourceAdapter({
        "source_type": "rest_api",
        "auth_type": "none",
        "record_path": "records",
    })

    result = adapter.test_connection(payload={"records": [{"metric": "On-time delivery", "score": 92}]})

    assert result["ok"] is True
    assert result["mode"] == "sample_payload"
    assert result["sample_records"] == 1


def test_rest_adapter_reports_invalid_json_response():
    session = MagicMock()
    response = MagicMock()
    response.headers = {"content-type": "application/json"}
    response.status_code = 200
    response.text = "<html>login required</html>"
    response.json.side_effect = ValueError("invalid json")
    response.raise_for_status.return_value = None
    session.request.return_value = response

    adapter = RestSourceAdapter({
        "source_type": "rest_api",
        "endpoint": "https://example.test/kpis",
        "method": "GET",
        "auth_type": "none",
    }, session=session)

    result = adapter.test_connection()

    assert result["ok"] is False
    assert "invalid JSON" in result["errors"][0]
    assert "login required" in result["errors"][0]


def test_file_parsers_normalize_csv_json_xlsx_and_xml_rows():
    assert _parse_csv_bytes(b"kpi_id,value,timestamp\nkpi-1,90,2026-06-01\n") == [{
        "kpi_id": "kpi-1",
        "value": "90",
        "timestamp": "2026-06-01",
    }]
    assert _parse_json_bytes(b'{"records":[{"kpi_id":"kpi-1","value":91}]}') == [{"kpi_id": "kpi-1", "value": 91}]
    assert _parse_xml_bytes(b"<records><record><kpi_id>kpi-1</kpi_id><value>92</value></record></records>") == [{
        "kpi_id": "kpi-1",
        "value": "92",
    }]
    assert _parse_xlsx_bytes(_xlsx_bytes()) == [{
        "kpi_id": "kpi-1",
        "value": "90",
        "timestamp": "2026-06-01",
    }]


def test_validation_rejects_rows_without_value_or_kpi_mapping():
    fake_db = FakeDB()
    service = KpiSourceIngestionService(fake_db)
    accepted, skipped = service._validate_normalized_rows([
        {"timestamp": "2026-06-01"},
        {"kpi_id": "kpi-1", "value": ""},
    ], {"validation_rules": []})

    assert accepted == []
    assert len(skipped) == 2
    assert "Missing KPI mapping" in skipped[0]["reason"]
    assert "Missing actual_value/value" in skipped[1]["reason"]


def test_scheduled_cadence_computes_next_run_at():
    now = datetime(2026, 6, 1, 12, 0, 0)
    assert KpiSourceIngestionService.compute_next_run_at({"cadence": "hourly"}, now).hour == 13
    assert KpiSourceIngestionService.compute_next_run_at({"cadence": "daily"}, now).day == 2
    assert KpiSourceIngestionService.compute_next_run_at({"cadence": "manual"}, now) is None


def test_source_catalog_scopes_split_uploads_from_platform_connectors():
    manager = ContractKPIManager(FakeDB())

    user_catalog = manager.list_source_catalog(scope="user")
    platform_catalog = manager.list_source_catalog(scope="platform")

    assert {source["source_type"] for source in user_catalog} == USER_CONFIGURABLE_SOURCE_TYPES
    assert all(source["managed_by"] == "workspace_user" for source in user_catalog)
    assert all(source["enabled_for_contract_users"] for source in user_catalog)
    assert "servicenow" in {source["source_type"] for source in platform_catalog}
    assert all(source["managed_by"] == "contractsense_platform" for source in platform_catalog)
    assert all(not source["enabled_for_contract_users"] for source in platform_catalog)


def test_fetch_creates_actuals_and_deterministic_breaches_without_ai():
    fake_db = FakeDB()
    fake_db.collections["contract_kpi_source_configs"] = FakeCollection([{
        "source_config_id": "src-1",
        "contract_id": "contract-1",
        "project_id": "project-1",
        "display_name": "JSON Feed",
        "source_type": "json",
        "status": "ready",
        "enabled": False,
        "sample_payload": {"records": [{"kpi_id": "kpi-1", "value": 90, "timestamp": "2026-06-01", "record_id": "r-1"}]},
        "field_mappings": [
            {"kpi_field": "kpi_id", "source_field": "kpi_id"},
            {"kpi_field": "actual_value", "source_field": "value", "transform": "number"},
            {"kpi_field": "timestamp", "source_field": "timestamp", "transform": "datetime"},
            {"kpi_field": "source_record_id", "source_field": "record_id"},
        ],
        "validation_rules": [
            {"field": "actual_value", "rule": "required_numeric"},
        ],
    }])
    fake_db.collections["contract_kpis"] = FakeCollection([{
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "project_id": "project-1",
        "name": "On-time delivery",
        "operator": ">=",
        "value": 95,
        "unit": "%",
        "tracking_status": "tracked",
        "is_tracked": True,
    }])

    result = KpiSourceIngestionService(fake_db).fetch_source(
        contract_id="contract-1",
        source_config_id="src-1",
        user_id="user-1",
    )

    assert len(result["created_actuals"]) == 1
    assert len(result["created_breaches"]) == 1
    assert result["created_breaches"][0]["ai_used"] is False
    assert result["created_breaches"][0]["evaluation_mode"] == "deterministic_rule_engine"


def test_untracked_fetch_actuals_are_deferred_from_breach_evaluation():
    fake_db = FakeDB()
    fake_db.collections["contract_kpi_source_configs"] = FakeCollection([{
        "source_config_id": "src-1",
        "contract_id": "contract-1",
        "display_name": "Manual Feed",
        "source_type": "manual_attestation",
        "status": "ready",
        "enabled": False,
        "kpi_ids": ["kpi-1"],
        "sample_payload": {"records": [{"value": 90, "timestamp": "2026-06-01"}]},
        "field_mappings": [{"kpi_field": "actual_value", "source_field": "value", "transform": "number"}],
    }])
    fake_db.collections["contract_kpis"] = FakeCollection([{
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "name": "On-time delivery",
        "operator": ">=",
        "value": 95,
        "tracking_status": "recommended",
        "is_tracked": False,
    }])

    result = KpiSourceIngestionService(fake_db).fetch_source(
        contract_id="contract-1",
        source_config_id="src-1",
        user_id="user-1",
    )

    assert len(result["created_actuals"]) == 1
    assert result["created_breaches"] == []
    assert result["deferred_evaluations"][0]["reason"] == "KPI is not tracked"


def test_repeated_actual_ingest_skips_existing_source_period_record():
    fake_db = FakeDB()
    fake_db.collections["contract_kpis"] = FakeCollection([{
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "name": "On-time delivery",
        "operator": ">=",
        "value": 95,
        "unit": "%",
        "tracking_status": "tracked",
        "is_tracked": True,
    }])
    manager = ContractKPIManager(fake_db)
    row = {
        "kpi_id": "kpi-1",
        "value": 90,
        "unit": "%",
        "timestamp": "2026-06-01T12:00:00Z",
        "period": "FY2026",
    }

    first = manager.ingest_actuals(
        contract_id="contract-1",
        user_id="user-1",
        rows=[row],
        source="upload:actuals.csv",
        evaluate=False,
    )
    second = manager.ingest_actuals(
        contract_id="contract-1",
        user_id="user-1",
        rows=[row],
        source="upload:actuals.csv",
        evaluate=False,
    )

    assert first["count"] == 1
    assert second["count"] == 0
    assert second["skipped"][0]["reason"] == "Duplicate actual already ingested"
    assert len(fake_db.collections["contract_kpi_actuals"].docs) == 1


def test_one_kpi_can_be_assigned_to_multiple_source_configs():
    fake_db = FakeDB()
    fake_db.collections["contract_kpis"] = FakeCollection([
        {"kpi_id": "kpi-1", "contract_id": "contract-1", "name": "On-time delivery"},
        {"kpi_id": "kpi-2", "contract_id": "contract-1", "name": "Packaging quality"},
    ])
    manager = ContractKPIManager(fake_db)

    manager.upsert_source_config(
        contract_id="contract-1",
        project_id="project-1",
        user_id="user-1",
        source_config_id="src-csv",
        payload={
            "display_name": "CSV ops upload",
            "source_type": "csv",
            "kpi_ids": ["kpi-1", "kpi-2"],
            "field_mappings": [{"kpi_field": "actual_value", "source_field": "value"}],
        },
    )
    manager.upsert_source_config(
        contract_id="contract-1",
        project_id="project-1",
        user_id="user-1",
        source_config_id="src-json",
        payload={
            "display_name": "JSON telemetry",
            "source_type": "json",
            "kpi_ids": ["kpi-1"],
            "field_mappings": [{"kpi_field": "actual_value", "source_field": "value"}],
        },
    )

    configs = manager.list_source_configs("contract-1")
    source_ids_for_kpi_1 = {
        config["source_config_id"]
        for config in configs
        if "kpi-1" in config.get("kpi_ids", [])
    }
    csv_config = next(config for config in configs if config["source_config_id"] == "src-csv")

    assert source_ids_for_kpi_1 == {"src-csv", "src-json"}
    assert set(csv_config["kpi_ids"]) == {"kpi-1", "kpi-2"}


def test_fetch_run_detail_returns_created_records_for_run():
    fake_db = FakeDB()
    fake_db.collections["contract_kpi_source_configs"] = FakeCollection([{
        "source_config_id": "src-1",
        "contract_id": "contract-1",
        "project_id": "project-1",
        "display_name": "JSON Feed",
        "source_type": "json",
        "status": "ready",
        "enabled": False,
        "sample_payload": {"records": [{"kpi_id": "kpi-1", "value": 90, "timestamp": "2026-06-01", "record_id": "r-1"}]},
        "field_mappings": [
            {"kpi_field": "kpi_id", "source_field": "kpi_id"},
            {"kpi_field": "actual_value", "source_field": "value", "transform": "number"},
            {"kpi_field": "timestamp", "source_field": "timestamp", "transform": "datetime"},
            {"kpi_field": "source_record_id", "source_field": "record_id"},
        ],
    }])
    fake_db.collections["contract_kpis"] = FakeCollection([{
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "project_id": "project-1",
        "name": "On-time delivery",
        "operator": ">=",
        "value": 95,
        "unit": "%",
        "tracking_status": "tracked",
        "is_tracked": True,
    }])
    service = KpiSourceIngestionService(fake_db)

    result = service.fetch_source(
        contract_id="contract-1",
        source_config_id="src-1",
        user_id="user-1",
    )
    run_id = result["fetch_run"]["run_id"]
    detail = service.get_fetch_run_detail(
        contract_id="contract-1",
        source_config_id="src-1",
        run_id=run_id,
    )

    assert detail["fetch_run"]["run_id"] == run_id
    assert len(detail["normalized_rows"]) == 1
    assert len(detail["created_actuals"]) == 1
    assert detail["created_actuals"][0]["metadata"]["source_run_id"] == run_id
    assert len(detail["created_breaches"]) == 1


def test_repeated_source_fetch_skips_duplicate_record_id_rows():
    fake_db = FakeDB()
    fake_db.collections["contract_kpi_source_configs"] = FakeCollection([{
        "source_config_id": "src-1",
        "contract_id": "contract-1",
        "display_name": "JSON Feed",
        "source_type": "json",
        "status": "ready",
        "enabled": False,
        "dedupe_key": "record_id",
        "sample_payload": {"records": [{"kpi_id": "kpi-1", "value": 90, "timestamp": "2026-06-01", "period": "FY2026", "record_id": "r-1"}]},
        "field_mappings": [
            {"kpi_field": "kpi_id", "source_field": "kpi_id"},
            {"kpi_field": "actual_value", "source_field": "value", "transform": "number"},
            {"kpi_field": "timestamp", "source_field": "timestamp", "transform": "datetime"},
            {"kpi_field": "period", "source_field": "period"},
            {"kpi_field": "source_record_id", "source_field": "record_id"},
        ],
    }])
    fake_db.collections["contract_kpis"] = FakeCollection([{
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "name": "On-time delivery",
        "operator": ">=",
        "value": 95,
        "unit": "%",
        "tracking_status": "tracked",
        "is_tracked": True,
    }])
    service = KpiSourceIngestionService(fake_db)

    first = service.fetch_source(contract_id="contract-1", source_config_id="src-1", user_id="user-1")
    second = service.fetch_source(contract_id="contract-1", source_config_id="src-1", user_id="user-1")

    assert first["fetch_run"]["records_accepted"] == 1
    assert second["fetch_run"]["records_accepted"] == 0
    assert second["fetch_run"]["records_skipped"] == 1
    assert "Duplicate" in second["skipped_rows"][0]["reason"]
    assert len(fake_db.collections["contract_kpi_actuals"].docs) == 1


def test_one_source_row_can_feed_multiple_kpi_bindings_with_different_fields():
    fake_db = FakeDB()
    fake_db.collections["contract_kpi_source_configs"] = FakeCollection([{
        "source_config_id": "src-wide",
        "contract_id": "contract-1",
        "display_name": "Operations Workbook",
        "source_type": "json",
        "status": "ready",
        "enabled": False,
        "dedupe_key": "record_id",
        "sample_payload": {
            "records": [{
                "record_id": "row-1",
                "timestamp": "2026-06-01",
                "uptime_pct": "99.5",
                "response_minutes": "12",
            }]
        },
        "kpi_bindings": [
            {
                "binding_id": "bind-uptime",
                "kpi_id": "kpi-uptime",
                "enabled": True,
                "field_mappings": [
                    {"kpi_field": "actual_value", "source_field": "uptime_pct", "transform": "number"},
                    {"kpi_field": "timestamp", "source_field": "timestamp", "transform": "datetime"},
                    {"kpi_field": "source_record_id", "source_field": "record_id"},
                ],
                "unit_override": "%",
            },
            {
                "binding_id": "bind-response",
                "kpi_id": "kpi-response",
                "enabled": True,
                "field_mappings": [
                    {"kpi_field": "actual_value", "source_field": "response_minutes", "transform": "number"},
                    {"kpi_field": "timestamp", "source_field": "timestamp", "transform": "datetime"},
                    {"kpi_field": "source_record_id", "source_field": "record_id"},
                ],
                "unit_override": "minutes",
            },
        ],
    }])
    fake_db.collections["contract_kpis"] = FakeCollection([
        {"kpi_id": "kpi-uptime", "contract_id": "contract-1", "name": "Uptime", "unit": "%", "tracking_status": "tracked", "is_tracked": True},
        {"kpi_id": "kpi-response", "contract_id": "contract-1", "name": "Response Time", "unit": "minutes", "tracking_status": "tracked", "is_tracked": True},
    ])

    result = KpiSourceIngestionService(fake_db).fetch_source(
        contract_id="contract-1",
        source_config_id="src-wide",
        user_id="user-1",
        evaluate=False,
    )

    actuals_by_kpi = {actual["kpi_id"]: actual for actual in result["created_actuals"]}
    assert set(actuals_by_kpi) == {"kpi-uptime", "kpi-response"}
    assert actuals_by_kpi["kpi-uptime"]["value"] == 99.5
    assert actuals_by_kpi["kpi-response"]["value"] == 12.0
    assert actuals_by_kpi["kpi-uptime"]["metadata"]["source_dedupe_key"] == "row-1"
    assert actuals_by_kpi["kpi-response"]["metadata"]["source_dedupe_key"] == "row-1"


def test_source_fetch_dedupe_keeps_different_kpis_for_same_source_record_id():
    fake_db = FakeDB()
    fake_db.collections["contract_kpi_source_configs"] = FakeCollection([{
        "source_config_id": "src-wide",
        "contract_id": "contract-1",
        "display_name": "Operations Workbook",
        "source_type": "json",
        "status": "ready",
        "dedupe_key": "record_id",
        "sample_payload": {"records": [{"record_id": "row-1", "timestamp": "2026-06-01", "value_a": 1, "value_b": 2}]},
        "kpi_bindings": [
            {"kpi_id": "kpi-a", "enabled": True, "field_mappings": [{"kpi_field": "actual_value", "source_field": "value_a"}]},
            {"kpi_id": "kpi-b", "enabled": True, "field_mappings": [{"kpi_field": "actual_value", "source_field": "value_b"}]},
        ],
    }])
    fake_db.collections["contract_kpis"] = FakeCollection([
        {"kpi_id": "kpi-a", "contract_id": "contract-1", "name": "A", "tracking_status": "tracked", "is_tracked": True},
        {"kpi_id": "kpi-b", "contract_id": "contract-1", "name": "B", "tracking_status": "tracked", "is_tracked": True},
    ])
    service = KpiSourceIngestionService(fake_db)

    first = service.fetch_source(contract_id="contract-1", source_config_id="src-wide", user_id="user-1", evaluate=False)
    second = service.fetch_source(contract_id="contract-1", source_config_id="src-wide", user_id="user-1", evaluate=False)

    assert first["fetch_run"]["records_accepted"] == 2
    assert second["fetch_run"]["records_accepted"] == 0
    assert second["fetch_run"]["records_skipped"] == 2
    assert len(fake_db.collections["contract_kpi_actuals"].docs) == 2


def test_binding_field_mapping_falls_back_to_source_default_mapping():
    fake_db = FakeDB()
    service = KpiSourceIngestionService(fake_db)
    rows = service._normalize_records(
        [{"record_id": "row-1", "timestamp": "2026-06-01", "value": "42"}],
        {
            "source_config_id": "src-1",
            "display_name": "CSV",
            "source_type": "csv",
            "field_mappings": [
                {"kpi_field": "actual_value", "source_field": "value", "transform": "number"},
                {"kpi_field": "timestamp", "source_field": "timestamp", "transform": "datetime"},
                {"kpi_field": "source_record_id", "source_field": "record_id"},
            ],
            "kpi_bindings": [{"binding_id": "bind-1", "kpi_id": "kpi-1", "enabled": True, "field_mappings": []}],
        },
        "run-1",
    )

    assert len(rows) == 1
    assert rows[0]["kpi_id"] == "kpi-1"
    assert rows[0]["actual_value"] == 42.0
    assert rows[0]["source_record_id"] == "row-1"


def test_binding_validation_reports_unmatched_match_rule():
    fake_db = FakeDB()
    service = KpiSourceIngestionService(fake_db)
    config = {
        "source_config_id": "src-1",
        "display_name": "CSV",
        "source_type": "csv",
        "field_mappings": [{"kpi_field": "actual_value", "source_field": "value"}],
        "kpi_bindings": [{
            "binding_id": "bind-uptime",
            "kpi_id": "kpi-uptime",
            "enabled": True,
            "match_rule": {"field": "metric", "operator": "equals", "value": "uptime"},
        }],
    }

    rows = service._normalize_records([{"metric": "latency", "value": 10}], config, "run-1")
    accepted, skipped = service._validate_normalized_rows(rows, config)

    assert accepted == []
    assert skipped[0]["reason"] == "No source rows matched binding"
    assert skipped[0]["source_binding_id"] == "bind-uptime"


def test_metric_catalog_groups_contract_kpis_with_lineage_and_overrides():
    fake_db = FakeDB()
    fake_db.collections["contract_kpis"] = FakeCollection([
        {
            "kpi_id": "kpi-1",
            "contract_id": "contract-1",
            "project_id": "project-1",
            "contract_name": "Airport Food",
            "name": "Meal volume discount",
            "kpi_type": "financial",
            "unit": "%",
            "operator": "between",
            "value_min": 500000,
            "value_max": 1000000,
            "status": "approved",
            "tracking_status": "tracked",
            "is_tracked": True,
            "governance_status": "certified",
            "quote": "500,000-1,000,000 meals: 2.5%",
            "page_start": 5,
        },
        {
            "kpi_id": "kpi-2",
            "contract_id": "contract-2",
            "project_id": "project-1",
            "contract_name": "Airport Retail",
            "name": "Meal volume discount",
            "kpi_type": "financial",
            "unit": "%",
            "operator": "between",
            "value_min": 500000,
            "value_max": 1000000,
            "status": "approved",
        },
    ])
    fake_db.collections["contract_kpi_metric_catalog"] = FakeCollection([{
        "project_id": "project-1",
        "metric_key": "pending",
        "display_name": "Certified meal volume discount",
        "certified_status": "certified",
        "tags": ["commercial"],
        "version": 3,
    }])
    manager = ContractKPIManager(fake_db)
    metric_key = manager._canonical_metric_key(fake_db.collections["contract_kpis"].docs[0])
    fake_db.collections["contract_kpi_metric_catalog"].docs[0]["metric_key"] = metric_key

    result = manager.build_metric_catalog(project_id="project-1", contract_ids=["contract-1", "contract-2"])

    assert result["count"] == 1
    entry = result["entries"][0]
    assert entry["display_name"] == "Certified meal volume discount"
    assert entry["kpi_count"] == 2
    assert entry["tracked_count"] == 1
    assert entry["certified_count"] == 1
    assert entry["certified_status"] == "certified"
    assert entry["source_clause_lineage"][0]["page_start"] == 5


def test_project_operational_alert_generation_creates_contractsense_alerts():
    fake_db = FakeDB()
    fake_db.collections["contract_kpis"] = FakeCollection([{
        "kpi_id": "kpi-1",
        "contract_id": "contract-1",
        "project_id": "project-1",
        "name": "Monthly uptime",
        "tracking_status": "tracked",
        "is_tracked": True,
        "business_owner": "Ops",
        "missing_data_policy": "flag_missing_evidence_when_tracked",
    }])
    fake_db.collections["contract_kpi_alert_rules"] = FakeCollection([
        {
            "rule_id": "rule-medium-owner",
            "contract_id": "contract-1",
            "project_id": "project-1",
            "event_type": "missing_actual",
            "active": True,
            "severity_min": "Medium",
            "channels": ["in_app"],
            "recipients": ["ops@example.test"],
            "filters": {"owner": "Ops"},
        },
        {
            "rule_id": "rule-high-only",
            "contract_id": "contract-1",
            "project_id": "project-1",
            "event_type": "missing_actual",
            "active": True,
            "severity_min": "High",
            "channels": ["email"],
            "recipients": ["exec@example.test"],
            "filters": {},
        },
    ])
    fake_db.collections["contract_kpi_source_configs"] = FakeCollection([{
        "source_config_id": "src-1",
        "contract_id": "contract-1",
        "project_id": "project-1",
        "display_name": "ServiceNow incidents",
        "source_type": "servicenow",
        "enabled": True,
        "status": "enabled",
        "schedule": {"cadence": "daily"},
        "last_success_at": datetime(2026, 1, 1),
    }])
    manager = ContractKPIManager(fake_db)

    manager.generate_project_operational_alerts(project_id="project-1", contract_ids=["contract-1"])

    alerts = fake_db.collections["contract_kpi_alerts"].docs
    event_types = {alert["event_type"] for alert in alerts}
    assert "source_stale" in event_types
    assert "missing_actual" in event_types
    assert all(alert["project_id"] == "project-1" for alert in alerts)
    missing_alert = next(alert for alert in alerts if alert["event_type"] == "missing_actual")
    assert missing_alert["rule_ids"] == ["rule-medium-owner"]
    assert missing_alert["channels"] == ["in_app"]
    assert missing_alert["recipients"] == ["ops@example.test"]


def test_deadline_policy_uses_business_day_grace_and_period_lock():
    manager = ContractKPIManager(FakeDB())
    kpi = {
        "kpi_id": "kpi-deadline",
        "contract_id": "contract-1",
        "name": "Incident response deadline",
        "value": "2026-06-05T17:00:00",
        "rule_type": "deadline",
        "business_hours": {"enabled": True, "start": "09:00", "end": "17:00", "weekdays": [0, 1, 2, 3, 4]},
        "severity_grace_periods": {"default": 1},
        "reporting_lock": {"lock_after_days": 1},
    }
    rule = manager._build_evaluation_rule(kpi)

    result = manager._evaluate_rule(
        kpi,
        rule,
        "2026-06-08T16:00:00",
        timestamp=datetime(2026, 6, 8, 16, 0, 0),
    )

    assert result["is_breach"] is False
    assert result["deadline_at"].weekday() == 0
    assert result["period_locked"] is False


def test_error_budget_rule_is_deterministic_and_reports_burn_rate():
    manager = ContractKPIManager(FakeDB())
    kpi = {
        "kpi_id": "kpi-budget",
        "contract_id": "contract-1",
        "name": "Monthly error budget",
        "rule_type": "error_budget",
        "error_budget": {"budget": 100},
    }
    rule = manager._build_evaluation_rule(kpi)

    result = manager._evaluate_rule(kpi, rule, 125, timestamp=datetime(2026, 6, 10))

    assert result["is_breach"] is True
    assert result["expected_value"] == 100
    assert result["evaluated_value"] == 125
    assert result["burn_rate"] == 1.25


def test_raw_records_parking_layer():
    db = FakeDB()
    service = KpiSourceIngestionService(db)
    config = {
        "contract_id": "contract-1",
        "source_config_id": "src-config-1",
    }
    records = [
        {"id": 1, "kpi_id": "kpi-1", "actual_value": 98.5},
        {"id": 2, "kpi_id": "kpi-2", "actual_value": 105.0},
    ]

    count = service._park_raw_records(config, "run-101", records)
    assert count == 2

    parked = list(db["contract_kpi_raw_records"].find({"run_id": "run-101"}))
    assert len(parked) == 2
    assert parked[0]["contract_id"] == "contract-1"
    assert parked[0]["status"] == "parked"
    assert parked[0]["source_payload"] == {"id": 1, "kpi_id": "kpi-1", "actual_value": 98.5}

