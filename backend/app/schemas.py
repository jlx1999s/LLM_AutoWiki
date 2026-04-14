from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class IngestRequest(BaseModel):
    path: str = Field(description="Local file or directory path.")
    recursive: bool = Field(default=True)


class IngestResponse(BaseModel):
    ingested_count: int
    skipped_count: int
    failed_count: int
    errors: list[str]


class WikiBuildResponse(BaseModel):
    pages_generated: int
    index_path: str
    generated_at: datetime


class WikiPageSummary(BaseModel):
    slug: str
    title: str
    source_path: str
    updated_at: datetime


class WikiPageDetail(BaseModel):
    slug: str
    title: str
    content_md: str
    source_path: str
    updated_at: datetime


class QAQueryRequest(BaseModel):
    question: str
    top_k: int = Field(default=5, ge=1, le=20)
    strategy: Literal["lexical", "vector", "hybrid"] = "hybrid"


class Citation(BaseModel):
    chunk_id: int
    document_title: str
    source_path: str
    snippet: str
    score: float


class QAQueryResponse(BaseModel):
    answer: str
    citations: list[Citation]
    latency_ms: int
    strategy: Literal["lexical", "vector", "hybrid"]
