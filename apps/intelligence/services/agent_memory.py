"""Persistent contract-agent memory and work product storage.

The chat agent keeps source-of-truth contract evidence in RAG, while this module
stores conversation state and lightweight turn summaries. Memory is injected as
conversation context only; it is never treated as citation evidence.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence
from uuid import uuid4

from services.memory import lifecycle, semantic
from services.memory.summarizer import (
    SUMMARY_BUDGET_CHARS,
    summarize_run_outcome,
    summarize_session,
)


MAX_MEMORY_CHARS = 3500
RECENT_MESSAGE_LIMIT = 8
SUMMARY_AFTER_MESSAGES = 14

# Messages that must age out before another fold runs. Without it the summary
# would be rebuilt on every single append, which is one LLM call per turn to
# re-express material that has not changed.
SUMMARY_STRIDE = 6


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


# `_question_memory_key` lived here: five keyword buckets that any question
# was forced into, becoming the key a memory was written under and overwrote.
# It is why a contract could remember exactly one thing about payment, and why
# that thing was whichever answer mentioned an invoice most recently (F-20).
# Memories are now keyed by their own question and ranked by embedding.


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
        agent_db = mongo_db.client["contract_agent_db"]
        self.sessions = agent_db["agent_chat_sessions"]
        self.messages = agent_db["agent_chat_messages"]
        self.memories = agent_db["agent_memories"]
        self.drafts = agent_db["agent_drafts"]
        self.episodes = agent_db["agent_run_episodes"]

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

    def _summarize_session_if_needed(
        self,
        *,
        session_id: str,
        contract_id: str,
        user_id: str,
        model: Optional[Any] = None,
    ) -> None:
        """Fold newly-aged messages into the running summary.

        Only the messages that have aged out *since the last fold* are read.
        The rest are already represented in the summary, and re-summarizing
        them every time would both cost a full re-read per turn and let each
        pass paraphrase the previous pass's paraphrase.

        Runs at most once per `SUMMARY_STRIDE` messages rather than on every
        append, which is what turns this from an LLM call per turn into one per
        several turns.
        """
        query = {"session_id": session_id, "contract_id": contract_id, "user_id": user_id}
        count = self.messages.count_documents(query)
        if count <= SUMMARY_AFTER_MESSAGES:
            return

        session = self.sessions.find_one(query) or {}
        already_summarized = int(session.get("summarized_message_count") or 0)
        older_count = max(0, count - RECENT_MESSAGE_LIMIT)
        if older_count - already_summarized < SUMMARY_STRIDE:
            return

        aged = list(
            self.messages.find(query, {"role": 1, "content": 1, "created_at": 1})
            .sort("created_at", 1)
            .limit(older_count)
        )[already_summarized:]
        if not aged:
            return

        summary = summarize_session(
            str(session.get("summary") or ""),
            aged,
            model=model,
            budget=SUMMARY_BUDGET_CHARS,
        )
        self.sessions.update_one(
            query,
            {
                "$set": {
                    "summary": summary,
                    "summarized_message_count": older_count,
                    "updated_at": _now(),
                }
            },
        )

    def record_run_episode(
        self,
        *,
        session_id: str,
        contract_id: str,
        user_id: str,
        project_id: Optional[str],
        question: str,
        tools_called: Sequence[str],
        citation_count: int = 0,
        confidence: Any = None,
        unsupported: bool = False,
        workflow_id: Optional[str] = None,
        correction: str = "",
    ) -> Dict[str, Any]:
        """One episode per completed run: what was asked, how it was worked.

        Distinct from a chat message, which records what was *said*. An episode
        records what the agent *did* — the tool sequence, whether evidence was
        found, how confident it was. That makes "what have we already checked
        on this contract?" answerable across sessions, and it is the trajectory
        substrate 2.4 mines.
        """
        doc = {
            "episode_id": f"ep-{uuid4().hex}",
            "session_id": session_id,
            "contract_id": contract_id,
            "project_id": project_id,
            "user_id": user_id,
            "workflow_id": workflow_id,
            "question": _clean_text(question, 400),
            "tools_called": list(tools_called),
            "citation_count": int(citation_count or 0),
            "confidence": confidence,
            "unsupported": bool(unsupported),
            "summary": summarize_run_outcome(
                question=question,
                tools_called=tools_called,
                citation_count=citation_count,
                confidence=confidence,
                unsupported=unsupported,
                correction=correction,
            ),
            "created_at": _now(),
        }
        self.episodes.insert_one(doc)
        return doc

    def recent_episodes(
        self,
        *,
        contract_id: str,
        user_id: str,
        exclude_session_id: Optional[str] = None,
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """Past runs on this contract.

        The current session is excluded by default: its turns are already in
        the conversation blocks verbatim, and repeating them as episodes would
        spend budget restating what the model can already see.
        """
        query: Dict[str, Any] = {"contract_id": contract_id, "user_id": user_id}
        if exclude_session_id:
            query["session_id"] = {"$ne": exclude_session_id}
        return list(
            self.episodes.find(query, {"_id": 0}).sort("created_at", -1).limit(limit)
        )

    # `build_memory_context` lived here. It pre-joined the session summary,
    # recent turns and semantic recall into one string capped at
    # MAX_MEMORY_CHARS, which is why truncation used to eat whichever tier the
    # concatenation happened to put last rather than the least valuable one.
    # `services.memory.MemoryComposer` reads the three separately and budgets
    # them against project memory too (F-17); this method had no callers left,
    # and keeping a second assembler with its own format is how the two drift.

    def _semantic_memories(self, *, contract_id: str, user_id: str, question: str) -> List[Dict[str, Any]]:
        """Recall by meaning, ranked by relevance × recency.

        The candidate set is no longer "the twelve most recently updated". That
        cap silently made recall a recency filter with a keyword check bolted
        on: anything older than the last twelve writes was unreachable no
        matter how well it matched.
        """
        memories = list(
            self.memories.find(
                {"contract_id": contract_id, "user_id": user_id},
                {"_id": 0},
            ).sort("updated_at", -1).limit(semantic.MAX_CANDIDATES)
        )
        # A memory past its hard TTL is dropped as a candidate entirely rather
        # than left for recency weighting to rank toward the bottom — decay
        # asymptotes, it never reaches "gone", and an old unattributed guess
        # ranked last is still shown before nothing at all.
        memories = lifecycle.apply_ttl(memories, now=_now())
        return semantic.rank(question, memories, limit=3)

    def remember_answer_if_durable(
        self,
        *,
        contract_id: str,
        user_id: str,
        session_id: str,
        question: str,
        answer: str,
        citation_count: int = 0,
        confidence: Any = None,
        quote: str = "",
        explicit_request: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Write a durable memory only when the answer earned one.

        Replaces `remember_turn`, which wrote on every turn matching one of
        five keyword buckets and overwrote whatever that bucket held. Three
        things change:

        - **Gated.** See `semantic.is_durable_answer`. Most turns write
          nothing, which is the point.
        - **Appended, not overwritten.** Each memory is its own record with its
          own question and provenance. Overwriting meant a contract could only
          ever remember one thing about payment, and the thing it remembered
          was whichever answer came last.
        - **Attributed.** Origin, source contract, supporting quote and
          confidence are stored, matching the shape
          `ProjectMemoryManager.remember_fact` already uses, so the composer
          can label the block honestly and 2.6 can decay it.
        """
        if not semantic.is_durable_answer(
            citation_count=citation_count,
            confidence=confidence,
            answer=answer,
            explicit_request=explicit_request,
        ):
            return None

        now = _now()
        content = _clean_text(answer, 800)
        doc = {
            "memory_id": f"mem-{uuid4().hex}",
            "contract_id": contract_id,
            "user_id": user_id,
            "memory_key": _clean_text(question, 120),
            "question": _clean_text(question, 400),
            "content": content,
            "origin": "user" if explicit_request else "contract",
            "source_contract_id": contract_id,
            "source_session_id": session_id,
            "quote": _clean_text(quote, 600),
            "confidence": confidence,
            "citation_count": int(citation_count or 0),
            "embedding": semantic.embed(f"{question}\n{content}"),
            "created_at": now,
            "updated_at": now,
            "last_verified_at": now,
        }
        self.memories.insert_one(doc)
        return doc

    def migrate_legacy_memories(self, *, dry_run: bool = True, limit: int = 500) -> List[Dict[str, Any]]:
        """Backfill embeddings onto pre-2.3 memories without promoting them.

        These rows were written by the overwrite path: no provenance, no
        citation, no record of which answer produced them. They cannot be
        trusted as facts, so the migration gives them exactly one thing —
        an embedding, so they are *reachable* by meaning — and marks them
        `origin: "legacy"` with low confidence so the composer keeps labelling
        them as unverified and 2.6's decay can retire them.

        Deliberately not `origin: "contract"`. Silently promoting them to the
        shape gated writes produce would make them indistinguishable from
        memories that actually earned their place.
        """
        candidates = list(
            self.memories.find({"origin": {"$exists": False}}, {"_id": 0}).limit(limit)
        )
        results: List[Dict[str, Any]] = []
        for record in candidates:
            content = str(record.get("content") or "").strip()
            if not content:
                continue
            results.append(
                {
                    "contract_id": record.get("contract_id"),
                    "memory_key": record.get("memory_key"),
                    "content_preview": content[:120],
                }
            )
            if dry_run:
                continue
            self.memories.update_one(
                {
                    "contract_id": record.get("contract_id"),
                    "user_id": record.get("user_id"),
                    "memory_key": record.get("memory_key"),
                },
                {
                    "$set": {
                        "origin": "legacy",
                        "confidence": "low",
                        "embedding": semantic.embed(
                            f"{record.get('memory_key') or ''}\n{content}"
                        ),
                        "migrated_at": _now(),
                    }
                },
            )
        return results

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
