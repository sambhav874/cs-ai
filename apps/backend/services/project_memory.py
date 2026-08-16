"""Cross-document, chronological project memory for ContractSense.

Generated once per successful contract ingestion via a single RAG-grounded agent
call (bounded evidence retrieval, not a raw full-text LLM dump — see
`ContractRAGSystem.answer_agent_question`), so the agent and future project
members can see what documents exist in a project, what each is about, and how
they relate to one another over time (e.g. a main contract uploaded June 2026,
its schedule uploaded July 2026, and other related docs uploaded August 2026).
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4


MAX_CONTEXT_CHARS = 3500

PROJECT_OVERVIEW_QUESTIONS = """
Answer the following about THIS document only, using evidence you retrieve from it.
Respond with ONLY a single JSON object (no prose, no markdown fences) with these exact keys.
This is an internal project-memory summary, not a cited answer to a user — do NOT include
citation markers, footnote numbers, or bracketed references (e.g. "[1]") anywhere inside or
before the JSON. It must be valid, directly parseable JSON with nothing else on the line.

{{
  "doc_type": "main_agreement | schedule | annex | amendment | exhibit | sow | other",
  "parties": ["..."],
  "effective_date": "string or null",
  "purpose_summary": "1-3 sentence plain-language summary of what this document is and covers",
  "key_topics": ["3-5 short topic tags"],
  "related_to": [
    {{"filename": "exact filename from the list below", "relation_type": "amends|schedules|annexes|supersedes|references|other", "evidence_quote": "exact quote from this document naming or referencing the other document"}}
  ]
}}

Only include an entry in "related_to" if this document explicitly names or quotes a reference to
one of the existing project documents listed below. If it references none of them, return an
empty list. Do not guess a relation from topic similarity alone — require an explicit textual
reference.

