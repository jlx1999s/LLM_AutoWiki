from __future__ import annotations

from datetime import datetime
from hashlib import sha256
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.store.models import Chunk, Document, WikiPage


def content_hash(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()


def upsert_document_with_chunks(
    db: Session,
    source_path: str,
    title: str,
    body_text: str,
    chunks: list[str],
) -> str:
    current_hash = content_hash(body_text)
    existing = db.scalar(select(Document).where(Document.source_path == source_path))
    if existing and existing.content_hash == current_hash:
        return "skipped"

    if existing:
        existing.title = title
        existing.body_text = body_text
        existing.content_hash = current_hash
        existing.updated_at = datetime.utcnow()
        existing.chunks.clear()
        for idx, chunk_text in enumerate(chunks):
            existing.chunks.append(
                Chunk(
                    chunk_index=idx,
                    text=chunk_text,
                    token_count=len(chunk_text.split()),
                )
            )
        db.flush()
        return "updated"

    doc = Document(
        source_path=source_path,
        title=title,
        content_hash=current_hash,
        body_text=body_text,
        status="success",
        chunks=[
            Chunk(
                chunk_index=idx,
                text=chunk_text,
                token_count=len(chunk_text.split()),
            )
            for idx, chunk_text in enumerate(chunks)
        ],
    )
    db.add(doc)
    db.flush()
    return "created"


def list_documents(db: Session) -> list[Document]:
    return list(db.scalars(select(Document).order_by(Document.updated_at.desc())))


def upsert_wiki_page(
    db: Session,
    document: Document,
    slug: str,
    title: str,
    content_md: str,
) -> WikiPage:
    existing = db.scalar(select(WikiPage).where(WikiPage.document_id == document.id))
    if existing:
        existing.slug = slug
        existing.title = title
        existing.content_md = content_md
        existing.updated_at = datetime.utcnow()
        db.flush()
        return existing

    page = WikiPage(
        document_id=document.id,
        slug=slug,
        title=title,
        content_md=content_md,
    )
    db.add(page)
    db.flush()
    return page


def list_wiki_pages(db: Session) -> list[WikiPage]:
    return list(db.scalars(select(WikiPage).order_by(WikiPage.updated_at.desc())))


def get_wiki_page_by_slug(db: Session, slug: str) -> Optional[WikiPage]:
    return db.scalar(select(WikiPage).where(WikiPage.slug == slug))


def list_chunks(db: Session) -> list[Chunk]:
    return list(db.scalars(select(Chunk)))
