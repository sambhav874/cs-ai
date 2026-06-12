"""Public compatibility facade for the modular contract agent."""

from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import Path
import time
from typing import Any, Dict, Iterator, List, Optional, Union

from langchain_core.documents import Document

from core.config import settings
from models.contract_types import QuestionAnswer
from utils.secure_logger import log_exception
from utils.text_cleanup import clean_text_encoding

from .agent import AgentRunTrace, ContractAgentRunner, ContractEvidenceLoop, EvidenceLoopResult
from .citations import fallback_extracted_answer, normalize_model_answers
from .llm_client import ProviderLLMClient, StructuredLLMClient
from .prompts import ContractPromptBuilder, ContractTaskType, detect_task_type
from .retrieval import PromptContextSelector
from .schemas import CitationInfo, ExtractedAnswer, Reference, TextSegment
from .segmentation import DocumentSegmenter
from .verifier import ContractAnswerVerifier
from .vector_store import VectorStoreManager

logger = logging.getLogger(__name__)


def _mongo_react_tool_executor(tool: Any, state: Any) -> Dict[str, Any]:
    from core.database import collection
    from services.contract_agent.graph.tools.executor import execute_mongo_read_tool

    return execute_mongo_read_tool(collection, tool, state)


class _InMemoryContractCollection:
    def __init__(self, documents: List[Dict[str, Any]]):
        self.documents = documents

    def find(self, query: Dict[str, Any], projection: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        del projection
        wanted = {str(item) for item in ((query.get("_id") or {}).get("$in") or [])}
        results: List[Dict[str, Any]] = []
        for document in self.documents:
            if wanted and str(document.get("_id")) not in wanted:
                continue
            content = ((document.get("index") or {}).get("content") or "")
            if not content.strip():
                continue
            results.append(document)
        return results


def _in_memory_react_tool_executor(documents: List[Dict[str, Any]]):
    from services.contract_agent.graph.tools.executor import execute_mongo_read_tool

    collection = _InMemoryContractCollection(documents)

    def _execute(tool: Any, state: Any) -> Dict[str, Any]:
        return execute_mongo_read_tool(collection, tool, state)

    return _execute


class ContractRAGSystem:
    """Compatibility shell that delegates to modular contract-agent services."""

    def __init__(self, ai_provider: Optional[str] = None):
        self.ai_provider = (ai_provider or getattr(settings, "ai_provider", None) or "groq").lower()
        self.document_segments = {}
        self.last_agent_trace = None
        self._active_agent_task = None
        self._active_agent_trace = None

    @property
    def vector_manager(self) -> VectorStoreManager:
        if not hasattr(self, "_vector_manager"):
            ai_provider = getattr(self, "ai_provider", None) or getattr(settings, "ai_provider", None) or "groq"
            self._vector_manager = VectorStoreManager(ai_provider=ai_provider)
        return self._vector_manager

    @vector_manager.setter
    def vector_manager(self, val: VectorStoreManager):
        self._vector_manager = val

    @property
    def current_namespace(self) -> Optional[str]:
        return self.vector_manager.current_namespace

    @current_namespace.setter
    def current_namespace(self, val: Optional[str]):
        self.vector_manager.current_namespace = val

    @property
    def current_vector_backend(self) -> Optional[str]:
        return self.vector_manager.current_vector_backend

    @current_vector_backend.setter
    def current_vector_backend(self, val: Optional[str]):
        self.vector_manager.current_vector_backend = val

    @property
    def current_vector_count(self) -> int:
        return self.vector_manager.current_vector_count

    @current_vector_count.setter
    def current_vector_count(self, val: int):
        self.vector_manager.current_vector_count = val

    @property
    def embedding_backend(self) -> Optional[str]:
        return self.vector_manager.embedding_backend

    @property
    def use_mongodb_vector(self) -> bool:
        return self.vector_manager.use_mongodb_vector

    @property
    def use_pinecone(self) -> bool:
        return self.vector_manager.use_pinecone

    @property
    def embeddings(self):
        return self.vector_manager.embeddings

    def _contract_agent_runner(self) -> ContractAgentRunner:
        return ContractAgentRunner(self)

    def _prepare_segments_for_document(
        self,
        segments: List[TextSegment],
        *,
        contract_id: str,
        contract_name: str,
    ) -> List[TextSegment]:
        from .vector_store import prepare_segments_for_document
        from .segmentation import DocumentSegmenter
        segmenter = getattr(getattr(self, "vector_manager", None), "segmenter", None) or DocumentSegmenter()
        return prepare_segments_for_document(
            segments,
            contract_id=contract_id,
            contract_name=contract_name,
            token_counter=segmenter._estimated_tokens,
        )

    def _keyword_segment_documents(
        self,
        segments: List[TextSegment],
        question: str,
        *,
        top_k: int,
    ) -> List[Document]:
        from .retrieval import LegacyRetrievalBridge
        return LegacyRetrievalBridge(self)._keyword_segment_documents(segments, question, top_k=top_k)

    def _named_heading_candidates(self, question: str) -> List[str]:
        from .retrieval import LegacyRetrievalBridge
        return LegacyRetrievalBridge(self)._named_heading_candidates(question)

    def _named_heading_documents(
        self,
        segments: List[TextSegment],
        question: str,
        *,
        top_k: int,
    ) -> List[Document]:
        from .retrieval import LegacyRetrievalBridge
        return LegacyRetrievalBridge(self)._named_heading_documents(segments, question, top_k=top_k)

    def embed_contract_text(
        self,
        contract_text: str,
        contract_name: str,
        *,
        contract_id: str,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
        namespace: Optional[str] = None,
        replace_existing: bool = True,
        require_mongodb: bool = True,
    ) -> Dict[str, Any]:
        result = self.vector_manager.embed_contract_text(
            contract_text=contract_text,
            contract_name=contract_name,
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            namespace=namespace,
            replace_existing=replace_existing,
            require_mongodb=require_mongodb,
        )
        self.document_segments[contract_name] = self.vector_manager.segmenter.segment_text_with_page_markers(contract_text)[1]
        return result

    def create_vector_store(
        self,
        documents: List[Document],
        contract_name: str,
        namespace: Optional[str] = None,
        contract_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
        replace_existing: bool = False,
    ):
        return self.vector_manager.create_vector_store(
            documents=documents,
            contract_name=contract_name,
            namespace=namespace,
            contract_id=contract_id,
            project_id=project_id,
            user_id=user_id,
            replace_existing=replace_existing,
        )

    def load_existing_vector_store(self, namespace: Optional[str]):
        return self.vector_manager.load_existing_vector_store(namespace)

    def load_contract_documents(
        self,
        contract_dir: Path,
        contract_name: str,
        specific_contract_output_dir: Path,
    ) -> Tuple[List[Document], List[TextSegment]]:
        documents, segments = self.vector_manager.load_contract_documents(
            contract_dir=contract_dir,
            contract_name=contract_name,
            specific_contract_output_dir=specific_contract_output_dir,
        )
        self.document_segments[contract_name] = segments
        return documents, segments

    def create_reference_map(self, segments: List[TextSegment]) -> Dict[str, TextSegment]:
        return {segment.id: segment for segment in segments}

    def _query_plain_markdown(self, prompt: str) -> str:
        """Compatibility wrapper for Plain LLM Client."""
        return ProviderLLMClient(self).query_plain_markdown(prompt)

    def _process_response(self, content: str) -> Optional[List[Dict[str, Any]]]:
        """Compatibility wrapper for response parsing."""
        return ProviderLLMClient(self).process_response(content)

    def _answer_from_extracted(self, question: str, extracted: ExtractedAnswer) -> QuestionAnswer:
        segment_ids = extracted.reference.segment_ids if extracted.reference else []
        return QuestionAnswer(
            question=question,
            answer=extracted.value,
            confidence=extracted.confidence if extracted.confidence in {"high", "medium", "low"} else "low",
            citation=", ".join(segment_ids),
            reason=extracted.reference.justification if extracted.reference else "",
            citation_details={
                "cited_segments": segment_ids,
                "reference": extracted.reference.model_dump() if extracted.reference else {},
            },
        )

    def _legacy_answer_agent_question(
        self,
        *,
        contract_text: str,
        contract_name: str,
        contract_id: str,
        question: str,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
        vector_namespace: Optional[str] = None,
        vector_backend: Optional[str] = None,
        memory_context: str = "",
    ) -> QuestionAnswer:
        del project_id, user_id, vector_namespace, vector_backend
        clean_text, segments = self.segmenter.segment_text_with_page_markers(contract_text)
        prepared = self._prepare_segments_for_document(
            segments,
            contract_id=contract_id,
            contract_name=contract_name,
        )
        self.document_segments[contract_name] = prepared
        retrieved_docs = self._keyword_segment_documents(prepared, question, top_k=getattr(settings, "max_segments_in_prompt", 18))
        answers = self.query_model(
            question,
            contract_name,
            retrieved_docs,
            memory_context=memory_context,
            prefer_full_context=len(clean_text) <= getattr(settings, "agent_full_context_chars", 28000),
        )
        if answers:
            return self._answer_from_extracted(question, answers[0])
        return QuestionAnswer(
            question=question,
            answer="I could not answer that from the available contract evidence.",
            confidence="low",
            reason="No extracted answer was produced.",
        )

    def _legacy_answer_project_question(
        self,
        *,
        project_documents: List[Dict[str, Any]],
        project_id: str,
        question: str,
        user_id: Optional[str] = None,
        displayed_document: Optional[Dict[str, str]] = None,
        attached_documents: Optional[List[Dict[str, str]]] = None,
        memory_context: str = "",
    ) -> QuestionAnswer:
        del project_id, user_id, displayed_document, attached_documents
        all_docs: List[Document] = []
        contract_names: List[str] = []
        for doc in project_documents:
            contract_id = str(doc.get("_id") or doc.get("contract_id") or doc.get("document_id") or "")
            contract_name = doc.get("contract_name") or doc.get("filename") or contract_id or "Document"
            contract_text = ((doc.get("index") or {}).get("content") or doc.get("content") or "")
            if not contract_text.strip():
                continue
            _clean_text, segments = self.segmenter.segment_text_with_page_markers(contract_text)
            prepared = self._prepare_segments_for_document(
                segments,
                contract_id=contract_id,
                contract_name=contract_name,
            )
            self.document_segments[contract_name] = prepared
            contract_names.append(contract_name)
            all_docs.extend(self._keyword_segment_documents(prepared, question, top_k=6))

        if not contract_names:
            return QuestionAnswer(
                question=question,
                answer="I could not answer that from the available project documents.",
                confidence="low",
                reason="No project document text was available.",
            )

        synthetic_name = "Project Documents"
        self.document_segments[synthetic_name] = [
            segment
            for name in contract_names
            for segment in self.document_segments.get(name, [])
        ]
        answers = self.query_model(
            question,
            synthetic_name,
            all_docs,
            memory_context=memory_context,
        )
        if answers:
            return self._answer_from_extracted(question, answers[0])
        return QuestionAnswer(
            question=question,
            answer="I could not answer that from the available project evidence.",
            confidence="low",
            reason="No extracted answer was produced.",
        )

    def answer_agent_question(
        self,
        *,
        contract_text: str,
        contract_name: str,
        contract_id: str,
        question: str,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
        vector_namespace: Optional[str] = None,
        vector_backend: Optional[str] = None,
        memory_context: str = "",
    ) -> QuestionAnswer:
        # Route directly to the unified DeepContractAgentRunner
        from services.contract_agent.graph import AgentContext, AgentRunState, DeepContractAgentRunner
        from services.contract_agent.graph.state import AgentSurface

        context = AgentContext(
            surface=AgentSurface.CONTRACT,
            contract_id=contract_id,
            project_id=project_id,
            selected_document_ids=[contract_id] if contract_id else [],
            visible_state={
                "scope": "contract",
                "contract_name": contract_name,
            },
        )
        state = AgentRunState(
            user_id=user_id or "system",
            message=question,
            context=context,
            ai_provider=self.ai_provider,
            memory_context=memory_context,
        )
        documents = [
            {
                "_id": str(contract_id),
                "contract_name": contract_name,
                "index": {
                    "status": "success",
                    "content": contract_text,
                },
            }
        ] if contract_text.strip() else []
        runner = DeepContractAgentRunner(
            tool_executor=_in_memory_react_tool_executor(documents) if documents else _mongo_react_tool_executor
        )
        response = runner.run(state)

        # Populate last_agent_trace for backward compatibility
        self.last_agent_trace = {
            "iterations": state.react_iterations + 1,
            "tools": [tool.name for tool in state.tools],
        }

        return QuestionAnswer(
            question=question,
            answer=response.answer,
            confidence=response.confidence,
            citation=response.citation_details.get("source_pages_display") or "",
            reason=response.reason,
            citation_details=response.citation_details,
        )

    def answer_project_question(
        self,
        *,
        project_documents: List[Dict[str, Any]],
        project_id: str,
        question: str,
        user_id: Optional[str] = None,
        displayed_document: Optional[Dict[str, str]] = None,
        attached_documents: Optional[List[Dict[str, str]]] = None,
        memory_context: str = "",
    ) -> QuestionAnswer:
        # Route directly to the unified DeepContractAgentRunner
        from services.contract_agent.graph import AgentContext, AgentRunState, DeepContractAgentRunner
        from services.contract_agent.graph.state import AgentSurface

        doc_ids = [str(doc.get("_id") or doc.get("contract_id") or "") for doc in project_documents]
        context = AgentContext(
            surface=AgentSurface.PROJECT,
            project_id=project_id,
            selected_document_ids=[d for d in doc_ids if d],
            displayed_document=displayed_document,
            attached_documents=attached_documents or [],
            visible_state={
                "scope": "project",
                "document_count": len(project_documents),
            },
        )
        state = AgentRunState(
            user_id=user_id or "system",
            message=question,
            context=context,
            ai_provider=self.ai_provider,
            memory_context=memory_context,
        )
        documents = [
            {
                "_id": str(doc.get("_id") or doc.get("contract_id") or ""),
                "contract_name": doc.get("contract_name") or doc.get("filename") or str(doc.get("_id") or ""),
                "index": {
                    "status": "success",
                    "content": ((doc.get("index") or {}).get("content") or doc.get("content") or ""),
                },
            }
            for doc in project_documents
            if ((doc.get("index") or {}).get("content") or doc.get("content") or "").strip()
        ]
        runner = DeepContractAgentRunner(
            tool_executor=_in_memory_react_tool_executor(documents) if documents else _mongo_react_tool_executor
        )
        response = runner.run(state)

        # Populate last_agent_trace for backward compatibility
        self.last_agent_trace = {
            "iterations": state.react_iterations + 1,
            "tools": [tool.name for tool in state.tools],
        }

        return QuestionAnswer(
            question=question,
            answer=response.answer,
            confidence=response.confidence,
            citation=response.citation_details.get("source_pages_display") or "",
            reason=response.reason,
            citation_details=response.citation_details,
        )

    def query_model(
        self,
        questions: Union[str, List[str]],
        contract_name: str,
        retrieved_docs: List[Document],
        memory_context: str = "",
        context_char_budget: Optional[int] = None,
        max_segments_in_prompt: Optional[int] = None,
        segment_excerpt_chars: Optional[int] = None,
        prefer_full_context: bool = False,
    ) -> List[ExtractedAnswer]:
        if isinstance(questions, str):
            questions = [questions]
        questions = [clean_text_encoding(question) for question in questions]

        segments_for_contract = self.document_segments.get(contract_name, [])
        if not segments_for_contract:
            logger.warning("No segments found for contract %s in query_model.", contract_name)
            return [
                fallback_extracted_answer(question, "No document segments available for context.")
                for question in questions
            ]

        retrieval_question = " ".join(questions)
        max_segments = max_segments_in_prompt or getattr(settings, "max_segments_in_prompt", 18)
        selector = PromptContextSelector(self)
        prompt_segments = selector.select_segments(
            contract_name=contract_name,
            retrieved_docs=retrieved_docs,
            question=retrieval_question,
            max_segments=max_segments,
            context_char_budget=context_char_budget,
            segment_excerpt_chars=segment_excerpt_chars,
            prefer_full_context=prefer_full_context,
        )
        segment_map = self.create_reference_map(segments_for_contract)
        document_count = len({segment.contract_id or segment.contract_name or contract_name for segment in segments_for_contract})
        active_task = getattr(self, "_active_agent_task", None)
        task_type = active_task if isinstance(active_task, ContractTaskType) else detect_task_type(retrieval_question, document_count=document_count)
        builder = ContractPromptBuilder()
        llm_client = StructuredLLMClient(self)
        verifier = ContractAnswerVerifier()
        retrieval_hints = selector.retrieval_hints(retrieved_docs, max_segments)

        max_retries = 3
        pending_questions = list(questions)
        extracted_answers: Dict[str, ExtractedAnswer] = {}
        trace = getattr(self, "_active_agent_trace", None)
        if trace is not None:
            trace.retrieval_count = len(retrieved_docs or [])
            loop_result = self._run_evidence_loop(
                question=retrieval_question,
                task_type=task_type,
                all_segments=segments_for_contract,
                initial_segments=prompt_segments,
                memory_context=memory_context,
                max_segments=max_segments,
            )
            prompt_segments = loop_result.segments
            if loop_result.observations:
                retrieval_hints = f"{retrieval_hints}\n\nAgent tool observations:\n{loop_result.observations}"
            trace.iterations = max(1, loop_result.iterations + 1)
            trace.retrieval_count = len(prompt_segments)
            trace.tools = loop_result.tools_used or trace.tools
            if loop_result.fallback_reason:
                trace.fallback_reason = loop_result.fallback_reason

        prompt_segments = self._prompt_ready_segments(
            prompt_segments,
            question=retrieval_question,
            segment_excerpt_chars=segment_excerpt_chars,
        )

        for attempt in range(max_retries + 1):
            if not pending_questions:
                break
            prompt = builder.build_structured_answer_prompt(
                questions=pending_questions,
                contract_name=contract_name,
                prompt_segments=prompt_segments,
                retrieved_context=retrieval_hints,
                memory_context=memory_context,
                task_type=task_type,
            )
            if trace is not None:
                trace.prompt_chars = len(prompt)

            try:
                model_items = llm_client.query_answers(prompt)
                if model_items is None:
                    logger.warning("Attempt %s: model call failed; retrying.", attempt + 1)
                    time.sleep(2 ** attempt)
                    continue
                if isinstance(model_items, list) and not model_items:
                    logger.warning("Attempt %s: model returned no answers; retrying.", attempt + 1)
                    time.sleep(2 ** attempt)
                    continue

                newly_extracted, still_missing = normalize_model_answers(
                    questions=pending_questions,
                    model_items=model_items,
                    segment_map=segment_map,
                )
                verified_extracted = {}
                verification_issues: List[str] = []
                for question, answer in newly_extracted.items():
                    verification = verifier.verify(
                        answer=answer,
                        segment_map=segment_map,
                        task_type=task_type,
                        memory_context=memory_context,
                    )
                    verified_extracted[question] = verification.answer
                    verification_issues.extend(verification.issues)
                extracted_answers.update(newly_extracted)
                extracted_answers.update(verified_extracted)
                if trace is not None and verification_issues:
                    trace.fallback_reason = (
                        f"{trace.fallback_reason}; verifier issues: {', '.join(sorted(set(verification_issues)))}"
                        if trace.fallback_reason
                        else f"verifier issues: {', '.join(sorted(set(verification_issues)))}"
                    )
                pending_questions = still_missing
                logger.info(
                    "Attempt %s: processed %s answers; %s remaining.",
                    attempt + 1,
                    len(newly_extracted),
                    len(pending_questions),
                )
            except Exception as exc:
                log_exception(logger, f"Error in query_model on attempt {attempt + 1}", exc)
                if attempt >= max_retries:
                    break
                time.sleep(2 ** attempt)

        if pending_questions and trace is not None:
            trace.fallback_reason = "model did not return valid answers for all questions"

        for question in pending_questions:
            extracted_answers[question] = fallback_extracted_answer(question)

        return [extracted_answers[question] for question in questions if question in extracted_answers]

    def _streaming_prompt_for_segments(
        self,
        *,
        question: str,
        contract_name: str,
        retrieved_docs: List[Document],
        displayed_document: Optional[Dict[str, str]] = None,
        attached_documents: Optional[List[Dict[str, str]]] = None,
        memory_context: str = "",
        context_char_budget: Optional[int] = None,
        max_segments_in_prompt: Optional[int] = None,
        segment_excerpt_chars: Optional[int] = None,
        prefer_full_context: bool = False,
    ):
        selector = PromptContextSelector(self)
        prompt_segments = selector.select_segments(
            contract_name=contract_name,
            retrieved_docs=retrieved_docs,
            question=question,
            max_segments=max_segments_in_prompt,
            context_char_budget=context_char_budget,
            segment_excerpt_chars=segment_excerpt_chars,
            prefer_full_context=prefer_full_context,
        )
        document_count = len({segment.contract_id or segment.contract_name or contract_name for segment in prompt_segments}) or 1
        active_task = getattr(self, "_active_agent_task", None)
        task_type = active_task if isinstance(active_task, ContractTaskType) else detect_task_type(question, document_count=document_count)
        trace = getattr(self, "_active_agent_trace", None)
        if trace is not None:
            segments_for_contract = self.document_segments.get(contract_name, [])
            loop_result = self._run_evidence_loop(
                question=question,
                task_type=task_type,
                all_segments=segments_for_contract,
                initial_segments=prompt_segments,
                memory_context=memory_context,
                max_segments=max_segments_in_prompt or getattr(settings, "max_segments_in_prompt", 18),
            )
            prompt_segments = loop_result.segments
            trace.iterations = max(1, loop_result.iterations + 1)
            trace.retrieval_count = len(prompt_segments)
            trace.tools = loop_result.tools_used or trace.tools
            if loop_result.fallback_reason:
                trace.fallback_reason = loop_result.fallback_reason

        prompt_segments = self._prompt_ready_segments(
            prompt_segments,
            question=question,
            segment_excerpt_chars=segment_excerpt_chars,
        )
        prompt = ContractPromptBuilder().build_streaming_prompt(
            question=question,
            contract_name=contract_name,
            prompt_segments=prompt_segments,
            focus_note=self._document_focus_note(displayed_document, attached_documents or []),
            memory_context=memory_context,
            task_type=task_type,
        )
        if trace is not None:
            trace.prompt_chars = len(prompt)
            trace.retrieval_count = len(prompt_segments)
        return prompt, prompt_segments

    def _document_focus_note(
        self,
        displayed_document: Optional[Dict[str, str]],
        attached_documents: List[Dict[str, str]],
    ) -> str:
        lines: List[str] = []
        if displayed_document:
            display_name = displayed_document.get("filename") or displayed_document.get("name") or "Current document"
            display_id = displayed_document.get("document_id") or displayed_document.get("id") or ""
            lines.append(
                f"- Current open document: {display_name}"
                + (f" ({display_id})" if display_id else "")
                + ". Treat it as the user's likely focus, but not as the only truth source."
            )
        if attached_documents:
            lines.append("- User-referred documents for this turn are the primary focus unless the question clearly asks broader project coverage:")
            for document in attached_documents:
                name = document.get("filename") or document.get("name") or "Referenced document"
                document_id = document.get("document_id") or document.get("id") or ""
                lines.append(f"  - {name}" + (f" ({document_id})" if document_id else ""))
        else:
            lines.append("- No explicit referenced document set was selected, so consider every relevant indexed project document.")
        return "\n".join(lines)

    def _project_chat_prompt_without_documents(
        self,
        *,
        project_name: str,
        question: str,
        memory_context: str = "",
    ) -> str:
        return ContractPromptBuilder().build_no_document_prompt(
            project_name=project_name,
            question=question,
            memory_context=memory_context,
        )

    def stream_agent_question(self, **kwargs: Any) -> Iterator[Dict[str, Any]]:
        yield {"type": "status", "message": "planning"}
        yield {"type": "status", "message": "retrieving"}

        contract_id = kwargs.get("contract_id")
        contract_name = kwargs.get("contract_name")
        question = kwargs.get("question")
        user_id = kwargs.get("user_id")

        qa = self.answer_agent_question(
            contract_text="",
            contract_name=contract_name or "",
            contract_id=contract_id or "",
            question=question or "",
            project_id=kwargs.get("project_id"),
            user_id=user_id,
            vector_namespace=kwargs.get("vector_namespace"),
            vector_backend=kwargs.get("vector_backend"),
            memory_context=kwargs.get("memory_context") or "",
        )

        yield {
            "type": "final",
            "answer": qa.answer,
            "question": qa.question,
            "confidence": qa.confidence,
            "citation": qa.citation,
            "reason": qa.reason,
            "citation_details": qa.citation_details,
            "citation_annotations": qa.citation_details.get("annotations", []) if isinstance(qa.citation_details, dict) else [],
            "agent_trace": getattr(qa, "agent_trace", None) or getattr(self, "last_agent_trace", None),
            "vector_namespace": getattr(self.vector_manager, "current_namespace", None),
            "vector_backend": getattr(self.vector_manager, "current_vector_backend", None),
        }

    def stream_project_question(self, **kwargs: Any) -> Iterator[Dict[str, Any]]:
        yield {"type": "status", "message": "planning"}
        yield {"type": "status", "message": "retrieving"}

        project_documents = kwargs.get("project_documents") or []
        project_id = kwargs.get("project_id")
        question = kwargs.get("question")
        user_id = kwargs.get("user_id")

        qa = self.answer_project_question(
            project_documents=project_documents,
            project_id=project_id or "",
            question=question or "",
            user_id=user_id,
            displayed_document=kwargs.get("displayed_document"),
            attached_documents=kwargs.get("attached_documents") or [],
            memory_context=kwargs.get("memory_context") or "",
        )

        yield {
            "type": "final",
            "answer": qa.answer,
            "question": qa.question,
            "confidence": qa.confidence,
            "citation": qa.citation,
            "reason": qa.reason,
            "citation_details": qa.citation_details,
            "citation_annotations": qa.citation_details.get("annotations", []) if isinstance(qa.citation_details, dict) else [],
            "agent_trace": getattr(qa, "agent_trace", None) or getattr(self, "last_agent_trace", None),
            "vector_namespace": getattr(self.vector_manager, "current_namespace", None),
            "vector_backend": getattr(self.vector_manager, "current_vector_backend", None),
        }

    def _run_evidence_loop(
        self,
        *,
        question: str,
        task_type: ContractTaskType,
        all_segments: List[TextSegment],
        initial_segments: List[TextSegment],
        memory_context: str,
        max_segments: int,
    ):
        if not all_segments or not initial_segments:
            return EvidenceLoopResult(
                segments=initial_segments,
                observations=[],
                iterations=0,
                tools_used=[],
                fallback_reason="no evidence segments available",
            )
        max_steps = getattr(settings, "contract_agent_max_tool_steps", 3)
        return ContractEvidenceLoop(self, max_steps=max_steps).run(
            question=question,
            task_type=task_type,
            all_segments=all_segments,
            initial_segments=initial_segments,
            memory_context=memory_context,
            max_segments=max_segments,
        )

    def _prompt_ready_segments(
        self,
        segments: List[TextSegment],
        *,
        question: str,
        segment_excerpt_chars: Optional[int],
    ) -> List[TextSegment]:
        selector = PromptContextSelector(self)
        ready_segments: List[TextSegment] = []
        for segment in segments:
            excerpt = selector.excerpt_for_prompt(segment, question, segment_excerpt_chars)
            try:
                ready_segments.append(segment.model_copy(update={"text": excerpt}))
            except AttributeError:
                ready_segments.append(segment.copy(update={"text": excerpt}))
        return ready_segments


__all__ = [
    "CitationInfo",
    "ContractRAGSystem",
    "DocumentSegmenter",
    "ExtractedAnswer",
    "Reference",
    "TextSegment",
]
