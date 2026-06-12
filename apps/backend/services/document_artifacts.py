"""DOCX work-product generation for the contract assistant.

The assistant cannot safely mutate source PDFs in place. For drafting and edit
requests, we generate a separate Word document artifact and store it in GridFS
so the UI can present a Mike-style download card.
"""

from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4
from defusedxml import ElementTree as DefusedElementTree
from xml.etree import ElementTree
from xml.sax.saxutils import escape

from utils.text_cleanup import clean_text_encoding


DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DOCX_FONT = "Times New Roman"
REDLINE_DELETE_OPEN_PREFIX = "[[CS_REDLINE_DEL:"
REDLINE_DELETE_CLOSE = "[[/CS_REDLINE_DEL]]"
REDLINE_INSERT_OPEN_PREFIX = "[[CS_REDLINE_INS:"
REDLINE_INSERT_CLOSE = "[[/CS_REDLINE_INS]]"
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ElementTree.register_namespace("w", W_NS)
MAX_DOCX_PACKAGE_MEMBERS = 256
MAX_DOCX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024
MAX_DOCX_XML_BYTES = 5 * 1024 * 1024


def _w_tag(name: str) -> str:
    return f"{{{W_NS}}}{name}"


def read_docx_package_files(docx_bytes: bytes) -> Dict[str, bytes]:
    with zipfile.ZipFile(BytesIO(docx_bytes), "r") as package:
        members = package.infolist()
        if len(members) > MAX_DOCX_PACKAGE_MEMBERS:
            raise ValueError("DOCX package contains too many files.")
        total_uncompressed = sum(member.file_size for member in members)
        if total_uncompressed > MAX_DOCX_UNCOMPRESSED_BYTES:
            raise ValueError("DOCX package expands beyond the safe processing limit.")
        for member in members:
            if member.filename.startswith("/") or ".." in member.filename.split("/"):
                raise ValueError("DOCX package contains an unsafe file path.")
        return {member.filename: package.read(member.filename) for member in members}


def read_docx_xml_file(docx_bytes: bytes, name: str) -> bytes:
    files = read_docx_package_files(docx_bytes)
    content = files.get(name)
    if content is None:
        raise KeyError(name)
    if len(content) > MAX_DOCX_XML_BYTES:
        raise ValueError("DOCX XML file is too large to process safely.")
    return content


def parse_docx_xml(content: bytes):
    if len(content) > MAX_DOCX_XML_BYTES:
        raise ValueError("DOCX XML file is too large to process safely.")
    return DefusedElementTree.fromstring(content)


@dataclass
class GeneratedDocxArtifact:
    artifact_id: str
    file_id: Any
    filename: str
    content_type: str
    byte_count: int
    draft_type: str
    download_url: str
    artifact_kind: str = "work_product"

    def to_payload(self) -> Dict[str, Any]:
        return {
            "artifact_id": self.artifact_id,
            "file_id": str(self.file_id),
            "filename": self.filename,
            "content_type": self.content_type,
            "byte_count": self.byte_count,
            "draft_type": self.draft_type,
            "download_url": self.download_url,
            "artifact_kind": self.artifact_kind,
        }


@dataclass
class RedlineChange:
    finding_id: str
    rule_name: str
    matched_text: str
    suggested_revision: str
    status: str
    document_name: str = ""
    rationale: str = ""


@dataclass
class RedlineRenderResult:
    docx_bytes: bytes
    applied_changes: List[Dict[str, Any]]
    unmatched_changes: List[Dict[str, Any]]


@dataclass
class TrackedEditInput:
    find: str
    replace: str
    context_before: str = ""
    context_after: str = ""
    reason: str = ""


@dataclass
class TrackedEditAnnotation:
    change_id: str
    del_w_id: Optional[str]
    ins_w_id: Optional[str]
    deleted_text: str
    inserted_text: str
    context_before: str = ""
    context_after: str = ""
    reason: str = ""

    def to_payload(self) -> Dict[str, Any]:
        return {
            "change_id": self.change_id,
            "del_w_id": self.del_w_id,
            "ins_w_id": self.ins_w_id,
            "deleted_text": self.deleted_text,
            "inserted_text": self.inserted_text,
            "context_before": self.context_before,
            "context_after": self.context_after,
            "reason": self.reason,
        }


@dataclass
class TrackedEditApplyResult:
    docx_bytes: bytes
    annotations: List[TrackedEditAnnotation]
    errors: List[Dict[str, Any]]


def _explicit_docx_side_effect_request(question: str) -> bool:
    text = (question or "").lower()
    if re.search(r"\b(redline|edit|revise|rewrite|amend|change|replace|apply)\b", text):
        return True
    if re.search(r"\b(generate|create|draft|prepare|write|compose|make|produce|build)\b", text):
        return bool(re.search(
            r"\b(document|docx|word|agreement|amendment|clause|note|memo|letter|notice|template|checklist|copy|copies|language)\b",
            text,
        ))
    return bool(re.search(r"\b(yes|ok|okay|do it|make it|change it|apply it|generate it|create it)\b", text))


def should_generate_docx_work_product(question: str, answer: str, draft_type: Optional[str]) -> bool:
    """Return true only when the user explicitly asked for a downloadable side effect."""
    del answer
    if not _explicit_docx_side_effect_request(question):
        return False
    if draft_type:
        return True
    text = (question or "").lower()
    if re.search(r"\b(checklist|template|playbook|closing set|conditions precedent|cp checklist)\b", text):
        return True
    return bool(
        re.search(
            r"\b(generate|create|draft|prepare|write|compose|make|change|revise|amend|edit|redline|produce|build)\b",
            text,
        )
        and re.search(r"\b(document|docx|word|agreement|amendment|clause|note|memo|letter|notice|supplier|party|name|template|checklist|copy|copies|language)\b", text)
    )


def infer_draft_type(question: str, answer: str, fallback: Optional[str] = None) -> str:
    haystack = f"{question}\n{answer}".lower()
    if fallback:
        return fallback
    if re.search(r"\b(checklist|conditions precedent|cp checklist|closing checklist)\b", haystack):
        return "checklist"
    if "template" in haystack:
        return "template"
    if "approval" in haystack:
        return "approval_note"
    if re.search(r"\b(redline|edit|revision|revise|change|replace)\b", haystack):
        return "edit_suggestions"
    if "amendment" in haystack:
        return "amendment"
    return "draft"


def work_product_title(question: str, answer: str, draft_type: str, contract_name: str) -> str:
    lowered = f"{question}\n{answer}".lower()
    if draft_type == "checklist":
        first_heading = _first_heading(answer)
        if first_heading:
            return first_heading
        return "Contract Checklist"
    if draft_type == "template":
        first_heading = _first_heading(answer)
        if first_heading:
            return first_heading
        return "Contract Template"
    if "supplier" in lowered and re.search(r"\bchange|replace|amend|supplier\b", lowered):
        return "Edited Copy - Supplier Name Change"
    if draft_type == "approval_note":
        return "Contract Approval Note"
    if draft_type == "edit_suggestions":
        return "Proposed Contract Edits"
    if draft_type == "amendment":
        return "Contract Amendment"
    first_heading = _first_heading(answer)
    if first_heading:
        return first_heading
    safe_contract = re.sub(r"\.[A-Za-z0-9]+$", "", contract_name or "").strip()
    return f"{safe_contract or 'Contract'} Work Product"


def source_contract_title(contract_name: str) -> str:
    """Return the original contract title without generated-copy labels."""
    title = clean_text_encoding(contract_name or "").strip()
    title = re.sub(r"\.[A-Za-z0-9]+$", "", title)
    title = re.sub(r"\s+", " ", title).strip(" ._-")
    return title or "Contract"


