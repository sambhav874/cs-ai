import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import requests
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.routes.projects import build_accessible_contract_query, verify_project_access
from api.routes.tabular_reviews import (
    _build_tabular_context,
    _extract_citations,
    _extract_json_object,
    _post_tabular_prompt,
    _provider_key,
    _providers_for_call,
    _raise_tabular_model_unavailable,
    _tabular_provider_order,
)
from core.database import collection, db, projects_collection
from core.database import fs
from core.security import get_current_active_user
from models.domain import UserInDB
from services.document_artifacts import DOCX_CONTENT_TYPE, RedlineChange, render_redline_docx
from utils.http_headers import content_disposition
from utils.secure_logger import log_exception

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/playbooks")

playbooks_collection = db["playbooks"]
playbook_runs_collection = db["playbook_runs"]
playbook_findings_collection = db["playbook_findings"]
playbook_redlines_collection = db["playbook_redlines"]

MAX_RULES = 300
MAX_RUN_DOCUMENTS = 25
MAX_GENERATION_DOCUMENTS = 10
GENERATE_CONTRACT_EXCERPT_CHARS = 12000

RULE_STATUS_VALUES = {"acceptable", "needs_review", "not_acceptable", "not_applicable"}
RULE_SEVERITY_VALUES = {"low", "medium", "high", "critical"}


class PlaybookRuleRequest(BaseModel):
    rule_id: Optional[str] = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=180)
    clause_type: str = Field(min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=2000)
    standard_position: Optional[str] = Field(default=None, max_length=4000)
    fallback_positions: List[str] = Field(default_factory=list)
    unacceptable_deviations: List[str] = Field(default_factory=list)
    guidance: Optional[str] = Field(default=None, max_length=4000)
    required_clause: bool = False
    suggested_language: Optional[str] = Field(default=None, max_length=6000)
    severity: str = Field(default="medium")
    tags: List[str] = Field(default_factory=list)


class PlaybookCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: Optional[str] = Field(default=None, max_length=3000)
    contract_type: Optional[str] = Field(default=None, max_length=120)
    project_id: Optional[str] = None
    visibility: str = Field(default="private", pattern="^(private|project)$")
    reference_document_id: Optional[str] = None
    reference_document_name: Optional[str] = Field(default=None, max_length=240)
    rules: List[PlaybookRuleRequest] = Field(default_factory=list)


class PlaybookUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, max_length=180)
    description: Optional[str] = Field(default=None, max_length=3000)
    contract_type: Optional[str] = Field(default=None, max_length=120)
    visibility: Optional[str] = Field(default=None, pattern="^(private|project)$")
    reference_document_id: Optional[str] = None
    reference_document_name: Optional[str] = Field(default=None, max_length=240)
    rules: Optional[List[PlaybookRuleRequest]] = None


class PlaybookRunRequest(BaseModel):
    contract_ids: List[str] = Field(default_factory=list)
    rule_ids: Optional[List[str]] = None
    representing_party: Optional[str] = Field(default=None, max_length=160)
    paper_type: Optional[str] = Field(default=None, max_length=160)
    additional_context: Optional[str] = Field(default=None, max_length=4000)
    force: bool = False


class PlaybookFindingUpdateRequest(BaseModel):
    reviewer_status: Optional[str] = Field(default=None, pattern="^(acceptable|needs_review|not_acceptable|not_applicable)$")
    reviewer_notes: Optional[str] = Field(default=None, max_length=5000)
    suggested_revision: Optional[str] = Field(default=None, max_length=8000)


class PlaybookRedlineRequest(BaseModel):
    document_ids: List[str] = Field(default_factory=list)
    finding_ids: List[str] = Field(default_factory=list)


class GenerateFromContractsRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: Optional[str] = Field(default=None, max_length=3000)
    contract_type: Optional[str] = Field(default=None, max_length=120)
    project_id: Optional[str] = None
    standard_contract_id: Optional[str] = None
    example_contract_ids: List[str] = Field(default_factory=list)
    visibility: str = Field(default="private", pattern="^(private|project)$")
    risk_tolerance: Optional[str] = Field(default="balanced", max_length=80)


def _now() -> datetime:
    return datetime.utcnow()


def _parse_object_id(value: str, field_name: str) -> ObjectId:
    if not ObjectId.is_valid(str(value)):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} format.")
    return ObjectId(str(value))


def _parse_object_ids(values: List[str], field_name: str, *, limit: int) -> List[ObjectId]:
    if len(values) > limit:
        raise HTTPException(status_code=400, detail=f"Too many {field_name}. Maximum is {limit}.")
    seen: set[str] = set()
    object_ids: List[ObjectId] = []
    for value in values:
        oid = _parse_object_id(value, field_name)
        oid_text = str(oid)
        if oid_text in seen:
            continue
        seen.add(oid_text)
        object_ids.append(oid)
    return object_ids


