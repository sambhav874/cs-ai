import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import requests
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from api.routes.projects import build_accessible_contract_query, verify_project_access
from core.config import settings
from core.database import collection, db, projects_collection
from core.security import get_current_active_user
from models.domain import UserInDB
from utils.secure_logger import log_exception

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tabular-reviews")

reviews_collection = db["tabular_reviews"]
cells_collection = db["tabular_cells"]

MAX_COLUMNS = 40
MAX_DOCUMENTS = 100
MAX_CONTRACT_CHARS = 28000
TABULAR_EXPANDED_CONTEXT_CHARS = 52000
TABULAR_CONTEXT_HEAD_TAIL_CHARS = 3200
TABULAR_CONTEXT_EXPANDED_HEAD_TAIL_CHARS = 5000
TABULAR_CONTEXT_WINDOW_PADDING_CHARS = 650
TABULAR_CONTEXT_TOP_SEGMENTS = 14
TABULAR_CONTEXT_EXPANDED_TOP_SEGMENTS = 28
TABULAR_PROVIDER_ORDER = ("groq", "gemini", "claude", "openai")

CITATION_PATTERN = re.compile(
    r"\[\[page:(?P<page>[^\]|]+)(?:\|\|quote:(?P<quote>[^\]]+))?\]\]",
    flags=re.IGNORECASE,
)

TABULAR_STOP_WORDS = {
    "about", "above", "after", "again", "against", "agreement", "agreements", "also", "and",
    "any", "are", "contract", "contracts", "document", "documents", "does", "each", "for",
    "from", "have", "how", "into", "its", "list", "must", "not", "only", "other", "per",
    "provide", "review", "shall", "should", "state", "that", "the", "their", "there", "this",
    "under", "what", "when", "where", "whether", "which", "with",
}

TABULAR_QUERY_EXPANSIONS = {
    "assignment": ["assignment", "assign", "transfer"],
    "benefits": ["benefits", "insurance", "health", "pension", "retirement", "vacation"],
    "compensation": ["compensation", "salary", "base salary", "wage", "bonus", "commission", "incentive", "award", "rsu", "restricted stock"],
    "confidential": ["confidential", "confidentiality", "non-disclosure", "proprietary information"],
    "date": ["date", "effective date", "commencement", "grant date", "expiration"],
    "employee": ["employee", "executive", "participant", "grantee", "worker", "recipient"],
    "employer": ["employer", "company", "issuer", "corporation", "bank", "subsidiary"],
    "full time": ["full-time", "full time", "part-time", "part time", "hours", "days"],
    "governing law": ["governing law", "laws of", "jurisdiction", "venue", "courts", "forum"],
    "independent contractor": ["independent contractor", "contractor", "employee", "employment relationship"],
    "ip": ["intellectual property", "copyright", "trademark", "patent", "work product"],
    "liability": ["liability", "limitation of liability", "damages", "cap", "indemnity", "indemnification"],
    "notice": ["notice", "written notice", "notify", "notification"],
    "payment": ["payment", "pay", "paid", "invoice", "fee", "fees", "price", "pricing", "amount", "charges"],
    "renewal": ["renewal", "renew", "extension", "extend", "term"],
    "term": ["term", "duration", "period", "expiry", "expiration", "commencement"],
    "termination": ["termination", "terminate", "terminated", "breach", "default", "cure", "cause"],
    "title": ["title", "job title", "position", "role", "office", "officer"],
    "warranty": ["warranty", "warrant", "representations"],
}

_TABULAR_SEGMENTER: Optional[Any] = None
_TABULAR_SEGMENTER_UNAVAILABLE = False


class ColumnConfig(BaseModel):
    index: int = Field(ge=0)
    name: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=2000)
    format: Optional[str] = Field(default=None, max_length=80)
    tags: Optional[List[str]] = None


class TabularReviewCreate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=180)
    project_id: Optional[str] = None
    document_ids: List[str] = Field(default_factory=list)
    columns_config: List[ColumnConfig] = Field(default_factory=list)


class TabularReviewUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=180)
    document_ids: Optional[List[str]] = None
    columns_config: Optional[List[ColumnConfig]] = None


class GenerateRequest(BaseModel):
    force: bool = False


class RegenerateCellRequest(BaseModel):
    document_id: str
    column_index: int = Field(ge=0)


class CellUpdateRequest(BaseModel):
    summary: Optional[str] = Field(default=None, max_length=10000)
    reasoning: Optional[str] = Field(default=None, max_length=20000)
    status: Optional[str] = Field(default=None, pattern="^(pending|done|error)$")


