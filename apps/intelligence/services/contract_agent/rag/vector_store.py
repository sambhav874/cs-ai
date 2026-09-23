"""Vector-store helper functions and manager used by the contract-agent facade."""

from __future__ import annotations

from collections import OrderedDict
import os
import re
import time
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, NamedTuple, Optional, Tuple

import pinecone
from pinecone import ServerlessSpec
from pymongo.operations import SearchIndexModel
from langchain_core.embeddings import Embeddings
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from langchain_mongodb import MongoDBAtlasVectorSearch
import voyageai
from langchain_voyageai import VoyageAIEmbeddings

from core.config import settings
from core.database import client as shared_mongo_client
from utils.secure_logger import log_exception
from utils.text_cleanup import clean_text_encoding

from .schemas import TextSegment
from .segmentation import DocumentSegmenter

logger = logging.getLogger(__name__)


class PrecalculatedEmbeddings(Embeddings):
    """LangChain-compatible embeddings wrapper that returns pre-computed embeddings."""

    def __init__(
        self,
        texts: List[str],
        embeddings: List[List[float]],
        fallback_embeddings: Optional[Embeddings] = None
    ):
        self.text_to_embedding = {text: emb for text, emb in zip(texts, embeddings)}
        self.fallback_embeddings = fallback_embeddings

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        results = []
        for text in texts:
            if text in self.text_to_embedding:
                results.append(self.text_to_embedding[text])
            elif self.fallback_embeddings:
                results.append(self.fallback_embeddings.embed_documents([text])[0])
            else:
                logger.warning("Precalculated embedding not found for text, generating zero fallback")
                # Fallback to zero vectors if not found and no fallback provided
                results.append([0.0] * 1024)
        return results

    def embed_query(self, text: str) -> List[float]:
        if self.fallback_embeddings:
            return self.fallback_embeddings.embed_query(text)
        raise NotImplementedError("embed_query not supported directly on PrecalculatedEmbeddings without a fallback")

    async def aembed_documents(self, texts: List[str]) -> List[List[float]]:
        return self.embed_documents(texts)

    async def aembed_query(self, text: str) -> List[float]:
        return self.embed_query(text)



@dataclass
class VectorStoreSnapshot:
    backend: Optional[str]
    namespace: Optional[str]
    count: int
    embedding_backend: Optional[str] = None


def current_vector_snapshot(owner: Any) -> VectorStoreSnapshot:
    return VectorStoreSnapshot(
        backend=getattr(owner, "current_vector_backend", None),
        namespace=getattr(owner, "current_namespace", None),
        count=int(getattr(owner, "current_vector_count", 0) or 0),
        embedding_backend=getattr(owner, "embedding_backend", None),
    )


def namespace_search_kwargs(owner: Any, *, namespace: Optional[str], k: int) -> Dict[str, Any]:
    search_kwargs: Dict[str, Any] = {"k": k}
    if namespace and getattr(owner, "use_mongodb_vector", False):
        search_kwargs["pre_filter"] = {"namespace": {"$eq": namespace}}
    if namespace and getattr(owner, "use_pinecone", False):
        search_kwargs["namespace"] = namespace
    return search_kwargs


def default_vector_namespace(contract_name: str, contract_id: Optional[str] = None) -> str:
    if contract_id:
        safe_contract_id = re.sub(r"[^a-zA-Z0-9-]", "-", contract_id)
        return f"contract-{safe_contract_id}"
    safe_contract_name = re.sub(r"[^a-zA-Z0-9-]", "-", contract_name)
    return f"{safe_contract_name}-{int(time.time())}"


# --------------------------------------------------------------------------
# Singleton vector store cache — avoids re-initializing embeddings and
# MongoDB connections on every retrieval query.
# --------------------------------------------------------------------------
_MAX_CACHED_STORES = 128
_vector_store_cache: OrderedDict[str, Any] = OrderedDict()
_global_embeddings: Optional[Any] = None
_global_embedding_backend: Optional[str] = None

# Module-level segment cache — avoids re-segmenting on every fallback retrieval
_MAX_CACHED_SEGMENTS = 64
_segment_cache: OrderedDict[str, Tuple[List[Dict[str, Any]], int]] = OrderedDict()


class EmbeddingsBundle(NamedTuple):
    """An embeddings client plus the metadata callers record alongside vectors.

    Backend, model, and dimension travel together because a vector is only
    meaningful next to the model that produced it — a namespace embedded with
    one backend can't be searched with another.
    """

    embeddings: Any
    backend: str
    model: str
    dimension: int