def _serialize_value(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [_serialize_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _serialize_value(item) for key, item in value.items()}
    return value


def _clean_list(values: List[str], *, limit: int = 20, max_chars: int = 2000) -> List[str]:
    cleaned: List[str] = []
    seen: set[str] = set()
    for value in values or []:
        text = re.sub(r"\s+", " ", str(value or "")).strip()
        if not text:
            continue
        text = text[:max_chars]
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
        if len(cleaned) >= limit:
            break
    return cleaned


def _normalize_rule(rule: PlaybookRuleRequest, index: int) -> Dict[str, Any]:
    severity = (rule.severity or "medium").lower().strip()
    if severity not in RULE_SEVERITY_VALUES:
        severity = "medium"

    normalized = {
        "rule_id": (rule.rule_id or f"rule-{uuid4().hex[:12]}").strip(),
        "index": index,
        "name": rule.name.strip(),
        "clause_type": rule.clause_type.strip(),
        "description": (rule.description or "").strip() or None,
        "standard_position": (rule.standard_position or "").strip() or None,
        "fallback_positions": _clean_list(rule.fallback_positions, limit=25),
        "unacceptable_deviations": _clean_list(rule.unacceptable_deviations, limit=25),
        "guidance": (rule.guidance or "").strip() or None,
        "required_clause": bool(rule.required_clause),
        "suggested_language": (rule.suggested_language or "").strip() or None,
        "severity": severity,
        "tags": _clean_list(rule.tags, limit=20, max_chars=80),
    }
    if not (
        normalized["standard_position"]
        or normalized["fallback_positions"]
        or normalized["unacceptable_deviations"]
        or normalized["guidance"]
        or normalized["required_clause"]
    ):
        raise HTTPException(
            status_code=400,
            detail=f"Rule '{normalized['name']}' needs a standard position, fallback, red flag, guidance, or required-clause flag.",
        )
    return normalized


def _normalize_rules(rules: List[PlaybookRuleRequest]) -> List[Dict[str, Any]]:
    if len(rules) > MAX_RULES:
        raise HTTPException(status_code=400, detail=f"Playbooks can contain at most {MAX_RULES} rules.")

    normalized: List[Dict[str, Any]] = []
    seen_rule_ids: set[str] = set()
    for index, rule in enumerate(rules):
        item = _normalize_rule(rule, index)
        if item["rule_id"] in seen_rule_ids:
            item["rule_id"] = f"rule-{uuid4().hex[:12]}"
        seen_rule_ids.add(item["rule_id"])
        normalized.append(item)
    return normalized


def _accessible_project_ids(current_user: UserInDB) -> List[ObjectId]:
    user_oid = ObjectId(current_user.id)
    team_ids = [
        ObjectId(team_id)
        for team_id in ([current_user.ownedAccountId] + (current_user.teamIds or []))
        if team_id and ObjectId.is_valid(str(team_id))
    ]
    query: Dict[str, Any] = {"ownerType": "user", "ownerId": user_oid}
    if team_ids:
        query = {
            "$or": [
                {"ownerType": "user", "ownerId": user_oid},
                {"ownerType": "team", "ownerId": {"$in": team_ids}},
            ]
        }
    return [project["_id"] for project in projects_collection.find(query, {"_id": 1})]


def _ensure_playbook_access(playbook_id: str, current_user: UserInDB, *, edit: bool = False) -> Tuple[Dict[str, Any], bool]:
    playbook_oid = _parse_object_id(playbook_id, "playbook_id")
    playbook = playbooks_collection.find_one({"_id": playbook_oid})
    if not playbook:
        raise HTTPException(status_code=404, detail="Playbook not found.")

    is_owner = str(playbook.get("userId")) == current_user.id
    if is_owner:
        return playbook, True

    grant = next(
        (
            grant
            for grant in playbook.get("grants", []) or []
            if str(grant.get("userId")) == current_user.id
        ),
        None,
    )
    if grant:
        access = grant.get("access")
        if edit and access not in {"edit", "manage"}:
            raise HTTPException(status_code=403, detail="You only have view access to this playbook.")
        return playbook, False

    project_id = playbook.get("projectId")
    if project_id and playbook.get("visibility") == "project":
        verify_project_access(str(project_id), current_user)
        if edit:
            raise HTTPException(status_code=403, detail="Only the owner or editors can modify this playbook.")
        return playbook, False

    raise HTTPException(status_code=404, detail="Playbook not found.")


def _load_accessible_documents(
    *,
    document_ids: List[ObjectId],
    current_user: UserInDB,
    project_id: Optional[ObjectId],
) -> List[Dict[str, Any]]:
    if not document_ids:
        return []

    if project_id:
        project = verify_project_access(str(project_id), current_user)
        access_query = build_accessible_contract_query(project, current_user)
    else:
        access_query = {
            "$or": [
                {"ownerType": "user", "ownerId": ObjectId(current_user.id)},
                {"projectId": {"$in": _accessible_project_ids(current_user)}},
            ]
        }

    query = {
        "$and": [
            access_query,
            {"_id": {"$in": document_ids}},
            {"index.content": {"$type": "string", "$ne": ""}},
        ]
    }
    projection = {
        "_id": 1,
        "contract_name": 1,
        "projectId": 1,
        "page_count": 1,
        "uploaded_at": 1,
        "index.status": 1,
        "index.content": 1,
    }
    documents = list(collection.find(query, projection))
    found_ids = {str(document["_id"]) for document in documents}
    missing = [str(document_id) for document_id in document_ids if str(document_id) not in found_ids]
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Some selected documents are not indexed or not accessible: " + ", ".join(missing),
        )
    return documents


def _serialize_playbook(playbook: Dict[str, Any], *, is_owner: Optional[bool] = None) -> Dict[str, Any]:
    payload = {
        "id": str(playbook["_id"]),
        "user_id": str(playbook.get("userId")),
        "title": playbook.get("title") or "Untitled Playbook",
        "description": playbook.get("description"),
        "contract_type": playbook.get("contractType"),
        "project_id": str(playbook["projectId"]) if playbook.get("projectId") else None,
        "visibility": playbook.get("visibility") or "private",
        "reference_document_id": str(playbook["referenceDocumentId"]) if playbook.get("referenceDocumentId") else None,
        "reference_document_name": playbook.get("referenceDocumentName"),
        "rules": playbook.get("rules", []),
        "rule_count": len(playbook.get("rules", []) or []),
        "run_count": int(playbook.get("runCount") or 0),
        "source": playbook.get("source") or "manual",
        "created_at": _serialize_value(playbook.get("createdAt")),
        "updated_at": _serialize_value(playbook.get("updatedAt")),
    }
    if is_owner is not None:
        payload["is_owner"] = is_owner
    return payload


def _serialize_run(run: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(run["_id"]),
        "playbook_id": str(run.get("playbookId")),
        "user_id": str(run.get("userId")),
        "project_id": str(run["projectId"]) if run.get("projectId") else None,
        "contract_ids": [str(contract_id) for contract_id in run.get("contractIds", [])],
        "rule_ids": run.get("ruleIds", []),
        "status": run.get("status") or "pending",
        "summary": run.get("summary") or {},
        "options": run.get("options") or {},
        "error": run.get("error"),
        "created_at": _serialize_value(run.get("createdAt")),
        "updated_at": _serialize_value(run.get("updatedAt")),
        "completed_at": _serialize_value(run.get("completedAt")),
    }


