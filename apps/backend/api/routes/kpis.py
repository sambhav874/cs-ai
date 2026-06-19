import logging
import csv
import io
import re
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from bson import ObjectId
from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, Response, status, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from core.config import settings
from core.rate_limiter import limiter
from core.database import (
    db,
    async_db,
    collection,
    users_collection,
    accounts_collection,
    teams_collection,
    projects_collection,
)
from core.security import get_current_active_user
from models.domain import UserInDB
from utils.audit_logger import create_audit_log
from utils.secure_logger import log_exception
from services.kpi_manager import ContractKPIManager, USER_CONFIGURABLE_SOURCE_TYPES
from services.kpi_source_ingestion import KpiSourceError, KpiSourceIngestionService
from api.dependencies import check_contract_access, get_contract_and_verify_access, get_project_and_verify_access
from api.routes.projects import verify_project_access, build_accessible_contract_query
from core.cache import cache

logger = logging.getLogger(__name__)

kpis_router = APIRouter()

MAX_KPI_ACTUALS_UPLOAD_BYTES = 2 * 1024 * 1024
MAX_KPI_ACTUALS_UPLOAD_ROWS = 5000

# --- KPI Request Models ---
class KPIExtractionRequest(BaseModel):
    replace_drafts: bool = Field(default=True, description="Replace existing draft/ignored KPI candidates for this scope.")
    contract_id: Optional[str] = Field(default=None, description="For project KPI extraction, the single contract to extract.")
    ai_provider: Optional[str] = Field(default=None, description="Optional AI provider for hybrid KPI extraction.")

class KPIUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    kpi_type: Optional[str] = None
    party: Optional[str] = None
    operator: Optional[str] = None
    value: Optional[Any] = None
    unit: Optional[str] = None
    value_min: Optional[float] = None
    value_max: Optional[float] = None
    definition: Optional[str] = None
    formula: Optional[str] = None
    rule_type: Optional[str] = None
    target_value: Optional[Any] = None
    threshold_min: Optional[float] = None
    threshold_max: Optional[float] = None
    direction: Optional[str] = None
    baseline: Optional[Any] = None
    benchmark: Optional[Any] = None
    period_type: Optional[str] = None
    evaluation_window: Optional[str] = None
    frequency: Optional[str] = None
    effective_start: Optional[str] = None
    effective_end: Optional[str] = None
    target_schedule: Optional[List[Dict[str, Any]]] = None
    checkpoint_dates: Optional[List[str]] = None
    grace_period_days: Optional[int] = None
    lookback_window_days: Optional[int] = None
    partial_period_policy: Optional[str] = None
    late_data_policy: Optional[str] = None
    business_hours: Optional[Dict[str, Any]] = None
    blackout_windows: Optional[List[Dict[str, Any]]] = None
    severity_grace_periods: Optional[Dict[str, Any]] = None
    reporting_lock: Optional[Dict[str, Any]] = None
    missing_data_policy: Optional[str] = None
    error_budget: Optional[Dict[str, Any]] = None
    business_owner: Optional[str] = None
    technical_owner: Optional[str] = None
    responsible_party: Optional[str] = None
    consequence_value: Optional[float] = None
    consequence_unit: Optional[str] = None
    aggregation_type: Optional[str] = None
    trigger_condition: Optional[str] = None
    remediation: Optional[str] = None
    remediation_sla: Optional[str] = None
    contact_email: Optional[str] = None
    source_config_id: Optional[str] = None
    source_config_status: Optional[str] = None
    source_requirements: Optional[Dict[str, Any]] = None
    field_mappings: Optional[List[Dict[str, Any]]] = None
    evaluation_rule: Optional[Dict[str, Any]] = None
    # breach_email_template intentionally omitted — internal only, not user-writable.
    status: Optional[str] = None
    tracking_status: Optional[str] = None
    is_tracked: Optional[bool] = None
    notes: Optional[str] = None