class TabularProviderError(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.utcnow()


def _parse_object_id(value: str, field_name: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name} format.")
    return ObjectId(value)


def _parse_object_ids(values: List[str], field_name: str, *, limit: int) -> List[ObjectId]:
    if len(values) > limit:
        raise HTTPException(status_code=400, detail=f"Too many {field_name}. Maximum is {limit}.")

    seen: set[str] = set()
    object_ids: List[ObjectId] = []
    for raw_value in values:
        oid = _parse_object_id(str(raw_value), field_name)
        oid_text = str(oid)
        if oid_text in seen:
            continue
        seen.add(oid_text)
        object_ids.append(oid)
    return object_ids


def _normalize_columns(columns: List[ColumnConfig]) -> List[Dict[str, Any]]:
    if len(columns) > MAX_COLUMNS:
        raise HTTPException(status_code=400, detail=f"Too many columns. Maximum is {MAX_COLUMNS}.")

    normalized: List[Dict[str, Any]] = []
    seen_indexes: set[int] = set()
    for position, column in enumerate(columns):
        index = int(column.index if column.index is not None else position)
        if index in seen_indexes:
            raise HTTPException(status_code=400, detail="Column indexes must be unique.")
        seen_indexes.add(index)

        name = column.name.strip()
        prompt = column.prompt.strip()
        if not name or not prompt:
            raise HTTPException(status_code=400, detail="Each column needs a name and prompt.")

        normalized.append(
            {
                "index": index,
                "name": name,
                "prompt": prompt,
                "format": column.format.strip() if column.format else None,
                "tags": [tag.strip() for tag in (column.tags or []) if tag and tag.strip()],
            }
        )
    return normalized


def _serialize_datetime(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def _serialize_review(
    review: Dict[str, Any],
    *,
    document_count: Optional[int] = None,
    is_owner: Optional[bool] = None,
) -> Dict[str, Any]:
    payload = {
        "id": str(review["_id"]),
        "user_id": str(review.get("userId")),
        "title": review.get("title") or "Untitled Review",
        "project_id": str(review["projectId"]) if review.get("projectId") else None,
        "document_ids": [str(document_id) for document_id in review.get("documentIds", [])],
        "columns_config": review.get("columnsConfig", []),
        "created_at": _serialize_datetime(review.get("createdAt")),
        "updated_at": _serialize_datetime(review.get("updatedAt")),
    }
    if document_count is not None:
        payload["document_count"] = document_count
    if is_owner is not None:
        payload["is_owner"] = is_owner
    return payload


def _serialize_document(document: Dict[str, Any]) -> Dict[str, Any]:
    index_data = document.get("index") or {}
    return {
        "id": str(document["_id"]),
        "contract_id": str(document["_id"]),
        "contract_name": document.get("contract_name") or "Untitled document",
        "title": document.get("contract_name") or "Untitled document",
        "project_id": str(document["projectId"]) if document.get("projectId") else None,
        "page_count": document.get("page_count", 0),
        "uploaded_at": _serialize_datetime(document.get("uploaded_at")),
        "index_status": index_data.get("status"),
    }


def _serialize_cell(cell: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(cell["_id"]),
        "review_id": str(cell.get("reviewId")),
        "document_id": str(cell.get("documentId")),
        "column_index": int(cell.get("columnIndex", 0)),
        "status": cell.get("status") or "pending",
        "summary": cell.get("summary"),
        "reasoning": cell.get("reasoning"),
        "citations": cell.get("citations", []),
        "error": cell.get("error"),
        "created_at": _serialize_datetime(cell.get("createdAt")),
        "updated_at": _serialize_datetime(cell.get("updatedAt")),
    }


def _accessible_project_ids(current_user: UserInDB) -> List[ObjectId]:
    user_oid = ObjectId(current_user.id)
    team_ids = [
        ObjectId(team_id)
        for team_id in ([current_user.ownedAccountId] + (current_user.teamIds or []))
        if team_id and ObjectId.is_valid(str(team_id))
    ]
    project_query: Dict[str, Any] = {"ownerType": "user", "ownerId": user_oid}
    if team_ids:
        project_query = {
            "$or": [
                {"ownerType": "user", "ownerId": user_oid},
                {"ownerType": "team", "ownerId": {"$in": team_ids}},
            ]
        }
    return [project["_id"] for project in projects_collection.find(project_query, {"_id": 1})]


def _ensure_review_access(review_id: str, current_user: UserInDB) -> Tuple[Dict[str, Any], bool]:
    review_oid = _parse_object_id(review_id, "review_id")
    review = reviews_collection.find_one({"_id": review_oid})
    if not review:
        raise HTTPException(status_code=404, detail="Review not found.")

    is_owner = str(review.get("userId")) == current_user.id
    if is_owner:
        return review, True

    project_id = review.get("projectId")
    if project_id:
        verify_project_access(str(project_id), current_user)
        return review, False

    raise HTTPException(status_code=404, detail="Review not found.")


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
        user_oid = ObjectId(current_user.id)
        team_oids = [
            ObjectId(team_id)
            for team_id in [current_user.ownedAccountId, *(current_user.teamIds or [])]
            if team_id and ObjectId.is_valid(team_id)
        ]
        access_query = {
            "$or": [
                {"ownerType": "user", "ownerId": user_oid},
                {"ownerType": "team", "ownerId": {"$in": team_oids}},
                {"uploaded_by": user_oid},
                {"workflowRoles.editorUserId": user_oid},
                {"workflowRoles.approverUserId": user_oid},
            ],
        }

    query = {
        "$and": [
            access_query,
            {"_id": {"$in": document_ids}},
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
            detail="Some selected documents are not accessible: " + ", ".join(missing),
        )
    return documents


def _sync_cells(review_id: ObjectId, document_ids: List[ObjectId], columns: List[Dict[str, Any]]) -> None:
    column_indexes = [int(column["index"]) for column in columns]
    keep_filter = {
        "reviewId": review_id,
        "$or": [
            {"documentId": {"$nin": document_ids}},
            {"columnIndex": {"$nin": column_indexes}},
        ],
    }
    cells_collection.delete_many(keep_filter)

    existing = {
        (str(cell["documentId"]), int(cell["columnIndex"]))
        for cell in cells_collection.find(
            {"reviewId": review_id},
            {"documentId": 1, "columnIndex": 1},
        )
    }

    now = _now()
    inserts = []
    for document_id in document_ids:
        for column_index in column_indexes:
            key = (str(document_id), column_index)
            if key in existing:
                continue
            inserts.append(
                {
                    "reviewId": review_id,
                    "documentId": document_id,
                    "columnIndex": column_index,
                    "status": "pending",
                    "summary": None,
                    "reasoning": None,
                    "citations": [],
                    "error": None,
                    "createdAt": now,
                    "updatedAt": now,
                }
            )
    if inserts:
        cells_collection.insert_many(inserts)


def _format_prompt_suffix(column: Dict[str, Any]) -> str:
    column_format = column.get("format")
    tags = column.get("tags") or []
    if column_format == "bulleted_list":
        return "Return the summary as a markdown bulleted list only."
    if column_format == "number":
        return "Return the summary as a single number only, with no units or explanation."
    if column_format == "percentage":
        return "Return the summary as a percentage only, for example 42%."
    if column_format == "monetary_amount":
        return "Return the summary as the monetary value only, including the currency symbol or code."
    if column_format == "currency":
        return "Return only currency code(s), each wrapped in double square brackets, for example [[USD]]."
    if column_format == "yes_no":
        return "Return only [[Yes]] or [[No]] in the summary, and cite the exact supporting language in the reasoning."
    if column_format == "date":
        return "Return only the date in DD Month YYYY format. If the answer is a range, include both dates."
    if column_format == "tag" and tags:
        tag_list = ", ".join(f"[[{tag}]]" for tag in tags)
        return f"Return exactly one of these tags in the summary: {tag_list}."
    return ""


def _extract_json_object(text: str) -> Dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


def _extract_citations(*values: Optional[str]) -> List[Dict[str, Any]]:
    citations: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()
    for value in values:
        for match in CITATION_PATTERN.finditer(value or ""):
            page = match.group("page").strip()
            quote = (match.group("quote") or "").strip()
            key = (page, quote)
            if key in seen:
                continue
            seen.add(key)
            citations.append({"page": page, "quote": quote})
    return citations


def _normalize_tabular_text(text: str) -> str:
    cleaned = re.sub(r"[ \t\f\v]+", " ", text or "")
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _tabular_terms(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", (text or "").lower())
        if token not in TABULAR_STOP_WORDS
    }


def _tabular_query_text(column: Dict[str, Any], suffix: str = "") -> str:
    tags = " ".join(str(tag) for tag in (column.get("tags") or []))
    return " ".join(
        part.strip()
        for part in [
            str(column.get("name") or ""),
            str(column.get("prompt") or ""),
            str(column.get("format") or ""),
            tags,
            suffix,
        ]
        if part and part.strip()
    )


def _tabular_intent_terms(query_text: str) -> set[str]:
    normalized_query = (query_text or "").lower()
    query_terms = _tabular_terms(query_text)
    expanded = set(query_terms)
    for trigger, related_terms in TABULAR_QUERY_EXPANSIONS.items():
        trigger_terms = _tabular_terms(trigger)
        if trigger in normalized_query or trigger_terms & query_terms:
            expanded.update(related_terms)
    return {term.lower() for term in expanded if len(term.strip()) >= 3}


def _tabular_query_phrases(column: Dict[str, Any], query_text: str) -> List[str]:
    phrases: List[str] = []
    name = re.sub(r"\s+", " ", str(column.get("name") or "").lower()).strip()
    if 2 <= len(name.split()) <= 8:
        phrases.append(name)

    normalized_query = re.sub(r"[^a-zA-Z0-9%$ -]+", " ", (query_text or "").lower())
    for terms in TABULAR_QUERY_EXPANSIONS.values():
        for term in terms:
            if " " in term and term in normalized_query:
                phrases.append(term)

    seen: set[str] = set()
    return [phrase for phrase in phrases if phrase and not (phrase in seen or seen.add(phrase))]


def _get_tabular_segmenter() -> Optional[Any]:
    global _TABULAR_SEGMENTER, _TABULAR_SEGMENTER_UNAVAILABLE

    if _TABULAR_SEGMENTER is not None:
        return _TABULAR_SEGMENTER
    if _TABULAR_SEGMENTER_UNAVAILABLE:
        return None

    try:
        from services.contract_agent.rag import DocumentSegmenter

        _TABULAR_SEGMENTER = DocumentSegmenter()
        return _TABULAR_SEGMENTER
    except Exception as exc:
        _TABULAR_SEGMENTER_UNAVAILABLE = True
        logger.warning("Tabular legal segmenter unavailable; falling back to local chunks: %s", exc)
        return None


def _fallback_tabular_segments(text: str) -> List[Dict[str, Any]]:
    chunk_size = 3200
    overlap = 450
    segments: List[Dict[str, Any]] = []
    cursor = 0
    text_length = len(text)

    while cursor < text_length:
        end = min(text_length, cursor + chunk_size)
        if end < text_length:
            boundary_floor = min(end, cursor + 1200)
            paragraph_boundary = text.rfind("\n\n", boundary_floor, end)
            sentence_boundary = text.rfind(". ", boundary_floor, end)
            boundary = max(paragraph_boundary, sentence_boundary)
            if boundary > cursor:
                end = boundary + (1 if boundary == sentence_boundary else 0)

        chunk = text[cursor:end].strip()
        if chunk:
            start = text.find(chunk, cursor)
            if start < 0:
                start = cursor
            segments.append(
                {
                    "text": chunk,
                    "type": "meso",
                    "chunk_level": "meso",
                    "char_start": start,
                    "char_end": start + len(chunk),
                    "section_path": "Document",
                    "section_tags": [],
                    "value_types": [],
                }
            )

        next_cursor = max(end - overlap, cursor + 1)
        if next_cursor <= cursor:
            break
        cursor = next_cursor

    return segments


def _segment_tabular_text(raw_text: str) -> Tuple[str, List[Any]]:
    segmenter = _get_tabular_segmenter()
    if segmenter:
        try:
            clean_text, segments = segmenter.segment_text_with_page_markers(raw_text)
            if clean_text and segments:
                return clean_text, segments
        except Exception as exc:
            logger.warning("Tabular legal segmentation failed; falling back to local chunks: %s", exc)

    clean_text = _normalize_tabular_text(raw_text)
    return clean_text, _fallback_tabular_segments(clean_text)


def _segment_attr(segment: Any, key: str, default: Any = None) -> Any:
    if isinstance(segment, dict):
        return segment.get(key, default)
    return getattr(segment, key, default)


def _segment_char_range(segment: Any) -> Tuple[int, int]:
    start = _segment_attr(segment, "char_start", None)
    end = _segment_attr(segment, "char_end", None)
    if start is None:
        start = _segment_attr(segment, "start_index", 0)
    if end is None:
        end = _segment_attr(segment, "end_index", start)
    return max(0, int(start or 0)), max(0, int(end or 0))


def _segment_page_label(segment: Any) -> Optional[str]:
    page_start = _segment_attr(segment, "page_start", None) or _segment_attr(segment, "page_number", None)
    page_end = _segment_attr(segment, "page_end", None) or page_start
    if page_start is None:
        return None
    if page_end and page_end != page_start:
        return f"{page_start}-{page_end}"
    return str(page_start)


def _tabular_value_format_boost(text: str, value_types: List[str], column: Dict[str, Any]) -> float:
    column_format = column.get("format")
    lowered = text.lower()
    value_type_set = {str(value_type).lower() for value_type in value_types}
    score = 0.0

    if column_format in {"monetary_amount", "currency", "number"}:
        if value_type_set & {"money", "rate"} or re.search(r"(?:\$|USD|EUR|GBP|INR)\s?\d|\b\d[\d,]*(?:\.\d+)?\b", text, re.IGNORECASE):
            score += 2.0
    if column_format == "percentage" and ("percentage" in value_type_set or re.search(r"\b\d+(?:\.\d+)?\s?%", text)):
        score += 2.0
    if column_format == "date" and ("date" in value_type_set or re.search(r"\b(?:January|February|March|April|May|June|July|August|September|October|November|December|\d{1,2}[/-]\d{1,2})", text, re.IGNORECASE)):
        score += 2.0
    if column_format == "yes_no" and re.search(r"\b(shall|must|may|will|is|are|not|no|yes)\b", lowered):
        score += 0.8
    return score


def _score_tabular_segment(
    segment: Any,
    *,
    query_terms: set[str],
    intent_terms: set[str],
    phrases: List[str],
    column: Dict[str, Any],
) -> float:
    text = str(_segment_attr(segment, "text", "") or "")
    if len(text.strip()) < 40:
        return 0.0

    lowered = text.lower()
    segment_terms = _tabular_terms(text)
    score = float(len(query_terms & segment_terms) * 3)

    for term in intent_terms:
        if len(term) < 3:
            continue
        if " " in term:
            if term in lowered:
                score += 5.5
        elif re.search(rf"\b{re.escape(term)}\b", lowered):
            score += 2.0

    for phrase in phrases:
        if phrase in lowered:
            score += 7.0

    section_tags = [str(tag).lower() for tag in (_segment_attr(segment, "section_tags", []) or [])]
    section_path = str(_segment_attr(segment, "section_path", "") or "").lower()
    section_blob = " ".join([section_path, *section_tags]).replace("_", " ")
    for term in intent_terms:
        if term in section_blob:
            score += 2.5
    for phrase in phrases:
        if phrase in section_blob:
            score += 3.5

    value_types = [str(value_type) for value_type in (_segment_attr(segment, "value_types", []) or [])]
    score += _tabular_value_format_boost(text, value_types, column)

    level = str(_segment_attr(segment, "chunk_level", None) or _segment_attr(segment, "type", "") or "").lower()
    if level == "meso":
        score += 0.8
    elif level == "micro":
        score += 1.2 if column.get("format") in {"date", "number", "percentage", "monetary_amount", "currency"} else 0.2
    elif level == "macro":
        score -= 0.6

    page_label = _segment_page_label(segment)
    if page_label and page_label.split("-", 1)[0].isdigit() and int(page_label.split("-", 1)[0]) <= 2:
        score += 0.25
    return score


def _coverage_windows(text: str, *, expanded: bool) -> List[Dict[str, Any]]:
    coverage_chars = TABULAR_CONTEXT_EXPANDED_HEAD_TAIL_CHARS if expanded else TABULAR_CONTEXT_HEAD_TAIL_CHARS
    if len(text) <= coverage_chars * 2:
        return [
            {
                "start": 0,
                "end": len(text),
                "score": 1.0,
                "kind": "coverage",
                "page_label": None,
                "section": "Document coverage",
            }
        ]

    return [
        {
            "start": 0,
            "end": min(len(text), coverage_chars),
            "score": 1.0,
            "kind": "coverage",
            "page_label": None,
            "section": "Document opening",
        },
        {
            "start": max(0, len(text) - coverage_chars),
            "end": len(text),
            "score": 1.0,
            "kind": "coverage",
            "page_label": None,
            "section": "Document ending",
        },
    ]


def _window_for_segment(text: str, segment: Any, score: float) -> Optional[Dict[str, Any]]:
    start, end = _segment_char_range(segment)
    if end <= start or start >= len(text):
        return None
    padded_start = max(0, start - TABULAR_CONTEXT_WINDOW_PADDING_CHARS)
    padded_end = min(len(text), end + TABULAR_CONTEXT_WINDOW_PADDING_CHARS)
    return {
        "start": padded_start,
        "end": padded_end,
        "score": score,
        "kind": "match",
        "page_label": _segment_page_label(segment),
        "section": str(_segment_attr(segment, "section_path", "") or "Relevant clause"),
    }


def _combine_window_label(existing: Optional[str], incoming: Optional[str]) -> Optional[str]:
    labels = [label for label in [existing, incoming] if label]
    if not labels:
        return None
    combined: List[str] = []
    for label in labels:
        for part in str(label).split("; "):
            if part and part not in combined:
                combined.append(part)
            if len(combined) >= 3:
                break
    return "; ".join(combined)


def _merge_overlapping_windows(windows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not windows:
        return []

    merged: List[Dict[str, Any]] = []
    for window in sorted(windows, key=lambda item: (int(item["start"]), int(item["end"]))):
        if not merged or int(window["start"]) > int(merged[-1]["end"]) + 120:
            merged.append(dict(window))
            continue

        current = merged[-1]
        current["end"] = max(int(current["end"]), int(window["end"]))
        current["score"] = max(float(current.get("score") or 0), float(window.get("score") or 0))
        current["kind"] = _combine_window_label(current.get("kind"), window.get("kind")) or "match"
        current["page_label"] = _combine_window_label(current.get("page_label"), window.get("page_label"))
        current["section"] = _combine_window_label(current.get("section"), window.get("section")) or "Relevant clauses"
    return merged


def _window_text_length(windows: List[Dict[str, Any]]) -> int:
    return sum(max(0, int(window["end"]) - int(window["start"])) for window in windows)


def _select_budgeted_windows(
    coverage: List[Dict[str, Any]],
    matches: List[Dict[str, Any]],
    *,
    budget: int,
) -> List[Dict[str, Any]]:
    selected = list(coverage)
    ranked_matches = sorted(
        matches,
        key=lambda item: (-float(item.get("score") or 0), int(item.get("start") or 0)),
    )

    for window in ranked_matches:
        candidate = _merge_overlapping_windows([*selected, window])
        if _window_text_length(candidate) <= budget:
            selected.append(window)

    merged = _merge_overlapping_windows(selected)
    while _window_text_length(merged) > budget and len(merged) > 1:
        lowest_index = min(
            range(len(merged)),
            key=lambda index: (
                1 if "coverage" in str(merged[index].get("kind") or "") else 0,
                float(merged[index].get("score") or 0),
            ),
        )
        merged.pop(lowest_index)
    return merged


def _format_tabular_context(text: str, windows: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for index, window in enumerate(windows, start=1):
        start = int(window["start"])
        end = int(window["end"])
        excerpt = _normalize_tabular_text(text[start:end])
        if not excerpt:
            continue

        page_label = window.get("page_label") or "unknown"
        section = window.get("section") or "Relevant clauses"
        parts.append(
            f"[Excerpt {index} | pages {page_label} | section {section}]\n{excerpt}"
        )
    return "\n\n---\n\n".join(parts)


def _build_tabular_context(
    document: Dict[str, Any],
    column: Dict[str, Any],
    *,
    suffix: str,
    expanded: bool = False,
) -> Dict[str, Any]:
    raw_text = ((document.get("index") or {}).get("content") or "").strip()
    if not raw_text:
        raise ValueError("Document has no indexed text yet.")

    budget = TABULAR_EXPANDED_CONTEXT_CHARS if expanded else MAX_CONTRACT_CHARS
    if len(raw_text) <= budget:
        return {
            "mode": "full" if not expanded else "expanded_full",
            "text": raw_text,
            "can_expand": False,
            "source_chars": len(raw_text),
            "excerpt_count": 1,
        }

    clean_text, segments = _segment_tabular_text(raw_text)
    if not clean_text:
        clean_text = raw_text
    if len(clean_text) <= budget:
        return {
            "mode": "full" if not expanded else "expanded_full",
            "text": clean_text,
            "can_expand": False,
            "source_chars": len(raw_text),
            "excerpt_count": 1,
        }

    query_text = _tabular_query_text(column, suffix)
    query_terms = _tabular_terms(query_text)
    intent_terms = _tabular_intent_terms(query_text)
    phrases = _tabular_query_phrases(column, query_text)
    ranked_segments = sorted(
        (
            (
                _score_tabular_segment(
                    segment,
                    query_terms=query_terms,
                    intent_terms=intent_terms,
                    phrases=phrases,
                    column=column,
                ),
                segment,
            )
            for segment in segments
        ),
        key=lambda item: (
            -item[0],
            _segment_char_range(item[1])[0],
        ),
    )

    top_k = TABULAR_CONTEXT_EXPANDED_TOP_SEGMENTS if expanded else TABULAR_CONTEXT_TOP_SEGMENTS
    match_windows = [
        window
        for score, segment in ranked_segments[:top_k]
        if score > 0
        for window in [_window_for_segment(clean_text, segment, score)]
        if window is not None
    ]
    selected_windows = _select_budgeted_windows(
        _coverage_windows(clean_text, expanded=expanded),
        match_windows,
        budget=budget,
    )
    context_text = _format_tabular_context(clean_text, selected_windows)
    if not context_text:
        context_text = clean_text[:budget]

    return {
        "mode": "expanded_focused" if expanded else "focused",
        "text": context_text,
        "can_expand": not expanded,
        "source_chars": len(raw_text),
        "excerpt_count": len(selected_windows),
    }


def _format_tabular_user_prompt(
    document: Dict[str, Any],
    column: Dict[str, Any],
    suffix: str,
    context: Dict[str, Any],
) -> str:
    mode = str(context.get("mode") or "focused")
    context_label = (
        "full indexed document text"
        if "full" in mode
        else "focused excerpts selected from the full indexed document, with opening/ending coverage"
    )
    suffix_block = f"\nOutput constraint: {suffix}" if suffix else ""
    return (
        f"Document: {document.get('contract_name') or 'Untitled document'}\n"
        f"Column: {column.get('name')}\n"
        f"Extraction prompt: {column.get('prompt')}"
        f"{suffix_block}\n"
        f"Context type: {context_label}; source length: {context.get('source_chars')} characters; excerpts: {context.get('excerpt_count')}.\n\n"
        "Document context:\n"
        f"{context.get('text') or ''}"
    )


def _parse_tabular_model_response(content: str) -> Dict[str, Any]:
    parsed = _extract_json_object(content)
    summary = str(parsed.get("summary") or "").strip() or "Not found"
    reasoning = str(parsed.get("reasoning") or "").strip()
    return {
        "summary": summary,
        "reasoning": reasoning,
        "citations": _extract_citations(summary, reasoning),
    }


def _summary_is_not_found(summary: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", " ", (summary or "").lower()).strip()
    return normalized in {"not found", "not present", "not applicable", "none", "n a"} or normalized.startswith("not found ")


def _provider_key(provider: str) -> str:
    if provider == "groq":
        return (getattr(settings, "groq_api_key", "") or "").strip()
    if provider == "gemini":
        return (getattr(settings, "gemini_api_key", "") or "").strip()
    if provider == "claude":
        return (getattr(settings, "anthropic_api_key", "") or "").strip()
    if provider == "openai":
        return (getattr(settings, "openai_api_key", "") or "").strip()
    return ""


def _tabular_provider_order() -> List[str]:
    preferred = (
        getattr(settings, "tabular_ai_provider", None)
        or getattr(settings, "ai_provider", None)
        or "groq"
    )
    preferred = str(preferred).lower()
    ordered = [preferred] if preferred in TABULAR_PROVIDER_ORDER else ["groq"]
    ordered.extend(provider for provider in TABULAR_PROVIDER_ORDER if provider not in ordered)
    return [provider for provider in ordered if _provider_key(provider)]


def _providers_for_call(provider_state: Optional[Dict[str, Any]]) -> List[str]:
    base = (
        list(provider_state.get("providers") or [])
        if provider_state
        else _tabular_provider_order()
    )
    failed = set(provider_state.get("failed_providers") or []) if provider_state else set()
    last_success = provider_state.get("last_success") if provider_state else None

    ordered: List[str] = []
    if last_success and last_success in base and last_success not in failed:
        ordered.append(last_success)
    ordered.extend(provider for provider in base if provider not in failed and provider not in ordered)
    return ordered


def _mark_provider_failed(provider_state: Optional[Dict[str, Any]], provider: str) -> None:
    if provider_state is None:
        return
    failed = provider_state.setdefault("failed_providers", set())
    failed.add(provider)
    if provider_state.get("last_success") == provider:
        provider_state["last_success"] = None


def _mark_provider_success(provider_state: Optional[Dict[str, Any]], provider: str) -> None:
    if provider_state is not None:
        provider_state["last_success"] = provider


def _raise_tabular_model_unavailable() -> None:
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="No configured LLM API key is available for tabular reviews. Configure GROQ_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.",
    )


def _post_tabular_prompt(provider: str, system_prompt: str, user_prompt: str) -> str:
    if provider == "groq":
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {_provider_key('groq')}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "max_tokens": min(int(settings.max_tokens or 1200), 1600),
            },
            timeout=settings.api_timeout,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    if provider == "gemini":
        model = getattr(settings, "gemini_model_name", None) or "gemini-pro"
        response = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={_provider_key('gemini')}",
            headers={"Content-Type": "application/json"},
            json={
                "contents": [{"parts": [{"text": f"{system_prompt}\n\n{user_prompt}"}]}],
                "generationConfig": {
                    "temperature": 0,
                    "topP": 1.0,
                    "responseMimeType": "application/json",
                },
            },
            timeout=settings.api_timeout,
        )
        response.raise_for_status()
        return response.json()["candidates"][0]["content"]["parts"][0]["text"]

    if provider == "claude":
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": _provider_key("claude"),
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": getattr(settings, "anthropic_model_name", None) or getattr(settings, "claude_model_name", None) or "claude-haiku-4-5",
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
                "temperature": 0,
                "max_tokens": min(int(settings.max_tokens or 1200), 1600),
            },
            timeout=settings.api_timeout,
        )
        response.raise_for_status()
        return response.json()["content"][0]["text"]

    if provider == "openai":
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {_provider_key('openai')}",
                "Content-Type": "application/json",
            },
            json={
                "model": settings.openai_model_name or "gpt-4-turbo-preview",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "temperature": 0,
                "response_format": {"type": "json_object"},
                "max_tokens": min(int(settings.max_tokens or 1200), 1600),
            },
            timeout=settings.api_timeout,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    raise ValueError(f"Unsupported tabular provider: {provider}")