Existing documents already in this project (for relation matching only — do not treat as evidence
about the current document):
{existing_docs}
""".strip()


def _now() -> datetime:
    return datetime.utcnow()


_CITATION_MARKER_RE = re.compile(r"\[\d{1,3}\]")


def _strip_citation_markers(text: str) -> str:
    """Remove inline citation/footnote markers like "[1]" — the RAG agent's
    system prompt encourages these for cited answers, but project memory is
    an internal summary, not a cited answer, so they're noise here (and when
    one lands right after the opening brace of the JSON object, it breaks
    parsing entirely)."""
    return _CITATION_MARKER_RE.sub("", text)


def _clean_text(value: Any, limit: int = 2000) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = _strip_citation_markers(text).strip()
    return text[:limit]


def _project_memory_namespace(project_id: str) -> str:
    return f"project-memory-{project_id}"


def _build_markdown_section(record: Dict[str, Any]) -> str:
    """Render one document's overview as a markdown section — the unit that
    gets appended to the project's running markdown journal and embedded into
    its vector namespace. Metadata only (dates, parties, summary, topics,
    relations, confidence) — deliberately no quoted evidence/citations, since
    this is a project-history journal, not a cited answer."""
    uploaded = record.get("uploaded_at")
    uploaded_str = uploaded.strftime("%Y-%m-%d") if isinstance(uploaded, datetime) else str(uploaded or "")
    parties = ", ".join(record.get("parties") or []) or "—"
    topics = ", ".join(record.get("key_topics") or []) or "—"
    related = record.get("related_documents") or []
    relates_to = "; ".join(f"{r.get('relation_type')} {r.get('filename')}" for r in related) or "(none)"
    confidence = record.get("rag_confidence")

    lines = [
        f"## {record.get('filename')} — {record.get('doc_type', 'other')}",
        f"**Uploaded:** {uploaded_str}  |  **Effective date:** {record.get('effective_date') or '—'}  |  **Parties:** {parties}",
        "",
        record.get("purpose_summary") or "",
        "",
        f"**Key topics:** {topics}",
        f"**Relates to:** {relates_to}",
    ]
    if confidence:
        lines.append(f"**Confidence:** {confidence}")

    return "\n".join(lines).strip()


def _wrap_scratchpad_section(contract_id: str, markdown_section: str) -> str:
    """Wrap one document's markdown section with an HTML-comment marker pair
    so _sync_scratchpad can find-and-replace just this section later —
    comments are invisible when rendered but greppable in the raw text,
    letting per-document auto-sync coexist with manual edits elsewhere."""
    return f"<!-- pm:section:{contract_id} -->\n{markdown_section}\n<!-- /pm:section:{contract_id} -->"


def _extract_balanced_json_object(text: str) -> Optional[str]:
    """Find the first top-level {...} object by brace counting, respecting
    string literals — safer than a greedy regex when the text has trailing
    content after the object (e.g. the agent's own <CITATIONS> block, which
    also contains braces)."""
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def _parse_json_object(text: str) -> Optional[Dict[str, Any]]:
    if not text:
        return None
    # The underlying agent run may append its own <CITATIONS> block after the
    # requested JSON object (its system prompt encourages this whenever it
    # cites evidence) — strip it before extracting our object.
    stripped = re.sub(r"<CITATIONS?>[\s\S]*?(?:</CITATIONS?>|$)", "", text, flags=re.IGNORECASE).strip()
    stripped = _strip_citation_markers(stripped)
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", stripped)
    if fence:
        stripped = fence.group(1).strip()
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    candidate = _extract_balanced_json_object(stripped)
    if candidate:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None


class ProjectMemoryManager:
    """Mongo-backed chronological memory of documents ingested into a project.

    Lives in the same `contract_agent_db` database as `AgentMemoryManager`
    (see services/agent_memory.py), following the same construction pattern:
    pass the core `db` handle in, and this derives the agent DB from its client.
    """

    def __init__(self, mongo_db):
        agent_db = mongo_db.client["contract_agent_db"]
        self.memories = agent_db["project_memories"]
        self.scratchpads = agent_db["project_scratchpads"]

    def _existing_light_docs(self, project_id: str) -> List[Dict[str, Any]]:
        if not project_id:
            return []
        docs = self.memories.find(
            {"project_id": project_id, "status": "success"},
            {"_id": 0, "contract_id": 1, "filename": 1, "doc_type": 1, "purpose_summary": 1, "uploaded_at": 1},
        ).sort("uploaded_at", 1)
        return list(docs)

    def _format_existing_docs(self, docs: List[Dict[str, Any]]) -> str:
        if not docs:
            return "(none — this is the first document in the project)"
        lines = []
        for doc in docs:
            uploaded = doc.get("uploaded_at")
            uploaded_str = uploaded.strftime("%Y-%m-%d") if isinstance(uploaded, datetime) else str(uploaded or "")
            lines.append(
                f"- {doc.get('filename', 'Unknown')} (type: {doc.get('doc_type', 'other')}, uploaded: {uploaded_str}): "
                f"{_clean_text(doc.get('purpose_summary'), 160)}"
            )
        return "\n".join(lines)

    def generate_document_overview(
        self,
        *,
        contract_id: str,
        project_id: Optional[str],
        contract_name: str,
        contract_text: str,
        ai_provider: str = "groq",
        user_id: str = "system",
        rag_system: Optional[Any] = None,
        uploaded_at: Optional[datetime] = None,
    ) -> Optional[Dict[str, Any]]:
        """Run one RAG-grounded call over the newly-ingested document to build its
        overview, then persist it.

        `uploaded_at` should be the contract's actual upload timestamp, not the
        time this call happens to run — project timeline/scratchpad ordering is
        sorted by this field, and it must reflect real upload chronology even
        when this step runs late or gets retried, not the moment the overview
        job executed.

        Never raises — failures are logged into the stored record as
        status="failed" so contract ingestion is never blocked by this step.
        """
        if not project_id:
            return None

        now = _now()
        record: Dict[str, Any] = {
            "memory_id": f"pm-{uuid4().hex}",
            "project_id": project_id,
            "contract_id": contract_id,
            "filename": contract_name,
            "uploaded_at": uploaded_at or now,
            "created_at": now,
            "status": "failed",
        }

        try:
            existing_docs = self._existing_light_docs(project_id)
            question = PROJECT_OVERVIEW_QUESTIONS.format(existing_docs=self._format_existing_docs(existing_docs))

            if rag_system is None:
                from services.contract_agent.rag.facade import ContractRAGSystem
                rag_system = ContractRAGSystem(ai_provider=ai_provider)

            result = rag_system.answer_agent_question(
                contract_text=contract_text,
                contract_name=contract_name,
                contract_id=contract_id,
                question=question,
                project_id=project_id,
                user_id=user_id,
            )

            parsed = _parse_json_object(result.answer)
            if not parsed:
                # The RAG call returned something we couldn't parse as the
                # requested JSON object (e.g. thin evidence on a short annex
                # produced a prose non-answer). Record it as a real failure
                # instead of silently persisting an empty-but-"success" row —
                # keep a snippet of the raw answer so this is diagnosable.
                record["status"] = "failed"
                record["raw_answer_snippet"] = _clean_text(result.answer, 500)
                self.memories.update_one(
                    {"project_id": project_id, "contract_id": contract_id},
                    {"$set": record},
                    upsert=True,
                )
                return record

            related_raw = parsed.get("related_to") if isinstance(parsed.get("related_to"), list) else []
            existing_by_filename = {doc.get("filename"): doc for doc in existing_docs}
            related_documents: List[Dict[str, Any]] = []
            for item in related_raw:
                if not isinstance(item, dict):
                    continue
                filename = str(item.get("filename") or "").strip()
                matched = existing_by_filename.get(filename)
                if not matched:
                    continue
                related_documents.append({
                    "contract_id": matched.get("contract_id"),
                    "filename": filename,
                    "relation_type": _clean_text(item.get("relation_type"), 40) or "references",
                    "evidence_quote": _clean_text(item.get("evidence_quote"), 300),
                })

            record.update({
                "doc_type": _clean_text(parsed.get("doc_type"), 40) or "other",
                "parties": [_clean_text(p, 200) for p in (parsed.get("parties") or []) if str(p).strip()][:10],
                "effective_date": _clean_text(parsed.get("effective_date"), 60) or None,
                "purpose_summary": _clean_text(parsed.get("purpose_summary"), 600),
                "key_topics": [_clean_text(t, 60) for t in (parsed.get("key_topics") or []) if str(t).strip()][:5],
                "related_documents": related_documents,
                "rag_confidence": result.confidence,
                "status": "success",
            })

            # This document's metadata section gets folded into the single
            # project-wide scratchpad below — see _sync_scratchpad.
            markdown_section = _build_markdown_section(record)
            record["markdown"] = markdown_section

            self.memories.update_one(
                {"project_id": project_id, "contract_id": contract_id},
                {"$set": record},
                upsert=True,
            )
            try:
                self._sync_scratchpad(project_id, contract_id, markdown_section, rag_system)
                record["memory_namespace"] = _project_memory_namespace(project_id)
                record["vectorized"] = True
            except Exception as embed_exc:
                # Structured overview above still succeeded — only the
                # semantic-search layer is degraded. The static
                # build_project_context_for_agent fallback still works.
                record["vectorized"] = False
                record["vector_error"] = str(embed_exc)[:500]
            self.memories.update_one(
                {"project_id": project_id, "contract_id": contract_id},
                {"$set": {"vectorized": record["vectorized"], "vector_error": record.get("vector_error"),
                          "memory_namespace": record.get("memory_namespace")}},
            )
            return record
        except Exception as exc:
            record["error"] = str(exc)[:500]

        self.memories.update_one(
            {"project_id": project_id, "contract_id": contract_id},
            {"$set": record},
            upsert=True,
        )
        return record

    def update_document_overview(
        self,
        *,
        project_id: str,
        contract_id: str,
        updates: Dict[str, Any],
        rag_system: Optional[Any] = None,
    ) -> Optional[Dict[str, Any]]:
        """Apply a manual correction to a document's overview — e.g. fixing a
        doc_type or a relation that the RAG extraction missed on a thin-evidence
        document (see generate_document_overview's failure path above). Re-builds
        the markdown section from the corrected fields and re-embeds it so
        search_project_memory stays consistent with what the UI shows. Editing
        always leaves the record status="success" — a human correction is not a
        failure state."""
        existing = self.memories.find_one({"project_id": project_id, "contract_id": contract_id})
        if not existing:
            return None
        existing.pop("_id", None)

        if "doc_type" in updates and updates["doc_type"] is not None:
            existing["doc_type"] = _clean_text(updates["doc_type"], 40) or "other"
        if "parties" in updates and updates["parties"] is not None:
            existing["parties"] = [str(p)[:200] for p in updates["parties"] if str(p).strip()][:10]
        if "effective_date" in updates:
            existing["effective_date"] = _clean_text(updates["effective_date"], 60) or None
        if "purpose_summary" in updates and updates["purpose_summary"] is not None:
            existing["purpose_summary"] = _clean_text(updates["purpose_summary"], 600)
        if "key_topics" in updates and updates["key_topics"] is not None:
            existing["key_topics"] = [str(t)[:60] for t in updates["key_topics"] if str(t).strip()][:5]
        if "related_documents" in updates and updates["related_documents"] is not None:
            existing_docs = self._existing_light_docs(project_id)
            by_filename = {doc.get("filename"): doc for doc in existing_docs}
            by_contract_id = {doc.get("contract_id"): doc for doc in existing_docs}
            resolved: List[Dict[str, Any]] = []
            for item in updates["related_documents"]:
                if not isinstance(item, dict):
                    continue
                matched = by_contract_id.get(item.get("contract_id")) or by_filename.get(
                    str(item.get("filename") or "").strip()
                )
                if not matched or matched.get("contract_id") == contract_id:
                    continue
                resolved.append({
                    "contract_id": matched.get("contract_id"),
                    "filename": matched.get("filename"),
                    "relation_type": _clean_text(item.get("relation_type"), 40) or "references",
                    "evidence_quote": _clean_text(item.get("evidence_quote"), 300),
                })
            existing["related_documents"] = resolved

        existing["status"] = "success"
        existing["edited_at"] = _now()
        existing.pop("error", None)
        existing.pop("raw_answer_snippet", None)

        markdown_section = _build_markdown_section(existing)
        existing["markdown"] = markdown_section

        self.memories.update_one(
            {"project_id": project_id, "contract_id": contract_id},
            {"$set": existing},
            upsert=False,
        )

        # Re-sync just this doc's marked section in the scratchpad — leaves
        # every other section (auto or manually edited) untouched.
        try:
            if rag_system is None:
                from services.contract_agent.rag.facade import ContractRAGSystem
                rag_system = ContractRAGSystem()
            self._sync_scratchpad(project_id, contract_id, markdown_section, rag_system)
            existing["memory_namespace"] = _project_memory_namespace(project_id)
            existing["vectorized"] = True
        except Exception as embed_exc:
            existing["vectorized"] = False
            existing["vector_error"] = str(embed_exc)[:500]
            self.memories.update_one(
                {"project_id": project_id, "contract_id": contract_id},
                {"$set": {"vectorized": False, "vector_error": existing["vector_error"]}},
            )
        return existing

    def get_scratchpad(self, project_id: str) -> Dict[str, Any]:
        """The single running project-memory document — one growing markdown
        journal for the whole project, not a per-document fragment. Each
        document's section auto-appends/updates in place as it's ingested or
        corrected (see _sync_scratchpad); a human can also edit the whole
        thing directly (see update_scratchpad) — the two coexist, since
        auto-sync only ever touches its own marked sections and never
        overwrites the rest of the text."""
        doc = self.scratchpads.find_one({"project_id": project_id}, {"_id": 0})
        if not doc:
            return {"project_id": project_id, "content": "", "updated_at": None, "edited_manually": False}
        return doc

    def update_scratchpad(
        self, project_id: str, content: str, rag_system: Optional[Any] = None
    ) -> Dict[str, Any]:
        """Freeform full-text overwrite of the project's single memory
        scratchpad. Marks edited_manually=True — purely informational (shown
        as a badge in the UI) — future document events still auto-append or
        update their own marked sections on top of whatever's here. Note: a
        full rewrite that drops the `<!-- pm:section:... -->` markers means
        the next event for an already-mentioned document won't find its old
        section and will append a fresh copy instead of replacing in place."""
        now = _now()
        self.scratchpads.update_one(
            {"project_id": project_id},
            {
                "$set": {"content": content, "updated_at": now, "edited_manually": True},
                "$setOnInsert": {"project_id": project_id, "created_at": now},
            },
            upsert=True,
        )
        vectorized = True
        try:
            if rag_system is None:
                from services.contract_agent.rag.facade import ContractRAGSystem
                rag_system = ContractRAGSystem()
            self._reembed_scratchpad(project_id=project_id, content=content, rag_system=rag_system)
        except Exception:
            vectorized = False
        return {
            "project_id": project_id,
            "content": content,
            "updated_at": now,
            "edited_manually": True,
            "vectorized": vectorized,
        }

    def _sync_scratchpad(
        self, project_id: str, contract_id: str, markdown_section: str, rag_system: Optional[Any] = None
    ) -> None:
        """Event-driven append/update: touches ONLY this document's marked
        section of the single project scratchpad — appended if this is the
        first time this document has synced, replaced in place (by its
        `<!-- pm:section:{contract_id} -->` marker) if it already exists.
        Everything else in the scratchpad — including any manual prose a
        human has added elsewhere — is left byte-for-byte untouched, so
        manual edits and auto-sync on new/edited documents coexist instead of
        one disabling the other."""
        existing = self.scratchpads.find_one({"project_id": project_id}, {"_id": 0}) or {}
        content = existing.get("content", "")
        wrapped = _wrap_scratchpad_section(contract_id, markdown_section)

        marker_re = re.compile(
            rf"<!-- pm:section:{re.escape(contract_id)} -->.*?<!-- /pm:section:{re.escape(contract_id)} -->",
            re.DOTALL,
        )
        if marker_re.search(content):
            content = marker_re.sub(lambda _match: wrapped, content, count=1)
        elif content.strip():
            content = content.rstrip() + "\n\n---\n\n" + wrapped
        else:
            content = wrapped

        now = _now()
        self.scratchpads.update_one(
            {"project_id": project_id},
            {
                "$set": {"content": content, "updated_at": now},
                "$setOnInsert": {"project_id": project_id, "created_at": now, "edited_manually": False},
            },
            upsert=True,
        )
        if rag_system is None:
            from services.contract_agent.rag.facade import ContractRAGSystem
            rag_system = ContractRAGSystem()
        self._reembed_scratchpad(project_id=project_id, content=content, rag_system=rag_system)

    def _reembed_scratchpad(self, *, project_id: str, content: str, rag_system: Any) -> None:
        """The scratchpad is the ONLY thing in this project's vector
        namespace now (no more per-document fragments), so a full replace on
        every change is correct and simple — no scoped per-contract deletes
        needed."""
        from langchain_core.documents import Document

        namespace = _project_memory_namespace(project_id)
        if not content.strip():
            mongo_collection = getattr(rag_system.vector_manager, "mongo_collection", None)
            if mongo_collection is not None:
                mongo_collection.delete_many({"namespace": namespace})
            return

        doc = Document(
            page_content=content,
            metadata={"project_id": project_id, "kind": "project_scratchpad"},
        )
        rag_system.vector_manager.create_vector_store(
            documents=[doc],
            contract_name=f"Project memory — {project_id}",
            namespace=namespace,
            project_id=project_id,
            replace_existing=True,
        )

    def search_project_memory(
        self,
        project_id: str,
        query: str,
        *,
        top_k: int = 6,
        rag_system: Optional[Any] = None,
    ) -> Optional[str]:
        """Semantic top-k search over the project's vectorized document
        overviews. Returns None (caller should fall back to
        build_project_context_for_agent) if no vector data exists yet — e.g.
        documents ingested before this feature, or the vector backend being
        unavailable."""
        try:
            if rag_system is None:
                from services.contract_agent.rag.facade import ContractRAGSystem
                rag_system = ContractRAGSystem()
            store = rag_system.vector_manager.load_existing_vector_store(_project_memory_namespace(project_id))
            if store is None:
                return None
            hits = store.similarity_search(query or "project document history", k=top_k)
            if not hits:
                return None
        except Exception:
            return None

        lines = [
            "Project memory below (semantically matched to your question) is for "
            "context only — not citation evidence. Cite specific clauses only from "
            "search_evidence/read_document results.",
        ]
        # Chunks are slices of the single project scratchpad (see
        # _reembed_scratchpad), not per-document fragments, so there's no
        # per-hit filename/doc_type metadata to show — just the matched text.
        for hit in hits:
            lines.append(f"\n{_clean_text(getattr(hit, 'page_content', ''), 900)}")
        return "\n".join(lines)[:MAX_CONTEXT_CHARS]

    def build_project_timeline(self, project_id: str) -> List[Dict[str, Any]]:
        """Chronological, grouped view: schedules/annexes/amendments nest under
        the parent document they explicitly reference, instead of appearing as
        flat unrelated rows."""
        docs = list(self.memories.find({"project_id": project_id}, {"_id": 0}).sort("uploaded_at", 1))
        by_contract_id = {doc.get("contract_id"): doc for doc in docs}
        children_of: Dict[str, List[Dict[str, Any]]] = {}
        claimed_as_child: set = set()

        for doc in docs:
            for related in doc.get("related_documents") or []:
                parent_id = related.get("contract_id")
                if parent_id and parent_id in by_contract_id and parent_id != doc.get("contract_id"):
                    children_of.setdefault(parent_id, []).append(doc)
                    claimed_as_child.add(doc.get("contract_id"))
                    break

        top_level: List[Dict[str, Any]] = []
        for doc in docs:
            if doc.get("contract_id") in claimed_as_child:
                continue
            entry = dict(doc)
            entry["related_uploads"] = children_of.get(doc.get("contract_id"), [])
            top_level.append(entry)
        return top_level

    def build_project_context_for_agent(self, project_id: str, question: str = "") -> str:
        """Compact chronological narrative injected as agent context — mirrors
        AgentMemoryManager.build_memory_context's "context only, not evidence"
        framing so the model never cites this text as contract language."""
        docs = list(
            self.memories.find({"project_id": project_id, "status": "success"}, {"_id": 0}).sort("uploaded_at", 1)
        )
        if not docs:
            return "No project document history is available yet for this project."

        parts = [
            "Project document history below is for context only — not citation evidence. "
            "Cite specific clauses only from search_evidence/read_document results.",
        ]
        lines = []
        for doc in docs:
            uploaded = doc.get("uploaded_at")
            uploaded_str = uploaded.strftime("%Y-%m-%d") if isinstance(uploaded, datetime) else str(uploaded or "")
            related = doc.get("related_documents") or []
            relation_note = ""
            if related:
                relation_note = " Relates to: " + "; ".join(
                    f"{r.get('filename')} ({r.get('relation_type')})" for r in related
                )
            lines.append(
                f"- [{uploaded_str}] {doc.get('filename')} ({doc.get('doc_type', 'other')}): "
                f"{doc.get('purpose_summary', '')}{relation_note}"
            )
        parts.append("Chronological project timeline:\n" + "\n".join(lines))
        return "\n\n".join(parts)[:MAX_CONTEXT_CHARS]
