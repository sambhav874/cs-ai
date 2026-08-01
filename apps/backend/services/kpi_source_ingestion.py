import csv
import base64
import hashlib
import hmac
import io
import json
import logging
import os
import re
import socket
import zipfile
from datetime import datetime, timedelta
from ipaddress import ip_address
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse
from xml.etree.ElementTree import Element as XmlElement

from defusedxml import ElementTree as ET

import requests

from core.database import db
from services.kpi_manager import ContractKPIManager, SOURCE_CONNECTOR_CATALOG
from utils.encryption import decrypt_value

logger = logging.getLogger(__name__)


STANDARD_ACTUAL_FIELDS = {
    "kpi_id",
    "kpi_name",
    "name",
    "metric",
    "actual_value",
    "value",
    "actual",
    "score",
    "unit",
    "timestamp",
    "date",
    "period",
    "source_record_id",
    "source",
}

FILE_SOURCE_TYPES = {"csv", "xlsx", "json", "xml"}
REST_PROFILE_SOURCE_TYPES = {
    "rest_api",
    "sap_s4hana",
    "sap_ariba",
    "oracle_fusion",
    "netsuite",
    "dynamics_365",
    "salesforce",
    "hubspot",
    "servicenow",
    "jira_service_management",
    "zendesk",
}
HTTP_FILE_SOURCE_TYPES = {"sharepoint", "onedrive", "google_drive", "azure_blob", "gcs"}
CATALOG_ONLY_SOURCE_TYPES = {
    "sftp",
    "email_inbox",
    "postgres",
    "mysql",
    "sql_server",
    "oracle_db",
    "snowflake",
    "bigquery",
    "redshift",
    "kafka",
}

MAX_SOURCE_BYTES = int(os.getenv("KPI_SOURCE_MAX_BYTES", str(5 * 1024 * 1024)))
MAX_SOURCE_ROWS = int(os.getenv("KPI_SOURCE_MAX_ROWS", "5000"))
MAX_XLSX_ZIP_MEMBERS = int(os.getenv("KPI_SOURCE_MAX_XLSX_ZIP_MEMBERS", "128"))
MAX_XLSX_UNCOMPRESSED_BYTES = int(os.getenv("KPI_SOURCE_MAX_XLSX_UNCOMPRESSED_BYTES", str(10 * 1024 * 1024)))


class KpiSourceError(ValueError):
    """Raised when a KPI source config cannot be validated or fetched."""


def _clean_string(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _is_missing_value(value: Any) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _safe_json_loads(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, bytes):
        value = value.decode("utf-8-sig")
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        return json.loads(text)
    return value


def _assert_source_size(content: bytes, *, label: str = "source payload") -> None:
    if len(content) > MAX_SOURCE_BYTES:
        raise KpiSourceError(f"{label} is too large. Maximum allowed size is {MAX_SOURCE_BYTES} bytes.")


def _limit_records(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if len(records) > MAX_SOURCE_ROWS:
        raise KpiSourceError(f"Source returned too many rows. Maximum allowed rows is {MAX_SOURCE_ROWS}.")
    return records


def _validate_fetch_url(raw_url: str, *, resolve_dns: bool = True) -> str:
    parsed = urlparse(raw_url)
    if parsed.scheme not in {"http", "https"}:
        raise KpiSourceError("Only http and https source endpoints are allowed.")
    if not parsed.hostname:
        raise KpiSourceError("Source endpoint must include a hostname.")
    host = parsed.hostname.strip().lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith(".localhost"):
        raise KpiSourceError("Localhost source endpoints are not allowed.")
    if not resolve_dns:
        return raw_url

    try:
        resolved_addresses = {info[4][0] for info in socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)}
    except OSError as exc:
        raise KpiSourceError("Source endpoint hostname could not be resolved.") from exc

    for resolved in resolved_addresses:
        try:
            candidate = ip_address(resolved)
        except ValueError:
            raise KpiSourceError("Source endpoint resolved to an invalid address.")
        if (
            candidate.is_private
            or candidate.is_loopback
            or candidate.is_link_local
            or candidate.is_multicast
            or candidate.is_reserved
            or candidate.is_unspecified
        ):
            raise KpiSourceError("Source endpoint resolves to a private or reserved network address.")
    return raw_url


def _bounded_http_request(session: requests.Session, method: str, endpoint: str, **kwargs: Any) -> requests.Response:
    _validate_fetch_url(endpoint, resolve_dns=isinstance(session, requests.Session))
    kwargs["allow_redirects"] = False
    kwargs["stream"] = True
    response = session.request(method, endpoint, **kwargs)
    response.raise_for_status()
    content = bytearray()
    for chunk in response.iter_content(chunk_size=65536):
        if not chunk:
            continue
        content.extend(chunk)
        if len(content) > MAX_SOURCE_BYTES:
            response.close()
            raise KpiSourceError(f"Source response is too large. Maximum allowed size is {MAX_SOURCE_BYTES} bytes.")
    response._content = bytes(content)
    response._content_consumed = True
    return response


def _value_at_path(payload: Any, path: Optional[str]) -> Any:
    if not path:
        return payload
    current = payload
    for raw_part in str(path).replace("[", ".").replace("]", "").split("."):
        part = raw_part.strip()
        if not part:
            continue
        if isinstance(current, list):
            if part.isdigit():
                index = int(part)
                current = current[index] if index < len(current) else None
            else:
                current = [item.get(part) for item in current if isinstance(item, dict) and part in item]
        elif isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _records_from_payload(payload: Any, record_path: Optional[str] = None) -> List[Dict[str, Any]]:
    selected = _value_at_path(payload, record_path) if record_path else payload
    if isinstance(selected, dict):
        for key in ("actuals", "records", "data", "results", "items", "rows"):
            if isinstance(selected.get(key), list):
                selected = selected[key]
                break
    if isinstance(selected, dict):
        selected = [selected]
    if not isinstance(selected, list):
        selected = [] if selected is None else [{"value": selected}]

    records: List[Dict[str, Any]] = []
    for item in selected:
        if isinstance(item, dict):
            records.append(dict(item))
        else:
            records.append({"value": item})
    return _limit_records(records)


def _flatten_xml_element(element: XmlElement) -> Dict[str, Any]:
    row: Dict[str, Any] = {}
    for key, value in element.attrib.items():
        row[key] = value
    children = list(element)
    if not children:
        row[element.tag.split("}")[-1]] = (element.text or "").strip()
        return row
    for child in children:
        tag = child.tag.split("}")[-1]
        grandchildren = list(child)
        if grandchildren:
            nested = _flatten_xml_element(child)
            for key, value in nested.items():
                row[f"{tag}.{key}"] = value
        else:
            row[tag] = (child.text or "").strip()
    return row


def _cell_column_index(cell_ref: str) -> int:
    letters = re.sub(r"[^A-Z]", "", (cell_ref or "").upper())
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - ord("A") + 1)
    return max(index - 1, 0)


