import re
from pathlib import Path

from app.store.models import Document


def slugify(value: str) -> str:
    normalized = value.strip().lower()
    normalized = re.sub(r"[^\w\s-]", "", normalized)
    normalized = re.sub(r"[-\s]+", "-", normalized)
    return normalized or "untitled"


def build_wiki_page_content(document: Document) -> str:
    return (
        f"# {document.title}\n\n"
        f"> Source: `{document.source_path}`\n\n"
        f"{document.body_text}\n"
    )


def write_wiki_page(file_path: Path, content: str) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_text(content, encoding="utf-8")

