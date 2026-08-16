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
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

import yaml
from bson import ObjectId

logger = logging.getLogger(__name__)



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



CONCEPT_TYPE_DOCUMENT = "contract-document"


def _frontmatter(fields: Dict[str, Any]) -> str:
    """Emit OKF-style YAML frontmatter, dropping empty values so a sparse
    record doesn't render a wall of nulls. Uses safe_dump rather than hand
    formatting because these values are model output — filenames, party names
    and summaries routinely contain colons, quotes and newlines that would
    otherwise produce invalid YAML."""
    present = {k: v for k, v in fields.items() if v not in (None, "", [], {})}
    body = yaml.safe_dump(present, sort_keys=False, allow_unicode=True, default_flow_style=False)
    return f"---\n{body}---"


def render_concept(record: Dict[str, Any]) -> str:
    """One document's overview as a standalone OKF concept: YAML frontmatter
    carrying the queryable fields, markdown body carrying the prose.

    `project_id` lives in the frontmatter deliberately. Scoping memory to its
    own project used to be per-call-site discipline, and the one call site that
    forgot leaked every project's documents into every other project's answers.
    A field on the concept itself is a filter that cannot be forgotten.
    """
    uploaded = record.get("uploaded_at")
    uploaded_iso = uploaded.isoformat() if isinstance(uploaded, datetime) else (str(uploaded or "") or None)
    related = record.get("related_documents") or []

    front = _frontmatter({
        "type": CONCEPT_TYPE_DOCUMENT,
        "title": record.get("filename"),
        "project_id": record.get("project_id"),
        "source_contract_id": record.get("contract_id"),
        "doc_type": record.get("doc_type") or "other",
        "effective_date": record.get("effective_date"),
        "timestamp": uploaded_iso,
        "tags": list(record.get("key_topics") or []),
        "links": [
            f"{r.get('relation_type')}:{r.get('filename')}"
            for r in related
            if r.get("filename")
        ],
        "confidence": record.get("rag_confidence"),
    })

    parties = ", ".join(record.get("parties") or []) or "—"
    relates_to = "; ".join(f"{r.get('relation_type')} {r.get('filename')}" for r in related) or "(none)"
    body = [
        f"# {record.get('filename')}",
        "",
        f"**Parties:** {parties}",
        "",
        record.get("purpose_summary") or "",
        "",
        f"**Relates to:** {relates_to}",
    ]
    return f"{front}\n\n" + "\n".join(body).strip()


_SECTION_MARKER_RE = re.compile(
    r"<!-- pm:section:([0-9a-zA-Z]+) -->.*?<!-- /pm:section:\1 -->", re.DOTALL
)
_BARE_SEPARATOR_RE = re.compile(r"^\s*---\s*$", re.M)