def _serialize_finding(finding: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(finding["_id"]),
        "run_id": str(finding.get("runId")),
        "playbook_id": str(finding.get("playbookId")),
        "document_id": str(finding.get("documentId")),
        "document_name": finding.get("documentName"),
        "rule_id": finding.get("ruleId"),
        "rule_name": finding.get("ruleName"),
        "clause_type": finding.get("clauseType"),
        "status": finding.get("status") or "needs_review",
        "reviewer_status": finding.get("reviewerStatus"),
        "matched_position": finding.get("matchedPosition"),
        "clause_summary": finding.get("clauseSummary"),
        "matched_text": finding.get("matchedText"),
        "reasoning": finding.get("reasoning"),
        "guidance": finding.get("guidance"),
        "suggested_revision": finding.get("suggestedRevision"),
        "severity": finding.get("severity") or "medium",
        "confidence": finding.get("confidence"),
        "citations": finding.get("citations", []),
        "reviewer_notes": finding.get("reviewerNotes"),
        "created_at": _serialize_value(finding.get("createdAt")),
        "updated_at": _serialize_value(finding.get("updatedAt")),
    }


def _serialize_redline(redline: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "redline_id": redline.get("redlineId"),
        "playbook_id": str(redline.get("playbookId")),
        "run_id": str(redline.get("runId")),
        "document_id": str(redline.get("documentId")),
        "document_name": redline.get("documentName"),
        "filename": redline.get("filename"),
        "content_type": redline.get("contentType") or DOCX_CONTENT_TYPE,
        "byte_count": int(redline.get("byteCount") or 0),
        "applied_count": int(redline.get("appliedCount") or 0),
        "unmatched_count": int(redline.get("unmatchedCount") or 0),
        "download_url": redline.get("downloadUrl"),
        "created_at": _serialize_value(redline.get("createdAt")),
    }


def _safe_export_filename(value: str, suffix: str = ".docx") -> str:
    safe = re.sub(r"[^A-Za-z0-9 _.-]+", "", value or "").strip()
    safe = re.sub(r"\s+", " ", safe)[:90].strip(" ._-")
    return f"{safe or 'Playbook Redline'}{suffix}"


def _finding_effective_status(finding: Dict[str, Any]) -> str:
    return str(finding.get("reviewerStatus") or finding.get("status") or "needs_review")


def _redlineable_finding(finding: Dict[str, Any]) -> bool:
    if _finding_effective_status(finding) == "not_applicable":
        return False
    return bool(str(finding.get("matchedText") or "").strip() and str(finding.get("suggestedRevision") or "").strip())


