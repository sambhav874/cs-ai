"""DOCX work-product generation for the contract assistant.

The assistant cannot safely mutate source PDFs in place. For drafting and edit
requests, we generate a separate Word document artifact and store it in GridFS
so the UI can present a download card.

NOTE: Hand-rolled OOXML has been replaced by docx_engine (python-docx + lxml).
This module now only contains business logic — text processing, draft-type
inference, change parsing — and delegates all XML work to services.docx_engine.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from services.docx_engine import (
    DocxSection,
    EditInput,
    TrackedEditApplyResult,
    TrackedEditAnnotation,
    apply_tracked_edits,
    extract_tracked_change_ids,
    generate_docx,
    normalized_with_map,
    parse_docx_xml,
    read_docx_xml_file,
    resolve_tracked_changes,
)
from utils.text_cleanup import clean_text_encoding


DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
REDLINE_DELETE_OPEN_PREFIX = "[[CS_REDLINE_DEL:"
REDLINE_DELETE_CLOSE = "[[/CS_REDLINE_DEL]]"
REDLINE_INSERT_OPEN_PREFIX = "[[CS_REDLINE_INS:"
REDLINE_INSERT_CLOSE = "[[/CS_REDLINE_INS]]"


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
    """Generate a DOCX from title + body text using docx_engine."""
    sections = _body_to_sections(body)
    return generate_docx(title, sections, landscape=landscape)


def _body_to_sections(body: str) -> List[DocxSection]:
    """Convert a plain-text body (with headings and [[DOCX_PAGE:N]] markers) into DocxSections."""
    if not body:
        return [DocxSection(content="")]
    sections: List[DocxSection] = []
    lines = body.split("\n")
    current_heading: Optional[str] = None
    current_level = 1
    current_content: List[str] = []
    page_break = False
    def _flush():
        sections.append(DocxSection(
            heading=current_heading,
            level=current_level,
            content="\n".join(current_content).strip() if current_content else None,
            page_break=page_break,
        ))
        current_content.clear()
    for line in lines:
        stripped = line.strip()
        if re.match(r"^\[\[DOCX_PAGE:\d+\]\]", stripped):
            _flush()
            page_break = True
            current_heading = None
            continue
        heading_match = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading_match:
            _flush()
            page_break = False
            current_level = len(heading_match.group(1))
            current_heading = heading_match.group(2)
            continue
        if stripped:
            current_content.append(stripped)
    _flush()
    return sections


def render_redline_docx(
    *,
    title: str,
    source_text: str,
    document_name: str,
    changes: List[RedlineChange],
) -> RedlineRenderResult:
    """Render a redline DOCX using docx_engine for tracked changes."""
    cleaned_source = _clean_source_contract_text(source_text)
    planned_changes = _plan_redline_changes(cleaned_source, changes)

    applied = [c for c in planned_changes if c.get("applied")]
    unmatched = [c for c in planned_changes if not c.get("applied")]

    if not applied:
        # Generate a minimal DOCX with no changes applied
        body = f"No tracked changes could be applied to {document_name or 'the source document'}."
        sections = [DocxSection(content=body)]
        return RedlineRenderResult(
            docx_bytes=generate_docx(title, sections),
            applied_changes=[],
            unmatched_changes=[change["summary"] for change in unmatched],
        )

    # Build EditInputs from planned changes
    edits = []
    for change in applied:
        s, e = int(change["start"]), int(change["end"])
        deleted = cleaned_source[s:e]
        replacement = str(change.get("replacement") or "")
        context_before = cleaned_source[max(0, s - 80):s]
        context_after = cleaned_source[e:min(len(cleaned_source), e + 80)]
        if "\n\n" in context_before:
            context_before = context_before.split("\n\n")[-1]
        if "\n\n" in context_after:
            context_after = context_after.split("\n\n")[0]
        edits.append(EditInput(
            find=deleted,
            replace=replacement,
            context_before=context_before,
            context_after=context_after,
            reason=str(change.get("summary", {}).get("rule_name", "Redline edit")),
        ))

    # Create a clean DOCX from the source text, then apply tracked edits
    sections = [DocxSection(content=cleaned_source)]
    clean_docx = generate_docx(title, sections)
    result = apply_tracked_edits(clean_docx, edits)

    applied_summaries = []
    for idx, change in enumerate(applied):
        summary = dict(change["summary"])
        if idx < len(result.annotations):
            anno = result.annotations[idx]
            summary["del_w_id"] = anno.del_w_id
            summary["ins_w_id"] = anno.ins_w_id
            summary["deleted_text"] = anno.deleted_text
            summary["inserted_text"] = anno.inserted_text
        applied_summaries.append(summary)

    return RedlineRenderResult(
        docx_bytes=result.docx_bytes,
        applied_changes=applied_summaries,
        unmatched_changes=[change["summary"] for change in unmatched],
    )


def apply_tracked_edits_to_docx(
    docx_bytes: bytes,
    edits: List[TrackedEditInput],
    *,
    author: str = "ContractSense",
) -> TrackedEditApplyResult:
    """Apply tracked edits using docx_engine (delegates to lxml-based implementation)."""
    result = apply_tracked_edits(docx_bytes, edits, author=author)
    return TrackedEditApplyResult(
        docx_bytes=result.docx_bytes,
        annotations=[
            TrackedEditAnnotation(
                change_id=a.change_id,
                del_w_id=a.del_w_id,
                ins_w_id=a.ins_w_id,
                deleted_text=a.deleted_text,
                inserted_text=a.inserted_text,
                context_before=a.context_before,
                context_after=a.context_after,
                reason=a.reason,
            )
            for a in result.annotations
        ],
        errors=result.errors,
    )


def resolve_tracked_changes_in_docx(
    docx_bytes: bytes,
    *,
    change_ids: List[str],
    mode: str,
) -> Tuple[bytes, bool]:
    """Accept or reject tracked changes using docx_engine."""
    return resolve_tracked_changes(docx_bytes, change_ids, mode)


def tracked_change_ids_from_docx(docx_bytes: bytes) -> List[Dict[str, str]]:
    """Extract tracked change IDs using docx_engine."""
    return extract_tracked_change_ids(docx_bytes)


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


def _find_flexible_span(source_text: str, needle: str) -> Optional[Tuple[int, int]]:
    if not source_text or not needle:
        return None
    source_normalized, source_map = normalized_with_map(source_text)
    needle_normalized, _ = normalized_with_map(needle)
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
    source_normalized, source_map = normalized_with_map(source_text)
    needle_normalized, _ = normalized_with_map(needle)
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
    source_normalized, _ = normalized_with_map(source_text)
    needle_normalized, _ = normalized_with_map(needle)
    if not needle_normalized:
        return 0

    count = 0
    position = source_normalized.find(needle_normalized)
    while position >= 0 and count < limit:
        count += 1
        position = source_normalized.find(needle_normalized, position + max(1, len(needle_normalized)))
    return count