def build_embeddings(
    *, voyageai_api_key: Optional[str] = None, hf_token: Optional[str] = None
) -> EmbeddingsBundle:
    """The single place an embeddings provider is chosen.

    VoyageAI is the production backend; HuggingFace is the local-dev fallback.
    Keys default to server config but can be overridden per instance, which is
    why they're parameters rather than reads.
    """
    # Test mode: deterministic, offline, free. Checked FIRST so a unit test
    # never calls the paid Voyage API even if a key leaks into the environment,
    # and never downloads a HuggingFace model. TESTING already routes every
    # database to contractsense-test-db (core/database.py), so this keeps the
    # flag meaning one thing: no real external state. Dimension matches the
    # production Voyage backend so vector shapes stay what code expects.
    if getattr(settings, "testing", False):
        from langchain_core.embeddings import DeterministicFakeEmbedding

        dimension = getattr(settings, "voyageai_embedding_dimension", 1024)
        return EmbeddingsBundle(
            embeddings=DeterministicFakeEmbedding(size=dimension),
            backend="fake",
            model="deterministic-fake",
            dimension=dimension,
        )

    voyage_key = voyageai_api_key if voyageai_api_key is not None else settings.voyageai_api_key

    if voyage_key:
        dimension = getattr(settings, "voyageai_embedding_dimension", 1024)
        return EmbeddingsBundle(
            embeddings=VoyageAIEmbeddings(
                model=settings.voyageai_model_name,
                voyage_api_key=voyage_key,
                output_dimension=dimension,
            ),
            backend="voyageai",
            model=settings.voyageai_model_name,
            dimension=dimension,
        )

    if settings.embeddings_model_name:
        from langchain_huggingface import HuggingFaceEmbeddings

        token = hf_token if hf_token is not None else getattr(settings, "huggingface_token", None)
        return EmbeddingsBundle(
            embeddings=HuggingFaceEmbeddings(
                model_name=settings.embeddings_model_name,
                model_kwargs={"token": token},
            ),
            backend="huggingface",
            model=settings.embeddings_model_name,
            dimension=embedding_dimension("huggingface"),
        )

    raise RuntimeError(
        "No embeddings provider configured. "
        "Set VOYAGEAI_API_KEY for production or EMBEDDINGS_MODEL_NAME for local dev."
    )


def get_singleton_embeddings() -> Any:
    global _global_embeddings, _global_embedding_backend
    if _global_embeddings is None:
        bundle = build_embeddings()
        _global_embeddings = bundle.embeddings
        _global_embedding_backend = bundle.backend
    return _global_embeddings


def get_global_embedding_backend() -> str:
    global _global_embedding_backend
    if _global_embedding_backend is None:
        get_singleton_embeddings()
    return _global_embedding_backend or ""


def get_global_embedding_dimension() -> int:
    return embedding_dimension(get_global_embedding_backend())


def get_cached_vector_store(namespace: str) -> Optional[Any]:
    return _vector_store_cache.get(namespace)


def cache_vector_store(namespace: str, store: Any) -> None:
    if len(_vector_store_cache) >= _MAX_CACHED_STORES:
        _vector_store_cache.popitem(last=False)
    _vector_store_cache[namespace] = store


def invalidate_vector_store(namespace: str) -> None:
    _vector_store_cache.pop(namespace, None)


def cache_segments(contract_id: str, segments: List[Dict[str, Any]], schema_version: int) -> None:
    if len(_segment_cache) >= _MAX_CACHED_SEGMENTS:
        _segment_cache.popitem(last=False)
    _segment_cache[contract_id] = (segments, schema_version)


def get_cached_segments(contract_id: str, schema_version: int) -> Optional[List[Dict[str, Any]]]:
    entry = _segment_cache.get(contract_id)
    if entry and entry[1] == schema_version:
        return entry[0]
    return None


def embedding_dimension(embedding_backend: Optional[str]) -> int:
    backend = embedding_backend or ""
    if backend == "voyageai":
        return getattr(settings, "voyageai_embedding_dimension", 1024)
    if backend == "huggingface":
        model_name = (settings.embeddings_model_name or "").lower()
        if "e5-large" in model_name or "gte-large" in model_name:
            return 1024
        if "minilm" in model_name:
            return 384
        return 768
    if backend == "openai":
        model_name = (settings.openai_embedding_model or "").lower()
        if "3-large" in model_name:
            return 3072
        return getattr(settings, "openai_embed_dim", 1536)
    return 1024  # default


def prepare_segments_for_document(
    segments: List[TextSegment],
    *,
    contract_id: str,
    contract_name: str,
    token_counter: Callable[[str], int],
) -> List[TextSegment]:
    prepared_segments: List[TextSegment] = []
    id_map = {
        segment.id: segment.id if segment.id.startswith(f"{contract_id}:") else f"{contract_id}:{segment.id}"
        for segment in segments
    }
    for segment in segments:
        segment.text = clean_text_encoding(segment.text)
        segment.contract_id = contract_id
        segment.contract_name = contract_name
        segment.id = id_map.get(segment.id, segment.id)
        if segment.parent_id:
            segment.parent_id = id_map.get(segment.parent_id, segment.parent_id)
        if segment.parent_chunk_id:
            segment.parent_chunk_id = id_map.get(segment.parent_chunk_id, segment.parent_chunk_id)
        segment.child_chunk_ids = [
            id_map.get(child_id, child_id)
            for child_id in (segment.child_chunk_ids or [])
        ]
        if segment.page_start is None:
            segment.page_start = segment.page_number
        if segment.page_end is None:
            segment.page_end = segment.page_start
        if segment.char_start is None:
            segment.char_start = segment.start_index
        if segment.char_end is None:
            segment.char_end = segment.end_index
        if not segment.chunk_level:
            segment.chunk_level = segment.type
        if not segment.token_count:
            segment.token_count = token_counter(segment.text)
        prepared_segments.append(segment)
    return prepared_segments