class KPISourceConfigRequest(BaseModel):
    display_name: Optional[str] = None
    source_type: str = "csv"
    status: Optional[str] = None
    enabled: bool = False
    auth_type: Optional[str] = None
    credential_ref: Optional[str] = None
    auth_header: Optional[str] = None
    webhook_secret_ref: Optional[str] = None
    endpoint: Optional[str] = None
    signed_url: Optional[str] = None
    method: Optional[str] = None
    headers: Dict[str, Any] = Field(default_factory=dict)
    query_params: Dict[str, Any] = Field(default_factory=dict)
    body: Optional[Any] = None
    timeout_seconds: Optional[int] = None
    schedule: Dict[str, Any] = Field(default_factory=dict)
    next_run_at: Optional[Any] = None
    last_run_at: Optional[Any] = None
    last_success_at: Optional[Any] = None
    last_error: Optional[str] = None
    schema_fields: List[Dict[str, Any]] = Field(default_factory=list)
    sample_payload: Optional[Any] = None
    record_path: Optional[str] = None
    data_path: Optional[str] = None
    file_format: Optional[str] = None
    bucket: Optional[str] = None
    object_key: Optional[str] = None
    key: Optional[str] = None
    prefix: Optional[str] = None
    region: Optional[str] = None
    field_mappings: List[Dict[str, Any]] = Field(default_factory=list)
    source_requirements: Dict[str, Any] = Field(default_factory=dict)
    validation_rules: List[Dict[str, Any]] = Field(default_factory=list)
    dedupe_key: Optional[str] = None
    watermark_field: Optional[str] = None
    watermark_value: Optional[Any] = None
    retry_policy: Dict[str, Any] = Field(default_factory=dict)
    kpi_ids: List[str] = Field(default_factory=list)
    kpi_bindings: List[Dict[str, Any]] = Field(default_factory=list)
    last_fetch_status: Dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = None

class KPISourceTestRequest(BaseModel):
    payload: Optional[Any] = None

class KPISourceFetchRequest(BaseModel):
    trigger_type: str = "manual"
    evaluate: bool = True
    payload: Optional[Any] = None

class KPIActualRequest(BaseModel):
    kpi_id: str
    value: Any
    unit: Optional[str] = None
    source: Optional[str] = None
    timestamp: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

class KPIActualBatchRequest(BaseModel):
    actuals: List[Dict[str, Any]]
    source: Optional[str] = None
    evaluate: bool = True

class KPIEvaluateRequest(BaseModel):
    kpi_id: str
    actual_value: Any
    unit: Optional[str] = None

class KPICertificationRequest(BaseModel):
    status: str = Field(default="certified", description="draft, reviewed, certified, or deprecated")
    notes: Optional[str] = None

class KPICatalogUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    description: Optional[str] = None
    certified_status: Optional[str] = None
    owner: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    notes: Optional[str] = None
    contract_family: Optional[str] = None
    unit: Optional[str] = None
    rule_signature: Optional[str] = None

class KPIIntegrationProfileRequest(BaseModel):
    source_type: str
    display_name: Optional[str] = None
    status: Optional[str] = None
    enabled: bool = False
    auth_type: Optional[str] = None
    credential_ref: Optional[str] = None
    webhook_secret_ref: Optional[str] = None
    endpoint: Optional[str] = None
    method: Optional[str] = None
    headers: Dict[str, Any] = Field(default_factory=dict)
    query_params: Dict[str, Any] = Field(default_factory=dict)
    body: Optional[Any] = None
    timeout_seconds: Optional[int] = None
    record_path: Optional[str] = None
    data_path: Optional[str] = None
    field_mappings: List[Dict[str, Any]] = Field(default_factory=list)
    sample_payload: Optional[Any] = None
    schedule: Dict[str, Any] = Field(default_factory=dict)
    notes: Optional[str] = None

class KPIAlertRuleRequest(BaseModel):
    name: Optional[str] = None
    event_type: str = "breach_created"
    active: bool = True
    severity_min: Optional[str] = None
    channels: List[str] = Field(default_factory=lambda: ["in_app"])
    recipients: List[str] = Field(default_factory=list)
    filters: Dict[str, Any] = Field(default_factory=dict)
    threshold: Optional[Any] = None
    notes: Optional[str] = None



# --- KPI Helper Functions ---
def _kpi_manager() -> ContractKPIManager:
    return ContractKPIManager(db)

def _kpi_source_ingestion() -> KpiSourceIngestionService:
    return KpiSourceIngestionService(db)