def _status_summary(findings: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_status = {status: 0 for status in RULE_STATUS_VALUES}
    by_severity = {severity: 0 for severity in RULE_SEVERITY_VALUES}
    for finding in findings:
        by_status[finding.get("status") or "needs_review"] = by_status.get(finding.get("status") or "needs_review", 0) + 1
        by_severity[finding.get("severity") or "medium"] = by_severity.get(finding.get("severity") or "medium", 0) + 1
    action_count = by_status.get("needs_review", 0) + by_status.get("not_acceptable", 0)
    return {
        "total": len(findings),
        "by_status": by_status,
        "by_severity": by_severity,
        "action_count": action_count,
    }


def _rule_to_prompt(rule: Dict[str, Any]) -> str:
    fallbacks = "\n".join(f"- {item}" for item in rule.get("fallback_positions", []) or []) or "None"
    red_flags = "\n".join(f"- {item}" for item in rule.get("unacceptable_deviations", []) or []) or "None"
    return (
        f"Rule name: {rule.get('name')}\n"
        f"Clause type: {rule.get('clause_type')}\n"
        f"Required clause: {'yes' if rule.get('required_clause') else 'no'}\n"
        f"Standard position: {rule.get('standard_position') or 'None'}\n"
        f"Fallback positions:\n{fallbacks}\n"
        f"Unacceptable deviations:\n{red_flags}\n"
        f"Reviewer guidance: {rule.get('guidance') or 'None'}\n"
        f"Suggested language: {rule.get('suggested_language') or 'None'}"
    )


def _canonical_status(value: Any) -> str:
    normalized = str(value or "").lower().strip().replace(" ", "_").replace("-", "_")
    aliases = {
        "ok": "acceptable",
        "pass": "acceptable",
        "passed": "acceptable",
        "accepted": "acceptable",
        "acceptable": "acceptable",
        "needs_review": "needs_review",
        "review": "needs_review",
        "fallback": "needs_review",
        "not_acceptable": "not_acceptable",
        "unacceptable": "not_acceptable",
        "fail": "not_acceptable",
        "failed": "not_acceptable",
        "red_flag": "not_acceptable",
        "not_applicable": "not_applicable",
        "missing_optional": "not_applicable",
        "n/a": "not_applicable",
    }
    return aliases.get(normalized, "needs_review")


def _parse_finding_response(content: str, rule: Dict[str, Any]) -> Dict[str, Any]:
    parsed = _extract_json_object(content)
    status_value = _canonical_status(parsed.get("status"))
    reasoning = str(parsed.get("reasoning") or "").strip()
    matched_text = str(parsed.get("matched_text") or parsed.get("matchedText") or "").strip()
    clause_summary = str(parsed.get("clause_summary") or parsed.get("clauseSummary") or "").strip()
    suggested_revision = str(parsed.get("suggested_revision") or parsed.get("suggestedRevision") or "").strip()
    confidence = parsed.get("confidence")
    try:
        confidence = float(confidence) if confidence is not None else None
    except (TypeError, ValueError):
        confidence = None

    return {
        "status": status_value,
        "matchedPosition": str(parsed.get("matched_position") or parsed.get("matchedPosition") or "").strip() or None,
        "clauseSummary": clause_summary or "No clause summary provided.",
        "matchedText": matched_text or None,
        "reasoning": reasoning or "No reasoning provided.",
        "suggestedRevision": suggested_revision or (rule.get("suggested_language") if status_value in {"needs_review", "not_acceptable"} else None),
        "confidence": confidence,
        "citations": _extract_citations(reasoning, matched_text, clause_summary),
    }


def _call_model_for_finding(
    *,
    document: Dict[str, Any],
    rule: Dict[str, Any],
    options: Dict[str, Any],
    provider_state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    rule_prompt = _rule_to_prompt(rule)
    column = {
        "name": rule.get("name") or rule.get("clause_type") or "Playbook rule",
        "prompt": rule_prompt,
        "format": "playbook_rule",
        "tags": [rule.get("clause_type") or "", *(rule.get("tags") or [])],
    }
    context = _build_tabular_context(document, column, suffix="")
    system_prompt = (
        "You are a careful legal playbook reviewer. Evaluate the supplied contract context against exactly one playbook rule. "
        "Apply this order: first detect unacceptable deviations; if none, detect the standard position; if no standard match, detect fallback positions; "
        "if the clause is required and missing, mark not_acceptable; if the clause is optional and absent, mark not_applicable. "
        "Return valid JSON with exactly these keys: status, matched_position, clause_summary, matched_text, reasoning, suggested_revision, confidence. "
        "Allowed status values are acceptable, needs_review, not_acceptable, not_applicable. "
        "Use short citations in reasoning and matched_text when possible with [[page:N||quote:verbatim excerpt of 25 words or fewer]]. "
        "Do not guess beyond the supplied context."
    )
    user_prompt = (
        f"Document: {document.get('contract_name') or 'Untitled document'}\n"
        f"Representing party: {options.get('representing_party') or 'Not specified'}\n"
        f"Paper type: {options.get('paper_type') or 'Not specified'}\n"
        f"Additional context: {options.get('additional_context') or 'None'}\n\n"
        "Playbook rule:\n"
        f"{rule_prompt}\n\n"
        f"Document context:\n{context.get('text') or ''}"
    )

    errors: List[str] = []
    providers = _providers_for_call(provider_state)
    if not providers:
        _raise_tabular_model_unavailable()

    for provider in providers:
        try:
            content = _post_tabular_prompt(provider, system_prompt, user_prompt)
            generated = _parse_finding_response(content, rule)
            if generated["status"] in {"not_acceptable", "not_applicable"} and context.get("can_expand"):
                expanded_context = _build_tabular_context(document, column, suffix="", expanded=True)
                if expanded_context.get("text") != context.get("text"):
                    expanded_prompt = user_prompt.replace(str(context.get("text") or ""), str(expanded_context.get("text") or ""))
                    retry_content = _post_tabular_prompt(provider, system_prompt, expanded_prompt)
                    generated = _parse_finding_response(retry_content, rule)
            if provider_state is not None:
                provider_state["last_success"] = provider
            return generated
        except requests.exceptions.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else "HTTP"
            errors.append(f"{provider}: {status_code}")
            if provider_state is not None:
                provider_state.setdefault("failed_providers", set()).add(provider)
        except Exception as exc:
            errors.append(f"{provider}: {exc}")
            if provider_state is not None:
                provider_state.setdefault("failed_providers", set()).add(provider)

    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="No playbook review provider succeeded. " + "; ".join(errors))


def _template_rules() -> List[Dict[str, Any]]:
    return [
        {
            "id": "commercial-agreement",
            "title": "Commercial Agreement Playbook",
            "contract_type": "Commercial Agreement",
            "description": "Baseline review rules for service, supply, and commercial agreements.",
            "rules": [
                {
                    "name": "Payment Terms",
                    "clause_type": "Payment",
                    "standard_position": "Invoices are payable within 30 days after receipt of a valid invoice.",
                    "fallback_positions": ["Payment within 45 days after receipt of invoice"],
                    "unacceptable_deviations": ["Payment period longer than 60 days", "Payment obligation is entirely discretionary"],
                    "guidance": "Push for 30 days. Escalate anything beyond 45 days to finance.",
                    "required_clause": True,
                    "suggested_language": "Customer shall pay undisputed invoices within thirty (30) days after receipt of a valid invoice.",
                    "severity": "medium",
                },
                {
                    "name": "Limitation of Liability",
                    "clause_type": "Limitation of Liability",
                    "standard_position": "Liability is capped at fees paid or payable in the preceding 12 months, with appropriate carve-outs.",
                    "fallback_positions": ["Cap at total fees paid under the agreement", "Super-cap for confidentiality, data protection, or IP claims"],
                    "unacceptable_deviations": ["Unlimited liability for ordinary breach", "No carve-out for fraud or willful misconduct"],
                    "guidance": "Review cap size against deal value and risk allocation.",
                    "required_clause": True,
                    "suggested_language": "Except for excluded claims, each party's aggregate liability is capped at fees paid or payable in the twelve (12) months before the claim.",
                    "severity": "high",
                },
                {
                    "name": "Assignment",
                    "clause_type": "Assignment",
                    "standard_position": "Assignment requires consent, except assignment to affiliates or in connection with merger, reorganization, or sale of substantially all assets.",
                    "fallback_positions": ["Consent required but not unreasonably withheld", "Affiliate assignment allowed with notice"],
                    "unacceptable_deviations": ["Counterparty may assign freely without notice", "Assignment releases counterparty from accrued obligations"],
                    "guidance": "Preserve flexibility for corporate reorganizations and M&A.",
                    "required_clause": False,
                    "suggested_language": "Neither party may assign this Agreement without consent, except to an affiliate or successor in connection with a merger, reorganization, or sale of substantially all assets.",
                    "severity": "medium",
                },
            ],
        },
        {
            "id": "mutual-nda",
            "title": "Mutual NDA Playbook",
            "contract_type": "NDA",
            "description": "Rules for confidentiality, exclusions, use restrictions, and return or destruction.",
            "rules": [
                {
                    "name": "Confidentiality Obligation",
                    "clause_type": "Confidentiality",
                    "standard_position": "Each party must protect confidential information using at least reasonable care and may use it only for the permitted purpose.",
                    "fallback_positions": ["One-way confidentiality where only one party discloses information"],
                    "unacceptable_deviations": ["Recipient may use confidential information for unrelated business purposes", "No standard of care is stated"],
                    "guidance": "Confirm the permitted purpose is narrow enough for the transaction.",
                    "required_clause": True,
                    "suggested_language": "Recipient shall use Confidential Information solely for the Purpose and protect it using at least reasonable care.",
                    "severity": "high",
                },
                {
                    "name": "Disclosure Exceptions",
                    "clause_type": "Confidentiality Exceptions",
                    "standard_position": "Exceptions include information already known, public through no breach, independently developed, or lawfully received from a third party.",
                    "fallback_positions": ["Exceptions are present but require documentary evidence"],
                    "unacceptable_deviations": ["Overbroad exception that allows disclosure based only on oral knowledge", "No exception for compelled disclosure with notice"],
                    "guidance": "Exceptions should not swallow the confidentiality obligation.",
                    "required_clause": True,
                    "severity": "medium",
                },
                {
                    "name": "Return or Destruction",
                    "clause_type": "Return or Destruction",
                    "standard_position": "Recipient must return or destroy confidential information upon request, subject to legal archival copies.",
                    "fallback_positions": ["Return or destruction on termination only"],
                    "unacceptable_deviations": ["Recipient has no obligation to return or destroy confidential information"],
                    "guidance": "Allow retained archival copies only if they remain confidential.",
                    "required_clause": False,
                    "suggested_language": "Upon request, Recipient shall promptly return or destroy Confidential Information, except for legally required archival copies that remain subject to this Agreement.",
                    "severity": "medium",
                },
            ],
        },
    ]


def _normalize_template_rules(rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return _normalize_rules([PlaybookRuleRequest(**rule) for rule in rules])


def _documents_for_generation(request: GenerateFromContractsRequest, current_user: UserInDB) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]], Optional[ObjectId]]:
    project_oid = _parse_object_id(request.project_id, "project_id") if request.project_id else None
    if project_oid:
        verify_project_access(str(project_oid), current_user)

    example_ids = list(request.example_contract_ids or [])
    if request.standard_contract_id and request.standard_contract_id not in example_ids:
        all_ids = [request.standard_contract_id, *example_ids]
    else:
        all_ids = example_ids
    document_oids = _parse_object_ids(all_ids, "contract_id", limit=MAX_GENERATION_DOCUMENTS + 1)
    documents = _load_accessible_documents(document_ids=document_oids, current_user=current_user, project_id=project_oid)
    by_id = {str(document["_id"]): document for document in documents}
    standard_doc = by_id.get(request.standard_contract_id) if request.standard_contract_id else None
    examples = [by_id[doc_id] for doc_id in example_ids if doc_id in by_id]
    if not standard_doc and not examples:
        raise HTTPException(status_code=400, detail="Select at least one indexed contract to generate a playbook.")
    return standard_doc, examples, project_oid


