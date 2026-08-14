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
Respond with ONLY a single JSON object (no prose, no markdown fences) with these exact keys:

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


def _clean_text(value: Any, limit: int = 2000) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


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
    ) -> Optional[Dict[str, Any]]:
        """Run one RAG-grounded call over the newly-ingested document to build its
        overview, then persist it.

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
            "uploaded_at": now,
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

            parsed = _parse_json_object(result.answer) or {}
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

            citation_details = result.citation_details if isinstance(result.citation_details, dict) else {}
            record.update({
                "doc_type": _clean_text(parsed.get("doc_type"), 40) or "other",
                "parties": [str(p)[:200] for p in (parsed.get("parties") or []) if str(p).strip()][:10],
                "effective_date": _clean_text(parsed.get("effective_date"), 60) or None,
                "purpose_summary": _clean_text(parsed.get("purpose_summary"), 600),
                "key_topics": [str(t)[:60] for t in (parsed.get("key_topics") or []) if str(t).strip()][:5],
                "related_documents": related_documents,
                "citation_refs": citation_details.get("annotations", []),
                "rag_confidence": result.confidence,
                "status": "success",
            })
        except Exception as exc:
            record["error"] = str(exc)[:500]

        self.memories.update_one(
            {"project_id": project_id, "contract_id": contract_id},
            {"$set": record},
            upsert=True,
        )
        return record

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
