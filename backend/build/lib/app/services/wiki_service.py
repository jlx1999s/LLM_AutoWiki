from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.pipeline.compiler import build_wiki_page_content, slugify, write_wiki_page
from app.store.repositories import list_documents, list_wiki_pages, upsert_wiki_page


def build_wiki(db: Session) -> tuple[int, Path]:
    settings = get_settings()
    pages_dir = settings.wiki_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)

    generated = 0
    index_lines = ["# LLM Wiki Index", "", f"_Updated: {datetime.utcnow().isoformat()}_", ""]
    used_slugs: set[str] = set()
    for doc in list_documents(db):
        base_slug = slugify(doc.title)
        slug = base_slug
        suffix = 1
        while slug in used_slugs:
            suffix += 1
            slug = f"{base_slug}-{suffix}"
        used_slugs.add(slug)

        md_content = build_wiki_page_content(doc)
        page_path = pages_dir / f"{slug}.md"
        write_wiki_page(page_path, md_content)
        upsert_wiki_page(
            db=db,
            document=doc,
            slug=slug,
            title=doc.title,
            content_md=md_content,
        )
        index_lines.append(f"- [{doc.title}](pages/{slug}.md)")
        generated += 1

    index_path = settings.wiki_dir / "index.md"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text("\n".join(index_lines) + "\n", encoding="utf-8")
    return generated, index_path


def read_wiki_page_from_disk(slug: str) -> str | None:
    settings = get_settings()
    page_path = settings.wiki_dir / "pages" / f"{slug}.md"
    if not page_path.exists():
        return None
    return page_path.read_text(encoding="utf-8")


def get_page_summaries(db: Session) -> list[dict]:
    pages = list_wiki_pages(db)
    return [
        {
            "slug": p.slug,
            "title": p.title,
            "source_path": p.document.source_path,
            "updated_at": p.updated_at,
        }
        for p in pages
    ]
