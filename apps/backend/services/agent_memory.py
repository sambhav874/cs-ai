"""Persistent contract-agent memory and work product storage.

The chat agent keeps source-of-truth contract evidence in RAG, while this module
stores conversation state and lightweight turn summaries. Memory is injected as
conversation context only; it is never treated as citation evidence.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4


MAX_MEMORY_CHARS = 3500
RECENT_MESSAGE_LIMIT = 8
SUMMARY_AFTER_MESSAGES = 14


def _now() -> datetime:
    return datetime.utcnow()


def _clean_text(value: Any, limit: int = 2000) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    return text[:limit]


def _clean_message_content(value: Any, limit: int = 12000) -> str:
    text = str(value or "").strip()
    return text[:limit]


def _title_from_message(message: str) -> str:
    title = _clean_text(message, 80)
    return title or "Contract assistant chat"


def _is_placeholder_title(title: Any) -> bool:
    return _clean_text(title, 120).lower() in {
        "",
        "untitled chat",
        "contract assistant chat",
    }


def _question_memory_key(question: str) -> Optional[str]:
    lowered = (question or "").lower()
    rules = [
        ("payment_terms", ["payment", "invoice", "fee", "rate", "price", "billing"]),
        ("termination_terms", ["termination", "terminate", "renewal", "expiry", "cure"]),
        ("obligations", ["obligation", "deadline", "deliverable", "shall", "must"]),
        ("risk_review", ["risk", "liability", "indemnity", "warranty", "breach"]),
        ("drafting", ["draft", "approval note", "edit", "redline", "amend", "rewrite"]),
    ]
    for key, terms in rules:
        if any(term in lowered for term in terms):
            return key
    return None


def _work_product_side_effect_requested(question: str) -> bool:
    text = (question or "").lower()
    if re.search(r"\b(redline|edit|revise|rewrite|amend|change|replace|apply)\b", text):
        return True
    if re.search(r"\b(generate|create|draft|prepare|write|compose|make|produce|build)\b", text):
        return bool(re.search(
            r"\b(document|docx|word|note|memo|letter|notice|template|checklist|agreement|amendment|clause|copy|copies|language)\b",
            text,
        ))
    return bool(re.search(r"\b(yes|ok|okay|do it|make it|create it|generate it|apply it)\b", text))


def detect_work_product_type(question: str, answer: str = "") -> Optional[str]:
    """Infer a DOCX work-product type only when the user asked for a side effect."""
    if not _work_product_side_effect_requested(question):
        return None
    question_text = (question or "").lower()
    answer_text = (answer or "").lower()
    haystack = question_text if len(question_text.split()) > 4 else f"{question_text}\n{answer_text}"
    if re.search(r"\b(checklist|conditions precedent|cp checklist|closing checklist)\b", haystack):
        return "checklist"
    if "template" in haystack:
        return "template"
    if re.search(r"\b(approval note|approval memo|approval email)\b", haystack):
        return "approval_note"
    if re.search(r"\b(redline|edit suggestions?|suggest(ed)? edits?|revise|rewrite|amend|change it|replace|replacement language|supplier name)\b", haystack):
        return "edit_suggestions"
    if re.search(r"\bchange\s+the\b.{0,60}\b(name|party|supplier|customer|vendor)\b", haystack):
        return "edit_suggestions"
    if re.search(r"\b(draft|clause language|amendment language|contract language|amendment to|sample amendment|proposed amendment)\b", haystack):
        return "draft"
    return None


class AgentMemoryManager:
    """Mongo-backed memory manager for contract assistant chat."""

    def __init__(self, mongo_db):
        self.sessions = mongo_db["agent_chat_sessions"]
        self.messages = mongo_db["agent_chat_messages"]
        self.memories = mongo_db["agent_memories"]
        self.drafts = mongo_db["agent_drafts"]

    def ensure_session(
        self,
        *,
        contract_id: str,
        user_id: str,
        session_id: Optional[str] = None,
        contract_name: Optional[str] = None,
        project_id: Optional[str] = None,
        title_seed: str = "",
    ) -> Dict[str, Any]:
        query = {
            "contract_id": contract_id,
            "user_id": user_id,
            "archived_at": {"$exists": False},
        }
        if session_id:
            existing = self.sessions.find_one({**query, "session_id": session_id})
            if existing:
                return existing

        new_session_id = session_id or f"agent-{uuid4().hex}"
        now = _now()
        doc = {
            "session_id": new_session_id,
            "contract_id": contract_id,
            "project_id": project_id,
            "contract_name": contract_name or contract_id,
            "user_id": user_id,
            "title": _title_from_message(title_seed),
            "summary": "",
            "message_count": 0,
            "created_at": now,
        }
        self.sessions.update_one(
            {"session_id": new_session_id, "contract_id": contract_id, "user_id": user_id},
            {"$setOnInsert": doc, "$set": {"updated_at": now}},
            upsert=True,
        )
        return self.sessions.find_one({"session_id": new_session_id}) or {**doc, "updated_at": now}

    def list_sessions(self, *, contract_id: str, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        docs = self.sessions.find(
            {
                "contract_id": contract_id,
                "user_id": user_id,
                "archived_at": {"$exists": False},
            },
            {"_id": 0},
        ).sort("updated_at", -1).limit(limit)
        return self._hydrate_session_titles(list(docs), user_id=user_id)

    def list_recent_sessions(self, *, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        docs = self.sessions.find(
            {
                "user_id": user_id,
                "archived_at": {"$exists": False},
            },
            {"_id": 0},
        ).sort("updated_at", -1).limit(limit)
        return self._hydrate_session_titles(list(docs), user_id=user_id)

    def _hydrate_session_titles(self, sessions: List[Dict[str, Any]], *, user_id: str) -> List[Dict[str, Any]]:
        for session in sessions:
            if not _is_placeholder_title(session.get("title")):
                continue
            session_id = session.get("session_id")
            if not session_id:
                continue
            message_query = {"session_id": session_id, "user_id": user_id, "role": "user"}
            if session.get("contract_id"):
                message_query["contract_id"] = session["contract_id"]
            first_user_message = self.messages.find_one(
                message_query,
                {"content": 1},
                sort=[("created_at", 1)],
            )
            next_title = _title_from_message((first_user_message or {}).get("content", ""))
            if _is_placeholder_title(next_title):
                continue
            session["title"] = next_title
            self.sessions.update_one(
                {"session_id": session_id, "user_id": user_id},
                {"$set": {"title": next_title}},
            )
        return sessions

    def get_messages(self, *, session_id: str, contract_id: str, user_id: str, limit: int = 200) -> List[Dict[str, Any]]:
        session = self.sessions.find_one({
            "session_id": session_id,
            "contract_id": contract_id,
            "user_id": user_id,
            "archived_at": {"$exists": False},
        })
        if not session:
            return []
        docs = self.messages.find(
            {"session_id": session_id, "contract_id": contract_id, "user_id": user_id},
            {"_id": 0},
        ).sort("created_at", 1).limit(limit)
        return list(docs)

    def append_message(
        self,
        *,
        session_id: str,
        contract_id: str,
        user_id: str,
        role: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        now = _now()
        doc = {
            "message_id": f"msg-{uuid4().hex}",
            "session_id": session_id,
            "contract_id": contract_id,
            "user_id": user_id,
            "role": role,
            "content": _clean_message_content(content, 12000),
            "metadata": metadata or {},
            "created_at": now,
        }
        self.messages.insert_one(doc)
        session = self.sessions.find_one(
            {"session_id": session_id, "contract_id": contract_id, "user_id": user_id},
            {"title": 1},
        ) or {}
        set_values: Dict[str, Any] = {"updated_at": now}
        if role == "user" and _is_placeholder_title(session.get("title")):
            set_values["title"] = _title_from_message(content)
        self.sessions.update_one(
            {"session_id": session_id, "contract_id": contract_id, "user_id": user_id},
            {
                "$inc": {"message_count": 1},
                "$set": set_values,
                "$setOnInsert": {"created_at": now},
            },
        )
        self._summarize_session_if_needed(session_id=session_id, contract_id=contract_id, user_id=user_id)
        return doc

    def _summarize_session_if_needed(self, *, session_id: str, contract_id: str, user_id: str) -> None:
        count = self.messages.count_documents({"session_id": session_id, "contract_id": contract_id, "user_id": user_id})
        if count <= SUMMARY_AFTER_MESSAGES:
            return

        older_count = max(0, count - RECENT_MESSAGE_LIMIT)
        older = list(
            self.messages.find(
                {"session_id": session_id, "contract_id": contract_id, "user_id": user_id},
                {"role": 1, "content": 1, "created_at": 1},
            ).sort("created_at", 1).limit(older_count)
        )
        if not older:
            return

        lines: List[str] = []
        for message in older[-12:]:
            role = "User" if message.get("role") == "user" else "Assistant"
            lines.append(f"- {role}: {_clean_text(message.get('content'), 220)}")

        existing_summary = (self.sessions.find_one({"session_id": session_id}) or {}).get("summary", "")
        summary = _clean_text(f"{existing_summary}\n" + "\n".join(lines), MAX_MEMORY_CHARS)
        self.sessions.update_one(
            {"session_id": session_id, "contract_id": contract_id, "user_id": user_id},
            {"$set": {"summary": summary, "summarized_message_count": older_count, "updated_at": _now()}},
        )

    def build_memory_context(
        self,
        *,
        session_id: str,
        contract_id: str,
        user_id: str,
        question: str,
    ) -> str:
        session = self.sessions.find_one({
            "session_id": session_id,
            "contract_id": contract_id,
            "user_id": user_id,
            "archived_at": {"$exists": False},
        })
        if not session:
            return ""

        recent = list(
            self.messages.find(
                {"session_id": session_id, "contract_id": contract_id, "user_id": user_id},
                {"role": 1, "content": 1, "created_at": 1},
            ).sort("created_at", -1).limit(RECENT_MESSAGE_LIMIT)
        )
        recent.reverse()

        semantic = self._semantic_memories(contract_id=contract_id, user_id=user_id, question=question)
        parts = [
            "Conversation memory below is for continuity only. Do not treat it as contract evidence and do not cite it.",
        ]
        summary = _clean_text(session.get("summary"), 1200)
        if summary:
            parts.append(f"Prior conversation summary:\n{summary}")
        if recent:
            recent_lines = [
                f"- {'User' if msg.get('role') == 'user' else 'Assistant'}: {_clean_text(msg.get('content'), 360)}"
                for msg in recent
            ]
            parts.append("Recent turns:\n" + "\n".join(recent_lines))
        if semantic:
            memory_lines = [f"- {item.get('memory_key')}: {_clean_text(item.get('content'), 240)}" for item in semantic]
            parts.append("Useful remembered topics:\n" + "\n".join(memory_lines))

        return "\n\n".join(parts)[:MAX_MEMORY_CHARS]

    def _semantic_memories(self, *, contract_id: str, user_id: str, question: str) -> List[Dict[str, Any]]:
        query_terms = {
            token.lower()
            for token in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{3,}", question or "")
        }
        memories = list(
            self.memories.find(
                {"contract_id": contract_id, "user_id": user_id},
                {"_id": 0},
            ).sort("updated_at", -1).limit(12)
        )
        scored = []
        for memory in memories:
            haystack = f"{memory.get('memory_key', '')} {memory.get('content', '')}".lower()
            overlap = sum(1 for term in query_terms if term in haystack)
            scored.append((overlap, memory))
        return [memory for score, memory in sorted(scored, key=lambda item: (-item[0], item[1].get("updated_at", _now())), reverse=False) if score > 0][:3]

    def remember_turn(
        self,
        *,
        contract_id: str,
        user_id: str,
        session_id: str,
        question: str,
        answer: str,
    ) -> None:
        key = _question_memory_key(question)
        if not key or not answer:
            return
        now = _now()
        content = _clean_text(answer, 500)
        self.memories.update_one(
            {"contract_id": contract_id, "user_id": user_id, "memory_key": key},
            {
                "$set": {
                    "content": content,
                    "source_session_id": session_id,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

    def record_draft_if_any(
        self,
        *,
        contract_id: str,
        project_id: Optional[str],
        user_id: str,
        session_id: str,
        question: str,
        answer: str,
        metadata: Optional[Dict[str, Any]] = None,
        artifact: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        draft_type = detect_work_product_type(question, answer)
        if not draft_type and artifact:
            draft_type = str(artifact.get("draft_type") or "draft")
        if not draft_type:
            return None
        now = _now()
        stored_metadata = dict(metadata or {})
        if artifact:
            stored_metadata["artifact"] = artifact
        doc = {
            "draft_id": f"draft-{uuid4().hex}",
            "contract_id": contract_id,
            "project_id": project_id,
            "user_id": user_id,
            "session_id": session_id,
            "draft_type": draft_type,
            "title": _title_from_message(question),
            "prompt": _clean_text(question, 1000),
            "content": _clean_message_content(answer, 20000),
            "metadata": stored_metadata,
            "status": "draft",
            "created_at": now,
            "updated_at": now,
        }
        self.drafts.insert_one(doc)
        return doc

    def list_drafts(self, *, contract_id: str, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        docs = self.drafts.find(
            {"contract_id": contract_id, "user_id": user_id},
            {"_id": 0},
        ).sort("updated_at", -1).limit(limit)
        return list(docs)

    def clear_session(self, *, session_id: str, contract_id: str, user_id: str) -> bool:
        result = self.sessions.update_one(
            {"session_id": session_id, "contract_id": contract_id, "user_id": user_id},
            {"$set": {"archived_at": _now(), "updated_at": _now()}},
        )
        return result.matched_count > 0
