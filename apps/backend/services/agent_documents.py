"""Session-scoped editable documents for the contract assistant.

This is the ContractsSense analogue of Mike's generated/edited document
continuity. Source contracts remain immutable; agent work products are stored
as versioned DOCX files in GridFS and can be downloaded or targeted by later
assistant turns.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import uuid4

from services.document_artifacts import (
    DOCX_CONTENT_TYPE,
    RedlineChange,
    TrackedEditInput,
    apply_tracked_edits_to_docx,
    build_edited_contract_copy_body,
    build_redline_changes_from_request,
    build_work_product_body,
    infer_draft_type,
    redline_change_to_payload,
    redline_contract_preview_body,
    render_redline_docx,
    render_minimal_docx,
    resolve_tracked_changes_in_docx,
    parse_docx_xml,
    read_docx_xml_file,
    should_generate_docx_work_product,
    source_contract_title,
    tracked_change_ids_from_docx,
    work_product_title,
)


def _now() -> datetime:
    return datetime.utcnow()


def _safe_filename(title: str, suffix: str = ".docx") -> str:
    safe = re.sub(r"[^A-Za-z0-9 _.-]+", "", title or "").strip()
    safe = re.sub(r"\s+", " ", safe)[:80].strip(" ._-")
    return f"{safe or 'Contract Work Product'}{suffix}"


def wants_contract_edit_copy(question: str, answer: str, draft_type: Optional[str]) -> bool:
    haystack = f"{question}\n{answer}".lower()
    return bool(
        draft_type == "edit_suggestions"
        or (
            re.search(r"\b(change|replace|revise|edit|amend|apply|redline)\b", haystack)
            and re.search(r"\b(contract|agreement|supplier|party|vendor|customer|name|copy)\b", haystack)
        )
    )


def wants_landscape_docx(question: str, answer: str, draft_type: Optional[str]) -> bool:
    haystack = f"{question}\n{answer}".lower()
    return bool(
        draft_type == "checklist"
        or "landscape" in haystack
        or re.search(r"\b(cp checklist|conditions precedent|closing checklist)\b", haystack)
    )


@dataclass
class AgentDocumentResult:
    document_id: str
    version_id: str
    version_number: int
    artifact_id: str
    file_id: Any
    filename: str
    content_type: str
    byte_count: int
    draft_type: str
    artifact_kind: str
    download_url: str
    redline_changes: Optional[list[Dict[str, Any]]] = None
    applied_redline_changes: Optional[list[Dict[str, Any]]] = None
    unmatched_redline_changes: Optional[list[Dict[str, Any]]] = None
    edit_annotations: Optional[list[Dict[str, Any]]] = None

    def to_payload(self, *, contract_id: str) -> Dict[str, Any]:
        if contract_id.startswith("project:"):
            project_id = contract_id.split(":", 1)[1]
            download_url = f"/projects/{project_id}/agent/documents/{self.document_id}/versions/{self.version_id}/download"
        else:
            download_url = f"/contracts/{contract_id}/agent/documents/{self.document_id}/versions/{self.version_id}/download"
        payload = {
            "artifact_id": self.artifact_id,
            "document_id": self.document_id,
            "version_id": self.version_id,
            "version_number": self.version_number,
            "file_id": str(self.file_id),
            "filename": self.filename,
            "content_type": self.content_type,
            "byte_count": self.byte_count,
            "draft_type": self.draft_type,
            "artifact_kind": self.artifact_kind,
            "editable": True,
            "download_url": download_url,
        }
        if self.redline_changes is not None:
            payload["redline_changes"] = self.redline_changes
        if self.applied_redline_changes is not None:
            payload["applied_redline_changes"] = self.applied_redline_changes
        if self.unmatched_redline_changes is not None:
            payload["unmatched_redline_changes"] = self.unmatched_redline_changes
        if self.edit_annotations is not None:
            payload["edit_annotations"] = self.edit_annotations
        return payload


@dataclass
class AgentTrackedEditResult:
    document_id: str
    version_id: str
    version_number: int
    filename: str
    download_url: str
    annotations: list[Dict[str, Any]]
    errors: list[Dict[str, Any]]


class AgentDocumentManager:
    def __init__(self, mongo_db, fs):
        self.documents = mongo_db["agent_documents"]
        self.versions = mongo_db["agent_document_versions"]
        self.edits = mongo_db["agent_document_edits"]
        self.fs = fs

    def create_from_agent_turn(
        self,
        *,
        contract_id: str,
        project_id: Optional[str],
        user_id: str,
        session_id: str,
        contract_name: str,
        question: str,
        answer: str,
        source_text: str,
        draft_type: Optional[str] = None,
    ) -> Optional[AgentDocumentResult]:
        if not should_generate_docx_work_product(question, answer, draft_type):
            return None

        resolved_type = infer_draft_type(question, answer, draft_type)
        title = work_product_title(question, answer, resolved_type, contract_name)
        work_product_body = build_work_product_body(question, answer)
        is_edit_copy = wants_contract_edit_copy(question, answer, resolved_type)
        body = (
            build_edited_contract_copy_body(source_text or "", work_product_body, question=question)
            if is_edit_copy and source_text
            else work_product_body
        )
        landscape = wants_landscape_docx(question, answer, resolved_type)
        artifact_kind = "edited_contract_copy" if is_edit_copy and source_text else "work_product"
        latest_document = self.latest_for_session(
            contract_id=contract_id,
            user_id=user_id,
            session_id=session_id,
        )
        if is_edit_copy and latest_document:
            return self.create_edited_version(
                contract_id=contract_id,
                user_id=user_id,
                document_id=latest_document["document_id"],
                body=body,
                change_summary="Edited by assistant",
                filename=latest_document.get("filename"),
            )
        return self._create_document(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            source_contract_id=contract_id,
            source_contract_name=contract_name,
            title=title,
            body=body,
            draft_type=resolved_type,
            artifact_kind=artifact_kind,
            change_summary="Created by assistant",
            landscape=landscape,
        )

    def create_redline_from_agent_turn(
        self,
        *,
        contract_id: str,
        project_id: Optional[str],
        user_id: str,
        session_id: str,
        contract_name: str,
        question: str,
        source_text: str,
        changes: Optional[list[RedlineChange]] = None,
    ) -> Optional[AgentDocumentResult]:
        planned_changes = changes or build_redline_changes_from_request(
            question=question,
            source_text=source_text,
            contract_name=contract_name,
        )
        if not planned_changes or not source_text:
            return None
        for change in planned_changes:
            change.status = "approved"

        title = source_contract_title(contract_name)
        render_result = render_redline_docx(
            title=title,
            source_text=source_text,
            document_name=contract_name,
            changes=planned_changes,
        )
        redline_changes = [redline_change_to_payload(change) for change in planned_changes]
        body_text = redline_contract_preview_body(
            source_text=source_text,
            changes=planned_changes,
        )
        existing_redline = self.latest_redline_for_session(
            contract_id=contract_id,
            user_id=user_id,
            session_id=session_id,
            source_contract_id=contract_id,
        )
        if existing_redline:
            result = self._create_version_from_bytes(
                document=existing_redline,
                contract_id=contract_id,
                user_id=user_id,
                title=title,
                filename=existing_redline.get("filename") or _safe_filename(title),
                docx_bytes=render_result.docx_bytes,
                body_text=body_text,
                draft_type="edit_suggestions",
                artifact_kind="redline_contract_copy",
                change_summary=f"Applied {len(render_result.applied_changes)} approved redline change(s)",
                redline_changes=redline_changes,
                applied_redline_changes=render_result.applied_changes,
                unmatched_redline_changes=render_result.unmatched_changes,
            )
            result.edit_annotations = self._persist_redline_edit_annotations(
                contract_id=contract_id,
                project_id=project_id,
                user_id=user_id,
                document_id=result.document_id,
                version_id=result.version_id,
                version_number=result.version_number,
                applied_changes=render_result.applied_changes,
            )
            return result
        result = self._create_document_from_bytes(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            source_contract_id=contract_id,
            source_contract_name=contract_name,
            title=title,
            filename=_safe_filename(title),
            docx_bytes=render_result.docx_bytes,
            body_text=body_text,
            draft_type="edit_suggestions",
            artifact_kind="redline_contract_copy",
            change_summary=f"Applied {len(render_result.applied_changes)} approved redline change(s)",
            redline_changes=redline_changes,
            applied_redline_changes=render_result.applied_changes,
            unmatched_redline_changes=render_result.unmatched_changes,
        )
        result.edit_annotations = self._persist_redline_edit_annotations(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            document_id=result.document_id,
            version_id=result.version_id,
            version_number=result.version_number,
            applied_changes=render_result.applied_changes,
        )
        return result

    def latest_for_session(
        self,
        *,
        contract_id: str,
        user_id: str,
        session_id: str,
    ) -> Optional[Dict[str, Any]]:
        return self.documents.find_one(
            {
                "contract_id": contract_id,
                "user_id": user_id,
                "session_id": session_id,
                "archived_at": {"$exists": False},
            },
            sort=[("updated_at", -1)],
        )

    def latest_redline_for_session(
        self,
        *,
        contract_id: str,
        user_id: str,
        session_id: str,
        source_contract_id: str,
    ) -> Optional[Dict[str, Any]]:
        return self.documents.find_one(
            {
                "contract_id": contract_id,
                "user_id": user_id,
                "session_id": session_id,
                "source_contract_id": source_contract_id,
                "artifact_kind": "redline_contract_copy",
                "archived_at": {"$exists": False},
            },
            sort=[("updated_at", -1)],
        )

    def read_current_document(
        self,
        *,
        contract_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: str,
        document_id: str,
    ) -> Optional[Dict[str, Any]]:
        document = self._find_document_for_scope(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            document_id=document_id,
        )
        if not document:
            return None
        version, grid_out = self._current_version_file(document=document, user_id=user_id)
        if not version or not grid_out:
            return None
        body_text = version.get("body_text")
        if not body_text:
            try:
                body_text = _extract_docx_text(grid_out.read())
            except Exception:
                body_text = ""
        return {
            "document": self._serialize_doc(document),
            "version": self._serialize_doc(version),
            "body_text": body_text or "",
            "filename": version.get("filename") or document.get("filename"),
            "document_id": document_id,
            "version_id": version.get("version_id"),
            "version_number": version.get("version_number"),
        }

    def find_in_document(
        self,
        *,
        contract_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: str,
        document_id: str,
        query: str,
        max_results: int = 20,
        context_chars: int = 80,
    ) -> Optional[Dict[str, Any]]:
        current = self.read_current_document(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            document_id=document_id,
        )
        if not current:
            return None
        text = current.get("body_text") or ""
        matches = _find_text_matches(text, query, max_results=max_results, context_chars=context_chars)
        return {**current, "query": query, "matches": matches, "total_matches": len(matches)}

    def replicate_document(
        self,
        *,
        contract_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: str,
        document_id: str,
        count: int = 1,
    ) -> Optional[list[AgentDocumentResult]]:
        document = self._find_document_for_scope(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            document_id=document_id,
        )
        if not document:
            return None
        version, grid_out = self._current_version_file(document=document, user_id=user_id)
        if not version or not grid_out:
            return None

        docx_bytes = grid_out.read()
        body_text = version.get("body_text") or _extract_docx_text(docx_bytes)
        resolved_count = max(1, min(int(count or 1), 20))
        base_title = re.sub(r"\.docx$", "", document.get("title") or document.get("filename") or "Agent Document", flags=re.IGNORECASE).strip()
        resolved_contract_id = str(document.get("contract_id") or contract_id or (f"project:{project_id}" if project_id else ""))
        resolved_project_id = document.get("project_id") or project_id
        results: list[AgentDocumentResult] = []
        for index in range(1, resolved_count + 1):
            suffix = "Copy" if resolved_count == 1 else f"Copy {index}"
            title = f"{base_title} {suffix}".strip()
            results.append(
                self._create_document_from_bytes(
                    contract_id=resolved_contract_id,
                    project_id=str(resolved_project_id) if resolved_project_id else None,
                    user_id=user_id,
                    session_id=document.get("session_id") or f"replicate-{uuid4().hex}",
                    source_contract_id=document.get("source_contract_id") or resolved_contract_id,
                    source_contract_name=document.get("source_contract_name") or document.get("filename") or title,
                    title=title,
                    filename=_safe_filename(title),
                    docx_bytes=docx_bytes,
                    body_text=body_text,
                    draft_type=document.get("draft_type") or "editable_copy",
                    artifact_kind=document.get("artifact_kind") or "editable_contract_copy",
                    change_summary=f"Replicated from {document.get('filename') or document_id}",
                )
            )
        return results

    def edit_document(
        self,
        *,
        contract_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: str,
        document_id: str,
        edits: list[Dict[str, Any]],
    ) -> Optional[AgentTrackedEditResult]:
        document = self._find_document_for_scope(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            document_id=document_id,
        )
        if not document:
            return None
        version, grid_out = self._current_version_file(document=document, user_id=user_id)
        if not version or not grid_out:
            return None
        docx_bytes = grid_out.read()
        edit_inputs = [
            TrackedEditInput(
                find=str(item.get("find") or ""),
                replace=str(item.get("replace") or ""),
                context_before=str(item.get("context_before") or ""),
                context_after=str(item.get("context_after") or ""),
                reason=str(item.get("reason") or ""),
            )
            for item in edits
        ]
        apply_result = apply_tracked_edits_to_docx(docx_bytes, edit_inputs)
        if not apply_result.annotations:
            return AgentTrackedEditResult(
                document_id=document_id,
                version_id=str(version.get("version_id") or document.get("current_version_id") or ""),
                version_number=int(version.get("version_number") or document.get("current_version_number") or 1),
                filename=version.get("filename") or document.get("filename") or "Document.docx",
                download_url=self._download_url(
                    contract_id=contract_id,
                    project_id=project_id,
                    document_id=document_id,
                    version_id=str(version.get("version_id") or ""),
                ),
                annotations=[],
                errors=apply_result.errors,
            )

        body_text = _extract_docx_text(apply_result.docx_bytes)
        result = self._create_version_from_bytes(
            document=document,
            contract_id=document.get("contract_id") or contract_id or "",
            user_id=user_id,
            title=document.get("title") or document.get("filename") or "Edited Document",
            filename=document.get("filename") or version.get("filename") or "Edited Document.docx",
            docx_bytes=apply_result.docx_bytes,
            body_text=body_text,
            draft_type=document.get("draft_type") or "edit_suggestions",
            artifact_kind=document.get("artifact_kind") or "edited_contract_copy",
            change_summary=f"Applied {len(apply_result.annotations)} tracked edit proposal(s)",
        )
        annotations: list[Dict[str, Any]] = []
        now = _now()
        for annotation in apply_result.annotations:
            edit_id = f"edit-{uuid4().hex}"
            payload = {
                "edit_id": edit_id,
                "type": "edit_data",
                "kind": "edit",
                "document_id": document_id,
                "contract_id": document.get("contract_id") or contract_id,
                "project_id": document.get("project_id") or project_id,
                "user_id": user_id,
                "version_id": result.version_id,
                "version_number": result.version_number,
                "change_id": annotation.change_id,
                "del_w_id": annotation.del_w_id,
                "ins_w_id": annotation.ins_w_id,
                "deleted_text": annotation.deleted_text,
                "inserted_text": annotation.inserted_text,
                "context_before": annotation.context_before,
                "context_after": annotation.context_after,
                "reason": annotation.reason,
                "status": "pending",
                "created_at": now,
            }
            self.edits.insert_one(payload)
            annotations.append(self._serialize_doc(payload))
        return AgentTrackedEditResult(
            document_id=document_id,
            version_id=result.version_id,
            version_number=result.version_number,
            filename=result.filename,
            download_url=self._download_url(
                contract_id=document.get("contract_id") or contract_id,
                project_id=document.get("project_id") or project_id,
                document_id=document_id,
                version_id=result.version_id,
            ),
            annotations=annotations,
            errors=apply_result.errors,
        )

    def _persist_redline_edit_annotations(
        self,
        *,
        contract_id: str,
        project_id: Optional[str],
        user_id: str,
        document_id: str,
        version_id: str,
        version_number: int,
        applied_changes: list[Dict[str, Any]],
    ) -> list[Dict[str, Any]]:
        annotations: list[Dict[str, Any]] = []
        now = _now()
        for change in applied_changes:
            del_w_id = change.get("del_w_id")
            ins_w_id = change.get("ins_w_id")
            if not del_w_id and not ins_w_id:
                continue
            payload = {
                "edit_id": f"edit-{uuid4().hex}",
                "type": "edit_data",
                "kind": "redline",
                "document_id": document_id,
                "contract_id": contract_id,
                "project_id": project_id,
                "user_id": user_id,
                "version_id": version_id,
                "version_number": version_number,
                "change_id": change.get("change_id") or f"contractsense-redline-{len(annotations) + 1}",
                "del_w_id": str(del_w_id) if del_w_id else None,
                "ins_w_id": str(ins_w_id) if ins_w_id else None,
                "deleted_text": change.get("deleted_text") or change.get("matched_text") or change.get("source_excerpt") or "",
                "inserted_text": change.get("inserted_text") if "inserted_text" in change else change.get("suggested_revision") or "",
                "reason": change.get("rationale") or change.get("reason") or change.get("rule_name") or "Approved redline change",
                "status": "pending",
                "created_at": now,
            }
            self.edits.insert_one(payload)
            annotations.append(self._serialize_doc(payload))
        return annotations

    def resolve_tracked_edit(
        self,
        *,
        contract_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: str,
        document_id: str,
        edit_id: str,
        mode: str,
    ) -> Optional[Dict[str, Any]]:
        document = self._find_document_for_scope(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            document_id=document_id,
        )
        if not document:
            return None
        edit = self.edits.find_one({
            "edit_id": edit_id,
            "document_id": document_id,
            "user_id": user_id,
        })
        if not edit:
            return None
        status = edit.get("status")
        if status in {"accepted", "rejected"}:
            return {
                "ok": True,
                "already_resolved": True,
                "status": status,
                "version_id": document.get("current_version_id"),
                "download_url": self._download_url(
                    contract_id=contract_id or document.get("contract_id"),
                    project_id=project_id or document.get("project_id"),
                    document_id=document_id,
                    version_id=document.get("current_version_id"),
                ),
            }

        version, grid_out = self._current_version_file(document=document, user_id=user_id)
        if not version or not grid_out:
            return None
        change_ids = [value for value in [edit.get("del_w_id"), edit.get("ins_w_id")] if value]
        resolved_bytes, found = resolve_tracked_changes_in_docx(grid_out.read(), change_ids=change_ids, mode=mode)
        now = _now()
        if found:
            file_id = self.fs.put(
                resolved_bytes,
                filename=version.get("filename") or document.get("filename") or "Document.docx",
                content_type=DOCX_CONTENT_TYPE,
                metadata={
                    "agent_document_id": document_id,
                    "agent_version_id": version.get("version_id"),
                    "contract_id": document.get("contract_id"),
                    "project_id": document.get("project_id"),
                    "user_id": user_id,
                    "source": "agent_document_edit_resolution",
                },
            )
            body_text = _extract_docx_text(resolved_bytes)
            self.versions.update_one(
                {"version_id": version.get("version_id"), "document_id": document_id, "user_id": user_id},
                {"$set": {"file_id": file_id, "byte_count": len(resolved_bytes), "body_text": body_text[:200000], "updated_at": now}},
            )
            self.documents.update_one(
                {"document_id": document_id, "user_id": user_id},
                {"$set": {"updated_at": now}},
            )
        new_status = "accepted" if mode == "accept" else "rejected"
        self.edits.update_one(
            {"edit_id": edit_id, "document_id": document_id, "user_id": user_id},
            {"$set": {"status": new_status, "resolved_at": now}},
        )
        remaining = self.edits.count_documents({"document_id": document_id, "user_id": user_id, "status": "pending"})
        version_id = str(version.get("version_id") or document.get("current_version_id") or "")
        return {
            "ok": True,
            "found": found,
            "status": new_status,
            "version_id": version_id,
            "download_url": self._download_url(
                contract_id=contract_id or document.get("contract_id"),
                project_id=project_id or document.get("project_id"),
                document_id=document_id,
                version_id=version_id,
            ),
            "remaining_pending": remaining,
        }

    def tracked_change_ids(
        self,
        *,
        contract_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: str,
        document_id: str,
        version_id: Optional[str] = None,
    ) -> Optional[list[Dict[str, str]]]:
        document = self._find_document_for_scope(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            document_id=document_id,
        )
        if not document:
            return None
        if version_id:
            version = self.versions.find_one({"version_id": version_id, "document_id": document_id, "user_id": user_id})
            grid_out = self.fs.get(version["file_id"]) if version else None
        else:
            version, grid_out = self._current_version_file(document=document, user_id=user_id)
        if not version or not grid_out:
            return None
        return tracked_change_ids_from_docx(grid_out.read())

    def list_edit_annotations(
        self,
        *,
        contract_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: str,
        document_id: str,
        version_id: Optional[str] = None,
    ) -> list[Dict[str, Any]]:
        query: Dict[str, Any] = {
            "document_id": document_id,
            "user_id": user_id,
        }
        if contract_id:
            query["contract_id"] = contract_id
        if project_id:
            query["project_id"] = project_id
        if version_id:
            query["version_id"] = version_id
        return [
            self._serialize_doc(edit)
            for edit in self.edits.find(query, {"_id": 0}).sort([("created_at", 1)])
        ]

    def _find_document_for_scope(
        self,
        *,
        contract_id: Optional[str],
        project_id: Optional[str],
        user_id: str,
        document_id: str,
    ) -> Optional[Dict[str, Any]]:
        query: Dict[str, Any] = {
            "document_id": document_id,
            "user_id": user_id,
            "archived_at": {"$exists": False},
        }
        if contract_id:
            query["contract_id"] = contract_id
        if project_id:
            query["project_id"] = project_id
        return self.documents.find_one(query)

    def _current_version_file(self, *, document: Dict[str, Any], user_id: str):
        version_id = document.get("current_version_id")
        if not version_id:
            return None, None
        version = self.versions.find_one({
            "document_id": document.get("document_id"),
            "version_id": version_id,
            "user_id": user_id,
        })
        if not version:
            return None, None
        return version, self.fs.get(version["file_id"])

    def _download_url(
        self,
        *,
        contract_id: Optional[str],
        project_id: Optional[str],
        document_id: str,
        version_id: Optional[str],
    ) -> str:
        if project_id:
            return f"/projects/{project_id}/agent/documents/{document_id}/versions/{version_id}/download"
        if contract_id and str(contract_id).startswith("project:"):
            resolved_project_id = str(contract_id).split(":", 1)[1]
            return f"/projects/{resolved_project_id}/agent/documents/{document_id}/versions/{version_id}/download"
        return f"/contracts/{contract_id}/agent/documents/{document_id}/versions/{version_id}/download"

    def list_documents(self, *, contract_id: str, user_id: str, limit: int = 50) -> list[Dict[str, Any]]:
        documents = list(
            self.documents.find(
                {
                    "contract_id": contract_id,
                    "user_id": user_id,
                    "archived_at": {"$exists": False},
                },
                {"_id": 0},
            ).sort("updated_at", -1).limit(limit)
        )
        if not documents:
            return []

        document_ids = [document["document_id"] for document in documents if document.get("document_id")]
        versions_by_document: Dict[str, list[Dict[str, Any]]] = {document_id: [] for document_id in document_ids}
        for version in self.versions.find(
            {
                "contract_id": contract_id,
                "user_id": user_id,
                "document_id": {"$in": document_ids},
            },
            {"body_text": 0},
        ).sort([("document_id", 1), ("version_number", -1)]):
            clean_version = self._serialize_doc(version)
            document_id = str(clean_version.get("document_id") or "")
            if document_id in versions_by_document:
                versions_by_document[document_id].append(clean_version)

        for document in documents:
            document_id = str(document.get("document_id") or "")
            document["versions"] = versions_by_document.get(document_id, [])
            document["version_count"] = len(document["versions"])
            document["pending_edit_count"] = self.edits.count_documents({
                "document_id": document_id,
                "user_id": user_id,
                "status": "pending",
            })

        return [self._serialize_doc(document) for document in documents]

    def list_project_documents(self, *, project_id: str, user_id: str, limit: int = 100) -> list[Dict[str, Any]]:
        documents = list(
            self.documents.find(
                {
                    "project_id": project_id,
                    "user_id": user_id,
                    "archived_at": {"$exists": False},
                },
                {"_id": 0},
            ).sort("updated_at", -1).limit(limit)
        )
        if not documents:
            return []

        document_ids = [document["document_id"] for document in documents if document.get("document_id")]
        versions_by_document: Dict[str, list[Dict[str, Any]]] = {document_id: [] for document_id in document_ids}
        for version in self.versions.find(
            {
                "project_id": project_id,
                "user_id": user_id,
                "document_id": {"$in": document_ids},
            },
            {"body_text": 0},
        ).sort([("document_id", 1), ("version_number", -1)]):
            clean_version = self._serialize_doc(version)
            document_id = str(clean_version.get("document_id") or "")
            if document_id in versions_by_document:
                versions_by_document[document_id].append(clean_version)

        for document in documents:
            document_id = str(document.get("document_id") or "")
            document["versions"] = versions_by_document.get(document_id, [])
            document["version_count"] = len(document["versions"])
            document["pending_edit_count"] = self.edits.count_documents({
                "document_id": document_id,
                "user_id": user_id,
                "status": "pending",
            })

        return [self._serialize_doc(document) for document in documents]

    def create_plain_copy(
        self,
        *,
        contract_id: str,
        project_id: Optional[str],
        user_id: str,
        session_id: str,
        contract_name: str,
        source_text: str,
        title: Optional[str] = None,
    ) -> AgentDocumentResult:
        source_title = re.sub(r"\.[A-Za-z0-9]+$", "", contract_name or "").strip() or "Contract"
        copy_title = title or f"Editable Copy - {source_title}"
        return self._create_document(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            source_contract_id=contract_id,
            source_contract_name=contract_name,
            title=copy_title,
            body=build_edited_contract_copy_body(source_text or "", ""),
            draft_type="editable_copy",
            artifact_kind="editable_contract_copy",
            change_summary="Replicated source contract into editable DOCX copy",
        )

    def duplicate_latest_for_session(
        self,
        *,
        contract_id: str,
        project_id: Optional[str],
        user_id: str,
        session_id: str,
        count: int,
    ) -> list[AgentDocumentResult]:
        count = max(1, min(int(count or 1), 20))
        latest = self.latest_for_session(
            contract_id=contract_id,
            user_id=user_id,
            session_id=session_id,
        )
        if not latest:
            return []

        version = self.versions.find_one(
            {
                "document_id": latest.get("document_id"),
                "contract_id": contract_id,
                "user_id": user_id,
                "version_id": latest.get("current_version_id"),
            },
            {"body_text": 1, "title": 1},
        ) or {}
        body = version.get("body_text") or ""
        if not body:
            return []

        base_title = re.sub(r"\.docx$", "", latest.get("filename") or latest.get("title") or "Generated Document", flags=re.IGNORECASE)
        results: list[AgentDocumentResult] = []
        for index in range(1, count + 1):
            results.append(
                self._create_document(
                    contract_id=contract_id,
                    project_id=project_id,
                    user_id=user_id,
                    session_id=session_id,
                    source_contract_id=latest.get("source_contract_id") or contract_id,
                    source_contract_name=latest.get("source_contract_name") or latest.get("filename") or base_title,
                    title=f"{base_title} ({index})",
                    body=body,
                    draft_type=latest.get("draft_type") or "draft",
                    artifact_kind=latest.get("artifact_kind") or "work_product",
                    change_summary="Replicated by assistant",
                )
            )
        return results

    def create_edited_version(
        self,
        *,
        contract_id: str,
        user_id: str,
        document_id: str,
        body: str,
        change_summary: str,
        filename: Optional[str] = None,
    ) -> AgentDocumentResult:
        document = self.documents.find_one({
            "document_id": document_id,
            "contract_id": contract_id,
            "user_id": user_id,
            "archived_at": {"$exists": False},
        })
        if not document:
            raise ValueError("Agent document not found.")

        version_number = int(document.get("current_version_number") or 0) + 1
        version_id = f"version-{uuid4().hex}"
        artifact_id = f"artifact-{uuid4().hex}"
        title = document.get("title") or document.get("filename") or "Edited Contract Copy"
        output_filename = filename or document.get("filename") or _safe_filename(title)
        docx_bytes = render_minimal_docx(title=title, body=body)
        now = _now()
        file_id = self.fs.put(
            docx_bytes,
            filename=output_filename,
            content_type=DOCX_CONTENT_TYPE,
            metadata={
                "artifact_id": artifact_id,
                "agent_document_id": document_id,
                "agent_version_id": version_id,
                "contract_id": contract_id,
                "project_id": document.get("project_id"),
                "user_id": user_id,
                "session_id": document.get("session_id"),
                "draft_type": document.get("draft_type"),
                "artifact_kind": "edited_contract_copy",
                "source": "agent_document",
            },
        )
        self.versions.insert_one({
            "version_id": version_id,
            "document_id": document_id,
            "contract_id": contract_id,
            "project_id": document.get("project_id"),
            "user_id": user_id,
            "session_id": document.get("session_id"),
            "version_number": version_number,
            "file_id": file_id,
            "filename": output_filename,
            "content_type": DOCX_CONTENT_TYPE,
            "byte_count": len(docx_bytes),
            "title": title,
            "body_text": body[:200000],
            "change_summary": change_summary,
            "created_at": now,
        })
        self.documents.update_one(
            {"document_id": document_id, "contract_id": contract_id, "user_id": user_id},
            {"$set": {
                "current_version_id": version_id,
                "current_version_number": version_number,
                "filename": output_filename,
                "updated_at": now,
            }},
        )
        return AgentDocumentResult(
            document_id=document_id,
            version_id=version_id,
            version_number=version_number,
            artifact_id=artifact_id,
            file_id=file_id,
            filename=output_filename,
            content_type=DOCX_CONTENT_TYPE,
            byte_count=len(docx_bytes),
            draft_type=document.get("draft_type") or "edit_suggestions",
            artifact_kind="edited_contract_copy",
            download_url="",
        )

    def save_text_version(
        self,
        *,
        contract_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: str,
        document_id: str,
        body_text: str,
        change_summary: str = "Saved from live editor",
    ) -> Optional[AgentDocumentResult]:
        document = self._find_document_for_scope(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            document_id=document_id,
        )
        if not document:
            return None
        body = (body_text or "").strip()
        if not body:
            body = "Empty document"
        title = document.get("title") or document.get("filename") or "Edited Contract Copy"
        filename = document.get("filename") or _safe_filename(title)
        docx_bytes = render_minimal_docx(title=title, body=body)
        resolved_contract_id = str(document.get("contract_id") or contract_id or (f"project:{project_id}" if project_id else ""))
        result = self._create_version_from_bytes(
            document=document,
            contract_id=resolved_contract_id,
            user_id=user_id,
            title=title,
            filename=filename,
            docx_bytes=docx_bytes,
            body_text=body,
            draft_type=document.get("draft_type") or "editable_copy",
            artifact_kind=document.get("artifact_kind") or "editable_contract_copy",
            change_summary=change_summary or "Saved from live editor",
            redline_changes=document.get("redline_changes"),
            applied_redline_changes=document.get("applied_redline_changes"),
            unmatched_redline_changes=document.get("unmatched_redline_changes"),
        )
        result.download_url = self._download_url(
            contract_id=resolved_contract_id,
            project_id=str(document.get("project_id") or project_id or "") or None,
            document_id=result.document_id,
            version_id=result.version_id,
        )
        return result

    def _create_version_from_bytes(
        self,
        *,
        document: Dict[str, Any],
        contract_id: str,
        user_id: str,
        title: str,
        filename: str,
        docx_bytes: bytes,
        body_text: str,
        draft_type: str,
        artifact_kind: str,
        change_summary: str,
        redline_changes: Optional[list[Dict[str, Any]]] = None,
        applied_redline_changes: Optional[list[Dict[str, Any]]] = None,
        unmatched_redline_changes: Optional[list[Dict[str, Any]]] = None,
    ) -> AgentDocumentResult:
        document_id = str(document.get("document_id") or "")
        if not document_id:
            raise ValueError("Agent document is missing document_id.")

        now = _now()
        version_number = int(document.get("current_version_number") or 0) + 1
        version_id = f"version-{uuid4().hex}"
        artifact_id = f"artifact-{uuid4().hex}"
        metadata = {
            "artifact_id": artifact_id,
            "agent_document_id": document_id,
            "agent_version_id": version_id,
            "contract_id": contract_id,
            "project_id": document.get("project_id"),
            "user_id": user_id,
            "session_id": document.get("session_id"),
            "draft_type": draft_type,
            "artifact_kind": artifact_kind,
            "source": "agent_document",
        }
        if redline_changes is not None:
            metadata["redline_changes"] = redline_changes
        file_id = self.fs.put(
            docx_bytes,
            filename=filename,
            content_type=DOCX_CONTENT_TYPE,
            metadata=metadata,
        )

        version_doc: Dict[str, Any] = {
            "version_id": version_id,
            "document_id": document_id,
            "contract_id": contract_id,
            "project_id": document.get("project_id"),
            "user_id": user_id,
            "session_id": document.get("session_id"),
            "version_number": version_number,
            "file_id": file_id,
            "filename": filename,
            "content_type": DOCX_CONTENT_TYPE,
            "byte_count": len(docx_bytes),
            "title": title,
            "body_text": body_text[:200000],
            "change_summary": change_summary,
            "created_at": now,
        }
        update_doc: Dict[str, Any] = {
            "current_version_id": version_id,
            "current_version_number": version_number,
            "filename": filename,
            "title": title,
            "draft_type": draft_type,
            "artifact_kind": artifact_kind,
            "updated_at": now,
        }
        if redline_changes is not None:
            version_doc["redline_changes"] = redline_changes
            update_doc["redline_changes"] = redline_changes
        if applied_redline_changes is not None:
            version_doc["applied_redline_changes"] = applied_redline_changes
            update_doc["applied_redline_changes"] = applied_redline_changes
        if unmatched_redline_changes is not None:
            version_doc["unmatched_redline_changes"] = unmatched_redline_changes
            update_doc["unmatched_redline_changes"] = unmatched_redline_changes

        self.versions.insert_one(version_doc)
        self.documents.update_one(
            {"document_id": document_id, "contract_id": contract_id, "user_id": user_id},
            {"$set": update_doc},
        )
        return AgentDocumentResult(
            document_id=document_id,
            version_id=version_id,
            version_number=version_number,
            artifact_id=artifact_id,
            file_id=file_id,
            filename=filename,
            content_type=DOCX_CONTENT_TYPE,
            byte_count=len(docx_bytes),
            draft_type=draft_type,
            artifact_kind=artifact_kind,
            download_url="",
            redline_changes=redline_changes,
            applied_redline_changes=applied_redline_changes,
            unmatched_redline_changes=unmatched_redline_changes,
        )

    def get_version_file(self, *, contract_id: str, user_id: str, document_id: str, version_id: str):
        version = self.versions.find_one({
            "document_id": document_id,
            "version_id": version_id,
            "contract_id": contract_id,
            "user_id": user_id,
        })
        if not version:
            return None, None
        grid_out = self.fs.get(version["file_id"])
        return version, grid_out

    def get_project_version_file(self, *, project_id: str, user_id: str, document_id: str, version_id: str):
        version = self.versions.find_one({
            "document_id": document_id,
            "version_id": version_id,
            "project_id": project_id,
            "user_id": user_id,
        })
        if not version:
            return None, None
        grid_out = self.fs.get(version["file_id"])
        return version, grid_out

    def get_version_preview(self, *, contract_id: str, user_id: str, document_id: str, version_id: str) -> Optional[Dict[str, Any]]:
        version, grid_out = self.get_version_file(
            contract_id=contract_id,
            user_id=user_id,
            document_id=document_id,
            version_id=version_id,
        )
        if not version or not grid_out:
            return None

        document = self.documents.find_one(
            {
                "document_id": document_id,
                "contract_id": contract_id,
                "user_id": user_id,
                "archived_at": {"$exists": False},
            },
            {"_id": 0},
        ) or {}
        preview_text = version.get("body_text")
        if not preview_text:
            try:
                preview_text = _extract_docx_text(grid_out.read())
            except Exception:
                preview_text = ""

        if contract_id.startswith("project:"):
            project_id = contract_id.split(":", 1)[1]
            download_url = f"/projects/{project_id}/agent/documents/{document_id}/versions/{version_id}/download"
        else:
            download_url = f"/contracts/{contract_id}/agent/documents/{document_id}/versions/{version_id}/download"

        payload = self._serialize_doc(version)
        payload.update({
            "document": self._serialize_doc(document),
            "body_text": preview_text,
            "download_url": download_url,
            "edit_annotations": self.list_edit_annotations(
                contract_id=contract_id,
                user_id=user_id,
                document_id=document_id,
                version_id=version_id,
            ),
        })
        return payload

    def get_project_version_preview(self, *, project_id: str, user_id: str, document_id: str, version_id: str) -> Optional[Dict[str, Any]]:
        version, grid_out = self.get_project_version_file(
            project_id=project_id,
            user_id=user_id,
            document_id=document_id,
            version_id=version_id,
        )
        if not version or not grid_out:
            return None

        document = self.documents.find_one(
            {
                "document_id": document_id,
                "project_id": project_id,
                "user_id": user_id,
                "archived_at": {"$exists": False},
            },
            {"_id": 0},
        ) or {}
        preview_text = version.get("body_text")
        if not preview_text:
            try:
                preview_text = _extract_docx_text(grid_out.read())
            except Exception:
                preview_text = ""

        payload = self._serialize_doc(version)
        payload.update({
            "document": self._serialize_doc(document),
            "body_text": preview_text,
            "download_url": f"/projects/{project_id}/agent/documents/{document_id}/versions/{version_id}/download",
            "edit_annotations": self.list_edit_annotations(
                project_id=project_id,
                user_id=user_id,
                document_id=document_id,
                version_id=version_id,
            ),
        })
        return payload

    def _create_document(
        self,
        *,
        contract_id: str,
        project_id: Optional[str],
        user_id: str,
        session_id: str,
        source_contract_id: str,
        source_contract_name: str,
        title: str,
        body: str,
        draft_type: str,
        artifact_kind: str,
        change_summary: str,
        landscape: bool = False,
    ) -> AgentDocumentResult:
        docx_bytes = render_minimal_docx(title=title, body=body, landscape=landscape)
        return self._create_document_from_bytes(
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            source_contract_id=source_contract_id,
            source_contract_name=source_contract_name,
            title=title,
            filename=_safe_filename(title),
            docx_bytes=docx_bytes,
            body_text=body[:200000],
            draft_type=draft_type,
            artifact_kind=artifact_kind,
            change_summary=change_summary,
        )

    def _create_document_from_bytes(
        self,
        *,
        contract_id: str,
        project_id: Optional[str],
        user_id: str,
        session_id: str,
        source_contract_id: str,
        source_contract_name: str,
        title: str,
        filename: str,
        docx_bytes: bytes,
        body_text: str,
        draft_type: str,
        artifact_kind: str,
        change_summary: str,
        redline_changes: Optional[list[Dict[str, Any]]] = None,
        applied_redline_changes: Optional[list[Dict[str, Any]]] = None,
        unmatched_redline_changes: Optional[list[Dict[str, Any]]] = None,
    ) -> AgentDocumentResult:
        now = _now()
        document_id = f"agent-doc-{uuid4().hex}"
        version_id = f"version-{uuid4().hex}"
        artifact_id = f"artifact-{uuid4().hex}"
        metadata = {
            "artifact_id": artifact_id,
            "agent_document_id": document_id,
            "agent_version_id": version_id,
            "contract_id": contract_id,
            "project_id": project_id,
            "user_id": user_id,
            "session_id": session_id,
            "draft_type": draft_type,
            "artifact_kind": artifact_kind,
            "source": "agent_document",
        }
        if redline_changes is not None:
            metadata["redline_changes"] = redline_changes
        file_id = self.fs.put(
            docx_bytes,
            filename=filename,
            content_type=DOCX_CONTENT_TYPE,
            metadata=metadata,
        )
        document_doc = {
            "document_id": document_id,
            "contract_id": contract_id,
            "project_id": project_id,
            "user_id": user_id,
            "session_id": session_id,
            "source_contract_id": source_contract_id,
            "source_contract_name": source_contract_name,
            "title": title,
            "filename": filename,
            "draft_type": draft_type,
            "artifact_kind": artifact_kind,
            "current_version_id": version_id,
            "current_version_number": 1,
            "created_at": now,
            "updated_at": now,
        }
        version_doc = {
            "version_id": version_id,
            "document_id": document_id,
            "contract_id": contract_id,
            "project_id": project_id,
            "user_id": user_id,
            "session_id": session_id,
            "version_number": 1,
            "file_id": file_id,
            "filename": filename,
            "content_type": DOCX_CONTENT_TYPE,
            "byte_count": len(docx_bytes),
            "title": title,
            "body_text": body_text[:200000],
            "change_summary": change_summary,
            "created_at": now,
        }
        if redline_changes is not None:
            document_doc["redline_changes"] = redline_changes
            version_doc["redline_changes"] = redline_changes
        if applied_redline_changes is not None:
            document_doc["applied_redline_changes"] = applied_redline_changes
            version_doc["applied_redline_changes"] = applied_redline_changes
        if unmatched_redline_changes is not None:
            document_doc["unmatched_redline_changes"] = unmatched_redline_changes
            version_doc["unmatched_redline_changes"] = unmatched_redline_changes
        self.documents.insert_one(document_doc)
        self.versions.insert_one(version_doc)
        return AgentDocumentResult(
            document_id=document_id,
            version_id=version_id,
            version_number=1,
            artifact_id=artifact_id,
            file_id=file_id,
            filename=filename,
            content_type=DOCX_CONTENT_TYPE,
            byte_count=len(docx_bytes),
            draft_type=draft_type,
            artifact_kind=artifact_kind,
            download_url="",
            redline_changes=redline_changes,
            applied_redline_changes=applied_redline_changes,
            unmatched_redline_changes=unmatched_redline_changes,
        )

    @staticmethod
    def _serialize_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
        clean_doc = dict(doc or {})
        clean_doc.pop("_id", None)
        if clean_doc.get("file_id") is not None:
            clean_doc["file_id"] = str(clean_doc["file_id"])
        for key in ("created_at", "updated_at", "archived_at", "resolved_at"):
            if isinstance(clean_doc.get(key), datetime):
                clean_doc[key] = clean_doc[key].isoformat()
        return clean_doc


def _extract_docx_text(docx_bytes: bytes) -> str:
    document_xml = read_docx_xml_file(docx_bytes, "word/document.xml")
    root = parse_docx_xml(document_xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs = []
    for paragraph in root.findall(".//w:p", namespace):
        text_parts = []
        has_page_break = False
        for node in paragraph.iter():
            tag = node.tag.rsplit("}", 1)[-1]
            if tag == "t" and node.text:
                text_parts.append(node.text)
            elif tag == "br" and node.attrib.get(f"{{{namespace['w']}}}type") == "page":
                has_page_break = True
        line = "".join(text_parts).strip()
        if has_page_break and paragraphs:
            paragraphs.append("")
            paragraphs.append("--- Page Break ---")
        if line:
            paragraphs.append(line)
    return "\n\n".join(paragraphs).strip()


def _normalize_with_map(value: str) -> tuple[str, list[int]]:
    chars: list[str] = []
    index_map: list[int] = []
    last_space = False
    for index, char in enumerate(value or ""):
        if char.isspace():
            if chars and not last_space:
                chars.append(" ")
                index_map.append(index)
                last_space = True
            continue
        chars.append(char.lower())
        index_map.append(index)
        last_space = False
    while chars and chars[-1] == " ":
        chars.pop()
        index_map.pop()
    return "".join(chars), index_map


def _find_text_matches(text: str, query: str, *, max_results: int, context_chars: int) -> list[Dict[str, Any]]:
    normalized_text, index_map = _normalize_with_map(text)
    normalized_query, _ = _normalize_with_map(query)
    if not normalized_text or not normalized_query:
        return []

    max_results = max(1, min(int(max_results or 20), 50))
    context_chars = max(20, min(int(context_chars or 80), 500))
    matches: list[Dict[str, Any]] = []
    position = normalized_text.find(normalized_query)
    while position >= 0 and len(matches) < max_results:
        end_position = min(position + len(normalized_query) - 1, len(index_map) - 1)
        start = index_map[position]
        end = index_map[end_position] + 1
        matches.append({
            "index": len(matches),
            "start": start,
            "end": end,
            "text": text[start:end],
            "context_before": text[max(0, start - context_chars):start],
            "context_after": text[end:end + context_chars],
        })
        position = normalized_text.find(normalized_query, position + max(1, len(normalized_query)))
    return matches