def _linearize_table_for_embedding(markdown_table: str) -> str:
    """Convert markdown table rows to labelled text so semantic retrieval sees cell meaning."""
    lines = [line for line in (markdown_table or "").splitlines() if line.strip()]
    if len(lines) < 2:
        return markdown_table
    header = [cell.strip() for cell in lines[0].strip().strip("|").split("|")]
    rows = lines[2:] if len(lines) > 2 else []
    linearized_rows: List[str] = []
    for row in rows:
        values = [cell.strip() for cell in row.strip().strip("|").split("|")]
        pairs = [
            f"{header[index] or f'Column {index + 1}'}: {value}"
            for index, value in enumerate(values)
        ]
        if pairs:
            linearized_rows.append("; ".join(pairs))
    return ". ".join(linearized_rows) or markdown_table


def _batched(items: List[Any], n: int = 256) -> List[List[Any]]:
    """Return bounded batches so a single vector-write failure does not abort all writes."""
    if n <= 0:
        raise ValueError("Batch size must be positive")
    return [items[index:index + n] for index in range(0, len(items), n)]


def embedding_text_for_segment(segment: TextSegment, segment_text: str) -> str:
    context_parts = [
        f"Document: {segment.contract_name}" if segment.contract_name else "",
        f"Section: {segment.section_path}" if segment.section_path else "",
        f"Chunk level: {segment.chunk_level or segment.type}",
        f"Tags: {', '.join(segment.section_tags)}" if segment.section_tags else "",
        f"Values: {', '.join(segment.value_types)}" if segment.value_types else "",
        f"Cross references: {', '.join(segment.cross_refs[:5])}" if segment.cross_refs else "",
    ]
    context = " | ".join(part for part in context_parts if part)
    content = _linearize_table_for_embedding(segment_text) if segment.type == "table" else segment_text
    return f"{context}\n{content}" if context else content


def segments_to_index_documents(
    segments: List[TextSegment],
    *,
    contract_name: str,
    contract_id: str,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    source: str = "mongodb:index.content",
) -> List[Document]:
    documents: List[Document] = []
    for segment in segments:
        segment_text = clean_text_encoding(segment.text)
        if segment.type == "sentence":
            continue
        if segment.type == "table" and not segment.embedding_eligible:
            logger.info(
                "Skipping vector embedding for oversized table %s; lexical retrieval remains available",
                segment.table_id or segment.id,
            )
            continue
        documents.append(
            Document(
                page_content=embedding_text_for_segment(segment, segment_text),
                metadata={
                    "source": source,
                    "contract_name": contract_name,
                    "contract_id": contract_id,
                    "document_id": contract_id,
                    "project_id": project_id,
                    "user_id": user_id,
                    "segment_id": segment.id,
                    "display_text": segment_text,
                    "segment_type": segment.type,
                    "table_id": segment.table_id,
                    "table_rows": segment.table_rows,
                    "table_cols": segment.table_cols,
                    "table_type": segment.table_type,
                    "classification_confidence": segment.classification_confidence,
                    "classification_version": segment.classification_version,
                    "embedding_eligible": segment.embedding_eligible,
                    "embedding_skip_reason": segment.embedding_skip_reason,
                    "chunk_schema_version": segment.chunk_schema_version,
                    "chunk_level": segment.chunk_level or segment.type,
                    "section_path": segment.section_path,
                    "section_tags": segment.section_tags,
                    "page_number": segment.page_number,
                    "page_start": segment.page_start,
                    "page_end": segment.page_end,
                    "char_start": segment.char_start,
                    "char_end": segment.char_end,
                    "parent_chunk_id": segment.parent_chunk_id or segment.parent_id,
                    "child_chunk_ids": segment.child_chunk_ids,
                    "token_count": segment.token_count,
                    "entities": segment.entities,
                    "cross_refs": segment.cross_refs,
                    "obligation_parties": segment.obligation_parties,
                    "referenced_documents": segment.referenced_documents,
                    "value_types": segment.value_types,
                    "is_pdf": False,
                },
            )
        )
    return documents


def documents_for_vector_store(documents: List[Document], text_splitter: Any) -> List[Document]:
    if any((doc.metadata or {}).get("chunk_schema_version") for doc in documents):
        return list(documents)
    return text_splitter.split_documents(documents)