def split_scratchpad(content: str) -> Dict[str, Any]:
    """Separate a legacy glued scratchpad into the part that is regenerable and
    the part that is not.

    Everything inside a `pm:section` marker pair was rendered from a memory
    record and can be rebuilt at any time. Everything outside was typed by a
    human and exists nowhere else — no record, no contract field, no backup.
    That asymmetry is the whole risk of this migration, so the split is a
    named, tested function rather than an inline regex at the call site.
    """
    sections = [match.group(1) for match in _SECTION_MARKER_RE.finditer(content or "")]
    remainder = _SECTION_MARKER_RE.sub("", content or "")
    remainder = _BARE_SEPARATOR_RE.sub("", remainder).strip()
    return {"notes": remainder, "section_contract_ids": sections}


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

    Purely Mongo — nothing here is embedded. The scratchpad used to be written
    into a `project-memory-{id}` vector namespace, but it was stored as a single
    document smaller than the splitter's chunk size, so retrieval could only
    ever return the one chunk it had just written. Reading the scratchpad
    directly is the same answer without the round trip. Vectors belong on units
    that actually need ranking between them.
    """

    def __init__(self, mongo_db):
        agent_db = mongo_db.client["contract_agent_db"]
        self.memories = agent_db["project_memories"]
        self.scratchpads = agent_db["project_scratchpads"]
        # The index is built from the contracts collection, not from memory —
        # see render_index for why.
        self.contracts = mongo_db["contracts"]

    def render_index(self, project_id: str) -> str:
        """Every document in the project, one line each. Complete by
        construction and never ranked or truncated.

        Enumerates `contracts`, not `project_memories`. Overview generation is
        best-effort at ingest and explicitly never fails ingestion, so a
        document can sit in a project with no memory record at all — and every
        other reader here filters on `status: "success"`. Building the index
        from memory would inherit that hole and quietly present a partial
        project as the whole one, which is the failure this index exists to
        prevent. A document without a usable overview gets a row saying so.
        """
        if not project_id or not ObjectId.is_valid(project_id):
            return "No project in scope."

        contracts = list(
            self.contracts.find(
                {"projectId": ObjectId(project_id)},
                {"contract_name": 1, "status": 1, "uploaded_at": 1},
            ).sort("uploaded_at", 1)
        )
        memories = {
            str(m.get("contract_id")): m
            for m in self.memories.find({"project_id": project_id})
        }

        lines: List[str] = []
        for contract in contracts:
            contract_id = str(contract["_id"])
            record = memories.get(contract_id)
            name = contract.get("contract_name") or (record or {}).get("filename") or "(unnamed)"
            uploaded = contract.get("uploaded_at")
            uploaded_str = uploaded.strftime("%Y-%m-%d") if isinstance(uploaded, datetime) else ""

            if record and record.get("status") == "success":
                related = record.get("related_documents") or []
                relates = ", ".join(
                    f"{r.get('relation_type')} {r.get('filename')}" for r in related
                ) or "none"
                detail = f"{record.get('doc_type') or 'other'} · relates to: {relates}"
            elif record:
                detail = f"overview unavailable ({record.get('status') or 'unknown'})"
            else:
                detail = f"no overview yet (ingest status: {contract.get('status') or 'unknown'})"

            lines.append(f"- {name} · {uploaded_str} · {detail} · id: {contract_id}")

        # Memory records whose contract is gone from the project. Currently
        # reachable via project deletion, which reassigns contracts to the
        # fallback project without moving or removing their memory.
        orphans = [
            record for contract_id, record in memories.items()
            if contract_id not in {str(c["_id"]) for c in contracts}
        ]
        for record in orphans:
            lines.append(
                f"- {record.get('filename')} · no longer in this project "
                f"· id: {record.get('contract_id')}"
            )

        if not lines:
            return "This project has no documents yet."
        return "Documents in this project (complete list):\n" + "\n".join(lines)

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

            # The rendered concept is stored alongside the typed fields rather
            # than glued into a project-wide blob: it is fetched per document,
            # on demand, by contract_id.
            record["markdown"] = render_concept(record)

            self.memories.update_one(
                {"project_id": project_id, "contract_id": contract_id},
                {"$set": record},
                upsert=True,
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
        the markdown section from the corrected fields and re-syncs it so
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

        existing["markdown"] = render_concept(existing)

        self.memories.update_one(
            {"project_id": project_id, "contract_id": contract_id},
            {"$set": existing},
            upsert=False,
        )
        return existing

    def get_notes(self, project_id: str) -> Dict[str, Any]:
        """The project's human-written notes. Prose only — document overviews
        are concepts now, rendered from their records on demand, so nothing
        auto-writes into this and a human's text is never interleaved with
        generated sections."""
        doc = self.scratchpads.find_one({"project_id": project_id}, {"_id": 0})
        if not doc:
            return {"project_id": project_id, "content": "", "updated_at": None, "edited_manually": False}
        return doc

    def update_notes(self, project_id: str, content: str) -> Dict[str, Any]:
        """Overwrite the project's notes. Nothing else writes here, so there is
        no merge to do and no auto-sync to coexist with."""
        now = _now()
        self.scratchpads.update_one(
            {"project_id": project_id},
            {
                "$set": {"content": content, "updated_at": now, "edited_manually": True},
                "$setOnInsert": {"project_id": project_id, "created_at": now},
            },
            upsert=True,
        )
        return {
            "project_id": project_id,
            "content": content,
            "updated_at": now,
            "edited_manually": True,
        }

    def read_concept(self, project_id: str, contract_id: str) -> Optional[str]:
        """One document's full overview, fetched by id. Re-renders from the
        typed fields rather than trusting the stored `markdown`, so a record
        written before the concept format still comes back in it."""
        record = self.memories.find_one(
            {"project_id": project_id, "contract_id": contract_id}, {"_id": 0}
        )
        if not record:
            return None
        if record.get("status") != "success":
            return (
                f"No usable overview for this document (status: "
                f"{record.get('status') or 'unknown'}). Read the document itself instead."
            )
        return render_concept(record)

    def transfer_project_memory(self, from_project_id: str, to_project_id: str) -> Dict[str, Any]:
        """Move a project's memory to another project, for when its documents
        move there.

        Deleting a project reassigns its contracts to the fallback project
        rather than deleting them. Without this, their overviews stay behind
        under a project_id that no longer exists: the fallback project shows
        every reassigned document as "no overview yet" while the real work sits
        orphaned and unreachable.

        Notes are appended rather than overwritten — the destination may have
        its own, and prose typed by a person is not ours to discard. A record
        already present at the destination wins, since it describes the
        document in the project it now actually lives in.
        """
        if not from_project_id or not to_project_id or from_project_id == to_project_id:
            return {"memories_moved": 0, "notes_appended": False}

        existing_ids = {
            str(record.get("contract_id"))
            for record in self.memories.find({"project_id": to_project_id}, {"contract_id": 1})
        }
        moved = 0
        for record in list(self.memories.find({"project_id": from_project_id})):
            if str(record.get("contract_id")) in existing_ids:
                self.memories.delete_one({"_id": record["_id"]})
                continue
            self.memories.update_one(
                {"_id": record["_id"]}, {"$set": {"project_id": to_project_id}}
            )
            moved += 1

        source_notes = (self.get_notes(from_project_id).get("content") or "").strip()
        notes_appended = False
        if source_notes:
            target_notes = (self.get_notes(to_project_id).get("content") or "").strip()
            carried = f"## Notes carried over from a deleted project\n\n{source_notes}"
            self.update_notes(
                to_project_id,
                f"{target_notes}\n\n---\n\n{carried}" if target_notes else carried,
            )
            notes_appended = True

        self.scratchpads.delete_one({"project_id": from_project_id})
        return {"memories_moved": moved, "notes_appended": notes_appended}

    def migrate_scratchpads_to_notes(self, *, dry_run: bool = True) -> List[Dict[str, Any]]:
        """Reduce every legacy scratchpad to the human prose it contains.

        Defaults to dry_run because the generated sections are recoverable and
        the prose is not: if the split is wrong, a real run destroys the only
        copy. Returns per-project detail either way so a caller can inspect
        exactly what would be kept before committing to it.
        """
        results: List[Dict[str, Any]] = []
        for doc in self.scratchpads.find({}):
            project_id = doc.get("project_id")
            content = doc.get("content") or ""
            split = split_scratchpad(content)
            notes = split["notes"]

            known_ids = {
                str(record.get("contract_id"))
                for record in self.memories.find({"project_id": project_id}, {"contract_id": 1})
            }
            # A marked section whose record is gone is NOT regenerable, so it
            # is kept as prose rather than dropped on the assumption it can be
            # rebuilt.
            orphaned = [cid for cid in split["section_contract_ids"] if cid not in known_ids]
            if orphaned:
                for match in _SECTION_MARKER_RE.finditer(content):
                    if match.group(1) in orphaned:
                        notes = (notes + "\n\n" + match.group(0)).strip()

            results.append({
                "project_id": project_id,
                "before_chars": len(content),
                "after_chars": len(notes),
                "sections_dropped": len(split["section_contract_ids"]) - len(orphaned),
                "orphaned_sections_kept": orphaned,
                "notes_preview": notes[:200],
            })

            if not dry_run:
                self.scratchpads.update_one(
                    {"project_id": project_id},
                    {"$set": {"content": notes, "migrated_at": _now()}},
                )
        return results

    def build_memory_context(self, project_id: str) -> Optional[str]:
        """What the agent gets up front: the complete document index, plus any
        human notes. Uncapped, because both are small and truncating either one
        silently drops documents.

        Deliberately excludes the per-document overviews. They used to all be
        concatenated into one blob and sent every turn; now the index carries
        enough to answer "what is in this project and how do these relate",
        and the agent pulls a full concept by id when it needs the detail.
        """
        parts = [
            "Project memory below is for context only — not citation evidence. "
            "Cite specific clauses only from search_evidence/read_document results.",
            self.render_index(project_id),
        ]

        notes = (self.get_notes(project_id).get("content") or "").strip()
        if notes:
            parts.append(f"Notes written by the team:\n{notes}")

        return "\n\n".join(parts)

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
        # Uncapped for the same reason as search_project_memory: truncating a
        # chronological list drops the most recent documents, so the agent
        # confidently answers about a project it has only partly been shown.
        return "\n\n".join(parts)