def redline_change_to_payload(change: RedlineChange) -> Dict[str, Any]:
    return {
        "finding_id": change.finding_id,
        "rule_name": change.rule_name,
        "matched_text": change.matched_text,
        "suggested_revision": change.suggested_revision,
        "status": change.status,
        "document_name": change.document_name,
        "rationale": change.rationale,
    }


def redline_change_from_payload(payload: Dict[str, Any]) -> RedlineChange:
    return RedlineChange(
        finding_id=str(payload.get("finding_id") or f"agent-redline-{uuid4().hex[:8]}"),
        rule_name=str(payload.get("rule_name") or "Proposed redline"),
        matched_text=str(payload.get("matched_text") or ""),
        suggested_revision=str(payload.get("suggested_revision") or ""),
        status=str(payload.get("status") or "pending_approval"),
        document_name=str(payload.get("document_name") or ""),
        rationale=str(payload.get("rationale") or ""),
    )


def build_redline_changes_from_request(
    *,
    question: str,
    source_text: str,
    contract_name: str,
) -> List[RedlineChange]:
    """Build deterministic edit proposals from a user redline request.

    This keeps approved side effects tied to source text instead of turning a
    prose answer into a DOCX. Party-name redlines apply to repeated source
    occurrences so the generated copy reads like a changed contract, not a
    one-off memo.
    """
    cleaned_source = _clean_source_contract_text(source_text)
    matched_text, explicit_replacement = _extract_requested_replacement(question)
    if not matched_text:
        matched_text = _infer_redline_target(question, cleaned_source, contract_name)
    if not matched_text:
        return []

    suggested_revision = explicit_replacement
    if suggested_revision is None:
        suggested_revision = _default_redline_replacement(question)

    label = "Supplier name redline" if re.search(r"\bsupplier\b", question or "", flags=re.IGNORECASE) else "Requested redline"
    repeat_count = 1
    if _should_redline_repeated_occurrences(question):
        repeat_count = max(1, _count_flexible_occurrences(cleaned_source, matched_text, limit=12))

    return [
        RedlineChange(
            finding_id=f"agent-redline-{index}",
            rule_name=label if repeat_count == 1 else f"{label} {index}",
            matched_text=matched_text,
            suggested_revision=suggested_revision,
            status="pending_approval",
            document_name=contract_name,
            rationale="Prepared from the user's approved redline request and matched against the original contract text.",
        )
        for index in range(1, repeat_count + 1)
    ]


def redline_contract_preview_body(*, source_text: str, changes: List[RedlineChange]) -> str:
    """Return source contract text with inline redline markers for UI preview."""
    cleaned_source = _clean_source_contract_text(source_text)
    planned_changes = _plan_redline_changes(cleaned_source, changes)
    applied = [change for change in planned_changes if change.get("applied")]
    if not applied:
        return cleaned_source

    parts: List[str] = []
    cursor = 0
    for index, change in enumerate(sorted(applied, key=lambda item: item["start"]), start=1):
        start = int(change["start"])
        end = int(change["end"])
        replacement = str(change.get("replacement") or "")
        if start > cursor:
            parts.append(cleaned_source[cursor:start])
        parts.append(f"{REDLINE_DELETE_OPEN_PREFIX}{index}]]{cleaned_source[start:end]}{REDLINE_DELETE_CLOSE}")
        if replacement:
            parts.append(f"{REDLINE_INSERT_OPEN_PREFIX}{index}]]{replacement}{REDLINE_INSERT_CLOSE}")
        cursor = end
    if cursor < len(cleaned_source):
        parts.append(cleaned_source[cursor:])
    return "".join(parts).strip()


def _extract_requested_replacement(question: str) -> Tuple[str, Optional[str]]:
    text = clean_text_encoding(question or "").strip()
    patterns = [
        r"\breplace\s+['\"]?(.+?)['\"]?\s+(?:with|to)\s+['\"]?(.+?)['\"]?(?:[.;\n]|$)",
        r"\bchange\s+['\"]?(.+?)['\"]?\s+(?:to|with)\s+['\"]?(.+?)['\"]?(?:[.;\n]|$)",
        r"\bredline\s+['\"]?(.+?)['\"]?\s+(?:to|with)\s+['\"]?(.+?)['\"]?(?:[.;\n]|$)",
        r"\b(?:supplier|vendor|party|customer)\s+name\s+(?:to|with)\s+['\"]?(.+?)['\"]?(?:[.;\n]|$)",
    ]
    for pattern in patterns[:3]:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return _clean_requested_term(match.group(1)), _clean_requested_term(match.group(2))
    match = re.search(patterns[3], text, flags=re.IGNORECASE)
    if match:
        return "", _clean_requested_term(match.group(1))
    return "", None