# --- KPI Routes ---
@kpis_router.get("/contracts/{contract_id}/kpis")
def list_contract_kpis(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)

    cache_key = f"kpi:list:{contract_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    manager = _kpi_manager()
    kpis = manager.list_contract_kpis(contract_id)
    result = {
        "contract_id": contract_id,
        "count": len(kpis),
        "summary": manager.summarize_kpis(kpis),
        "kpis": kpis,
    }
    cache.set(cache_key, result, ttl=60)
    return result


@kpis_router.get("/kpis/source-catalog")
def list_kpi_source_catalog(
    scope: Optional[str] = Query(None, description="Catalog scope: all, user, or platform."),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    catalog = _kpi_manager().list_source_catalog(scope=scope)
    return {"count": len(catalog), "sources": catalog}


def _ensure_kpi_integration_admin(current_user: UserInDB) -> str:
    if not current_user.ownedAccountId:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only account owners can manage ContractSense KPI integration profiles.",
        )
    return str(current_user.ownedAccountId)


@kpis_router.get("/kpis/integrations/catalog")
def list_kpi_integration_catalog(
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    catalog = _kpi_manager().list_platform_integration_catalog()
    return {"count": len(catalog), "connectors": catalog}


@kpis_router.post("/kpis/integrations/profiles")
def create_kpi_integration_profile(
    request: KPIIntegrationProfileRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    owner_account_id = _ensure_kpi_integration_admin(current_user)
    try:
        return _kpi_manager().upsert_integration_profile(
            payload=request.model_dump(),
            user_id=str(current_user.id),
            owner_account_id=owner_account_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@kpis_router.post("/kpis/integrations/profiles/{profile_id}/test")
def test_kpi_integration_profile(
    profile_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    _ensure_kpi_integration_admin(current_user)
    try:
        return _kpi_manager().test_integration_profile(
            profile_id=profile_id,
            user_id=str(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@kpis_router.get("/contracts/{contract_id}/kpis/source-configs")
def list_contract_kpi_source_configs(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    configs = _kpi_manager().list_source_configs(contract_id)
    return {"contract_id": contract_id, "count": len(configs), "source_configs": configs}


@kpis_router.post("/contracts/{contract_id}/kpis/source-configs")
def create_contract_kpi_source_config(
    contract_id: str,
    request: KPISourceConfigRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1, "projectId": 1})
    check_contract_access(contract, current_user)
    source_type = str(request.source_type or "csv").strip().lower()
    if source_type not in USER_CONFIGURABLE_SOURCE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enterprise KPI connectors are managed by ContractSense in platform Integrations. Contract workspaces can configure upload/manual actual sources only.",
        )
    try:
        return _kpi_manager().upsert_source_config(
            contract_id=contract_id,
            project_id=str(contract.get("projectId")) if contract.get("projectId") else None,
            user_id=str(current_user.id),
            payload=request.model_dump(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@kpis_router.patch("/contracts/{contract_id}/kpis/source-configs/{source_config_id}")
def update_contract_kpi_source_config(
    contract_id: str,
    source_config_id: str,
    request: KPISourceConfigRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1, "projectId": 1})
    check_contract_access(contract, current_user)
    source_type = str(request.source_type or "csv").strip().lower()
    if source_type not in USER_CONFIGURABLE_SOURCE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Enterprise KPI connectors are managed by ContractSense in platform Integrations. Contract workspaces can configure upload/manual actual sources only.",
        )
    try:
        return _kpi_manager().upsert_source_config(
            contract_id=contract_id,
            project_id=str(contract.get("projectId")) if contract.get("projectId") else None,
            user_id=str(current_user.id),
            payload=request.model_dump(),
            source_config_id=source_config_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@kpis_router.delete("/contracts/{contract_id}/kpis/source-configs/{source_config_id}")
def delete_contract_kpi_source_config(
    contract_id: str,
    source_config_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    archived = _kpi_manager().archive_source_config(
        contract_id=contract_id,
        source_config_id=source_config_id,
        user_id=str(current_user.id),
    )
    if not archived:
        raise HTTPException(status_code=404, detail="Source config not found.")
    return archived


@kpis_router.post("/contracts/{contract_id}/kpis/source-configs/{source_config_id}/test")
def test_contract_kpi_source_config(
    contract_id: str,
    source_config_id: str,
    request: KPISourceTestRequest = KPISourceTestRequest(),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    try:
        return _kpi_source_ingestion().test_source(
            contract_id=contract_id,
            source_config_id=source_config_id,
            user_id=str(current_user.id),
            payload=request.payload,
        )
    except KpiSourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@kpis_router.post("/contracts/{contract_id}/kpis/source-configs/{source_config_id}/fetch")
def fetch_contract_kpi_source_config(
    contract_id: str,
    source_config_id: str,
    request: KPISourceFetchRequest = KPISourceFetchRequest(),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    try:
        return _kpi_source_ingestion().fetch_source(
            contract_id=contract_id,
            source_config_id=source_config_id,
            user_id=str(current_user.id),
            trigger_type=request.trigger_type or "manual",
            payload=request.payload,
            evaluate=request.evaluate,
        )
    except KpiSourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@kpis_router.get("/contracts/{contract_id}/kpis/source-configs/{source_config_id}/fetch-runs")
def list_contract_kpi_source_fetch_runs(
    contract_id: str,
    source_config_id: str,
    limit: int = Query(50, ge=1, le=200),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    runs = _kpi_source_ingestion().list_fetch_runs(
        contract_id=contract_id,
        source_config_id=source_config_id,
        limit=limit,
    )
    return {
        "contract_id": contract_id,
        "source_config_id": source_config_id,
        "count": len(runs),
        "fetch_runs": runs,
    }


@kpis_router.get("/contracts/{contract_id}/kpis/source-configs/{source_config_id}/fetch-runs/{run_id}")
def get_contract_kpi_source_fetch_run_detail(
    contract_id: str,
    source_config_id: str,
    run_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    try:
        return _kpi_source_ingestion().get_fetch_run_detail(
            contract_id=contract_id,
            source_config_id=source_config_id,
            run_id=run_id,
        )
    except KpiSourceError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@kpis_router.post("/contracts/{contract_id}/kpis/source-configs/{source_config_id}/webhook")
async def ingest_contract_kpi_source_webhook(
    contract_id: str,
    source_config_id: str,
    request: Request,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Webhook payload must be JSON.")
    signature = request.headers.get("x-contractsense-signature") or request.headers.get("x-hub-signature-256")
    try:
        return _kpi_source_ingestion().ingest_webhook(
            contract_id=contract_id,
            source_config_id=source_config_id,
            user_id=str(current_user.id),
            payload=payload,
            signature=signature,
        )
    except KpiSourceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@kpis_router.post("/contracts/{contract_id}/kpis/extract")
def extract_contract_kpis(
    contract_id: str,
    request: KPIExtractionRequest = KPIExtractionRequest(),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one(
        {"_id": contract_oid},
        {
            "_id": 1,
            "ownerType": 1,
            "ownerId": 1,
            "projectId": 1,
            "contract_name": 1,
            "index.status": 1,
            "index.content": 1,
        },
    )
    check_contract_access(contract, current_user)
    if (contract.get("index") or {}).get("status") != "success":
        raise HTTPException(status_code=400, detail="Contract must be ingested before KPI extraction.")

    result = _kpi_manager().extract_for_contract(
        contract_doc=contract,
        user_id=str(current_user.id),
        replace_drafts=request.replace_drafts,
        ai_provider=request.ai_provider,
    )
    cache.delete(f"kpi:list:{contract_id}")
    return result


@kpis_router.patch("/contracts/{contract_id}/kpis/{kpi_id}")
def update_contract_kpi(
    contract_id: str,
    kpi_id: str,
    request: KPIUpdateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    updated = _kpi_manager().update_kpi(
        kpi_id,
        {key: value for key, value in request.model_dump().items() if value is not None},
        user_id=str(current_user.id),
        contract_id=contract_id,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="KPI not found.")
    cache.delete(f"kpi:list:{contract_id}")
    return updated


@kpis_router.post("/contracts/{contract_id}/kpis/{kpi_id}/certify")
def certify_contract_kpi(
    contract_id: str,
    kpi_id: str,
    request: KPICertificationRequest = KPICertificationRequest(),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    try:
        return _kpi_manager().certify_kpi(
            contract_id=contract_id,
            kpi_id=kpi_id,
            status=request.status,
            notes=request.notes,
            user_id=str(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@kpis_router.get("/contracts/{contract_id}/kpis/{kpi_id}/history")
def get_contract_kpi_history(
    contract_id: str,
    kpi_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    try:
        return _kpi_manager().get_kpi_history(contract_id=contract_id, kpi_id=kpi_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@kpis_router.post("/contracts/{contract_id}/kpis/alert-rules")
def create_contract_kpi_alert_rule(
    contract_id: str,
    request: KPIAlertRuleRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1, "projectId": 1})
    check_contract_access(contract, current_user)
    try:
        return _kpi_manager().upsert_alert_rule(
            contract_id=contract_id,
            project_id=str(contract.get("projectId")) if contract.get("projectId") else None,
            payload=request.model_dump(),
            user_id=str(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@kpis_router.patch("/contracts/{contract_id}/kpis/alert-rules/{rule_id}")
def update_contract_kpi_alert_rule(
    contract_id: str,
    rule_id: str,
    request: KPIAlertRuleRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1, "projectId": 1})
    check_contract_access(contract, current_user)
    try:
        return _kpi_manager().upsert_alert_rule(
            contract_id=contract_id,
            project_id=str(contract.get("projectId")) if contract.get("projectId") else None,
            payload=request.model_dump(),
            user_id=str(current_user.id),
            rule_id=rule_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@kpis_router.post("/contracts/{contract_id}/kpis/actuals")
def create_contract_kpi_actual(
    contract_id: str,
    request: KPIActualRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    manager = _kpi_manager()
    if not manager.get_kpi(request.kpi_id, contract_id=contract_id):
        raise HTTPException(status_code=404, detail="KPI not found for this contract.")
    return manager.record_actual(
        kpi_id=request.kpi_id,
        contract_id=contract_id,
        user_id=str(current_user.id),
        value=request.value,
        unit=request.unit,
        source=request.source,
        metadata=request.metadata,
        timestamp=manager._parse_datetime(request.timestamp),
    )


@kpis_router.post("/contracts/{contract_id}/kpis/actuals/batch")
def ingest_contract_kpi_actuals(
    contract_id: str,
    request: KPIActualBatchRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    if not request.actuals:
        raise HTTPException(status_code=400, detail="No actual rows supplied.")
    return _kpi_manager().ingest_actuals(
        contract_id=contract_id,
        user_id=str(current_user.id),
        rows=request.actuals,
        source=request.source or "api",
        evaluate=request.evaluate,
    )


@kpis_router.post("/contracts/{contract_id}/kpis/actuals/upload")
@limiter.limit("10/minute")
async def upload_contract_kpi_actuals(
    request: Request,
    contract_id: str,
    file: UploadFile = File(...),
    evaluate: bool = Form(True),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    filename = file.filename or "actuals.csv"
    content = await file.read()
    filename = validate_file_upload(
        content,
        filename,
        MAX_KPI_ACTUALS_UPLOAD_BYTES,
        ["csv", "json"]
    )
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    if filename.lower().endswith(".json"):
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON actuals file.")
        rows = payload.get("actuals") if isinstance(payload, dict) else payload
        if not isinstance(rows, list):
            raise HTTPException(status_code=400, detail="JSON actuals file must be a list or contain an 'actuals' list.")
    else:
        reader = csv.DictReader(io.StringIO(text))
        rows = []
        for row in reader:
            rows.append(dict(row))
            if len(rows) > MAX_KPI_ACTUALS_UPLOAD_ROWS:
                raise HTTPException(status_code=413, detail="KPI actuals file has too many rows.")

    if not rows:
        raise HTTPException(status_code=400, detail="No actual rows found in uploaded file.")
    if len(rows) > MAX_KPI_ACTUALS_UPLOAD_ROWS:
        raise HTTPException(status_code=413, detail="KPI actuals file has too many rows.")

    result = _kpi_manager().ingest_actuals(
        contract_id=contract_id,
        user_id=str(current_user.id),
        rows=rows,
        source=f"upload:{filename}",
        evaluate=evaluate,
    )
    result["filename"] = filename
    result["uploaded_rows"] = len(rows)
    return result


@kpis_router.get("/contracts/{contract_id}/kpis/actuals")
def list_contract_kpi_actuals(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    actuals = _kpi_manager().list_contract_actuals(contract_id)
    return {"contract_id": contract_id, "count": len(actuals), "actuals": actuals}


@kpis_router.post("/contracts/{contract_id}/kpis/evaluate")
def evaluate_contract_kpi(
    contract_id: str,
    request: KPIEvaluateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    try:
        result = _kpi_manager().evaluate_kpi(
            kpi_id=request.kpi_id,
            actual_value=request.actual_value,
            user_id=str(current_user.id),
            contract_id=contract_id,
            actual_unit=request.unit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


@kpis_router.get("/contracts/{contract_id}/kpis/breaches")
def list_contract_kpi_breaches(
    contract_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    breaches = _kpi_manager().list_contract_breaches(contract_id)
    return {"contract_id": contract_id, "count": len(breaches), "breaches": breaches}


@kpis_router.post("/contracts/{contract_id}/kpis/breaches/{breach_id}/flag-remediation-email")
def flag_breach_remediation_email(
    contract_id: str,
    breach_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """Flag a breach for remediation, rendering and returning the breach email draft.

    The breach_email_draft field is ONLY populated when this endpoint is called \u2014
    it is never pre-generated during evaluation. The response includes the fully
    rendered email (with all placeholders substituted) that the user can review,
    edit, and send.
    """
    try:
        contract_oid = ObjectId(contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contract = collection.find_one({"_id": contract_oid}, {"_id": 1, "ownerType": 1, "ownerId": 1})
    check_contract_access(contract, current_user)
    try:
        result = _kpi_manager().flag_breach_remediation_email(
            breach_id,
            user_id=str(current_user.id),
            contract_id=contract_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


def _accessible_project_contracts(project_id: str, current_user: UserInDB, *, indexed_only: bool = False) -> List[Dict[str, Any]]:
    project_doc = verify_project_access(project_id, current_user)
    project_query = build_accessible_contract_query(project_doc, current_user)
    filters: List[Dict[str, Any]] = [project_query]
    if indexed_only:
        filters.append({"index.status": "success"})
        filters.append({"index.content": {"$type": "string", "$ne": ""}})
    return list(collection.find(
        {"$and": filters},
        {
            "_id": 1,
            "ownerType": 1,
            "ownerId": 1,
            "projectId": 1,
            "contract_name": 1,
            "index.status": 1,
            "index.content": 1,
        },
    ))


@kpis_router.get("/projects/{project_id}/kpis/portfolio")
def get_project_kpi_portfolio(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    contract_docs = _accessible_project_contracts(project_id, current_user)
    return _kpi_manager().build_project_portfolio(
        project_id=project_id,
        contract_docs=contract_docs,
    )


@kpis_router.get("/projects/{project_id}/kpis/catalog")
def get_project_kpi_catalog(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    contract_docs = _accessible_project_contracts(project_id, current_user)
    contract_ids = [str(document["_id"]) for document in contract_docs]
    return _kpi_manager().build_metric_catalog(
        project_id=project_id,
        contract_ids=contract_ids,
    )


@kpis_router.patch("/projects/{project_id}/kpis/catalog/{metric_key}")
def update_project_kpi_catalog_entry(
    project_id: str,
    metric_key: str,
    request: KPICatalogUpdateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    verify_project_access(project_id, current_user)
    try:
        return _kpi_manager().update_metric_catalog_entry(
            project_id=project_id,
            metric_key=metric_key,
            updates=request.model_dump(),
            user_id=str(current_user.id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@kpis_router.get("/projects/{project_id}/kpis/alerts")
def list_project_kpi_alerts(
    project_id: str,
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=250),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    contract_docs = _accessible_project_contracts(project_id, current_user)
    contract_ids = [str(document["_id"]) for document in contract_docs]
    return _kpi_manager().list_project_alerts(
        project_id=project_id,
        contract_ids=contract_ids,
        status=status_filter,
        include_generated=True,
        limit=limit,
    )


def _serialize_project_contract_summary(doc: Dict[str, Any], user_map: Dict[str, str]) -> Dict[str, Any]:
    workflow_roles = doc.get("workflowRoles") or {}
    return {
        "_id": str(doc["_id"]),
        "contract_name": doc.get("contract_name", "Unknown"),
        "status": doc.get("status", "Unknown"),
        "uploaded_at": doc.get("uploaded_at"),
        "page_count": doc.get("page_count", 0),
        "ownerType": doc.get("ownerType"),
        "ownerId": str(doc.get("ownerId")) if doc.get("ownerId") else None,
        "projectId": str(project_id) if (project_id := doc.get("projectId")) else None,
        "uploaded_by": str(doc.get("uploaded_by")) if doc.get("uploaded_by") else None,
        "uploader_name": user_map.get(str(doc.get("uploaded_by"))),
        "workflowRoles": {
            "editorUserId": str(uid) if (uid := workflow_roles.get("editorUserId")) else None,
            "approverUserId": str(uid) if (uid := workflow_roles.get("approverUserId")) else None,
            "editor_name": user_map.get(str(workflow_roles.get("editorUserId"))),
            "approver_name": user_map.get(str(workflow_roles.get("approverUserId"))),
        },
        "index": doc.get("index"),
    }


@kpis_router.get("/projects/{project_id}/contracts")
def list_project_contract_documents(
    project_id: str,
    limit: int = Query(100, ge=1, le=200),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    project_doc = verify_project_access(project_id, current_user)
    project_query = build_accessible_contract_query(project_doc, current_user)
    projection = {
        "_id": 1,
        "contract_name": 1,
        "status": 1,
        "uploaded_at": 1,
        "page_count": 1,
        "ownerType": 1,
        "ownerId": 1,
        "projectId": 1,
        "uploaded_by": 1,
        "workflowRoles": 1,
        "index.status": 1,
    }
    documents = list(collection.find(project_query, projection).sort("uploaded_at", -1).limit(limit))
    user_ids = {
        user_id
        for document in documents
        for user_id in [
            document.get("uploaded_by"),
            (document.get("workflowRoles") or {}).get("editorUserId"),
            (document.get("workflowRoles") or {}).get("approverUserId"),
        ]
        if isinstance(user_id, ObjectId)
    }
    user_map = {
        str(user["_id"]): user.get("username")
        for user in users_collection.find({"_id": {"$in": list(user_ids)}}, {"_id": 1, "username": 1})
    } if user_ids else {}
    return {
        "project": {
            "_id": str(project_doc["_id"]),
            "name": project_doc.get("name", "Untitled Project"),
            "description": project_doc.get("description"),
            "ownerType": project_doc.get("ownerType"),
            "ownerId": str(project_doc.get("ownerId")) if project_doc.get("ownerId") else None,
        },
        "count": len(documents),
        "documents": [_serialize_project_contract_summary(document, user_map) for document in documents],
    }


@kpis_router.get("/projects/{project_id}/kpis")
def list_project_kpis(
    project_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    contracts = _accessible_project_contracts(project_id, current_user)
    contract_ids = [str(contract["_id"]) for contract in contracts]
    manager = _kpi_manager()
    kpis = manager.list_project_kpis(project_id, contract_ids=contract_ids)
    return {
        "project_id": project_id,
        "contract_count": len(contract_ids),
        "count": len(kpis),
        "summary": manager.summarize_kpis(kpis),
        "kpis": kpis,
    }


@kpis_router.post("/projects/{project_id}/kpis/extract")
def extract_project_kpis(
    project_id: str,
    request: KPIExtractionRequest = KPIExtractionRequest(),
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    if not request.contract_id:
        raise HTTPException(status_code=400, detail="Select one ingested contract before extracting KPIs. Project-wide KPI extraction is intentionally disabled.")

    try:
        requested_contract_oid = ObjectId(request.contract_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid contract ID format.")

    contracts = [
        contract
        for contract in _accessible_project_contracts(project_id, current_user, indexed_only=True)
        if contract.get("_id") == requested_contract_oid
    ]
    if not contracts:
        raise HTTPException(status_code=400, detail="The selected contract is not ingested or is not accessible in this project.")

    manager = _kpi_manager()
    contract_result = manager.extract_for_contract(
        contract_doc=contracts[0],
        user_id=str(current_user.id),
        replace_drafts=request.replace_drafts,
        ai_provider=request.ai_provider,
    )
    accessible_contract_ids = [str(contract["_id"]) for contract in _accessible_project_contracts(project_id, current_user)]
    project_kpis = manager.list_project_kpis(project_id, contract_ids=accessible_contract_ids)
    return {
        "project_id": project_id,
        "contract_count": 1,
        "contract_id": str(contracts[0]["_id"]),
        "contract_name": contracts[0].get("contract_name") or "Contract",
        "kpi_count": contract_result.get("kpi_count", 0),
        "result": contract_result,
        "kpis": project_kpis,
        "summary": manager.summarize_kpis(project_kpis),
    }