class VectorStoreManager:
    """Manager to load documents, initialize embeddings, and manage MongoDB/Pinecone vector databases."""

    # voyage-context-4 context-window cap (tokens).  Documents longer than this
    # are split into sub-windows before calling contextualized_embed so that each
    # API call stays safely below the model limit.
    VOYAGE_CONTEXT_WINDOW_TOKENS: int = 120_000

    def __init__(self, ai_provider: str = "groq"):
        self.ai_provider = ai_provider.lower()
        self.hf_token = getattr(settings, "huggingface_token", None)

        self.groq_api_key = settings.groq_api_key
        self.gemini_api_key = settings.gemini_api_key
        self.openai_api_key = settings.openai_api_key
        self.anthropic_api_key = getattr(settings, "anthropic_api_key", None)

        self.pinecone_api_key = settings.pinecone_api_key
        self.pinecone_index_name = settings.pinecone_index_name
        self.voyageai_api_key = settings.voyageai_api_key
        self.use_voyageai = bool(self.voyageai_api_key)
        self.use_mongodb_vector = settings.use_mongodb_vector and bool(settings.mongodb_uri)
        self.use_pinecone = (not self.use_mongodb_vector) and bool(self.pinecone_api_key)

        self.mongo_client = None
        self.mongo_collection = None
        self.embeddings = None
        self.embedding_backend = None
        # Single shared raw VoyageAI client (set during _initialize_embeddings when applicable)
        self._vo_client: Optional[voyageai.Client] = None

        self.current_vector_backend = None
        self.current_namespace = None
        self.current_vector_count = 0
        self.existing_chunk_schema_version: Optional[int] = None

        self.embedding_model = None
        self.embedding_dimension = None

        self.segmenter = DocumentSegmenter()
        self.last_embedded_segments: List[TextSegment] = []
        self.text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
            length_function=len
        )

        self._initialize_embeddings()
        if self.use_mongodb_vector:
            self._initialize_mongodb_vector_search()
        else:
            self._initialize_pinecone()

    def _initialize_embeddings(self):
        """Populate this instance's embeddings from the shared build_embeddings
        seam — provider selection lives there, not here."""
        logger.info("Initializing embeddings...")

        try:
            bundle = build_embeddings(
                voyageai_api_key=self.voyageai_api_key, hf_token=self.hf_token
            )
        except RuntimeError:
            raise
        except Exception as e:
            # The caller decides whether this is fatal; indexing carries on
            # without vectors, so it is not an error here.
            logger.warning("No embeddings provider available: %s", e)
            raise RuntimeError("Could not initialize any embeddings provider") from e

        self.embeddings = bundle.embeddings
        self.embedding_backend = bundle.backend
        self.embedding_model = bundle.model
        self.embedding_dimension = bundle.dimension

        if bundle.backend == "voyageai":
            # Single shared raw client — reused everywhere in this instance for
            # the calls that need the SDK directly rather than via LangChain.
            self._vo_client = voyageai.Client(api_key=self.voyageai_api_key)

        logger.info(
            "Embeddings initialized: backend=%s model=%s dim=%s",
            self.embedding_backend,
            self.embedding_model,
            self.embedding_dimension,
        )

    def _initialize_mongodb_vector_search(self):
        if self.use_mongodb_vector:
            try:
                logger.info("Attempting to initialize MongoDB Atlas Vector Search...")
                self.mongo_client = shared_mongo_client
                self.mongo_collection = self.mongo_client[settings.mongodb_db_name][settings.mongodb_collection_name]
                self.mongo_client.admin.command('ping')
                logger.info(f"Successfully initialized MongoDB Atlas Vector Search on {settings.mongodb_db_name}.{settings.mongodb_collection_name}")
            except Exception as e:
                log_exception(logger, f"Failed to initialize MongoDB Atlas Vector Search", e)
                self.use_mongodb_vector = False
                self.mongo_client = None
                self.mongo_collection = None

    def _initialize_pinecone(self):
        logger.info("Initializing Pinecone vector store connection...")
        if self.use_pinecone:
            try:
                logger.info(f"Attempting to initialize Pinecone with index: {self.pinecone_index_name}")
                self.pc = pinecone.Pinecone(api_key=self.pinecone_api_key)
                available_indexes = self.pc.list_indexes()
                logger.info(f"Available Pinecone indexes: {available_indexes}")

                if self.pinecone_index_name not in [index.name for index in available_indexes]:
                    logger.warning(f"Index {self.pinecone_index_name} not found. Creating new index...")
                    embed_dim = embedding_dimension(self.embedding_backend)

                    logger.info(f"Using embedding dimension: {embed_dim} for new Pinecone index.")
                    self.pc.create_index(
                        name=self.pinecone_index_name,
                        dimension=embed_dim,
                        metric="cosine",
                        spec=ServerlessSpec(cloud="aws", region="us-east-1")
                    )
                    logger.info(f"Created new Pinecone index: {self.pinecone_index_name}")

                logger.info("Successfully initialized Pinecone")
                return True
            except Exception as e:
                log_exception(logger, f"Failed to initialize Pinecone", e)
                return False
        return False

    def load_contract_documents(
        self,
        contract_dir: Path,
        contract_name: str,
        specific_contract_output_dir: Path,
    ) -> Tuple[List[Document], List[TextSegment]]:
        markdown_path = contract_dir / f"{contract_name}.md"
        pdf_path = contract_dir / f"{contract_name}.pdf"

        documents = []
        segments: List[TextSegment] = []

        if markdown_path.exists():
            try:
                logger.info(f"Processing Markdown file: {markdown_path}")
                with open(markdown_path, 'r', encoding='utf-8') as f:
                    content = f.read()

                clean_content, md_segments = self.segmenter.segment_text_with_page_markers(content)

                document = Document(
                    page_content=f"Contract Content:\n{clean_content}",
                    metadata={
                        "source": str(markdown_path),
                        "contract_name": contract_name,
                        "is_pdf": False
                    }
                )
                documents.append(document)
                segments = md_segments

                logger.info(f"Saved full text from Markdown to {specific_contract_output_dir}")
            except Exception as e:
                log_exception(logger, f"Error reading markdown file {markdown_path}", e)

        if not documents and pdf_path.exists():
            try:
                logger.info(f"Processing PDF file as fallback: {pdf_path}")
                full_text_from_pdf, pdf_segments = self.segmenter.segment_pdf(pdf_path, contract_name, specific_contract_output_dir)

                if full_text_from_pdf:
                    document = Document(
                        page_content=f"Contract Content:\n{full_text_from_pdf}",
                        metadata={
                            "source": str(pdf_path),
                            "contract_name": contract_name,
                            "is_pdf": True,
                            "pdf_path": str(pdf_path)
                        }
                    )
                    documents.append(document)
                    segments = pdf_segments
            except Exception as e:
                log_exception(logger, f"Error processing PDF file {pdf_path}", e)

        return documents, segments

    def load_existing_vector_store(self, namespace: Optional[str]):
        if not namespace:
            return None

        self.existing_chunk_schema_version = None
        cached = get_cached_vector_store(namespace)
        if cached is not None:
            self.current_namespace = namespace
            self.current_vector_backend = "mongodb"
            if self.mongo_collection is not None:
                sample = self.mongo_collection.find_one(
                    {"namespace": namespace},
                    {"chunk_schema_version": 1},
                )
                if sample:
                    self.existing_chunk_schema_version = sample.get("chunk_schema_version")
            return cached

        if self.use_mongodb_vector:
            try:
                if self.mongo_collection is not None:
                    # Validate embedding dimension match before loading
                    sample = self.mongo_collection.find_one(
                        {"namespace": namespace},
                        {
                            "_embedding_dimension": 1,
                            "_embedding_model": 1,
                            "chunk_schema_version": 1,
                        },
                    )
                    if sample:
                        self.existing_chunk_schema_version = sample.get("chunk_schema_version")
                        stored_dim = sample.get("_embedding_dimension")
                        stored_model = sample.get("_embedding_model")
                        current_dim = self.embedding_dimension or embedding_dimension(self.embedding_backend)
                        if stored_dim and stored_dim != current_dim:
                            raise RuntimeError(
                                f"Contract {namespace} was indexed with {stored_dim}d vectors "
                                f"(model: {stored_model}). Current embedding backend "
                                f"({self.embedding_backend}) produces {current_dim}d vectors. "
                                f"Re-index the contract or use the original embedding model."
                            )

                    vector_count = self.mongo_collection.count_documents({"namespace": namespace})
                    if vector_count == 0:
                        logger.warning(f"No MongoDB vectors found for namespace {namespace}.")
                        return None
                    self.current_vector_count = vector_count

                vector_store = MongoDBAtlasVectorSearch.from_connection_string(
                    connection_string=settings.mongodb_uri,
                    namespace=f"{settings.mongodb_db_name}.{settings.mongodb_collection_name}",
                    embedding=self.embeddings,
                    index_name=settings.mongodb_vector_index_name
                )
                self.current_namespace = namespace
                self.current_vector_backend = "mongodb"
                cache_vector_store(namespace, vector_store)
                logger.info(f"Loaded existing MongoDB vector store namespace {namespace}.")
                return vector_store
            except Exception as e:
                log_exception(logger, f"Failed to load MongoDB vector store namespace {namespace}", e)

        return None

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
        if not documents:
            logger.warning(f"No documents provided to create vector store for {contract_name}.")
            return None

        texts = documents_for_vector_store(documents, self.text_splitter)
        if not texts:
            logger.warning(f"Text splitting resulted in no chunks for {contract_name}.")
            return None

        self.current_vector_backend = None
        self.current_vector_count = 0
        namespace = namespace or default_vector_namespace(contract_name, contract_id)

        if replace_existing:
            invalidate_vector_store(namespace)

        for i, text in enumerate(texts):
            text.metadata["chunk_index"] = i
            text.metadata["contract_name"] = contract_name
            if contract_id:
                text.metadata["contract_id"] = contract_id
            if project_id:
                text.metadata["project_id"] = project_id
            if user_id:
                text.metadata["user_id"] = user_id
            text.metadata["embedded_at"] = datetime.utcnow().isoformat()

        # MongoDB Atlas Vector Search
        if self.use_mongodb_vector:
            try:
                logger.info(f"Creating MongoDB Atlas vector store with namespace {namespace}")
                if not self.embeddings:
                    logger.error("Embeddings are not initialized. Cannot create MongoDB vector store.")
                else:
                    if replace_existing and self.mongo_collection is not None:
                        deleted = self.mongo_collection.delete_many({"namespace": namespace}).deleted_count
                        logger.info(f"Deleted {deleted} existing MongoDB vectors for namespace {namespace}")

                    for doc in texts:
                        doc.metadata["namespace"] = namespace
                        doc.metadata["contract_name"] = contract_name
                        doc.metadata["_embedding_model"] = self.embedding_model
                        doc.metadata["_embedding_dimension"] = self.embedding_dimension
                        doc.metadata["_embedding_backend"] = self.embedding_backend
                        if project_id:
                            doc.metadata["project_id"] = project_id

                    vector_store = MongoDBAtlasVectorSearch.from_connection_string(
                        connection_string=settings.mongodb_uri,
                        namespace=f"{settings.mongodb_db_name}.{settings.mongodb_collection_name}",
                        embedding=self.embeddings,
                        index_name=settings.mongodb_vector_index_name
                    )
                    successful_documents = 0
                    for batch_index, batch in enumerate(_batched(texts), 1):
                        try:
                            vector_store.add_documents(batch)
                            successful_documents += len(batch)
                        except Exception as batch_error:
                            logger.error(
                                "MongoDB vector batch %d failed for namespace %s; continuing with remaining batches: %s",
                                batch_index,
                                namespace,
                                batch_error,
                            )
                    if successful_documents == 0:
                        raise RuntimeError(f"All MongoDB vector batches failed for namespace {namespace}")
                    self.current_vector_count = successful_documents

                    try:
                        vector_store.create_vector_search_index(
                            dimensions=embedding_dimension(self.embedding_backend),
                            filters=[
                                "namespace",
                                "contract_name",
                                "contract_id",
                                "document_id",
                                "project_id",
                                "chunk_schema_version",
                                "chunk_level",
                                "section_tags",
                                "referenced_documents",
                            ]
                        )
                        logger.info("MongoDB vector search index ensured.")
                    except Exception as idx_err:
                        logger.debug(f"Vector search index already exists or could not be auto-created: {idx_err}")

                    self.current_namespace = namespace
                    self.current_vector_backend = "mongodb"
                    logger.info(f"Successfully created MongoDB Atlas vector store with namespace {namespace}")
                    return vector_store
            except Exception as e:
                log_exception(logger, "MongoDB vector store failed, falling back to FAISS", e)

        # Pinecone
        if self.use_pinecone:
            try:
                logger.info(f"Creating Pinecone vector store with namespace {namespace} for index {self.pinecone_index_name}")
                if not self.embeddings:
                    logger.error("Embeddings are not initialized. Cannot create Pinecone vector store.")
                    return None

                vector_store = PineconeVectorStore.from_documents(
                    [],
                    self.embeddings,
                    index_name=self.pinecone_index_name,
                    namespace=namespace
                )

                batch_size = getattr(settings, "pinecone_batch_size", 20)
                for i in range(0, len(texts), batch_size):
                    batch = texts[i:i + batch_size]
                    logger.info(f"Adding batch {i//batch_size + 1} of {len(batch)} documents to Pinecone.")
                    for doc_in_batch in batch:
                        if len(doc_in_batch.page_content) > 8000:
                            doc_in_batch.page_content = doc_in_batch.page_content[:8000]
                    vector_store.add_documents(batch)
                    if i + batch_size < len(texts):
                        time.sleep(getattr(settings, "pinecone_batch_sleep", 10))

                time.sleep(5)
                self.current_namespace = namespace
                self.current_vector_backend = "pinecone"
                self.current_vector_count = len(texts)
                logger.info(f"Successfully created and populated Pinecone vector store with namespace {namespace}")
                return vector_store
            except Exception as e:
                log_exception(logger, f"Error creating Pinecone vector store", e)

        # FAISS fallback
        try:
            from langchain_community.vectorstores import FAISS
            logger.info("Using FAISS vector store as fallback or default.")
            if not self.embeddings:
                logger.error("Embeddings are not initialized. Cannot create FAISS vector store.")
                return None
            vector_store = FAISS.from_documents(texts, self.embeddings)
            time.sleep(1)
            self.current_vector_backend = "faiss"
            self.current_vector_count = len(texts)
            logger.info("Successfully created FAISS vector store.")
            return vector_store
        except ImportError:
            logger.error("FAISS is not available, and MongoDB/Pinecone setup failed or was not enabled.")
            raise RuntimeError("No vector store implementation available or successfully initialized.")
        except Exception as e:
            log_exception(logger, f"Error creating FAISS vector store", e)
            return None

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
        namespace = namespace or default_vector_namespace(contract_name, contract_id)
        
        schema_version = getattr(settings, "chunk_schema_version", 2)

        # Existing vectors are reusable only when their character offsets were
        # produced from the current indexed-content schema.
        existing_store = self.load_existing_vector_store(namespace)
        if existing_store is not None and self.existing_chunk_schema_version == schema_version:
            logger.info(
                "Skipping embedding for contract %s in namespace %s: schema version %s is current.",
                contract_name,
                namespace,
                schema_version,
            )
            cached_segs = get_cached_segments(contract_id, schema_version)
            self.last_embedded_segments = [
                TextSegment.model_validate(segment)
                for segment in (cached_segs or [])
            ]
            segment_count = len(self.last_embedded_segments)

            return {
                "namespace": self.current_namespace,
                "backend": self.current_vector_backend,
                "collection": f"{settings.mongodb_db_name}.{settings.mongodb_collection_name}"
                    if self.current_vector_backend == "mongodb" else None,
                "chunk_count": self.current_vector_count,
                "segment_count": segment_count,
                "chunk_schema_version": schema_version,
                "embedding_backend": self.embedding_backend,
                "embedding_model": self.embedding_model,
                "embedding_dimension": self.embedding_dimension or embedding_dimension(self.embedding_backend),
            }

        if existing_store is not None:
            logger.info(
                "Re-indexing contract %s in namespace %s because stored schema version %s differs from current version %s.",
                contract_name,
                namespace,
                self.existing_chunk_schema_version,
                schema_version,
            )
            invalidate_vector_store(namespace)
            replace_existing = True

        clean_content, segments = self.segmenter.segment_text_with_page_markers(contract_text)
        self.last_embedded_segments = list(segments)
        if not clean_content.strip():
            raise ValueError("No extracted contract text available to embed.")

        # Check if we should use Voyage auto-chunking
        is_voyage_autochunk = (
            self.embedding_backend == "voyageai"
            and getattr(settings, "voyageai_auto_chunking", False)
            and bool(self.embedding_model and self.embedding_model.startswith("voyage-context-"))
        )

        if is_voyage_autochunk:
            logger.info(f"Using Voyage auto-chunking for contract {contract_name} with model {self.embedding_model}")
            vo_client = self._vo_client  # single shared client — no duplicate initialisation

            # ------------------------------------------------------------------
            # Context-window guard: voyage-context-4 hard cap = 120 k tokens.
            # Split at paragraph boundaries, accumulating real token counts
            # (via the same tokenizer used everywhere in the codebase) until
            # the next paragraph would exceed the per-window target.
            # ------------------------------------------------------------------
            _MAX_TOKENS_PER_WINDOW = 110_000  # 10 k buffer below the 120 k cap
            windows: List[str] = []
            paragraphs = clean_content.split("\n\n")
            current_parts: List[str] = []
            current_tokens = 0

            for para in paragraphs:
                para_tokens = self.segmenter._estimated_tokens(para)
                if para_tokens > _MAX_TOKENS_PER_WINDOW:
                    # Single paragraph exceeds the cap — split it by sentences
                    if current_parts:
                        windows.append("\n\n".join(current_parts))
                        current_parts, current_tokens = [], 0
                    sentences = para.replace(". ", ".\n").split("\n")
                    for sent in sentences:
                        sent_tokens = self.segmenter._estimated_tokens(sent)
                        if current_tokens + sent_tokens > _MAX_TOKENS_PER_WINDOW and current_parts:
                            windows.append("\n\n".join(current_parts))
                            current_parts, current_tokens = [sent], sent_tokens
                        else:
                            current_parts.append(sent)
                            current_tokens += sent_tokens
                elif current_tokens + para_tokens > _MAX_TOKENS_PER_WINDOW and current_parts:
                    windows.append("\n\n".join(current_parts))
                    current_parts, current_tokens = [para], para_tokens
                else:
                    current_parts.append(para)
                    current_tokens += para_tokens

            if current_parts:
                windows.append("\n\n".join(current_parts))

            logger.info(
                "Document split into %d context window(s) for Voyage auto-chunking "
                "(target ≤%d tokens/window, total doc tokens ~%d)",
                len(windows), _MAX_TOKENS_PER_WINDOW,
                self.segmenter._estimated_tokens(clean_content),
            )

            chunk_texts: List[str] = []
            embeddings: List[List[float]] = []

            for win_idx, window_text in enumerate(windows):
                win_tokens = self.segmenter._estimated_tokens(window_text)
                logger.info(
                    "Calling contextualized_embed for window %d/%d (~%d tokens)",
                    win_idx + 1, len(windows), win_tokens,
                )
                res = vo_client.contextualized_embed(
                    model=self.embedding_model,
                    inputs=[window_text],
                    input_type="document",
                    enable_auto_chunking=True,
                    output_dimension=self.embedding_dimension,
                )
                if not res.results:
                    logger.warning("Voyage auto-chunking returned no results for window %d — skipping", win_idx + 1)
                    continue
                result_obj = res.results[0]
                chunk_texts.extend(result_obj.chunk_texts)
                embeddings.extend(result_obj.embeddings)

            if not chunk_texts:
                raise RuntimeError("Voyage auto-chunking returned no results across all windows.")

            # Function to find chunk offsets and pages
            def find_chunk_offsets_and_pages(
                chunk_text_str: str,
                clean_content_str: str,
                original_segments: List[TextSegment],
                search_start_idx: int = 0
            ) -> Tuple[int, int, Optional[int]]:
                idx = clean_content_str.find(chunk_text_str, search_start_idx)
                if idx == -1:
                    idx = clean_content_str.find(chunk_text_str[:100], search_start_idx)
                
                char_start = idx if idx != -1 else search_start_idx
                char_end = char_start + len(chunk_text_str)
                
                overlapping_pages = []
                for seg in original_segments:
                    if seg.page_number is not None and seg.start_index <= char_end and seg.end_index >= char_start:
                        overlapping_pages.append((seg.end_index - seg.start_index, seg.page_number))
                
                if overlapping_pages:
                    overlapping_pages.sort()
                    page_number = overlapping_pages[0][1]
                else:
                    page_number = None
                return char_start, char_end, page_number

            voyage_segments = []
            index_documents = []
            search_start = 0

            for i, (chunk_text, embedding) in enumerate(zip(chunk_texts, embeddings)):
                char_start, char_end, page_num = find_chunk_offsets_and_pages(
                    chunk_text,
                    clean_content,
                    segments,
                    search_start
                )
                search_start = char_start

                seg_id = f"{contract_id}:voyage-chunk-{i}"
                token_count = self.segmenter._estimated_tokens(chunk_text)

                seg = TextSegment(
                    id=seg_id,
                    text=chunk_text,
                    type="voyage-chunk",
                    start_index=char_start,
                    end_index=char_end,
                    page_number=page_num,
                    contract_id=contract_id,
                    contract_name=contract_name,
                    chunk_schema_version=schema_version,
                    chunk_level="voyage-chunk",
                    page_start=page_num,
                    page_end=page_num,
                    char_start=char_start,
                    char_end=char_end,
                    token_count=token_count,
                )
                voyage_segments.append(seg)

                index_documents.append(
                    Document(
                        page_content=chunk_text,
                        metadata={
                            "source": "mongodb:index.content",
                            "contract_name": contract_name,
                            "contract_id": contract_id,
                            "document_id": contract_id,
                            "project_id": project_id,
                            "user_id": user_id,
                            "segment_id": seg.id,
                            "display_text": chunk_text,
                            "segment_type": seg.type,
                            "chunk_schema_version": seg.chunk_schema_version,
                            "chunk_level": seg.chunk_level,
                            "page_number": seg.page_number,
                            "page_start": seg.page_start,
                            "page_end": seg.page_end,
                            "char_start": seg.char_start,
                            "char_end": seg.char_end,
                            "token_count": seg.token_count,
                            "is_pdf": False,
                        }
                    )
                )

            self.last_embedded_segments = list(voyage_segments)
            chunk_count = len(index_documents)
            segment_count = len(voyage_segments)

            # Persist segments to contract document for fallback retrieval caching
            segments_dicts = [segment.model_dump(mode="json") for segment in voyage_segments]
            cache_segments(contract_id, segments_dicts, schema_version)

            precalc_embeddings = PrecalculatedEmbeddings(
                chunk_texts,
                embeddings,
                fallback_embeddings=self.embeddings
            )

            orig_embeddings = self.embeddings
            try:
                self.embeddings = precalc_embeddings
                vector_store = self.create_vector_store(
                    index_documents,
                    contract_name,
                    namespace=namespace,
                    contract_id=contract_id,
                    project_id=project_id,
                    user_id=user_id,
                    replace_existing=replace_existing,
                )
            finally:
                self.embeddings = orig_embeddings

        else:
            segments = prepare_segments_for_document(
                segments,
                contract_id=contract_id,
                contract_name=contract_name,
                token_counter=self.segmenter._estimated_tokens,
            )
            self.last_embedded_segments = list(segments)
            index_documents = segments_to_index_documents(
                segments,
                contract_name=contract_name,
                contract_id=contract_id,
                project_id=project_id,
                user_id=user_id,
            )
            chunk_count = len(documents_for_vector_store(index_documents, self.text_splitter))
            segment_count = len(segments)

            # Persist segments to contract document for fallback retrieval caching
            segments_dicts = [segment.model_dump(mode="json") for segment in segments]
            cache_segments(contract_id, segments_dicts, schema_version)

            if index_documents:
                vector_store = self.create_vector_store(
                    index_documents,
                    contract_name,
                    namespace=namespace,
                    contract_id=contract_id,
                    project_id=project_id,
                    user_id=user_id,
                    replace_existing=replace_existing,
                )
            else:
                logger.warning(
                    "No embedding-eligible documents remain for %s; using lexical-only retrieval for cached segments",
                    contract_name,
                )
                self.current_namespace = namespace
                self.current_vector_backend = "lexical"
                self.current_vector_count = 0
                vector_store = True

        if not vector_store:
            raise RuntimeError("Vector store creation failed.")

        if require_mongodb and self.current_vector_backend not in {"mongodb", "lexical"}:
            raise RuntimeError("MongoDB vector storage is unavailable; embeddings were not persisted in the database.")

        table_segments = [segment for segment in self.last_embedded_segments if segment.type == "table"]
        return {
            "namespace": self.current_namespace,
            "backend": self.current_vector_backend,
            "collection": f"{settings.mongodb_db_name}.{settings.mongodb_collection_name}"
                if self.current_vector_backend == "mongodb" else None,
            "chunk_count": self.current_vector_count or chunk_count,
            "segment_count": segment_count,
            "table_count": len(table_segments),
            "table_ids": [segment.table_id for segment in table_segments if segment.table_id],
            "lexical_table_count": sum(1 for segment in table_segments if not segment.embedding_eligible),
            "chunk_schema_version": schema_version,
            "embedding_backend": self.embedding_backend,
            "embedding_model": self.embedding_model,
            "embedding_dimension": embedding_dimension(self.embedding_backend),
        }