def _parse_csv_bytes(content: bytes) -> List[Dict[str, Any]]:
    _assert_source_size(content, label="CSV source")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    records: List[Dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(text)):
        records.append(dict(row))
        if len(records) > MAX_SOURCE_ROWS:
            raise KpiSourceError(f"CSV source has too many rows. Maximum allowed rows is {MAX_SOURCE_ROWS}.")
    return records


def _parse_json_bytes(content: bytes, record_path: Optional[str] = None) -> List[Dict[str, Any]]:
    _assert_source_size(content, label="JSON source")
    payload = _safe_json_loads(content)
    return _records_from_payload(payload, record_path)


def _parse_xml_bytes(content: bytes, record_path: Optional[str] = None) -> List[Dict[str, Any]]:
    _assert_source_size(content, label="XML source")
    root = ET.fromstring(content)
    if record_path:
        path = ".//" + "/".join(part for part in record_path.split(".") if part)
        elements = root.findall(path)
    else:
        children = list(root)
        if children and all(child.tag == children[0].tag for child in children):
            elements = children
        else:
            elements = root.findall(".//record") or root.findall(".//row") or children or [root]
    return _limit_records([_flatten_xml_element(element) for element in elements])


def _parse_xlsx_bytes(content: bytes) -> List[Dict[str, Any]]:
    _assert_source_size(content, label="XLSX source")
    with zipfile.ZipFile(io.BytesIO(content)) as workbook:
        members = workbook.infolist()
        if len(members) > MAX_XLSX_ZIP_MEMBERS:
            raise KpiSourceError("XLSX workbook contains too many internal files.")
        total_uncompressed = sum(member.file_size for member in members)
        if total_uncompressed > MAX_XLSX_UNCOMPRESSED_BYTES:
            raise KpiSourceError("XLSX workbook expands beyond the safe processing limit.")

        shared_strings: List[str] = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            shared_root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            for item in shared_root.findall(".//{*}si"):
                text = "".join(node.text or "" for node in item.findall(".//{*}t"))
                shared_strings.append(text)

        sheet_name = "xl/worksheets/sheet1.xml"
        if sheet_name not in workbook.namelist():
            sheet_candidates = sorted(name for name in workbook.namelist() if name.startswith("xl/worksheets/sheet"))
            if not sheet_candidates:
                return []
            sheet_name = sheet_candidates[0]

        sheet_root = ET.fromstring(workbook.read(sheet_name))
        parsed_rows: List[List[Any]] = []
        for row in sheet_root.findall(".//{*}row"):
            values: List[Any] = []
            for cell in row.findall("{*}c"):
                index = _cell_column_index(cell.attrib.get("r", ""))
                while len(values) <= index:
                    values.append("")
                value_node = cell.find("{*}v")
                inline_text = cell.find("{*}is/{*}t")
                raw_value = value_node.text if value_node is not None else inline_text.text if inline_text is not None else ""
                if cell.attrib.get("t") == "s" and str(raw_value).isdigit():
                    value = shared_strings[int(raw_value)] if int(raw_value) < len(shared_strings) else ""
                else:
                    value = raw_value
                values[index] = value
            parsed_rows.append(values)

    if not parsed_rows:
        return []
    headers = [str(header).strip() or f"column_{index + 1}" for index, header in enumerate(parsed_rows[0])]
    records: List[Dict[str, Any]] = []
    for row in parsed_rows[1:]:
        if not any(str(value).strip() for value in row):
            continue
        records.append({headers[index]: row[index] if index < len(row) else "" for index in range(len(headers))})
    return _limit_records(records)


def _parse_records_by_format(content: bytes, file_format: str, record_path: Optional[str] = None) -> List[Dict[str, Any]]:
    normalized_format = (file_format or "json").lower().lstrip(".")
    if normalized_format == "csv":
        return _parse_csv_bytes(content)
    if normalized_format == "xlsx":
        return _parse_xlsx_bytes(content)
    if normalized_format == "xml":
        return _parse_xml_bytes(content, record_path)
    return _parse_json_bytes(content, record_path)


def _format_from_config(config: Dict[str, Any], fallback_url: Optional[str] = None) -> str:
    explicit = _clean_string(config.get("file_format") or config.get("format"))
    if explicit:
        return explicit.lower().lstrip(".")
    source_type = str(config.get("source_type") or "").lower()
    if source_type in FILE_SOURCE_TYPES:
        return source_type
    path = _clean_string(config.get("object_key") or config.get("key") or fallback_url)
    suffix = (urlparse(path).path if path else "").rsplit(".", 1)
    return suffix[-1].lower() if len(suffix) == 2 and suffix[-1] else "json"


# --- Auto-Mapping Field Scoring Table & Logic ---
AUTO_MAP_FIELD_PATTERNS = {
    "actual_value": ["actual_value", "value", "val", "actual", "score", "metric_value", "reading", "amount", "result", "measured_value"],
    "timestamp": ["timestamp", "time", "date", "event_time", "created_at", "recorded_at", "ts", "datetime", "log_date"],
    "source_record_id": ["source_record_id", "record_id", "id", "txn_id", "event_id", "uuid", "transaction_id", "row_id", "key"],
    "unit": ["unit", "uom", "unit_of_measure", "dimension"],
    "period": ["period", "interval", "window", "quarter", "month", "reporting_period"],
    "kpi_id": ["kpi_id", "kpi", "metric_id", "metric_code", "sla_id"],
    "kpi_name": ["kpi_name", "metric_name", "name", "metric_title", "sla_name"],
}


def auto_detect_field_mappings(schema_fields: List[str]) -> List[Dict[str, Any]]:
    """Auto-detect target KPI field mappings from raw payload column names."""
    mappings: List[Dict[str, Any]] = []
    used_sources = set()

    for target_field, synonyms in AUTO_MAP_FIELD_PATTERNS.items():
        best_match = None
        best_score = -1

        for col in schema_fields:
            if col in used_sources:
                continue
            col_clean = re.sub(r"[^a-z0-9]", "", col.lower())

            for rank, synonym in enumerate(synonyms):
                syn_clean = re.sub(r"[^a-z0-9]", "", synonym.lower())
                if col_clean == syn_clean:
                    score = 100 - rank
                    if score > best_score:
                        best_score = score
                        best_match = col
                elif syn_clean in col_clean or col_clean in syn_clean:
                    score = 70 - rank
                    if score > best_score:
                        best_score = score
                        best_match = col

        if best_match:
            used_sources.add(best_match)
            transform = "number" if target_field == "actual_value" else "datetime" if target_field == "timestamp" else "string"
            mappings.append({
                "kpi_field": target_field,
                "source_field": best_match,
                "transform": transform,
                "auto_detected": True,
            })

    return mappings


