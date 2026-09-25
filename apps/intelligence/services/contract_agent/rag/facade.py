"""Public compatibility facade for the modular contract agent."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from langchain_core.documents import Document

from core.config import settings
from models.contract_types import QuestionAnswer


from .llm_client import ProviderLLMClient
from .schemas import CitationInfo, Reference, TextSegment
from .segmentation import DocumentSegmenter
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

    def _run_provider(self) -> Optional[str]:
        """The provider a run pins, or None to let the platform org decide.

        With a platform org in scope (use_platform_org — a linked contract's
        ingestion), the org's Admin → AI choice must win; pinning this tier's
        default here is what made project-memory overviews run on groq
        whatever the team had chosen.
        """
        from services.platform_models import active_platform_org

        return None if active_platform_org() else self.ai_provider
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

    @use_mongodb_vector.setter
    def use_mongodb_vector(self, val: bool):
        self.vector_manager.use_mongodb_vector = val

    @property
    def use_pinecone(self) -> bool:
        return self.vector_manager.use_pinecone

    @use_pinecone.setter
    def use_pinecone(self, val: bool):
        self.vector_manager.use_pinecone = val

    @property
    def embeddings(self):
        return self.vector_manager.embeddings

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
        self.document_segments[contract_name] = list(self.vector_manager.last_embedded_segments)
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
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
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
            ai_provider=self._run_provider(),
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
        response = runner.run(state, on_event=on_event)

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
        on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None,
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
            ai_provider=self._run_provider(),
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
        response = runner.run(state, on_event=on_event)

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


__all__ = [
    "CitationInfo",
    "ContractRAGSystem",
    "DocumentSegmenter",
    "Reference",
    "TextSegment",
]
