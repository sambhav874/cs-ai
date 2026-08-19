"""Shared data models for the contract agent."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class CitationInfo(BaseModel):
    """Model for storing citation information."""

    text: str
    start_index: int
    end_index: int
    source: str

    def __str__(self) -> str:
        return (
            f"Citation(text='{self.text[:30]}...', "
            f"position={self.start_index}-{self.end_index}, source='{self.source}')"
        )


class TextSegment(BaseModel):
    """Model for storing hierarchical text segments with unique IDs."""

    id: str
    text: str
    display_text: Optional[str] = None
    type: str
    start_index: int
    end_index: int
    parent_id: Optional[str] = None
    page_number: Optional[int] = None
    contract_id: Optional[str] = None
    contract_name: Optional[str] = None
    chunk_schema_version: int = 1
    chunk_level: Optional[str] = None
    section_path: Optional[str] = None
    section_tags: List[str] = Field(default_factory=list)
    page_start: Optional[int] = None
    page_end: Optional[int] = None
    char_start: Optional[int] = None
    char_end: Optional[int] = None
    parent_chunk_id: Optional[str] = None
    child_chunk_ids: List[str] = Field(default_factory=list)
    token_count: Optional[int] = None
    entities: List[str] = Field(default_factory=list)
    cross_refs: List[str] = Field(default_factory=list)
    obligation_parties: List[str] = Field(default_factory=list)
    referenced_documents: List[str] = Field(default_factory=list)
    value_types: List[str] = Field(default_factory=list)
    table_rows: Optional[int] = None
    table_cols: Optional[int] = None
    table_part_index: Optional[int] = None
    table_part_count: Optional[int] = None

    def __str__(self) -> str:
        level = self.chunk_level or self.type
        page_range = self.page_start or self.page_number
        if self.page_end and self.page_end != page_range:
            page_range = f"{page_range}-{self.page_end}"
        return f"Segment(id={self.id}, type={level}, text='{self.text[:30]}...', page={page_range})"


class Reference(BaseModel):
    """Model for storing reference information."""

    segment_ids: List[str]
    justification: str
    confidence: str

    def __str__(self) -> str:
        return f"Reference(segments={len(self.segment_ids)}, confidence={self.confidence})"


class ExtractedAnswer(BaseModel):
    """Model for storing extracted answers with references."""

    question: str
    value: str
    reference: Reference
    confidence: str

    def __str__(self) -> str:
        return (
            f"Answer(question='{self.question[:30]}...', "
            f"value='{self.value[:30]}...', ref={self.reference})"
        )


__all__ = ["CitationInfo", "ExtractedAnswer", "Reference", "TextSegment"]
