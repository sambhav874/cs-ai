"""ContractSense RAG implementation."""

from .schemas import CitationInfo, ExtractedAnswer, Reference, TextSegment
from .evidence_service import EvidenceHit, EvidenceRetrievalService
from .segmentation import DocumentSegmenter

__all__ = [
    "CitationInfo",
    "ContractRAGSystem",
    "DocumentSegmenter",
    "EvidenceHit",
    "EvidenceRetrievalService",
    "ExtractedAnswer",
    "Reference",
    "TextSegment",
]


def __getattr__(name: str):
    if name == "ContractRAGSystem":
        from .facade import ContractRAGSystem

        return ContractRAGSystem
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
