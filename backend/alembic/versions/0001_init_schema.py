"""init schema

Revision ID: 0001_init_schema
Revises:
Create Date: 2026-04-15 00:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0001_init_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("source_path", sa.String(length=1024), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("body_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="success"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_documents_id", "documents", ["id"], unique=False)
    op.create_index("ix_documents_source_path", "documents", ["source_path"], unique=True)
    op.create_index("ix_documents_content_hash", "documents", ["content_hash"], unique=False)

    op.create_table(
        "chunks",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("document_id", "chunk_index", name="uq_doc_chunk_index"),
    )
    op.create_index("ix_chunks_id", "chunks", ["id"], unique=False)
    op.create_index("ix_chunks_document_id", "chunks", ["document_id"], unique=False)

    op.create_table(
        "wiki_pages",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("document_id", sa.Integer(), sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("slug", sa.String(length=255), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("content_md", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_wiki_pages_id", "wiki_pages", ["id"], unique=False)
    op.create_index("ix_wiki_pages_document_id", "wiki_pages", ["document_id"], unique=True)
    op.create_index("ix_wiki_pages_slug", "wiki_pages", ["slug"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_wiki_pages_slug", table_name="wiki_pages")
    op.drop_index("ix_wiki_pages_document_id", table_name="wiki_pages")
    op.drop_index("ix_wiki_pages_id", table_name="wiki_pages")
    op.drop_table("wiki_pages")

    op.drop_index("ix_chunks_document_id", table_name="chunks")
    op.drop_index("ix_chunks_id", table_name="chunks")
    op.drop_table("chunks")

    op.drop_index("ix_documents_content_hash", table_name="documents")
    op.drop_index("ix_documents_source_path", table_name="documents")
    op.drop_index("ix_documents_id", table_name="documents")
    op.drop_table("documents")