def _reference_document_metadata(
    *,
    reference_document_id: Optional[str],
    reference_document_name: Optional[str],
    project_oid: Optional[ObjectId],
    current_user: UserInDB,
) -> Tuple[Optional[ObjectId], Optional[str]]:
    if not reference_document_id:
        return None, (reference_document_name or "").strip() or None

    reference_oid = _parse_object_id(reference_document_id, "reference_document_id")
    documents = _load_accessible_documents(
        document_ids=[reference_oid],
        current_user=current_user,
        project_id=project_oid,
    )
    document = documents[0] if documents else None
    return reference_oid, (document.get("contract_name") if document else reference_document_name) or None


def _contract_excerpt(document: Dict[str, Any]) -> str:
    text = ((document.get("index") or {}).get("content") or "").strip()
    if len(text) <= GENERATE_CONTRACT_EXCERPT_CHARS:
        return text
    head = text[: GENERATE_CONTRACT_EXCERPT_CHARS // 2]
    tail = text[-GENERATE_CONTRACT_EXCERPT_CHARS // 2 :]
    return f"{head}\n\n[...middle omitted for playbook generation...]\n\n{tail}"


def _generate_rules_from_contracts(request: GenerateFromContractsRequest, current_user: UserInDB) -> Tuple[List[Dict[str, Any]], Optional[ObjectId]]:
    standard_doc, examples, project_oid = _documents_for_generation(request, current_user)
    providers = _tabular_provider_order()
    if not providers or not any(_provider_key(provider) for provider in providers):
        _raise_tabular_model_unavailable()

    standard_block = (
        f"Standard paper: {standard_doc.get('contract_name')}\n{_contract_excerpt(standard_doc)}"
        if standard_doc
        else "No standard paper was provided."
    )
    example_blocks = "\n\n---\n\n".join(
        f"Negotiated example: {document.get('contract_name')}\n{_contract_excerpt(document)}"
        for document in examples[:MAX_GENERATION_DOCUMENTS]
    ) or "No additional negotiated examples were provided."
    system_prompt = (
        "You create contract review playbooks. Extract concise, self-contained legal review rules from the supplied contracts. "
        "Return valid JSON with a single key rules. Each rule must include name, clause_type, standard_position, fallback_positions, "
        "unacceptable_deviations, guidance, required_clause, suggested_language, severity. Keep rules specific enough to evaluate in future contracts."
    )
    user_prompt = (
        f"Target contract type: {request.contract_type or 'Not specified'}\n"
        f"Risk tolerance: {request.risk_tolerance or 'balanced'}\n\n"
        "If a standard paper is provided, derive standard positions from it. Use negotiated examples to identify fallback positions and less favorable language. "
        "If no standard paper is provided, infer the most favorable recurring positions as standard positions.\n\n"
        f"{standard_block}\n\n--- negotiated examples ---\n{example_blocks}"
    )

    errors: List[str] = []
    for provider in providers:
        try:
            content = _post_tabular_prompt(provider, system_prompt, user_prompt)
            parsed = _extract_json_object(content)
            raw_rules = parsed.get("rules") or []
            if not isinstance(raw_rules, list):
                raise ValueError("Model did not return rules list.")
            normalized = _normalize_rules([PlaybookRuleRequest(**rule) for rule in raw_rules[:MAX_RULES]])
            if not normalized:
                raise ValueError("No rules were generated.")
            return normalized, project_oid
        except Exception as exc:
            errors.append(f"{provider}: {exc}")
            logger.warning("Playbook generation provider %s failed: %s", provider, exc)

    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not generate playbook rules. " + "; ".join(errors))


@router.get("/templates")
def list_playbook_templates() -> List[Dict[str, Any]]:
    return [
        {
            **template,
            "rules": _normalize_template_rules(template["rules"]),
        }
        for template in _template_rules()
    ]


@router.get("/")
def list_playbooks(
    project_id: Optional[str] = Query(None),
    current_user: UserInDB = Depends(get_current_active_user),
) -> List[Dict[str, Any]]:
    user_oid = ObjectId(current_user.id)
    if project_id:
        project_oid = _parse_object_id(project_id, "project_id")
        verify_project_access(project_id, current_user)
        query: Dict[str, Any] = {
            "$or": [
                {"userId": user_oid, "projectId": project_oid},
                {"projectId": project_oid, "visibility": "project"},
                {"grants.userId": user_oid},
            ]
        }
    else:
        accessible_project_ids = _accessible_project_ids(current_user)
        query = {
            "$or": [
                {"userId": user_oid},
                {"projectId": {"$in": accessible_project_ids}, "visibility": "project"},
                {"grants.userId": user_oid},
            ]
        }

    playbooks = list(playbooks_collection.find(query).sort("updatedAt", -1))
    return [
        _serialize_playbook(playbook, is_owner=str(playbook.get("userId")) == current_user.id)
        for playbook in playbooks
    ]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_playbook(
    request: PlaybookCreateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    project_oid = _parse_object_id(request.project_id, "project_id") if request.project_id else None
    if project_oid:
        verify_project_access(str(project_oid), current_user)

    rules = _normalize_rules(request.rules)
    reference_document_oid, reference_document_name = _reference_document_metadata(
        reference_document_id=request.reference_document_id,
        reference_document_name=request.reference_document_name,
        project_oid=project_oid,
        current_user=current_user,
    )
    now = _now()
    result = playbooks_collection.insert_one(
        {
            "userId": ObjectId(current_user.id),
            "title": request.title.strip(),
            "description": (request.description or "").strip() or None,
            "contractType": (request.contract_type or "").strip() or None,
            "projectId": project_oid,
            "visibility": request.visibility,
            "referenceDocumentId": reference_document_oid,
            "referenceDocumentName": reference_document_name,
            "rules": rules,
            "source": "manual",
            "runCount": 0,
            "grants": [],
            "createdAt": now,
            "updatedAt": now,
        }
    )
    playbook = playbooks_collection.find_one({"_id": result.inserted_id})
    return _serialize_playbook(playbook, is_owner=True)


@router.post("/generate-from-contracts", status_code=status.HTTP_201_CREATED)
def generate_playbook_from_contracts(
    request: GenerateFromContractsRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    standard_doc, examples, project_oid = _documents_for_generation(request, current_user)
    rules, project_oid = _generate_rules_from_contracts(request, current_user)
    reference_document = standard_doc or (examples[0] if examples else None)
    now = _now()
    result = playbooks_collection.insert_one(
        {
            "userId": ObjectId(current_user.id),
            "title": request.title.strip(),
            "description": (request.description or "").strip() or "Generated from selected contracts.",
            "contractType": (request.contract_type or "").strip() or None,
            "projectId": project_oid,
            "visibility": request.visibility,
            "referenceDocumentId": reference_document["_id"] if reference_document else None,
            "referenceDocumentName": reference_document.get("contract_name") if reference_document else None,
            "rules": rules,
            "source": "generated_from_contracts",
            "generation": {
                "standard_contract_id": request.standard_contract_id,
                "example_contract_ids": request.example_contract_ids,
                "risk_tolerance": request.risk_tolerance,
            },
            "runCount": 0,
            "grants": [],
            "createdAt": now,
            "updatedAt": now,
        }
    )
    playbook = playbooks_collection.find_one({"_id": result.inserted_id})
    return _serialize_playbook(playbook, is_owner=True)


@router.get("/{playbook_id}")
def get_playbook(
    playbook_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    playbook, is_owner = _ensure_playbook_access(playbook_id, current_user)
    latest_run = playbook_runs_collection.find_one({"playbookId": playbook["_id"]}, sort=[("createdAt", -1)])
    return {
        "playbook": _serialize_playbook(playbook, is_owner=is_owner),
        "latest_run": _serialize_run(latest_run) if latest_run else None,
    }


@router.patch("/{playbook_id}")
def update_playbook(
    playbook_id: str,
    request: PlaybookUpdateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    playbook, is_owner = _ensure_playbook_access(playbook_id, current_user, edit=True)
    if not is_owner:
        grant = next((grant for grant in playbook.get("grants", []) if str(grant.get("userId")) == current_user.id), None)
        if not grant or grant.get("access") not in {"edit", "manage"}:
            raise HTTPException(status_code=403, detail="You cannot edit this playbook.")

    update: Dict[str, Any] = {"updatedAt": _now()}
    if request.title is not None:
        update["title"] = request.title.strip() or "Untitled Playbook"
    if request.description is not None:
        update["description"] = request.description.strip() or None
    if request.contract_type is not None:
        update["contractType"] = request.contract_type.strip() or None
    if request.visibility is not None:
        update["visibility"] = request.visibility
    if request.reference_document_id is not None or request.reference_document_name is not None:
        reference_document_oid, reference_document_name = _reference_document_metadata(
            reference_document_id=request.reference_document_id,
            reference_document_name=request.reference_document_name,
            project_oid=playbook.get("projectId"),
            current_user=current_user,
        )
        update["referenceDocumentId"] = reference_document_oid
        update["referenceDocumentName"] = reference_document_name
    if request.rules is not None:
        update["rules"] = _normalize_rules(request.rules)

    playbooks_collection.update_one({"_id": playbook["_id"]}, {"$set": update})
    updated = playbooks_collection.find_one({"_id": playbook["_id"]})
    return _serialize_playbook(updated, is_owner=is_owner)


@router.delete("/{playbook_id}")
def delete_playbook(
    playbook_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, str]:
    playbook, is_owner = _ensure_playbook_access(playbook_id, current_user, edit=True)
    if not is_owner:
        raise HTTPException(status_code=403, detail="Only the owner can delete this playbook.")
    playbook_runs_collection.delete_many({"playbookId": playbook["_id"]})
    playbook_findings_collection.delete_many({"playbookId": playbook["_id"]})
    playbooks_collection.delete_one({"_id": playbook["_id"]})
    return {"message": "Playbook deleted"}


@router.post("/{playbook_id}/runs", status_code=status.HTTP_201_CREATED)
def run_playbook(
    playbook_id: str,
    request: PlaybookRunRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    playbook, _ = _ensure_playbook_access(playbook_id, current_user)
    if not playbook.get("rules"):
        raise HTTPException(status_code=400, detail="Add at least one rule before running this playbook.")

    if not _tabular_provider_order():
        _raise_tabular_model_unavailable()

    document_oids = _parse_object_ids(request.contract_ids, "contract_id", limit=MAX_RUN_DOCUMENTS)
    documents = _load_accessible_documents(
        document_ids=document_oids,
        current_user=current_user,
        project_id=playbook.get("projectId"),
    )
    if not documents:
        raise HTTPException(status_code=400, detail="Select at least one indexed contract.")

    selected_rule_ids = set(request.rule_ids or [])
    rules = [
        rule for rule in playbook.get("rules", [])
        if not selected_rule_ids or rule.get("rule_id") in selected_rule_ids
    ]
    if not rules:
        raise HTTPException(status_code=400, detail="No matching rules selected.")

    now = _now()
    run_result = playbook_runs_collection.insert_one(
        {
            "playbookId": playbook["_id"],
            "userId": ObjectId(current_user.id),
            "projectId": playbook.get("projectId"),
            "contractIds": document_oids,
            "ruleIds": [rule.get("rule_id") for rule in rules],
            "status": "running",
            "summary": {},
            "options": {
                "representing_party": request.representing_party,
                "paper_type": request.paper_type,
                "additional_context": request.additional_context,
            },
            "createdAt": now,
            "updatedAt": now,
            "completedAt": None,
        }
    )
    run_id = run_result.inserted_id
    provider_state: Dict[str, Any] = {
        "providers": _tabular_provider_order(),
        "failed_providers": set(),
        "last_success": None,
    }

    findings: List[Dict[str, Any]] = []
    try:
        for document in documents:
            for rule in rules:
                generated = _call_model_for_finding(
                    document=document,
                    rule=rule,
                    options={
                        "representing_party": request.representing_party,
                        "paper_type": request.paper_type,
                        "additional_context": request.additional_context,
                    },
                    provider_state=provider_state,
                )
                finding = {
                    "runId": run_id,
                    "playbookId": playbook["_id"],
                    "documentId": document["_id"],
                    "documentName": document.get("contract_name"),
                    "ruleId": rule.get("rule_id"),
                    "ruleName": rule.get("name"),
                    "clauseType": rule.get("clause_type"),
                    "status": generated["status"],
                    "reviewerStatus": None,
                    "matchedPosition": generated.get("matchedPosition"),
                    "clauseSummary": generated.get("clauseSummary"),
                    "matchedText": generated.get("matchedText"),
                    "reasoning": generated.get("reasoning"),
                    "guidance": rule.get("guidance"),
                    "suggestedRevision": generated.get("suggestedRevision"),
                    "severity": rule.get("severity") or "medium",
                    "confidence": generated.get("confidence"),
                    "citations": generated.get("citations") or [],
                    "reviewerNotes": None,
                    "createdAt": _now(),
                    "updatedAt": _now(),
                }
                insert = playbook_findings_collection.insert_one(finding)
                finding["_id"] = insert.inserted_id
                findings.append(finding)

        summary = _status_summary(findings)
        playbook_runs_collection.update_one(
            {"_id": run_id},
            {"$set": {"status": "completed", "summary": summary, "updatedAt": _now(), "completedAt": _now()}},
        )
        playbooks_collection.update_one(
            {"_id": playbook["_id"]},
            {"$inc": {"runCount": 1}, "$set": {"updatedAt": _now()}},
        )
    except Exception as exc:
        log_exception(logger, f"Playbook run failed playbook={playbook_id} run={run_id}", exc)
        playbook_runs_collection.update_one(
            {"_id": run_id},
            {"$set": {"status": "error", "error": str(exc), "updatedAt": _now(), "completedAt": _now()}},
        )
        raise

    run = playbook_runs_collection.find_one({"_id": run_id})
    return {
        "run": _serialize_run(run),
        "findings": [_serialize_finding(finding) for finding in findings],
    }


@router.get("/{playbook_id}/runs")
def list_playbook_runs(
    playbook_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> List[Dict[str, Any]]:
    playbook, _ = _ensure_playbook_access(playbook_id, current_user)
    runs = list(playbook_runs_collection.find({"playbookId": playbook["_id"]}).sort("createdAt", -1).limit(25))
    return [_serialize_run(run) for run in runs]


@router.get("/{playbook_id}/runs/{run_id}")
def get_playbook_run(
    playbook_id: str,
    run_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    playbook, _ = _ensure_playbook_access(playbook_id, current_user)
    run_oid = _parse_object_id(run_id, "run_id")
    run = playbook_runs_collection.find_one({"_id": run_oid, "playbookId": playbook["_id"]})
    if not run:
        raise HTTPException(status_code=404, detail="Playbook run not found.")
    findings = list(playbook_findings_collection.find({"runId": run_oid}).sort([("documentName", 1), ("ruleName", 1)]))
    return {
        "run": _serialize_run(run),
        "findings": [_serialize_finding(finding) for finding in findings],
    }


@router.post("/{playbook_id}/runs/{run_id}/redlines")
def create_playbook_redlines(
    playbook_id: str,
    run_id: str,
    request: PlaybookRedlineRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> List[Dict[str, Any]]:
    playbook, _ = _ensure_playbook_access(playbook_id, current_user)
    run_oid = _parse_object_id(run_id, "run_id")
    run = playbook_runs_collection.find_one({"_id": run_oid, "playbookId": playbook["_id"]})
    if not run:
        raise HTTPException(status_code=404, detail="Playbook run not found.")

    query: Dict[str, Any] = {"runId": run_oid, "playbookId": playbook["_id"]}
    if request.finding_ids:
        query["_id"] = {"$in": _parse_object_ids(request.finding_ids, "finding_id", limit=200)}
    if request.document_ids:
        query["documentId"] = {"$in": _parse_object_ids(request.document_ids, "document_id", limit=MAX_RUN_DOCUMENTS)}

    findings = [
        finding for finding in playbook_findings_collection.find(query).sort([("documentName", 1), ("ruleName", 1)])
        if _redlineable_finding(finding)
    ]
    if not findings:
        raise HTTPException(status_code=400, detail="No findings have both matched text and suggested revision.")

    document_oids = []
    seen_document_ids: set[str] = set()
    for finding in findings:
        document_id = finding.get("documentId")
        if not document_id:
            continue
        document_id_text = str(document_id)
        if document_id_text in seen_document_ids:
            continue
        seen_document_ids.add(document_id_text)
        document_oids.append(document_id if isinstance(document_id, ObjectId) else ObjectId(document_id_text))

    documents = _load_accessible_documents(
        document_ids=document_oids,
        current_user=current_user,
        project_id=playbook.get("projectId"),
    )
    documents_by_id = {str(document["_id"]): document for document in documents}
    artifacts: List[Dict[str, Any]] = []
    now = _now()

    for document_id_text, document in documents_by_id.items():
        document_findings = [finding for finding in findings if str(finding.get("documentId")) == document_id_text]
        if not document_findings:
            continue
        changes = [
            RedlineChange(
                finding_id=str(finding["_id"]),
                rule_name=str(finding.get("ruleName") or finding.get("clauseType") or "Playbook rule"),
                matched_text=str(finding.get("matchedText") or ""),
                suggested_revision=str(finding.get("suggestedRevision") or ""),
                status=_finding_effective_status(finding),
                document_name=str(document.get("contract_name") or ""),
            )
            for finding in document_findings
        ]
        document_name = document.get("contract_name") or f"Document {document_id_text}"
        filename = _safe_export_filename(f"Redline - {document_name}")
        render_result = render_redline_docx(
            title=f"Redline - {document_name}",
            source_text=(document.get("index") or {}).get("content") or "",
            document_name=document_name,
            changes=changes,
        )
        redline_id = f"redline-{uuid4().hex}"
        file_id = fs.put(
            render_result.docx_bytes,
            filename=filename,
            content_type=DOCX_CONTENT_TYPE,
            metadata={
                "redline_id": redline_id,
                "playbook_id": str(playbook["_id"]),
                "run_id": str(run_oid),
                "document_id": document_id_text,
                "user_id": str(current_user.id),
                "source": "playbook_redline",
            },
        )
        redline_doc = {
            "redlineId": redline_id,
            "playbookId": playbook["_id"],
            "runId": run_oid,
            "documentId": document["_id"],
            "documentName": document_name,
            "userId": ObjectId(current_user.id),
            "fileId": file_id,
            "filename": filename,
            "contentType": DOCX_CONTENT_TYPE,
            "byteCount": len(render_result.docx_bytes),
            "appliedCount": len(render_result.applied_changes),
            "unmatchedCount": len(render_result.unmatched_changes),
            "appliedChanges": render_result.applied_changes,
            "unmatchedChanges": render_result.unmatched_changes,
            "downloadUrl": f"/playbooks/{playbook_id}/redlines/{redline_id}/download",
            "createdAt": now,
        }
        playbook_redlines_collection.insert_one(redline_doc)
        artifacts.append(_serialize_redline(redline_doc))

    if not artifacts:
        raise HTTPException(status_code=400, detail="No redline artifacts were created.")
    return artifacts


@router.get("/{playbook_id}/redlines/{redline_id}/download")
def download_playbook_redline(
    playbook_id: str,
    redline_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> StreamingResponse:
    playbook, _ = _ensure_playbook_access(playbook_id, current_user)
    redline = playbook_redlines_collection.find_one({
        "redlineId": redline_id,
        "playbookId": playbook["_id"],
        "userId": ObjectId(current_user.id),
    })
    if not redline:
        raise HTTPException(status_code=404, detail="Redline not found.")

    grid_out = fs.get(redline["fileId"])
    return StreamingResponse(
        grid_out,
        media_type=grid_out.content_type or DOCX_CONTENT_TYPE,
        headers={
            "Content-Disposition": content_disposition("attachment", redline.get("filename"), "Playbook Redline.docx"),
            "Cache-Control": "private, max-age=60",
        },
    )


@router.patch("/{playbook_id}/findings/{finding_id}")
def update_playbook_finding(
    playbook_id: str,
    finding_id: str,
    request: PlaybookFindingUpdateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    playbook, _ = _ensure_playbook_access(playbook_id, current_user)
    finding_oid = _parse_object_id(finding_id, "finding_id")
    finding = playbook_findings_collection.find_one({"_id": finding_oid, "playbookId": playbook["_id"]})
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found.")

    update: Dict[str, Any] = {"updatedAt": _now()}
    if request.reviewer_status is not None:
        update["reviewerStatus"] = request.reviewer_status
    if request.reviewer_notes is not None:
        update["reviewerNotes"] = request.reviewer_notes.strip() or None
    if request.suggested_revision is not None:
        update["suggestedRevision"] = request.suggested_revision.strip() or None

    playbook_findings_collection.update_one({"_id": finding_oid}, {"$set": update})
    updated = playbook_findings_collection.find_one({"_id": finding_oid})
    return _serialize_finding(updated)