def _call_tabular_model_for_cell(
    document: Dict[str, Any],
    column: Dict[str, Any],
    provider_state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    suffix = _format_prompt_suffix(column)
    context = _build_tabular_context(document, column, suffix=suffix)
    system_prompt = (
        "You are a careful legal tabular review assistant. Extract answers only from the supplied document context. "
        "The context may be the full indexed document text, or focused excerpts selected from the full document for long contracts. "
        "Return valid JSON with exactly these keys: summary, reasoning. If the answer is not present, use "
        '"Not found" as the summary and explain what was checked. Include short inline citations in reasoning '
        "when possible using [[page:N||quote:verbatim excerpt of 25 words or fewer]]. "
        "Do not guess beyond the supplied context."
    )
    user_prompt = _format_tabular_user_prompt(document, column, suffix, context)

    errors: List[str] = []
    providers = _providers_for_call(provider_state)
    if not providers:
        _raise_tabular_model_unavailable()

    for provider in providers:
        try:
            content = _post_tabular_prompt(provider, system_prompt, user_prompt)
            generated = _parse_tabular_model_response(content)
            if _summary_is_not_found(generated["summary"]) and context.get("can_expand"):
                expanded_context = _build_tabular_context(document, column, suffix=suffix, expanded=True)
                if expanded_context.get("text") != context.get("text"):
                    try:
                        expanded_prompt = _format_tabular_user_prompt(document, column, suffix, expanded_context)
                        expanded_content = _post_tabular_prompt(provider, system_prompt, expanded_prompt)
                        generated = _parse_tabular_model_response(expanded_content)
                    except Exception as retry_exc:
                        logger.warning(
                            "Expanded tabular context retry failed for provider %s; keeping first response: %s",
                            provider,
                            retry_exc,
                        )
            _mark_provider_success(provider_state, provider)
            return generated
        except requests.exceptions.HTTPError as exc:
            status_code = exc.response.status_code if exc.response is not None else "HTTP"
            errors.append(f"{provider}: {status_code}")
            logger.warning("Tabular provider %s failed with HTTP %s; trying fallback.", provider, status_code)
            _mark_provider_failed(provider_state, provider)
        except Exception as exc:
            errors.append(f"{provider}: {exc}")
            logger.warning("Tabular provider %s failed; trying fallback: %s", provider, exc)
            _mark_provider_failed(provider_state, provider)

    raise TabularProviderError("No tabular review provider succeeded. " + "; ".join(errors))


def _ensure_tabular_model_ready() -> None:
    if not _tabular_provider_order():
        _raise_tabular_model_unavailable()


def create_tabular_review_for_agent(
    *,
    current_user: UserInDB,
    title: str,
    project_id: Optional[str],
    document_ids: List[str],
    columns_config: List[Dict[str, Any]],
    source_workflow_id: Optional[str] = None,
    require_ready: bool = True,
) -> Dict[str, Any]:
    """Create a tabular review from an approval-gated agent proposal."""
    if require_ready and not document_ids:
        raise HTTPException(status_code=400, detail="A tabular review needs at least one document.")
    if require_ready and not columns_config:
        raise HTTPException(status_code=400, detail="A tabular review needs at least one field.")

    project_oid = _parse_object_id(project_id, "project_id") if project_id else None
    if project_oid:
        verify_project_access(str(project_oid), current_user)

    document_oids = _parse_object_ids(document_ids, "document_id", limit=MAX_DOCUMENTS)
    _load_accessible_documents(
        document_ids=document_oids,
        current_user=current_user,
        project_id=project_oid,
    )
    columns = _normalize_columns([ColumnConfig.model_validate(column) for column in columns_config])
    now = _now()
    result = reviews_collection.insert_one(
        {
            "userId": ObjectId(current_user.id),
            "title": (title or "Untitled Review").strip() or "Untitled Review",
            "projectId": project_oid,
            "documentIds": document_oids,
            "columnsConfig": columns,
            "source": {
                "type": "agent",
                "workflowId": source_workflow_id,
            },
            "createdAt": now,
            "updatedAt": now,
        }
    )
    _sync_cells(result.inserted_id, document_oids, columns)
    review = reviews_collection.find_one({"_id": result.inserted_id})
    return _serialize_review(review, document_count=len(document_oids), is_owner=True)


def find_tabular_review_for_agent_workflow(
    *,
    current_user: UserInDB,
    workflow_id: str,
) -> Optional[Dict[str, Any]]:
    """Return an already-created review for an approval workflow, if one exists."""
    if not workflow_id:
        return None
    review = reviews_collection.find_one(
        {
            "userId": ObjectId(current_user.id),
            "source.type": "agent",
            "source.workflowId": workflow_id,
        },
        sort=[("createdAt", -1)],
    )
    if not review:
        return None
    return _serialize_review(
        review,
        document_count=len(review.get("documentIds") or []),
        is_owner=True,
    )


def _generate_one_cell(
    *,
    review_id: ObjectId,
    document: Dict[str, Any],
    column: Dict[str, Any],
    provider_state: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    now = _now()
    cell_filter = {
        "reviewId": review_id,
        "documentId": document["_id"],
        "columnIndex": int(column["index"]),
    }
    cells_collection.update_one(
        cell_filter,
        {
            "$set": {"status": "running", "error": None, "updatedAt": now},
            "$setOnInsert": {"createdAt": now, "citations": []},
        },
        upsert=True,
    )
    try:
        generated = _call_tabular_model_for_cell(document, column, provider_state=provider_state)
        update = {
            "status": "done",
            "summary": generated["summary"],
            "reasoning": generated["reasoning"],
            "citations": generated["citations"],
            "error": None,
            "updatedAt": _now(),
        }
    except TabularProviderError as exc:
        cells_collection.update_one(
            cell_filter,
            {
                "$set": {
                    "status": "error",
                    "summary": None,
                    "reasoning": None,
                    "citations": [],
                    "error": str(exc),
                    "updatedAt": _now(),
                }
            },
        )
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        log_exception(
            logger,
            f"Failed to generate tabular cell review={review_id} doc={document['_id']} column={column['index']}",
            exc,
        )
        update = {
            "status": "error",
            "summary": None,
            "reasoning": None,
            "citations": [],
            "error": str(exc),
            "updatedAt": _now(),
        }

    cells_collection.update_one(cell_filter, {"$set": update})
    cell = cells_collection.find_one(cell_filter)
    return _serialize_cell(cell)


@router.get("/")
def list_tabular_reviews(
    project_id: Optional[str] = Query(None),
    current_user: UserInDB = Depends(get_current_active_user),
) -> List[Dict[str, Any]]:
    user_oid = ObjectId(current_user.id)
    if project_id:
        project_oid = _parse_object_id(project_id, "project_id")
        verify_project_access(project_id, current_user)
        query: Dict[str, Any] = {"projectId": project_oid}
    else:
        project_ids = _accessible_project_ids(current_user)
        query = {
            "$or": [
                {"userId": user_oid},
                {"projectId": {"$in": project_ids}},
            ]
        }

    reviews = list(reviews_collection.find(query).sort("updatedAt", -1))
    return [
        _serialize_review(
            review,
            document_count=len(review.get("documentIds", [])),
            is_owner=str(review.get("userId")) == current_user.id,
        )
        for review in reviews
    ]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_tabular_review(
    request: TabularReviewCreate,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    return create_tabular_review_for_agent(
        current_user=current_user,
        title=request.title or "Untitled Review",
        project_id=request.project_id,
        document_ids=request.document_ids,
        columns_config=[column.model_dump() for column in request.columns_config],
        require_ready=False,
    )


@router.get("/{review_id}")
def get_tabular_review(
    review_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    review, is_owner = _ensure_review_access(review_id, current_user)
    document_ids = review.get("documentIds", [])
    documents = _load_accessible_documents(
        document_ids=document_ids,
        current_user=current_user,
        project_id=review.get("projectId"),
    )
    cells = list(cells_collection.find({"reviewId": review["_id"]}).sort([("documentId", 1), ("columnIndex", 1)]))
    return {
        "review": _serialize_review(review, document_count=len(document_ids), is_owner=is_owner),
        "documents": [_serialize_document(document) for document in documents],
        "cells": [_serialize_cell(cell) for cell in cells],
    }


@router.patch("/{review_id}")
def update_tabular_review(
    review_id: str,
    request: TabularReviewUpdate,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    review, is_owner = _ensure_review_access(review_id, current_user)
    update: Dict[str, Any] = {"updatedAt": _now()}

    if request.title is not None:
        update["title"] = request.title.strip() or "Untitled Review"

    document_oids = review.get("documentIds", [])
    if request.document_ids is not None:
        document_oids = _parse_object_ids(request.document_ids, "document_id", limit=MAX_DOCUMENTS)
        _load_accessible_documents(
            document_ids=document_oids,
            current_user=current_user,
            project_id=review.get("projectId"),
        )
        update["documentIds"] = document_oids

    columns = review.get("columnsConfig", [])
    if request.columns_config is not None:
        columns = _normalize_columns(request.columns_config)
        update["columnsConfig"] = columns

    reviews_collection.update_one({"_id": review["_id"]}, {"$set": update})
    if request.document_ids is not None or request.columns_config is not None:
        _sync_cells(review["_id"], document_oids, columns)

    updated = reviews_collection.find_one({"_id": review["_id"]})
    return _serialize_review(updated, document_count=len(updated.get("documentIds", [])), is_owner=is_owner)


@router.delete("/{review_id}")
def delete_tabular_review(
    review_id: str,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, str]:
    review, is_owner = _ensure_review_access(review_id, current_user)
    if not is_owner:
        raise HTTPException(status_code=403, detail="Only the review owner can delete this review.")
    cells_collection.delete_many({"reviewId": review["_id"]})
    reviews_collection.delete_one({"_id": review["_id"]})
    return {"message": "Review deleted"}


@router.post("/{review_id}/generate")
def generate_tabular_review(
    review_id: str,
    request: GenerateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    review, _ = _ensure_review_access(review_id, current_user)
    columns = review.get("columnsConfig", [])
    if not columns:
        raise HTTPException(status_code=400, detail="Add at least one column before generating.")
    _ensure_tabular_model_ready()
    provider_state: Dict[str, Any] = {
        "providers": _tabular_provider_order(),
        "failed_providers": set(),
        "last_success": None,
    }

    documents = _load_accessible_documents(
        document_ids=review.get("documentIds", []),
        current_user=current_user,
        project_id=review.get("projectId"),
    )
    if not documents:
        raise HTTPException(status_code=400, detail="Add at least one document before generating.")

    columns_by_index = {int(column["index"]): column for column in columns}
    documents_by_id = {str(document["_id"]): document for document in documents}
    _sync_cells(review["_id"], review.get("documentIds", []), columns)

    generated_cells: List[Dict[str, Any]] = []
    cell_query: Dict[str, Any] = {"reviewId": review["_id"]}
    if not request.force:
        cell_query["status"] = {"$ne": "done"}

    for cell in cells_collection.find(cell_query).sort([("documentId", 1), ("columnIndex", 1)]):
        document = documents_by_id.get(str(cell.get("documentId")))
        column = columns_by_index.get(int(cell.get("columnIndex", 0)))
        if not document or not column:
            continue
        generated_cells.append(
            _generate_one_cell(
                review_id=review["_id"],
                document=document,
                column=column,
                provider_state=provider_state,
            )
        )

    reviews_collection.update_one({"_id": review["_id"]}, {"$set": {"updatedAt": _now()}})
    cells = list(cells_collection.find({"reviewId": review["_id"]}).sort([("documentId", 1), ("columnIndex", 1)]))
    return {
        "generated_count": len(generated_cells),
        "cells": [_serialize_cell(cell) for cell in cells],
    }


def generate_tabular_review_for_agent(
    *,
    current_user: UserInDB,
    review_id: str,
    force: bool = False,
) -> Dict[str, Any]:
    """Generate an approved tabular review from an agent workflow."""
    return generate_tabular_review(review_id, GenerateRequest(force=force), current_user)


@router.post("/{review_id}/regenerate-cell")
def regenerate_tabular_cell(
    review_id: str,
    request: RegenerateCellRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    review, _ = _ensure_review_access(review_id, current_user)
    document_oid = _parse_object_id(request.document_id, "document_id")
    if document_oid not in (review.get("documentIds") or []):
        raise HTTPException(status_code=404, detail="Document is not part of this review.")
    documents = _load_accessible_documents(
        document_ids=[document_oid],
        current_user=current_user,
        project_id=review.get("projectId"),
    )
    columns_by_index = {int(column["index"]): column for column in review.get("columnsConfig", [])}
    column = columns_by_index.get(request.column_index)
    if not column:
        raise HTTPException(status_code=404, detail="Column not found.")
    _ensure_tabular_model_ready()
    provider_state: Dict[str, Any] = {
        "providers": _tabular_provider_order(),
        "failed_providers": set(),
        "last_success": None,
    }

    return _generate_one_cell(
        review_id=review["_id"],
        document=documents[0],
        column=column,
        provider_state=provider_state,
    )


@router.patch("/{review_id}/cells/{cell_id}")
def update_tabular_cell(
    review_id: str,
    cell_id: str,
    request: CellUpdateRequest,
    current_user: UserInDB = Depends(get_current_active_user),
) -> Dict[str, Any]:
    review, _ = _ensure_review_access(review_id, current_user)
    cell_oid = _parse_object_id(cell_id, "cell_id")
    cell = cells_collection.find_one({"_id": cell_oid, "reviewId": review["_id"]})
    if not cell:
        raise HTTPException(status_code=404, detail="Cell not found.")

    update: Dict[str, Any] = {"updatedAt": _now()}
    if request.summary is not None:
        update["summary"] = request.summary
    if request.reasoning is not None:
        update["reasoning"] = request.reasoning
    if request.status is not None:
        update["status"] = request.status
    if request.summary is not None or request.reasoning is not None:
        summary = request.summary if request.summary is not None else cell.get("summary")
        reasoning = request.reasoning if request.reasoning is not None else cell.get("reasoning")
        update["citations"] = _extract_citations(summary, reasoning)
        update["error"] = None
        update["status"] = request.status or "done"

    cells_collection.update_one({"_id": cell_oid}, {"$set": update})
    updated = cells_collection.find_one({"_id": cell_oid})
    return _serialize_cell(updated)