def parse_sample_file_bytes(
    content: bytes,
    file_format: str,
    record_path: Optional[str] = None
) -> Dict[str, Any]:
    """Parse raw uploaded sample file bytes, extract records, schema fields, and auto-detected mappings."""
    records = _parse_records_by_format(content, file_format, record_path)
    if not records:
        return {
            "schema_fields": [],
            "sample_rows": [],
            "field_mappings": [],
            "record_count": 0,
            "sample_payload": [],
        }

    all_keys = []
    seen = set()
    for rec in records:
        if isinstance(rec, dict):
            for key in rec.keys():
                if key not in seen:
                    seen.add(key)
                    all_keys.append(key)

    schema_fields = [{"name": key, "type": "string"} for key in all_keys]
    auto_mappings = auto_detect_field_mappings(all_keys)

    return {
        "schema_fields": schema_fields,
        "sample_rows": records[:5],
        "field_mappings": auto_mappings,
        "record_count": len(records),
        "sample_payload": records[:20],
    }


class BaseKpiSourceAdapter:
    def __init__(self, config: Dict[str, Any], session: Optional[requests.Session] = None):
        self.config = dict(config)
        for field in ["credential_ref", "webhook_secret_ref", "webhook_secret"]:
            if self.config.get(field):
                self.config[field] = decrypt_value(self.config[field])
        self.session = session or requests.Session()

    def validate_config(self, payload: Any = None) -> List[str]:
        return []

    def test_connection(self, payload: Any = None) -> Dict[str, Any]:
        errors = self.validate_config(payload=payload)
        return {
            "ok": not errors,
            "errors": errors,
            "source_type": self.config.get("source_type"),
        }

    def fetch(self, payload: Any = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def normalize(self, records: List[Dict[str, Any]], mappings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return records

    def update_watermark(self, config: Dict[str, Any], run: Dict[str, Any]) -> Optional[Any]:
        return run.get("watermark_after") or config.get("watermark_value")

    def _sample_or_payload(self, payload: Any = None) -> Any:
        if payload is not None:
            return payload
        return self.config.get("sample_payload")


class ManualPayloadAdapter(BaseKpiSourceAdapter):
    def validate_config(self) -> List[str]:
        return []

    def fetch(self, payload: Any = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        selected = self._sample_or_payload(payload)
        records = _records_from_payload(selected, self.config.get("record_path") or self.config.get("data_path"))
        return records[:limit] if limit else records


class RestSourceAdapter(BaseKpiSourceAdapter):
    def validate_config(self) -> List[str]:
        errors: List[str] = []
        if not _clean_string(self.config.get("endpoint")) and self.config.get("sample_payload") is None:
            errors.append("endpoint is required unless sample_payload is supplied")
        auth_type = str(self.config.get("auth_type") or "none").lower()
        if auth_type not in {"none", "api_key", "bearer", "basic", "oauth2", "api_token", "private_app_token", "sap_destination", "token_based"}:
            errors.append(f"unsupported auth_type for REST adapter: {auth_type}")
        if auth_type not in {"none"} and not self.config.get("credential_ref"):
            errors.append("credential_ref is required for authenticated REST sources")
        return errors

    def test_connection(self) -> Dict[str, Any]:
        errors = self.validate_config()
        if errors:
            return {"ok": False, "errors": errors, "source_type": self.config.get("source_type")}
        if self.config.get("sample_payload") is not None and not self.config.get("endpoint"):
            return {"ok": True, "mode": "sample_payload", "source_type": self.config.get("source_type")}
        try:
            records = self.fetch(limit=1)
            return {"ok": True, "mode": "http", "sample_records": len(records), "source_type": self.config.get("source_type")}
        except Exception as exc:
            return {"ok": False, "errors": [str(exc)], "source_type": self.config.get("source_type")}

    def fetch(self, payload: Any = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        selected_payload = self._sample_or_payload(payload)
        endpoint = _clean_string(self.config.get("endpoint"))
        if selected_payload is not None and not endpoint:
            records = _records_from_payload(selected_payload, self.config.get("record_path") or self.config.get("data_path"))
            return records[:limit] if limit else records
        if not endpoint:
            raise KpiSourceError("endpoint is required for REST fetch")

        method = str(self.config.get("method") or "GET").upper()
        request_body = self.config.get("body")
        headers = self.config.get("headers") if isinstance(self.config.get("headers"), dict) else {}
        headers = {**headers, **self._credential_headers()}
        query_params = self.config.get("query_params") if isinstance(self.config.get("query_params"), dict) else {}
        timeout = float(self.config.get("timeout_seconds") or 30)
        response = _bounded_http_request(
            self.session,
            method,
            endpoint,
            headers=headers,
            params=query_params,
            json=request_body if isinstance(request_body, (dict, list)) else None,
            data=request_body if isinstance(request_body, str) else None,
            timeout=timeout,
        )
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "json" in content_type or _format_from_config(self.config, endpoint) == "json":
            payload_json = response.json()
            records = _records_from_payload(payload_json, self.config.get("record_path") or self.config.get("data_path"))
        else:
            records = _parse_records_by_format(response.content, _format_from_config(self.config, endpoint), self.config.get("record_path"))
        return records[:limit] if limit else records

    def _credential_headers(self) -> Dict[str, str]:
        credential_ref = _clean_string(self.config.get("credential_ref"))
        if not credential_ref:
            return {}
        env_name = credential_ref[4:] if credential_ref.startswith("env:") else credential_ref if credential_ref.isupper() else None
        secret = os.getenv(env_name) if env_name else None
        if not secret:
            return {}
        auth_type = str(self.config.get("auth_type") or "none").lower()
        if auth_type in {"bearer", "oauth2", "api_token", "private_app_token", "token_based", "sap_destination"}:
            return {"Authorization": f"Bearer {secret}"}
        if auth_type == "api_key":
            return {str(self.config.get("auth_header") or "x-api-key"): secret}
        if auth_type == "basic":
            token = base64.b64encode(secret.encode("utf-8")).decode("ascii") if ":" in secret else secret
            return {"Authorization": f"Basic {token}"}
        return {}


class HttpFileSourceAdapter(BaseKpiSourceAdapter):
    def validate_config(self) -> List[str]:
        if not _clean_string(self.config.get("endpoint") or self.config.get("signed_url")) and self.config.get("sample_payload") is None:
            return ["endpoint or signed_url is required unless sample_payload is supplied"]
        return []

    def fetch(self, payload: Any = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        selected_payload = self._sample_or_payload(payload)
        endpoint = _clean_string(self.config.get("endpoint") or self.config.get("signed_url"))
        if selected_payload is not None and not endpoint:
            if isinstance(selected_payload, (dict, list)):
                records = _records_from_payload(selected_payload, self.config.get("record_path") or self.config.get("data_path"))
            else:
                content = str(selected_payload).encode("utf-8")
                records = _parse_records_by_format(content, _format_from_config(self.config, endpoint), self.config.get("record_path"))
            return records[:limit] if limit else records
        if not endpoint:
            raise KpiSourceError("endpoint or signed_url is required for file fetch")
        response = _bounded_http_request(
            self.session,
            "GET",
            endpoint,
            headers=self.config.get("headers") or {},
            params=self.config.get("query_params") or {},
            timeout=float(self.config.get("timeout_seconds") or 30),
        )
        records = _parse_records_by_format(response.content, _format_from_config(self.config, endpoint), self.config.get("record_path"))
        return records[:limit] if limit else records


class UploadedFileAdapter(BaseKpiSourceAdapter):
    def validate_config(self, payload: Any = None) -> List[str]:
        selected_payload = self._sample_or_payload(payload)
        if selected_payload is None and not _clean_string(self.config.get("endpoint") or self.config.get("signed_url")):
            return ["No telemetry data found. Please drop or select a sample file into Section 4 before clicking 'Ingest Actuals'."]
        return []

    def fetch(self, payload: Any = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        selected_payload = self._sample_or_payload(payload)
        if selected_payload is not None:
            if isinstance(selected_payload, (dict, list)):
                records = _records_from_payload(selected_payload, self.config.get("record_path") or self.config.get("data_path"))
            else:
                records = _parse_records_by_format(str(selected_payload).encode("utf-8"), _format_from_config(self.config), self.config.get("record_path"))
            return records[:limit] if limit else records
        return HttpFileSourceAdapter(self.config, self.session).fetch(limit=limit)


class S3SourceAdapter(BaseKpiSourceAdapter):
    def validate_config(self) -> List[str]:
        if self.config.get("sample_payload") is not None:
            return []
        if _clean_string(self.config.get("endpoint") or self.config.get("signed_url")):
            return []
        if not _clean_string(self.config.get("bucket")):
            return ["bucket is required for S3 fetch"]
        if not _clean_string(self.config.get("object_key") or self.config.get("key") or self.config.get("prefix")):
            return ["object_key/key or prefix is required for S3 fetch"]
        return []

    def fetch(self, payload: Any = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        selected_payload = self._sample_or_payload(payload)
        if selected_payload is not None:
            records = _records_from_payload(selected_payload, self.config.get("record_path") or self.config.get("data_path"))
            return records[:limit] if limit else records
        signed_url = _clean_string(self.config.get("endpoint") or self.config.get("signed_url"))
        if signed_url:
            return HttpFileSourceAdapter(self.config, self.session).fetch(limit=limit)

        try:
            import boto3  # type: ignore
        except ImportError as exc:
            raise KpiSourceError("S3 private object fetch requires boto3 or a signed_url/endpoint") from exc

        bucket = _clean_string(self.config.get("bucket"))
        key = _clean_string(self.config.get("object_key") or self.config.get("key"))
        prefix = _clean_string(self.config.get("prefix"))
        if not bucket:
            raise KpiSourceError("bucket is required for S3 fetch")
        s3 = boto3.client("s3", region_name=_clean_string(self.config.get("region")))
        if not key and prefix:
            listed = s3.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=50)
            objects = sorted(listed.get("Contents") or [], key=lambda item: item.get("LastModified") or datetime.min, reverse=True)
            key = objects[0].get("Key") if objects else None
        if not key:
            raise KpiSourceError("No S3 object found for source config")
        response = s3.get_object(Bucket=bucket, Key=key)
        content = response["Body"].read()
        records = _parse_records_by_format(content, _format_from_config({**self.config, "key": key}), self.config.get("record_path"))
        return records[:limit] if limit else records


class CatalogContractAdapter(BaseKpiSourceAdapter):
    def validate_config(self) -> List[str]:
        source_type = self.config.get("source_type")
        return [f"{source_type} is catalog-backed in this build; add its runtime dependency/secret resolver before enabling fetches"]

    def fetch(self, payload: Any = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        raise KpiSourceError(self.validate_config()[0])


def adapter_for_source(config: Dict[str, Any], session: Optional[requests.Session] = None) -> BaseKpiSourceAdapter:
    source_type = str(config.get("source_type") or "rest_api").lower()
    if source_type in {"manual_attestation", "webhook"}:
        return ManualPayloadAdapter(config, session)
    if source_type in REST_PROFILE_SOURCE_TYPES:
        return RestSourceAdapter(config, session)
    if source_type in FILE_SOURCE_TYPES:
        return UploadedFileAdapter(config, session)
    if source_type in HTTP_FILE_SOURCE_TYPES:
        return HttpFileSourceAdapter(config, session)
    if source_type == "s3":
        return S3SourceAdapter(config, session)
    if source_type in CATALOG_ONLY_SOURCE_TYPES:
        return CatalogContractAdapter(config, session)
    return CatalogContractAdapter(config, session)


class KpiSourceIngestionService:
    def __init__(self, database=None, session: Optional[requests.Session] = None):
        from core.database import kpi_db
        self.db = database if database is not None else kpi_db
        self.source_configs = self.db["contract_kpi_source_configs"]
        self.fetch_runs = self.db["contract_kpi_fetch_runs"]
        self.actuals = self.db["contract_kpi_actuals"]
        self.manager = ContractKPIManager(self.db)
        self.session = session or requests.Session()

    def test_source(
        self,
        *,
        contract_id: str,
        source_config_id: str,
        user_id: str,
        payload: Any = None,
    ) -> Dict[str, Any]:
        config = self._get_config(contract_id, source_config_id)
        run = self._start_run(config, user_id=user_id, trigger_type="test")
        try:
            adapter = adapter_for_source(config, self.session)
            connection = adapter.test_connection(payload=payload)
            if not connection.get("ok"):
                raise KpiSourceError("; ".join(connection.get("errors") or ["Connection test failed"]))
            records = adapter.fetch(payload=payload, limit=int(config.get("preview_limit") or 50))
            normalized = self._normalize_records(records, config, run["run_id"])
            accepted, skipped = self._validate_normalized_rows(normalized, config)
            schema_fields = self._schema_fields(records)
            status = "ready" if accepted and not skipped else "validation_failed" if not accepted else "ready"
            finished = self._finish_run(
                run,
                status="validated" if accepted else "validation_failed",
                records_fetched=len(records),
                records_accepted=len(accepted),
                records_skipped=len(skipped),
                normalized_rows=normalized,
                skipped_rows=skipped,
                errors=[] if accepted else ["No valid normalized rows were produced"],
            )
            self.source_configs.update_one(
                {"contract_id": contract_id, "source_config_id": source_config_id},
                {
                    "$set": {
                        "status": status,
                        "schema_fields": schema_fields,
                        "last_fetch_status": {
                            "status": finished["status"],
                            "trigger_type": "test",
                            "record_count": len(records),
                            "accepted_count": len(accepted),
                            "skipped_count": len(skipped),
                            "run_id": run["run_id"],
                            "finished_at": finished.get("finished_at"),
                        },
                        "last_error": None if accepted else "No valid normalized rows were produced",
                        "updated_at": datetime.utcnow(),
                        "updated_by": user_id,
                    }
                },
            )
            return {
                "contract_id": contract_id,
                "source_config_id": source_config_id,
                "connection": connection,
                "fetch_run": finished,
                "schema_fields": schema_fields,
                "normalized_rows": accepted[:50],
                "skipped_rows": skipped[:50],
                "source_config": self._serialize(self.source_configs.find_one({"contract_id": contract_id, "source_config_id": source_config_id})),
            }
        except Exception as exc:
            logger.exception("KPI source test failed for %s: %s", source_config_id, exc)
            finished = self._finish_run(run, status="failed", errors=[str(exc)])
            self.source_configs.update_one(
                {"contract_id": contract_id, "source_config_id": source_config_id},
                {
                    "$set": {
                        "status": "validation_failed",
                        "last_error": str(exc),
                        "last_fetch_status": {
                            "status": "failed",
                            "trigger_type": "test",
                            "record_count": 0,
                            "accepted_count": 0,
                            "skipped_count": 0,
                            "run_id": run["run_id"],
                            "finished_at": finished.get("finished_at"),
                            "error": str(exc),
                        },
                        "updated_at": datetime.utcnow(),
                        "updated_by": user_id,
                    }
                },
            )
            raise KpiSourceError(str(exc)) from exc

    def fetch_source(
        self,
        *,
        contract_id: str,
        source_config_id: str,
        user_id: str,
        trigger_type: str = "manual",
        payload: Any = None,
        evaluate: bool = True,
    ) -> Dict[str, Any]:
        config = self._get_config(contract_id, source_config_id)
        run = self._start_run(config, user_id=user_id, trigger_type=trigger_type)
        watermark_before = config.get("watermark_value")
        try:
            adapter = adapter_for_source(config, self.session)
            validation_errors = adapter.validate_config(payload=payload)
            if validation_errors:
                raise KpiSourceError("; ".join(validation_errors))
            records = adapter.fetch(payload=payload)
            normalized = self._normalize_records(records, config, run["run_id"])
            accepted, skipped = self._validate_normalized_rows(normalized, config)
            accepted, duplicate_rows = self._dedupe_rows(contract_id, source_config_id, accepted, config)
            skipped.extend(duplicate_rows)
            ingest_result = self.manager.ingest_actuals(
                contract_id=contract_id,
                user_id=user_id,
                rows=accepted,
                source=f"source_config:{source_config_id}:{config.get('source_type')}",
                evaluate=evaluate,
            ) if accepted else {
                "count": 0,
                "actuals": [],
                "breaches": [],
                "deferred_evaluations": [],
                "skipped": [],
            }
            skipped.extend(ingest_result.get("skipped") or [])
            watermark_after = self._watermark_after(config, records, accepted) or watermark_before
            next_run_at = self.compute_next_run_at(config.get("schedule") or {}, datetime.utcnow()) if config.get("enabled") else None
            status = "completed" if accepted and not skipped else "partial_success" if accepted else "completed_empty"
            finished = self._finish_run(
                run,
                status=status,
                records_fetched=len(records),
                records_accepted=len(ingest_result.get("actuals") or []),
                records_skipped=len(skipped),
                normalized_rows=accepted,
                skipped_rows=skipped,
                ingest_result=ingest_result,
                watermark_before=watermark_before,
                watermark_after=watermark_after,
            )
            update_payload: Dict[str, Any] = {
                "status": "enabled" if config.get("enabled") else "ready",
                "last_run_at": finished.get("finished_at"),
                "last_fetch_status": {
                    "status": finished["status"],
                    "trigger_type": trigger_type,
                    "record_count": len(records),
                    "accepted_count": len(ingest_result.get("actuals") or []),
                    "skipped_count": len(skipped),
                    "actual_count": ingest_result.get("count", 0),
                    "breach_count": len(ingest_result.get("breaches") or []),
                    "deferred_count": len(ingest_result.get("deferred_evaluations") or []),
                    "run_id": run["run_id"],
                    "finished_at": finished.get("finished_at"),
                    "ai_used": False,
                },
                "last_error": None,
                "watermark_value": watermark_after,
                "updated_at": datetime.utcnow(),
                "updated_by": user_id,
            }
            if ingest_result.get("actuals"):
                update_payload["last_success_at"] = finished.get("finished_at")
            if next_run_at:
                update_payload["next_run_at"] = next_run_at
            self.source_configs.update_one(
                {"contract_id": contract_id, "source_config_id": source_config_id},
                {"$set": update_payload},
            )
            return {
                "contract_id": contract_id,
                "source_config_id": source_config_id,
                "fetch_run": finished,
                "normalized_rows": accepted[:50],
                "skipped_rows": skipped[:50],
                "created_actuals": ingest_result.get("actuals") or [],
                "created_breaches": ingest_result.get("breaches") or [],
                "deferred_evaluations": ingest_result.get("deferred_evaluations") or [],
                "source_config": self._serialize(self.source_configs.find_one({"contract_id": contract_id, "source_config_id": source_config_id})),
            }
        except Exception as exc:
            logger.exception("KPI source fetch failed for %s: %s", source_config_id, exc)
            finished = self._finish_run(run, status="failed", errors=[str(exc)], watermark_before=watermark_before)
            next_run_at = self.compute_next_run_at(config.get("schedule") or {}, datetime.utcnow()) if config.get("enabled") else None
            update_payload = {
                "status": "last_fetch_failed" if config.get("enabled") else "validation_failed",
                "last_run_at": finished.get("finished_at"),
                "last_error": str(exc),
                "last_fetch_status": {
                    "status": "failed",
                    "trigger_type": trigger_type,
                    "record_count": 0,
                    "accepted_count": 0,
                    "skipped_count": 0,
                    "run_id": run["run_id"],
                    "finished_at": finished.get("finished_at"),
                    "error": str(exc),
                    "ai_used": False,
                },
                "updated_at": datetime.utcnow(),
                "updated_by": user_id,
            }
            if next_run_at:
                update_payload["next_run_at"] = next_run_at
            self.source_configs.update_one(
                {"contract_id": contract_id, "source_config_id": source_config_id},
                {"$set": update_payload},
            )
            raise KpiSourceError(str(exc)) from exc

    def ingest_webhook(
        self,
        *,
        contract_id: str,
        source_config_id: str,
        user_id: str,
        payload: Any,
        signature: Optional[str] = None,
    ) -> Dict[str, Any]:
        config = self._get_config(contract_id, source_config_id)
        self._verify_webhook_signature(config, payload, signature)
        return self.fetch_source(
            contract_id=contract_id,
            source_config_id=source_config_id,
            user_id=user_id,
            trigger_type="webhook",
            payload=payload,
            evaluate=True,
        )

    def list_fetch_runs(self, *, contract_id: str, source_config_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {"contract_id": contract_id}
        if source_config_id:
            query["source_config_id"] = source_config_id
        return [
            self._serialize(doc)
            for doc in self.fetch_runs.find(query).sort([("started_at", -1)]).limit(max(1, min(int(limit or 50), 200)))
        ]

    def get_fetch_run_detail(self, *, contract_id: str, source_config_id: str, run_id: str) -> Dict[str, Any]:
        run = self.fetch_runs.find_one({
            "contract_id": contract_id,
            "source_config_id": source_config_id,
            "run_id": run_id,
        })
        if not run:
            raise KpiSourceError("Fetch run not found")

        actual_docs = list(self.actuals.find({
            "contract_id": contract_id,
            "metadata.source_config_id": source_config_id,
            "metadata.source_run_id": run_id,
        }).sort([("timestamp", -1), ("created_at", -1)]))
        actual_ids = [doc.get("actual_id") for doc in actual_docs if doc.get("actual_id")]
        breach_docs = list(self.manager.breaches.find({
            "contract_id": contract_id,
            "actual_id": {"$in": actual_ids},
        }).sort([("created_at", -1)])) if actual_ids else []
        serialized_run = self._serialize(run)
        return {
            "contract_id": contract_id,
            "source_config_id": source_config_id,
            "run_id": run_id,
            "fetch_run": serialized_run,
            "normalized_rows": serialized_run.get("normalized_preview") or [],
            "skipped_rows": serialized_run.get("skipped_rows") or [],
            "created_actuals": [self.manager._serialize(doc) for doc in actual_docs],
            "created_breaches": [self.manager._serialize(doc) for doc in breach_docs],
        }

    @staticmethod
    def compute_next_run_at(schedule: Dict[str, Any], now: Optional[datetime] = None) -> Optional[datetime]:
        current = now or datetime.utcnow()
        cadence = str((schedule or {}).get("cadence") or "manual").lower()
        if cadence in {"manual", "on_file_arrival", "real_time", "webhook", "on_email"}:
            return None
        if cadence == "hourly":
            return current + timedelta(hours=1)
        if cadence == "daily":
            return current + timedelta(days=1)
        if cadence == "weekly":
            return current + timedelta(weeks=1)
        if cadence == "monthly":
            return current + timedelta(days=31)
        if cadence == "quarterly":
            return current + timedelta(days=92)
        if cadence in {"annual", "annually", "yearly"}:
            return current + timedelta(days=366)
        return None

    def _get_config(self, contract_id: str, source_config_id: str) -> Dict[str, Any]:
        config = self.source_configs.find_one({
            "contract_id": contract_id,
            "source_config_id": source_config_id,
            "archived_at": {"$exists": False},
        })
        if not config:
            raise KpiSourceError("Source config not found")
        config = dict(config)
        for field in ["credential_ref", "webhook_secret_ref", "webhook_secret"]:
            if config.get(field):
                config[field] = decrypt_value(config[field])
        catalog = {item["source_type"] for item in SOURCE_CONNECTOR_CATALOG}
        if str(config.get("source_type") or "").lower() not in catalog:
            raise KpiSourceError(f"Unsupported KPI source type: {config.get('source_type')}")
        return config

    def _start_run(self, config: Dict[str, Any], *, user_id: str, trigger_type: str) -> Dict[str, Any]:
        now = datetime.utcnow()
        run_seed = f"{config.get('source_config_id')}:{trigger_type}:{now.isoformat()}"
        run_id = f"kpi_fetch_{hashlib.md5(run_seed.encode()).hexdigest()[:14]}"
        run = {
            "run_id": run_id,
            "contract_id": config.get("contract_id"),
            "project_id": config.get("project_id"),
            "source_config_id": config.get("source_config_id"),
            "source_type": config.get("source_type"),
            "status": "running",
            "trigger_type": trigger_type,
            "user_id": user_id,
            "started_at": now,
            "records_fetched": 0,
            "records_accepted": 0,
            "records_skipped": 0,
            "errors": [],
            "watermark_before": config.get("watermark_value"),
            "watermark_after": config.get("watermark_value"),
            "ai_used": False,
        }
        self.fetch_runs.insert_one(run)
        return run

    def _finish_run(
        self,
        run: Dict[str, Any],
        *,
        status: str,
        records_fetched: int = 0,
        records_accepted: int = 0,
        records_skipped: int = 0,
        normalized_rows: Optional[List[Dict[str, Any]]] = None,
        skipped_rows: Optional[List[Dict[str, Any]]] = None,
        ingest_result: Optional[Dict[str, Any]] = None,
        errors: Optional[List[str]] = None,
        watermark_before: Any = None,
        watermark_after: Any = None,
    ) -> Dict[str, Any]:
        finished_at = datetime.utcnow()
        update = {
            "status": status,
            "finished_at": finished_at,
            "duration_ms": int((finished_at - run["started_at"]).total_seconds() * 1000),
            "records_fetched": records_fetched,
            "records_accepted": records_accepted,
            "records_skipped": records_skipped,
            "normalized_preview": (normalized_rows or [])[:25],
            "skipped_rows": (skipped_rows or [])[:100],
            "created_actual_count": len((ingest_result or {}).get("actuals") or []),
            "created_breach_count": len((ingest_result or {}).get("breaches") or []),
            "deferred_evaluation_count": len((ingest_result or {}).get("deferred_evaluations") or []),
            "errors": errors or [],
            "watermark_before": watermark_before if watermark_before is not None else run.get("watermark_before"),
            "watermark_after": watermark_after if watermark_after is not None else run.get("watermark_after"),
            "ai_used": False,
        }
        self.fetch_runs.update_one({"run_id": run["run_id"]}, {"$set": update})
        clean = {**run, **update}
        return self._serialize(clean)

    def _normalize_records(self, records: List[Dict[str, Any]], config: Dict[str, Any], run_id: str) -> List[Dict[str, Any]]:
        mappings = config.get("field_mappings") if isinstance(config.get("field_mappings"), list) else []
        bindings = [
            binding for binding in self.manager._runtime_kpi_bindings(config)
            if binding.get("enabled", True) and binding.get("kpi_id")
        ]
        normalized_rows: List[Dict[str, Any]] = []
        for index, record in enumerate(records, start=1):
            base_row = self._normalize_source_record(record, mappings, config, run_id, index)
            if not bindings:
                kpi_ids = [str(item) for item in config.get("kpi_ids") or [] if item]
                if len(kpi_ids) == 1 and not base_row.get("kpi_id") and not base_row.get("kpi_name"):
                    base_row["kpi_id"] = kpi_ids[0]
                normalized_rows.append(base_row)
                continue

            for binding in bindings:
                if not self._record_matches_binding(record, base_row, binding):
                    continue
                row = dict(base_row)
                binding_mappings = binding.get("field_mappings") if isinstance(binding.get("field_mappings"), list) else []
                if binding_mappings:
                    row.update(self._mapped_row(record, binding_mappings))
                row["kpi_id"] = str(binding["kpi_id"])
                row["source_binding_id"] = binding.get("binding_id")
                row["source_binding_match_rule"] = binding.get("match_rule") or {}
                row["source_binding_aggregation"] = binding.get("aggregation") or "latest"
                if binding.get("unit_override"):
                    row["unit"] = binding["unit_override"]

                dedupe_key = _clean_string(binding.get("dedupe_key_override") or config.get("dedupe_key"))
                if dedupe_key:
                    dedupe_value = _value_at_path(record, dedupe_key)
                    if dedupe_value is not None:
                        row["source_record_id"] = dedupe_value
                watermark_field = _clean_string(binding.get("watermark_field_override") or config.get("watermark_field"))
                if watermark_field:
                    watermark_value = _value_at_path(record, watermark_field)
                    if watermark_value is not None:
                        row["source_watermark_value"] = watermark_value
                if row.get("source_record_id") is None:
                    row["source_record_id"] = self._fallback_source_record_id(config, record, index)
                normalized_rows.append(row)
        return normalized_rows

    def _normalize_source_record(
        self,
        record: Dict[str, Any],
        mappings: List[Dict[str, Any]],
        config: Dict[str, Any],
        run_id: str,
        index: int,
    ) -> Dict[str, Any]:
        row = self._mapped_row(record, mappings)
        for source_field, target in (
            ("kpi_id", "kpi_id"),
            ("kpi_name", "kpi_name"),
            ("metric", "metric"),
            ("name", "name"),
            ("actual_value", "actual_value"),
            ("value", "value"),
            ("actual", "actual"),
            ("score", "score"),
            ("unit", "unit"),
            ("timestamp", "timestamp"),
            ("date", "timestamp"),
            ("period", "period"),
            ("source_record_id", "source_record_id"),
            ("record_id", "source_record_id"),
            ("id", "source_record_id"),
        ):
            if target not in row and record.get(source_field) is not None:
                row[target] = record.get(source_field)

        dedupe_key = _clean_string(config.get("dedupe_key"))
        if dedupe_key and not row.get("source_record_id"):
            row["source_record_id"] = _value_at_path(record, dedupe_key)

        row["source_config_id"] = config.get("source_config_id")
        row["source_display_name"] = config.get("display_name")
        row["source_type"] = config.get("source_type")
        row["source_run_id"] = run_id
        row["source_row_index"] = index
        if row.get("source_record_id") is None:
            row["source_record_id"] = self._fallback_source_record_id(config, record, index)

        for key, value in record.items():
            metadata_key = f"source_field_{key}"
            if key not in row and metadata_key not in row and key not in STANDARD_ACTUAL_FIELDS:
                row[metadata_key] = value
        return row

    def _mapped_row(self, record: Dict[str, Any], mappings: List[Dict[str, Any]]) -> Dict[str, Any]:
        row: Dict[str, Any] = {}
        for mapping in mappings:
            if not isinstance(mapping, dict):
                continue
            target = _clean_string(
                mapping.get("kpi_field")
                or mapping.get("target_field")
                or mapping.get("target")
                or mapping.get("field")
            )
            source_field = _clean_string(
                mapping.get("source_field")
                or mapping.get("source")
                or mapping.get("path")
            )
            if not target or not source_field:
                continue
            value = _value_at_path(record, source_field)
            if value is None and source_field in record:
                value = record.get(source_field)
            row[target] = self._apply_transform(value, mapping.get("transform"))
        return row

    def _record_matches_binding(self, record: Dict[str, Any], row: Dict[str, Any], binding: Dict[str, Any]) -> bool:
        rule = binding.get("match_rule") if isinstance(binding.get("match_rule"), dict) else {}
        if not rule:
            return True
        nested_rules = rule.get("rules")
        if isinstance(nested_rules, list):
            results = [
                self._record_matches_binding(record, row, {**binding, "match_rule": nested_rule})
                for nested_rule in nested_rules
                if isinstance(nested_rule, dict)
            ]
            return any(results) if str(rule.get("mode") or rule.get("operator") or "all").lower() == "any" else all(results)

        field = _clean_string(rule.get("field") or rule.get("source_field") or rule.get("kpi_field"))
        if not field:
            return True
        candidate = row.get(field)
        if candidate is None:
            candidate = _value_at_path(record, field)
        operator = str(rule.get("operator") or rule.get("op") or "equals").lower()
        expected = rule.get("value")
        values = rule.get("values") if isinstance(rule.get("values"), list) else []
        if operator in {"exists", "present"}:
            return not _is_missing_value(candidate)
        if operator in {"missing", "not_exists"}:
            return _is_missing_value(candidate)
        if operator in {"in", "one_of"}:
            return str(candidate).strip().lower() in {str(value).strip().lower() for value in values}
        if operator in {"contains", "includes"}:
            return str(expected).lower() in str(candidate).lower()
        if operator in {"regex", "matches"}:
            try:
                return re.search(str(expected), str(candidate or ""), flags=re.IGNORECASE) is not None
            except re.error:
                return False
        if operator in {"!=", "not_equals", "not"}:
            return str(candidate).strip().lower() != str(expected).strip().lower()
        return str(candidate).strip().lower() == str(expected).strip().lower()

    def _validate_normalized_rows(self, rows: List[Dict[str, Any]], config: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        accepted: List[Dict[str, Any]] = []
        skipped: List[Dict[str, Any]] = []
        required_fields = self._required_fields(config)
        for index, row in enumerate(rows, start=1):
            reasons: List[str] = []
            raw_value = next((row.get(key) for key in ("actual_value", "value", "actual", "score") if not _is_missing_value(row.get(key))), None)
            if raw_value is None:
                reasons.append("Missing actual_value/value")
            if not row.get("kpi_id") and not row.get("kpi_name") and not row.get("metric") and not row.get("name"):
                reasons.append("Missing KPI mapping")
            for field in required_fields:
                if _is_missing_value(row.get(field)):
                    reasons.append(f"Missing required field: {field}")
            if reasons:
                skipped.append({"row": index, "reason": "; ".join(reasons), "data": row})
            else:
                accepted.append(row)
        for binding in self.manager._runtime_kpi_bindings(config):
            if binding.get("enabled") is False:
                continue
            binding_id = binding.get("binding_id")
            if binding_id and any(row.get("source_binding_id") == binding_id for row in rows):
                continue
            if binding_id and binding.get("match_rule"):
                skipped.append({
                    "row": None,
                    "reason": "No source rows matched binding",
                    "source_binding_id": binding_id,
                    "kpi_id": binding.get("kpi_id"),
                    "match_rule": binding.get("match_rule"),
                })
        return accepted, skipped

    def _required_fields(self, config: Dict[str, Any]) -> List[str]:
        fields: List[str] = []
        for rule in config.get("validation_rules") or []:
            if not isinstance(rule, dict):
                continue
            field = _clean_string(rule.get("field") or rule.get("kpi_field"))
            rule_name = str(rule.get("rule") or "").lower()
            if field and ("required" in rule_name or rule.get("required") is True):
                fields.append("actual_value" if field == "value" else field)
        return fields

    def _dedupe_rows(
        self,
        contract_id: str,
        source_config_id: str,
        rows: List[Dict[str, Any]],
        config: Dict[str, Any],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        unique: List[Dict[str, Any]] = []
        skipped: List[Dict[str, Any]] = []
        seen: set = set()
        for index, row in enumerate(rows, start=1):
            source_record_id = _clean_string(row.get("source_record_id"))
            dedupe_value = source_record_id or self._fallback_source_record_id(config, row, index)
            row["source_dedupe_key"] = dedupe_value
            kpi_identity = _clean_string(row.get("kpi_id") or row.get("kpi_name") or row.get("metric") or row.get("name")) or "__unknown_kpi__"
            seen_key = (kpi_identity, dedupe_value)
            if seen_key in seen:
                skipped.append({"row": index, "reason": "Duplicate row in current fetch", "data": row})
                continue
            seen.add(seen_key)
            try:
                query = {
                    "contract_id": contract_id,
                    "metadata.source_config_id": source_config_id,
                    "metadata.source_dedupe_key": dedupe_value,
                }
                if row.get("kpi_id"):
                    query["kpi_id"] = str(row.get("kpi_id"))
                existing = self.actuals.find_one(query)
            except Exception:
                existing = None
            if existing:
                skipped.append({"row": index, "reason": "Duplicate source record already ingested", "data": row})
                continue
            unique.append(row)
        return unique, skipped

    def _fallback_source_record_id(self, config: Dict[str, Any], record: Dict[str, Any], index: int) -> str:
        seed = json.dumps({
            "source_config_id": config.get("source_config_id"),
            "index": index,
            "record": record,
        }, sort_keys=True, default=str)
        return f"src_rec_{hashlib.md5(seed.encode()).hexdigest()[:16]}"

    def _apply_transform(self, value: Any, transform: Any) -> Any:
        transform_name = str(transform or "").lower()
        if value is None:
            return None
        if transform_name in {"number", "numeric", "float", "decimal"}:
            parsed = re.sub(r"[^0-9.\-]", "", str(value))
            try:
                return float(parsed)
            except ValueError:
                return value
        if transform_name in {"integer", "int"}:
            parsed = re.sub(r"[^0-9\-]", "", str(value))
            try:
                return int(parsed)
            except ValueError:
                return value
        if transform_name in {"bool", "boolean"}:
            return str(value).strip().lower() in {"1", "true", "yes", "y", "present", "met"}
        if transform_name in {"datetime", "date"}:
            parsed = self.manager._parse_datetime(value)
            return parsed.isoformat() if parsed else value
        if transform_name == "string":
            return str(value)
        return value

    def _schema_fields(self, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        fields: Dict[str, Dict[str, Any]] = {}
        for record in records[:25]:
            for key, value in record.items():
                field = fields.setdefault(key, {"name": key, "type": self._field_type(value), "sample_values": []})
                if len(field["sample_values"]) < 3 and not any(existing == value for existing in field["sample_values"]):
                    field["sample_values"].append(value)
        return list(fields.values())

    def _field_type(self, value: Any) -> str:
        if isinstance(value, bool):
            return "boolean"
        if isinstance(value, (int, float)):
            return "number"
        if self.manager._parse_datetime(value):
            return "datetime"
        return "string"

    def _watermark_after(self, config: Dict[str, Any], records: List[Dict[str, Any]], accepted: List[Dict[str, Any]]) -> Optional[Any]:
        watermark_field = _clean_string(config.get("watermark_field"))
        if not watermark_field:
            return config.get("watermark_value")
        values: List[Any] = []
        for row in accepted:
            value = row.get("source_watermark_value") or row.get(watermark_field) or _value_at_path(row, watermark_field)
            if value is not None:
                values.append(value)
        if not values:
            for record in records:
                value = _value_at_path(record, watermark_field)
                if value is not None:
                    values.append(value)
        if not values:
            return config.get("watermark_value")
        parsed_values = []
        for value in values:
            parsed_values.append(self.manager._parse_datetime(value) or value)
        return max(parsed_values)

    def _verify_webhook_signature(self, config: Dict[str, Any], payload: Any, signature: Optional[str]) -> None:
        secret = _clean_string(config.get("webhook_secret"))
        secret_ref = _clean_string(config.get("webhook_secret_ref"))
        if not secret and secret_ref:
            env_name = secret_ref[4:] if secret_ref.startswith("env:") else secret_ref if secret_ref.isupper() else None
            secret = os.getenv(env_name) if env_name else None
        if not secret:
            return
        if not signature:
            raise KpiSourceError("Missing webhook signature")
        body = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
        expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        received = signature.replace("sha256=", "").strip()
        if not hmac.compare_digest(expected, received):
            raise KpiSourceError("Invalid webhook signature")

    def _serialize(self, doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        if not doc:
            return {}
        clean = dict(doc)
        clean.pop("_id", None)
        for key, value in list(clean.items()):
            if isinstance(value, datetime):
                clean[key] = value.isoformat()
            elif not isinstance(value, (str, int, float, bool, list, dict, type(None))):
                clean[key] = str(value)
        for field in ["credential_ref", "webhook_secret_ref", "webhook_secret"]:
            if clean.get(field):
                clean[field] = decrypt_value(clean[field])
        return clean