def _clean_requested_term(value: str) -> str:
    value = re.sub(r"\b(?:in|on|for|throughout|the|contract|agreement|document)\b\s*$", "", value or "", flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", value).strip(" '\".,:;")


def _default_redline_replacement(question: str) -> str:
    lowered = (question or "").lower()
    if re.search(r"\b(redact|mask|hide)\b", lowered):
        return "[REDACTED SUPPLIER NAME]" if "supplier" in lowered else "[REDACTED]"
    if re.search(r"\b(remove|delete|strike)\b", lowered):
        return ""
    if "supplier" in lowered:
        return "[New Supplier Name]"
    if "vendor" in lowered:
        return "[New Vendor Name]"
    if "customer" in lowered:
        return "[New Customer Name]"
    if "party" in lowered:
        return "[New Party Name]"
    return "[Proposed Replacement]"


def _should_redline_repeated_occurrences(question: str) -> bool:
    lowered = (question or "").lower()
    return bool(
        re.search(r"\b(all|every|throughout|entire)\b", lowered)
        or re.search(r"\b(supplier|vendor|party|customer)\s+name\b", lowered)
    )


def _infer_redline_target(question: str, source_text: str, contract_name: str) -> str:
    lowered = (question or "").lower()
    if re.search(r"\b(supplier|vendor|party|customer)\s+name\b", lowered):
        inferred = _infer_primary_party_name(source_text, contract_name)
        if inferred:
            return inferred
    quoted = re.findall(r"['\"]([^'\"]{3,120})['\"]", question or "")
    if quoted:
        return _clean_requested_term(quoted[0])
    return ""


def _infer_primary_party_name(source_text: str, contract_name: str) -> str:
    search_area = "\n".join((source_text or "").splitlines()[:120])
    patterns = [
        r"\b([A-Z][A-Za-z&.,' -]{2,90}\b(?:Corporation|Corp\.?|LLC|L\.L\.C\.|Inc\.?|Company|Co\.?|Ltd\.?|Limited|Bank(?: of [A-Z][A-Za-z]+)*))\b",
        r"\b([A-Z][A-Za-z&.,' -]{2,90} Gas Corporation)\b",
    ]
    candidates: List[str] = []
    for pattern in patterns:
        candidates.extend(re.findall(pattern, search_area))
    if not candidates and contract_name:
        first_part = re.split(r"\s+_\s+", contract_name)[0]
        match = re.search(patterns[0], first_part)
        if match:
            candidates.append(match.group(1))
    for candidate in candidates:
        cleaned = _clean_requested_term(candidate)
        if len(cleaned) < 4:
            continue
        if re.search(r"\b(EXHIBIT|AGREEMENT|PLAN|PERFORMANCE|AWARD|BUSINESS CONTRACTS|JUSTIA)\b", cleaned, flags=re.IGNORECASE):
            continue
        return cleaned
    return ""


def build_work_product_body(question: str, answer: str) -> str:
    cleaned = clean_text_encoding(answer or "")
    cleaned = _strip_hidden_citations(cleaned)
    cleaned = _strip_sources_section(cleaned)
    cleaned = _normalize_artifact_text(cleaned)
    cleaned = re.sub(r"\[(?:\d+)(?:\s*,\s*\d+)*\]", "", cleaned)
    cleaned = re.sub(r"\u3010\d+\u3011", "", cleaned)
    cleaned = re.sub(r"---\s*\d+\s*$", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    extracted_work_product = _extract_work_product_section(cleaned)
    if extracted_work_product:
        cleaned = extracted_work_product

    if not cleaned:
        cleaned = clean_text_encoding(question or "Generated contract work product")
    return cleaned


def create_docx_artifact(
    *,
    fs,
    contract_id: str,
    project_id: Optional[str],
    user_id: str,
    session_id: str,
    contract_name: str,
    question: str,
    answer: str,
    draft_type: Optional[str],
    source_text: Optional[str] = None,
) -> GeneratedDocxArtifact:
    resolved_type = infer_draft_type(question, answer, draft_type)
    title = work_product_title(question, answer, resolved_type, contract_name)
    work_product_body = build_work_product_body(question, answer)
    wants_edited_copy = _wants_edited_contract_copy(question, answer, resolved_type)
    body = (
        build_edited_contract_copy_body(source_text or "", work_product_body, question=question)
        if wants_edited_copy and source_text
        else work_product_body
    )
    filename = _safe_filename(title, suffix=".docx")
    docx_bytes = render_minimal_docx(
        title=title,
        body=body,
        landscape=_should_render_landscape(question, answer, resolved_type),
    )
    artifact_id = f"artifact-{uuid4().hex}"
    file_id = fs.put(
        docx_bytes,
        filename=filename,
        content_type=DOCX_CONTENT_TYPE,
        metadata={
            "artifact_id": artifact_id,
            "contract_id": contract_id,
            "project_id": project_id,
            "user_id": user_id,
            "session_id": session_id,
            "draft_type": resolved_type,
            "artifact_kind": "edited_contract_copy" if wants_edited_copy and source_text else "work_product",
            "source": "agent_work_product",
        },
    )
    return GeneratedDocxArtifact(
        artifact_id=artifact_id,
        file_id=file_id,
        filename=filename,
        content_type=DOCX_CONTENT_TYPE,
        byte_count=len(docx_bytes),
        draft_type=resolved_type,
        download_url=f"/contracts/{contract_id}/agent/artifacts/{artifact_id}/download",
        artifact_kind="edited_contract_copy" if wants_edited_copy and source_text else "work_product",
    )


def build_edited_contract_copy_body(source_text: str, work_product_body: str, question: str = "") -> str:
    """Build a full editable copy when the source is a PDF.

    The app currently accepts PDFs only, so we cannot preserve the original PDF
    bytes and apply tracked changes in place. Instead we create a converted DOCX
    copy with a first-page amendment summary and the amended source text.
    """
    source = _clean_source_contract_text(source_text)
    amendment = _clean_work_product_for_copy(work_product_body)
    source, applied_changes = _apply_requested_contract_changes(question, source)
    if applied_changes:
        amendment = _applied_change_summary(applied_changes, fallback=amendment)
    elif _is_approval_boilerplate(amendment):
        amendment = _fallback_amendment_summary(question)

    sections: List[str] = []
    if amendment:
        sections.append("Amendment / Applied Change\n\n" + amendment)
    if source:
        sections.append(_source_contract_starts_next_page(source) if amendment else source)
    return "\n\n".join(sections).strip() or amendment or source or "Edited contract copy"


def _apply_requested_contract_changes(question: str, source: str) -> Tuple[str, List[Dict[str, str]]]:
    if not source.strip():
        return source, []
    matched_text, replacement = _extract_requested_replacement(question)
    replacement = _clean_requested_term(replacement or "")
    if not replacement:
        return source, []

    field_change = _apply_field_change(source, question=question, matched_text=matched_text, replacement=replacement)
    if field_change:
        return field_change

    exact_target = _clean_requested_term(matched_text)
    if exact_target:
        span = _find_flexible_span(source, exact_target)
        if span:
            start, end = span
            old_value = source[start:end]
            return (
                f"{source[:start]}{replacement}{source[end:]}",
                [{
                    "label": "Requested text",
                    "old": old_value.strip(),
                    "new": replacement,
                }],
            )
    return source, []


def _apply_field_change(source: str, *, question: str, matched_text: str, replacement: str) -> Optional[Tuple[str, List[Dict[str, str]]]]:
    haystack = f"{question}\n{matched_text}".lower()
    field_patterns = [
        (
            "Agreement Number",
            ("agreement number", "contract number", "agreement no", "contract no"),
            [r"(?im)^(?P<prefix>\s*(?:AGREEMENT|CONTRACT)\s+(?:NUMBER|NO\.?)\s*:\s*)(?P<value>[^\r\n]+)"],
        ),
        (
            "Effective Date",
            ("effective date",),
            [r"(?im)^(?P<prefix>\s*EFFECTIVE\s+DATE\s*:\s*)(?P<value>[^\r\n]+)"],
        ),
        (
            "Expiration Date",
            ("expiration date", "expiry date"),
            [r"(?im)^(?P<prefix>\s*(?:EXPIRATION|EXPIRY)\s+DATE\s*:\s*)(?P<value>[^\r\n]+)"],
        ),
    ]
    for label, aliases, patterns in field_patterns:
        if not any(alias in haystack for alias in aliases):
            continue
        for pattern in patterns:
            match = re.search(pattern, source)
            if not match:
                continue
            old_value = match.group("value").strip()
            start, end = match.span("value")
            return (
                f"{source[:start]}{replacement}{source[end:]}",
                [{
                    "label": label,
                    "old": old_value,
                    "new": replacement,
                }],
            )
    return None


def _applied_change_summary(changes: List[Dict[str, str]], *, fallback: str = "") -> str:
    lines = ["Applied change summary:"]
    for change in changes:
        label = change.get("label") or "Field"
        old = change.get("old") or "[empty]"
        new = change.get("new") or "[empty]"
        lines.append(f"- {label}: {old} -> {new}")
    if fallback and not _is_approval_boilerplate(fallback):
        lines.extend(["", "Assistant note:", fallback])
    return "\n".join(lines).strip()


def _fallback_amendment_summary(question: str) -> str:
    cleaned = clean_text_encoding(question or "").strip()
    return f"Requested change: {cleaned}" if cleaned else "Requested change approved by the user."


def _is_approval_boilerplate(text: str) -> bool:
    lowered = (text or "").lower()
    return bool(
        "requires human approval before execution" in lowered
        or "review the parameters and confirm" in lowered
        or lowered.startswith("action '")
    )


def _source_contract_starts_next_page(source: str) -> str:
    stripped = source.strip()
    if re.match(r"^\[\[DOCX_PAGE:\d+\]\]", stripped):
        return stripped
    return f"[[DOCX_PAGE:1]]\n{stripped}"


def render_minimal_docx(*, title: str, body: str, landscape: bool = False) -> bytes:
    document_xml = _document_xml(title, body, landscape=landscape)
    out = BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", _content_types_xml())
        package.writestr("_rels/.rels", _rels_xml())
        package.writestr("word/_rels/document.xml.rels", _document_rels_xml())
        package.writestr("word/styles.xml", _styles_xml())
        package.writestr("word/settings.xml", _settings_xml())
        package.writestr("word/fontTable.xml", _font_table_xml())
        package.writestr("word/document.xml", document_xml)
    return out.getvalue()


def render_redline_docx(
    *,
    title: str,
    source_text: str,
    document_name: str,
    changes: List[RedlineChange],
) -> RedlineRenderResult:
    """Render a DOCX with real Word tracked-change insertions/deletions.

    Source contracts are immutable PDFs/indexed text in this app, so this
    produces a separate Word redline copy. Each matched clause is represented
    with a tracked deletion followed by a tracked insertion.
    """
    cleaned_source = _clean_source_contract_text(source_text)
    planned_changes = _plan_redline_changes(cleaned_source, changes)
    _attach_redline_revision_ids(planned_changes, cleaned_source)
    document_xml = _redline_document_xml(
        title=title,
        document_name=document_name,
        source_text=cleaned_source,
        changes=planned_changes,
    )
    out = BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("[Content_Types].xml", _content_types_xml())
        package.writestr("_rels/.rels", _rels_xml())
        package.writestr("word/_rels/document.xml.rels", _document_rels_xml())
        package.writestr("word/styles.xml", _styles_xml())
        package.writestr("word/settings.xml", _redline_settings_xml())
        package.writestr("word/fontTable.xml", _font_table_xml())
        package.writestr("word/document.xml", document_xml)
    return RedlineRenderResult(
        docx_bytes=out.getvalue(),
        applied_changes=[change["summary"] for change in planned_changes if change.get("applied")],
        unmatched_changes=[change["summary"] for change in planned_changes if not change.get("applied")],
    )


def _attach_redline_revision_ids(planned_changes: List[Dict[str, Any]], source_text: str) -> None:
    revision_id = 1
    for change in sorted([item for item in planned_changes if item.get("applied")], key=lambda item: item["start"]):
        replacement = str(change.get("replacement") or "")
        start = int(change["start"])
        end = int(change["end"])
        summary = change.setdefault("summary", {})
        summary["change_id"] = f"contractsense-redline-{revision_id}"
        summary["del_w_id"] = str(revision_id)
        summary["ins_w_id"] = str(revision_id) if replacement else None
        summary["deleted_text"] = source_text[start:end]
        summary["inserted_text"] = replacement
        revision_id += 1


def apply_tracked_edits_to_docx(
    docx_bytes: bytes,
    edits: List[TrackedEditInput],
    *,
    author: str = "ContractSense",
) -> TrackedEditApplyResult:
    """Apply precise substitutions to a DOCX as Word tracked changes."""
    if not edits:
        return TrackedEditApplyResult(docx_bytes=docx_bytes, annotations=[], errors=[{"index": 0, "reason": "edits array is empty"}])

    files = read_docx_package_files(docx_bytes)
    document_xml = files.get("word/document.xml")
    if not document_xml:
        return TrackedEditApplyResult(docx_bytes=docx_bytes, annotations=[], errors=[{"index": 0, "reason": "document.xml missing from docx"}])

    root = parse_docx_xml(document_xml)
    paragraphs = list(root.iter(_w_tag("p")))
    paragraph_texts = [_paragraph_accepted_text(paragraph) for paragraph in paragraphs]
    max_w_id = _max_tracked_change_id(root)
    next_w_id = max_w_id + 1
    plans_by_paragraph: Dict[int, List[Dict[str, Any]]] = {}
    annotations: List[TrackedEditAnnotation] = []
    errors: List[Dict[str, Any]] = []

    for edit_index, edit in enumerate(edits):
        find = clean_text_encoding(edit.find or "")
        replace = clean_text_encoding(edit.replace or "")
        if not find and not replace:
            errors.append({"index": edit_index, "reason": "empty edit"})
            continue
        if not find:
            errors.append({"index": edit_index, "reason": "pure insertion requires matched text in ContractSense MVP"})
            continue

        hit = _find_unique_tracked_edit_hit(
            paragraph_texts,
            find=find,
            context_before=edit.context_before,
            context_after=edit.context_after,
        )
        if hit.get("error"):
            errors.append({"index": edit_index, "reason": hit["error"], "find": find})
            continue

        paragraph_index = int(hit["paragraph_index"])
        start = int(hit["start"])
        end = int(hit["end"])
        existing = plans_by_paragraph.get(paragraph_index, [])
        if any(start < plan["end"] and end > plan["start"] for plan in existing):
            errors.append({"index": edit_index, "reason": "overlaps another edit in the same paragraph", "find": find})
            continue

        deleted_text = paragraph_texts[paragraph_index][start:end]
        change_id = f"contractsense-{uuid4().hex[:12]}"
        del_w_id = str(next_w_id) if deleted_text else None
        next_w_id += 1 if deleted_text else 0
        ins_w_id = str(next_w_id) if replace else None
        next_w_id += 1 if replace else 0
        plan = {
            "start": start,
            "end": end,
            "deleted_text": deleted_text,
            "inserted_text": replace,
            "change_id": change_id,
            "del_w_id": del_w_id,
            "ins_w_id": ins_w_id,
            "reason": edit.reason,
        }
        existing.append(plan)
        plans_by_paragraph[paragraph_index] = sorted(existing, key=lambda item: item["start"])
        annotations.append(
            TrackedEditAnnotation(
                change_id=change_id,
                del_w_id=del_w_id,
                ins_w_id=ins_w_id,
                deleted_text=deleted_text,
                inserted_text=replace,
                context_before=edit.context_before,
                context_after=edit.context_after,
                reason=edit.reason,
            )
        )

    for paragraph_index, plans in plans_by_paragraph.items():
        _rewrite_paragraph_with_tracked_edits(
            paragraphs[paragraph_index],
            paragraph_texts[paragraph_index],
            plans,
            author=author,
        )

    if not annotations:
        return TrackedEditApplyResult(docx_bytes=docx_bytes, annotations=[], errors=errors)

    files["word/document.xml"] = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
    return TrackedEditApplyResult(docx_bytes=_zip_docx_files(files), annotations=annotations, errors=errors)


def resolve_tracked_changes_in_docx(
    docx_bytes: bytes,
    *,
    change_ids: List[str],
    mode: str,
) -> Tuple[bytes, bool]:
    """Accept or reject tracked changes by Word w:id values."""
    wanted = {str(value) for value in change_ids if value}
    if mode not in {"accept", "reject"} or not wanted:
        return docx_bytes, False

    files = read_docx_package_files(docx_bytes)
    document_xml = files.get("word/document.xml")
    if not document_xml:
        return docx_bytes, False

    root = parse_docx_xml(document_xml)
    found = _resolve_tracked_change_children(root, wanted=wanted, mode=mode)
    if not found:
        return docx_bytes, False
    files["word/document.xml"] = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
    return _zip_docx_files(files), True


def tracked_change_ids_from_docx(docx_bytes: bytes) -> List[Dict[str, str]]:
    document_xml = read_docx_xml_file(docx_bytes, "word/document.xml")
    root = parse_docx_xml(document_xml)
    ids: List[Dict[str, str]] = []
    for element in root.iter():
        if element.tag not in {_w_tag("ins"), _w_tag("del")}:
            continue
        w_id = element.attrib.get(_w_tag("id"))
        if w_id:
            ids.append({"kind": "ins" if element.tag == _w_tag("ins") else "del", "w_id": str(w_id)})
    return ids


def _paragraph_accepted_text(paragraph: ElementTree.Element) -> str:
    parts: List[str] = []
    for node in paragraph.iter():
        if node.tag == _w_tag("del"):
            continue
        if node.tag in {_w_tag("t"), _w_tag("delText")} and node.text:
            # Deleted text is only visible when rejecting an existing deletion.
            if node.tag == _w_tag("delText"):
                continue
            parts.append(node.text)
        elif node.tag == _w_tag("tab"):
            parts.append("\t")
        elif node.tag == _w_tag("br"):
            parts.append("\n")
    return "".join(parts)


def _find_unique_tracked_edit_hit(
    paragraph_texts: List[str],
    *,
    find: str,
    context_before: str,
    context_after: str,
) -> Dict[str, Any]:
    find_normalized, _ = _normalized_with_map(find)
    before_normalized, _ = _normalized_with_map(context_before or "")
    after_normalized, _ = _normalized_with_map(context_after or "")
    if not find_normalized:
        return {"error": "empty find text"}

    hits: List[Dict[str, int]] = []
    for paragraph_index, text in enumerate(paragraph_texts):
        normalized, index_map = _normalized_with_map(text)
        position = normalized.find(find_normalized)
        while position >= 0:
            end_norm = position + len(find_normalized)
            before_ok = not before_normalized or normalized[:position].rstrip().endswith(before_normalized)
            after_ok = not after_normalized or normalized[end_norm:].lstrip().startswith(after_normalized)
            if before_ok and after_ok:
                original_start = index_map[position]
                original_end = index_map[min(end_norm - 1, len(index_map) - 1)] + 1
                hits.append({"paragraph_index": paragraph_index, "start": original_start, "end": original_end})
            position = normalized.find(find_normalized, position + max(1, len(find_normalized)))

    if not hits:
        return {"error": "matched text was not found with the provided context"}
    if len(hits) > 1:
        return {"error": "matched text is ambiguous; provide more context_before/context_after"}
    return hits[0]


def _max_tracked_change_id(root: ElementTree.Element) -> int:
    max_id = 0
    for element in root.iter():
        if element.tag not in {_w_tag("ins"), _w_tag("del")}:
            continue
        raw_id = element.attrib.get(_w_tag("id"))
        if raw_id and raw_id.isdigit():
            max_id = max(max_id, int(raw_id))
    return max_id


def _rewrite_paragraph_with_tracked_edits(
    paragraph: ElementTree.Element,
    text: str,
    plans: List[Dict[str, Any]],
    *,
    author: str,
) -> None:
    ppr = paragraph.find(_w_tag("pPr"))
    for child in list(paragraph):
        paragraph.remove(child)
    if ppr is not None:
        paragraph.append(ppr)

    cursor = 0
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    for plan in plans:
        start = int(plan["start"])
        end = int(plan["end"])
        if start > cursor:
            paragraph.append(_word_run_element(text[cursor:start]))
        deleted = text[start:end]
        inserted = str(plan.get("inserted_text") or "")
        if deleted and plan.get("del_w_id"):
            deletion = ElementTree.Element(_w_tag("del"), {
                _w_tag("id"): str(plan["del_w_id"]),
                _w_tag("author"): author,
                _w_tag("date"): now,
            })
            deletion.append(_word_run_element(deleted, deleted=True, color="C00000", strike=True))
            paragraph.append(deletion)
        if inserted and plan.get("ins_w_id"):
            insertion = ElementTree.Element(_w_tag("ins"), {
                _w_tag("id"): str(plan["ins_w_id"]),
                _w_tag("author"): author,
                _w_tag("date"): now,
            })
            insertion.append(_word_run_element(inserted, color="008A3D", underline=True))
            paragraph.append(insertion)
        cursor = end
    if cursor < len(text):
        paragraph.append(_word_run_element(text[cursor:]))


def _word_run_element(
    text: str,
    *,
    deleted: bool = False,
    color: str = "000000",
    strike: bool = False,
    underline: bool = False,
) -> ElementTree.Element:
    run = ElementTree.Element(_w_tag("r"))
    rpr = ElementTree.SubElement(run, _w_tag("rPr"))
    ElementTree.SubElement(rpr, _w_tag("rFonts"), {
        _w_tag("ascii"): DOCX_FONT,
        _w_tag("hAnsi"): DOCX_FONT,
        _w_tag("eastAsia"): DOCX_FONT,
        _w_tag("cs"): DOCX_FONT,
    })
    ElementTree.SubElement(rpr, _w_tag("sz"), {_w_tag("val"): "22"})
    ElementTree.SubElement(rpr, _w_tag("szCs"), {_w_tag("val"): "22"})
    ElementTree.SubElement(rpr, _w_tag("color"), {_w_tag("val"): color})
    if strike:
        ElementTree.SubElement(rpr, _w_tag("strike"))
    if underline:
        ElementTree.SubElement(rpr, _w_tag("u"), {_w_tag("val"): "single"})
    text_el = ElementTree.SubElement(run, _w_tag("delText" if deleted else "t"))
    text_el.attrib["{http://www.w3.org/XML/1998/namespace}space"] = "preserve"
    text_el.text = text
    return run


def _resolve_tracked_change_children(
    parent: ElementTree.Element,
    *,
    wanted: set[str],
    mode: str,
) -> bool:
    found = False
    for child in list(parent):
        if child.tag in {_w_tag("ins"), _w_tag("del")} and str(child.attrib.get(_w_tag("id")) or "") in wanted:
            found = True
            index = list(parent).index(child)
            parent.remove(child)
            keep_children = (
                (child.tag == _w_tag("ins") and mode == "accept")
                or (child.tag == _w_tag("del") and mode == "reject")
            )
            if keep_children:
                replacement_children = list(child)
                if child.tag == _w_tag("del"):
                    for node in replacement_children:
                        _convert_deleted_text_to_normal_text(node)
                for offset, replacement in enumerate(replacement_children):
                    parent.insert(index + offset, replacement)
            continue
        if _resolve_tracked_change_children(child, wanted=wanted, mode=mode):
            found = True
    return found


def _convert_deleted_text_to_normal_text(node: ElementTree.Element) -> None:
    if node.tag == _w_tag("delText"):
        node.tag = _w_tag("t")
    for child in list(node):
        _convert_deleted_text_to_normal_text(child)


def _zip_docx_files(files: Dict[str, bytes]) -> bytes:
    out = BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as package:
        for name, content in files.items():
            package.writestr(name, content)
    return out.getvalue()


def _should_render_landscape(question: str, answer: str, draft_type: str) -> bool:
    haystack = f"{question}\n{answer}".lower()
    return bool(
        draft_type == "checklist"
        or "landscape" in haystack
        or re.search(r"\b(cp checklist|conditions precedent|closing checklist)\b", haystack)
    )


def _first_heading(text: str) -> Optional[str]:
    for line in clean_text_encoding(text or "").splitlines():
        trimmed = line.strip()
        if not trimmed:
            continue
        match = re.match(r"^#{1,3}\s+(.+)$", trimmed)
        if match:
            return _clean_heading(match.group(1))
        if re.match(r"^\*\*[^*]{4,120}\*\*:?\s*$", trimmed):
            return _clean_heading(trimmed)
    return None


def _clean_heading(value: str) -> str:
    value = re.sub(r"\*\*", "", value)
    value = re.sub(r"\[(?:\d+)(?:\s*,\s*\d+)*\]", "", value)
    return re.sub(r"\s+", " ", value).strip(" :-")


def _strip_hidden_citations(text: str) -> str:
    text = re.sub(r"<\s*CITATIONS\s*>[\s\S]*?<\s*/\s*CITATIONS\s*>", "", text, flags=re.IGNORECASE)
    return re.sub(r"<\s*CITATIONS\b[\s\S]*$", "", text, flags=re.IGNORECASE)


def _strip_sources_section(text: str) -> str:
    lines = text.splitlines()
    kept = []
    for line in lines:
        if line.strip().lower() == "sources":
            break
        kept.append(line)
    return "\n".join(kept)


def _extract_work_product_section(text: str) -> str:
    lines = text.splitlines()
    start_index: Optional[int] = None
    for index, line in enumerate(lines):
        normalized = line.strip().lower()
        if not normalized:
            continue
        if re.search(r"\b(sample amendment|proposed amendment|amendment to|approval note|proposed language|replacement language|draft clause)\b", normalized):
            start_index = index
            break

    if start_index is None:
        return ""

    stop_patterns = (
        r"^use the above\b",
        r"^insert the amendment\b",
        r"^bottom line\b",
        r"^what this means\b",
        r"^sources\b",
    )
    selected = []
    for line in lines[start_index:]:
        normalized = line.strip().lower()
        if selected and any(re.search(pattern, normalized) for pattern in stop_patterns):
            break
        selected.append(line)

    candidate = "\n".join(selected).strip()
    return candidate if len(candidate) >= 40 else ""


def _normalize_artifact_text(text: str) -> str:
    text = clean_text_encoding(text or "")
    text = re.sub(r"ã\s*(\d+)\s*ã", r"[\1]", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _wants_edited_contract_copy(question: str, answer: str, draft_type: str) -> bool:
    haystack = f"{question}\n{answer}".lower()
    if draft_type == "edit_suggestions":
        return True
    return bool(
        re.search(r"\b(change|replace|revise|edit|amend|apply)\b", haystack)
        and re.search(r"\b(contract|agreement|supplier|party|vendor|customer|name|copy)\b", haystack)
    )


def _clean_work_product_for_copy(text: str) -> str:
    cleaned = _normalize_artifact_text(text)
    cleaned = _strip_hidden_citations(cleaned)
    cleaned = _strip_sources_section(cleaned)
    cleaned = re.sub(r"\[(?:\d+)(?:\s*,\s*\d+)*\]", "", cleaned)
    cleaned = re.sub(r"^\*\*Proposed amendment\*\*\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^Proposed amendment\s*", "", cleaned, flags=re.IGNORECASE)
    return cleaned.strip()


def _clean_source_contract_text(text: str) -> str:
    cleaned = clean_text_encoding(text or "")
    cleaned = _strip_hidden_citations(cleaned)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\[\[PAGE_BREAK\]\]", "\n\n", cleaned)
    cleaned = re.sub(r"^\s*---\s*Page\s+(\d+)\s*---\s*$", r"[[DOCX_PAGE:\1]]", cleaned, flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r"^\s*\[Page\s+(\d+)\]\s*$", r"[[DOCX_PAGE:\1]]", cleaned, flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = cleaned.strip()
    cleaned = _drop_web_wrapper_before_contract(cleaned)
    # Guard against pathological extracted text while still creating a real
    # full-document copy for normal contracts.
    return cleaned[:120000]


def _drop_web_wrapper_before_contract(text: str) -> str:
    lines = text.splitlines()
    first_page_token = ""
    for line in lines[:8]:
        if re.match(r"^\[\[DOCX_PAGE:\d+\]\]$", line.strip()):
            first_page_token = line.strip()
            break

    for index, line in enumerate(lines[:80]):
        if re.match(r"^EX-\d", line.strip(), flags=re.IGNORECASE):
            trimmed = lines[index:]
            if first_page_token and (not trimmed or trimmed[0].strip() != first_page_token):
                trimmed = [first_page_token, *trimmed]
            return "\n".join(trimmed).strip()
    return text


def _safe_filename(title: str, suffix: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9 _.-]+", "", title or "").strip()
    safe = re.sub(r"\s+", " ", safe)[:80].strip(" ._-")
    return f"{safe or 'Contract Work Product'}{suffix}"


def _content_types_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
</Types>"""


def _rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""


def _document_rels_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
</Relationships>"""


def _styles_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="{DOCX_FONT}" w:hAnsi="{DOCX_FONT}" w:eastAsia="{DOCX_FONT}" w:cs="{DOCX_FONT}"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
        <w:color w:val="000000"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="120" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:spacing w:after="120" w:line="276" w:lineRule="auto"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="{DOCX_FONT}" w:hAnsi="{DOCX_FONT}" w:eastAsia="{DOCX_FONT}" w:cs="{DOCX_FONT}"/>
      <w:sz w:val="22"/>
      <w:szCs w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:after="360"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="{DOCX_FONT}" w:hAnsi="{DOCX_FONT}" w:eastAsia="{DOCX_FONT}" w:cs="{DOCX_FONT}"/>
      <w:b/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="240" w:after="160"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="{DOCX_FONT}" w:hAnsi="{DOCX_FONT}" w:eastAsia="{DOCX_FONT}" w:cs="{DOCX_FONT}"/>
      <w:b/>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>
</w:styles>"""


def _settings_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="720"/>
  <w:compat/>
</w:settings>"""


def _font_table_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="{DOCX_FONT}">
    <w:family w:val="roman"/>
    <w:pitch w:val="variable"/>
  </w:font>
</w:fonts>"""


def _document_xml(title: str, body: str, *, landscape: bool = False) -> str:
    paragraphs = [_paragraph(title.upper(), bold=True, size=28, alignment="center", spacing_after=360, style="Title")]
    for kind, value in _markdown_blocks(body):
        if kind == "page_break":
            paragraphs.append(_page_break_paragraph())
        elif kind == "page_label":
            paragraphs.append(_paragraph(f"Source page {value}", size=18, italic=True, alignment="right", spacing_after=180))
        elif kind == "table":
            table = value if isinstance(value, dict) else {}
            paragraphs.append(_table_xml(table.get("headers") or [], table.get("rows") or []))
        elif kind == "source_meta":
            paragraphs.append(_paragraph(value, size=20, spacing_after=80, alignment="left"))
        elif kind == "source_exhibit":
            paragraphs.append(_paragraph(value, bold=True, size=22, alignment="right", spacing_after=180))
        elif kind == "source_center":
            paragraphs.append(_paragraph(value, bold=True, size=22, alignment="center", spacing_after=80))
        elif kind == "heading":
            paragraphs.append(_paragraph(value, bold=True, size=24, spacing_before=240, spacing_after=160, style="Heading1"))
        elif kind == "bullet":
            paragraphs.append(_paragraph(f"- {value}", size=22, indent=720, hanging=360, spacing_after=80, alignment="both"))
        elif kind == "numbered":
            paragraphs.append(_paragraph(value, size=22, indent=720, hanging=360, spacing_after=80, alignment="both"))
        else:
            paragraphs.append(_paragraph(value, size=22, spacing_after=120, alignment="both"))

    body_xml = "\n".join(paragraphs)
    page_size = (
        '<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/>'
        if landscape
        else '<w:pgSz w:w="12240" w:h="15840"/>'
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:xml="http://www.w3.org/XML/1998/namespace">
  <w:body>
    {body_xml}
    <w:sectPr>
      {page_size}
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"""


def _markdown_blocks(body: str):
    lines = body.splitlines()
    index = 0
    while index < len(lines):
        raw_line = lines[index]
        line = raw_line.strip()
        if not line:
            index += 1
            continue
        line = re.sub(r"^>\s*", "", line).strip()
        table = _parse_markdown_table(lines, index)
        if table:
            headers, rows, next_index = table
            yield "table", {"headers": headers, "rows": rows}
            index = next_index
            continue
        page_marker = re.match(r"^\[\[DOCX_PAGE:(\d+)\]\]$", line)
        if page_marker:
            yield "page_break", ""
            yield "page_label", page_marker.group(1)
            index += 1
            continue
        if line.lower() in {"amendment / applied change", "converted source contract text"}:
            yield "heading", _clean_inline_markdown(line)
            index += 1
            continue
        if re.match(r"^EX-\d", line, flags=re.IGNORECASE):
            yield "source_meta", _clean_inline_markdown(line)
            index += 1
            continue
        if re.match(r"^Exhibit\s+\d", line, flags=re.IGNORECASE):
            yield "source_exhibit", _clean_inline_markdown(line)
            index += 1
            continue
        if _looks_like_centered_contract_line(line):
            yield "source_center", _clean_inline_markdown(line)
            index += 1
            continue
        if re.match(r"^[A-Z][A-Za-z ]{3,60}:$", line):
            yield "heading", _clean_inline_markdown(line.rstrip(":"))
            index += 1
            continue
        heading = re.match(r"^#{1,4}\s+(.+)$", line)
        if heading:
            yield "heading", _clean_inline_markdown(heading.group(1))
            index += 1
            continue
        bold_heading = re.match(r"^\*\*([^*]{3,120})\*\*:?\s*$", line)
        if bold_heading:
            yield "heading", _clean_inline_markdown(bold_heading.group(1))
            index += 1
            continue
        bullet = re.match(r"^[-*•●]\s+(.+)$", line)
        if bullet:
            yield "bullet", _clean_inline_markdown(bullet.group(1))
            index += 1
            continue
        numbered = re.match(r"^(\d+[.)])\s+(.+)$", line)
        if numbered:
            yield "numbered", f"{numbered.group(1)} {_clean_inline_markdown(numbered.group(2))}"
            index += 1
            continue
        yield "paragraph", _clean_inline_markdown(line)
        index += 1


def _parse_markdown_table(lines: list[str], index: int) -> Optional[tuple[list[str], list[list[str]], int]]:
    if index + 1 >= len(lines):
        return None
    header_line = lines[index].strip()
    separator_line = lines[index + 1].strip()
    if "|" not in header_line:
        return None
    if not re.match(r"^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$", separator_line):
        return None

    headers = [_clean_inline_markdown(cell) for cell in header_line.strip("|").split("|")]
    headers = [header for header in headers if header]
    if not headers:
        return None

    rows: list[list[str]] = []
    cursor = index + 2
    while cursor < len(lines):
        row_line = lines[cursor].strip()
        if not row_line or "|" not in row_line:
            break
        if re.match(r"^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$", row_line):
            cursor += 1
            continue
        raw_cells = [_clean_inline_markdown(cell) for cell in row_line.strip("|").split("|")]
        row = [raw_cells[i] if i < len(raw_cells) else "" for i in range(len(headers))]
        rows.append(row)
        cursor += 1

    return headers, rows, cursor


def _looks_like_centered_contract_line(line: str) -> bool:
    cleaned = _clean_inline_markdown(line)
    if not cleaned or len(cleaned) > 95:
        return False
    if re.match(r"^[A-Z][a-z]+ \d{1,2}, \d{4}$", cleaned):
        return True
    centered_phrases = (
        "Cascade Natural Gas Corporation",
        "Key Performance Incentive Plan",
    )
    return any(phrase in cleaned for phrase in centered_phrases)


def _clean_inline_markdown(value: str) -> str:
    value = _normalize_artifact_text(value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
    value = re.sub(r"\*([^*]+)\*", r"\1", value)
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    value = re.sub(r"\[(?:\d+)(?:\s*,\s*\d+)*\]", "", value)
    return re.sub(r"\s+", " ", clean_text_encoding(value)).strip()


def _redline_settings_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:trackRevisions/>
  <w:defaultTabStop w:val="720"/>
  <w:compat/>
</w:settings>"""


def _plan_redline_changes(source_text: str, changes: List[RedlineChange]) -> List[Dict[str, Any]]:
    planned: List[Dict[str, Any]] = []
    occupied: List[Tuple[int, int]] = []

    for change in changes:
        matched = _clean_redline_match_text(change.matched_text)
        suggested = _clean_redline_revision_text(change.suggested_revision)
        summary = {
            "finding_id": change.finding_id,
            "rule_name": change.rule_name,
            "status": change.status,
            "matched_text": matched,
            "suggested_revision": suggested,
        }
        if not matched:
            planned.append({"applied": False, "summary": {**summary, "reason": "missing matched text"}})
            continue

        span = _find_next_available_flexible_span(source_text, matched, occupied)
        if not span:
            planned.append({"applied": False, "summary": {**summary, "reason": "matched text was not found in source text"}})
            continue

        start, end = span
        if any(start < used_end and end > used_start for used_start, used_end in occupied):
            planned.append({"applied": False, "summary": {**summary, "reason": "overlaps another redline"}})
            continue

        occupied.append((start, end))
        planned.append({
            "applied": True,
            "start": start,
            "end": end,
            "replacement": suggested,
            "summary": {
                **summary,
                "source_excerpt": source_text[start:end],
            },
        })

    planned.sort(key=lambda item: (0, item["start"]) if item.get("applied") else (1, 0))
    return planned


def _clean_redline_match_text(value: str) -> str:
    text = clean_text_encoding(value or "")
    quote_matches = re.findall(r"\[\[\s*page\s*:\s*[^|\]]+\|\|\s*quote\s*:\s*([^\]]+)\]\]", text, flags=re.IGNORECASE)
    if quote_matches:
        text = " ".join(quote_matches)
    text = re.sub(r"\[\[[^\]]+\]\]", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.strip().strip('"“”')
    return re.sub(r"\s+", " ", text).strip()


def _clean_redline_revision_text(value: str) -> str:
    text = clean_text_encoding(value or "")
    text = re.sub(r"\[\[[^\]]+\]\]", " ", text)
    text = re.sub(r"\[(?:\d+)(?:\s*,\s*\d+)*\]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _normalized_with_map(value: str) -> Tuple[str, List[int]]:
    normalized_chars: List[str] = []
    index_map: List[int] = []
    last_was_space = False
    for index, char in enumerate(value or ""):
        if char.isspace():
            if normalized_chars and not last_was_space:
                normalized_chars.append(" ")
                index_map.append(index)
                last_was_space = True
            continue
        normalized_chars.append(char.lower())
        index_map.append(index)
        last_was_space = False
    while normalized_chars and normalized_chars[-1] == " ":
        normalized_chars.pop()
        index_map.pop()
    return "".join(normalized_chars), index_map


def _find_flexible_span(source_text: str, needle: str) -> Optional[Tuple[int, int]]:
    if not source_text or not needle:
        return None
    source_normalized, source_map = _normalized_with_map(source_text)
    needle_normalized, _ = _normalized_with_map(needle)
    if not needle_normalized:
        return None

    position = source_normalized.find(needle_normalized)
    if position < 0 and len(needle_normalized) > 220:
        position = source_normalized.find(needle_normalized[:220])
    if position < 0 and len(needle_normalized) > 120:
        position = source_normalized.find(needle_normalized[:120])
    if position < 0:
        return None

    end_position = min(position + len(needle_normalized) - 1, len(source_map) - 1)
    return source_map[position], source_map[end_position] + 1


def _find_next_available_flexible_span(
    source_text: str,
    needle: str,
    occupied: List[Tuple[int, int]],
) -> Optional[Tuple[int, int]]:
    if not source_text or not needle:
        return None
    source_normalized, source_map = _normalized_with_map(source_text)
    needle_normalized, _ = _normalized_with_map(needle)
    if not needle_normalized:
        return None

    candidate_lengths = [len(needle_normalized)]
    if len(needle_normalized) > 220:
        candidate_lengths.append(220)
    if len(needle_normalized) > 120:
        candidate_lengths.append(120)

    for candidate_length in candidate_lengths:
        query = needle_normalized[:candidate_length]
        position = source_normalized.find(query)
        while position >= 0:
            end_position = min(position + candidate_length - 1, len(source_map) - 1)
            span = (source_map[position], source_map[end_position] + 1)
            if not any(span[0] < used_end and span[1] > used_start for used_start, used_end in occupied):
                return span
            position = source_normalized.find(query, position + max(1, candidate_length))
    return None


def _count_flexible_occurrences(source_text: str, needle: str, *, limit: int = 12) -> int:
    if not source_text or not needle:
        return 0
    source_normalized, _ = _normalized_with_map(source_text)
    needle_normalized, _ = _normalized_with_map(needle)
    if not needle_normalized:
        return 0

    count = 0
    position = source_normalized.find(needle_normalized)
    while position >= 0 and count < limit:
        count += 1
        position = source_normalized.find(needle_normalized, position + max(1, len(needle_normalized)))
    return count


def _redline_document_xml(
    *,
    title: str,
    document_name: str,
    source_text: str,
    changes: List[Dict[str, Any]],
) -> str:
    applied = [change for change in changes if change.get("applied")]
    unmatched = [change for change in changes if not change.get("applied")]
    paragraphs = [
        _paragraph(title.upper(), bold=True, size=28, alignment="center", spacing_after=240, style="Title"),
    ]
    if not applied:
        paragraphs.append(_paragraph(f"No tracked changes could be applied to {document_name or 'the source document'}.", italic=True, size=20, spacing_after=220))
    paragraphs.extend(_redline_source_paragraphs(source_text, applied))
    if unmatched:
        paragraphs.append(_page_break_paragraph())
        paragraphs.append(_paragraph("Unmatched Suggestions", bold=True, size=24, spacing_before=160, spacing_after=160, style="Heading1"))
        for change in unmatched:
            summary = change.get("summary") or {}
            paragraphs.append(_paragraph(summary.get("rule_name") or "Unmatched rule", bold=True, size=22, spacing_after=80))
            if summary.get("matched_text"):
                paragraphs.append(_paragraph(f"Matched text: {summary.get('matched_text')}", size=20, spacing_after=80))
            if summary.get("suggested_revision"):
                paragraphs.append(_paragraph(f"Suggested revision: {summary.get('suggested_revision')}", size=20, spacing_after=80))
            if summary.get("reason"):
                paragraphs.append(_paragraph(f"Reason: {summary.get('reason')}", italic=True, size=18, spacing_after=160))

    body_xml = "\n".join(paragraphs)
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:xml="http://www.w3.org/XML/1998/namespace">
  <w:body>
    {body_xml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>"""


def _redline_source_paragraphs(source_text: str, applied_changes: List[Dict[str, Any]]) -> List[str]:
    parts: List[Tuple[str, str, int]] = []
    cursor = 0
    revision_id = 1
    for change in sorted(applied_changes, key=lambda item: item["start"]):
        start = int(change["start"])
        end = int(change["end"])
        if start > cursor:
            parts.append(("normal", source_text[cursor:start], 0))
        parts.append(("delete", source_text[start:end], revision_id))
        parts.append(("insert", str(change.get("replacement") or ""), revision_id))
        cursor = end
        revision_id += 1
    if cursor < len(source_text):
        parts.append(("normal", source_text[cursor:], 0))

    paragraphs: List[str] = []
    current_runs: List[str] = []
    for kind, text, change_id in parts:
        chunks = re.split(r"(\n+)", text or "")
        for chunk in chunks:
            if not chunk:
                continue
            if chunk.startswith("\n"):
                if current_runs:
                    paragraphs.append(_redline_paragraph(current_runs))
                    current_runs = []
                blank_count = max(0, chunk.count("\n") - 1)
                for _ in range(min(blank_count, 2)):
                    paragraphs.append(_redline_paragraph([]))
                continue
            current_runs.append(_redline_run(kind, chunk, change_id))
    if current_runs:
        paragraphs.append(_redline_paragraph(current_runs))
    return paragraphs or [_paragraph("No source text available.", italic=True, size=20)]


def _redline_paragraph(runs: List[str]) -> str:
    return (
        "<w:p>"
        '<w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>'
        f"{''.join(runs)}"
        "</w:p>"
    )


def _redline_run(kind: str, text: str, change_id: int) -> str:
    if not text:
        return ""
    date = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    if kind == "delete":
        return (
            f'<w:del w:id="{change_id}" w:author="ContractSense" w:date="{date}">'
            f"{_run_xml(text, deleted=True, color='C00000', strike=True)}"
            "</w:del>"
        )
    if kind == "insert":
        return (
            f'<w:ins w:id="{change_id}" w:author="ContractSense" w:date="{date}">'
            f"{_run_xml(text, color='008A3D', underline=True)}"
            "</w:ins>"
        )
    return _run_xml(text)


def _run_xml(
    text: str,
    *,
    deleted: bool = False,
    color: str = "000000",
    strike: bool = False,
    underline: bool = False,
) -> str:
    tag = "w:delText" if deleted else "w:t"
    rpr = [
        f'<w:rFonts w:ascii="{DOCX_FONT}" w:hAnsi="{DOCX_FONT}" w:eastAsia="{DOCX_FONT}" w:cs="{DOCX_FONT}"/>',
        '<w:sz w:val="22"/>',
        '<w:szCs w:val="22"/>',
        f'<w:color w:val="{color}"/>',
    ]
    if strike:
        rpr.append("<w:strike/>")
    if underline:
        rpr.append('<w:u w:val="single"/>')
    return (
        "<w:r>"
        f"<w:rPr>{''.join(rpr)}</w:rPr>"
        f'<{tag} xml:space="preserve">{escape(text)}</{tag}>'
        "</w:r>"
    )


def _paragraph(
    text: str,
    *,
    bold: bool = False,
    italic: bool = False,
    size: int = 22,
    alignment: Optional[str] = None,
    indent: int = 0,
    hanging: int = 0,
    spacing_before: int = 0,
    spacing_after: int = 120,
    style: Optional[str] = None,
) -> str:
    ppr_parts = []
    if style:
        ppr_parts.append(f'<w:pStyle w:val="{style}"/>')
    ppr_parts.append(f'<w:spacing w:before="{spacing_before}" w:after="{spacing_after}" w:line="276" w:lineRule="auto"/>')
    if alignment:
        ppr_parts.append(f'<w:jc w:val="{alignment}"/>')
    if indent:
        hanging_attr = f' w:hanging="{hanging}"' if hanging else ""
        ppr_parts.append(f'<w:ind w:left="{indent}"{hanging_attr}/>')
    rpr_parts = [
        f'<w:rFonts w:ascii="{DOCX_FONT}" w:hAnsi="{DOCX_FONT}" w:eastAsia="{DOCX_FONT}" w:cs="{DOCX_FONT}"/>',
        f'<w:sz w:val="{size}"/>',
        f'<w:szCs w:val="{size}"/>',
        '<w:color w:val="000000"/>',
    ]
    if bold:
        rpr_parts.insert(0, "<w:b/>")
    if italic:
        rpr_parts.insert(0, "<w:i/>")
    safe_text = escape(text or "")
    return (
        "<w:p>"
        f"<w:pPr>{''.join(ppr_parts)}</w:pPr>"
        "<w:r>"
        f"<w:rPr>{''.join(rpr_parts)}</w:rPr>"
        f'<w:t xml:space="preserve">{safe_text}</w:t>'
        "</w:r>"
        "</w:p>"
    )


def _table_xml(headers: list[str], rows: list[list[str]]) -> str:
    if not headers:
        return ""
    col_count = len(headers)
    normalized_rows = [
        [row[i] if i < len(row) else "" for i in range(col_count)]
        for row in rows
    ]
    all_rows = [headers, *normalized_rows]
    row_xml = []
    for row_index, row in enumerate(all_rows):
        cells = []
        for cell in row:
            fill = '<w:shd w:fill="F2F2F2"/>' if row_index == 0 else ""
            cells.append(
                "<w:tc>"
                "<w:tcPr>"
                '<w:tcW w:w="0" w:type="auto"/>'
                f"{fill}"
                "<w:tcBorders>"
                '<w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                '<w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                '<w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
                "</w:tcBorders>"
                "</w:tcPr>"
                f"{_paragraph(cell, bold=row_index == 0, size=20, spacing_after=0)}"
                "</w:tc>"
            )
        row_xml.append(f"<w:tr>{''.join(cells)}</w:tr>")

    return (
        "<w:tbl>"
        "<w:tblPr>"
        '<w:tblW w:w="5000" w:type="pct"/>'
        "<w:tblBorders>"
        '<w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '<w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '<w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        "</w:tblBorders>"
        '<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>'
        "</w:tblPr>"
        f"{''.join(row_xml)}"
        "</w:tbl>"
        '<w:p><w:pPr><w:spacing w:after="160"/></w:pPr></w:p>'
    )


def _page_break_paragraph() -> str:
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
