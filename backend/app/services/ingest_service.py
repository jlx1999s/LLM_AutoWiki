from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from app.pipeline.chunker import split_into_chunks
from app.pipeline.parser import is_supported_file, parse_text_file
from app.store.repositories import upsert_document_with_chunks


@dataclass
class IngestStats:
    ingested_count: int = 0
    skipped_count: int = 0
    failed_count: int = 0
    errors: list[str] = field(default_factory=list)


def collect_files(target: Path, recursive: bool) -> list[Path]:
    if target.is_file():
        return [target] if is_supported_file(target) else []
    if target.is_dir():
        iterator = target.rglob("*") if recursive else target.glob("*")
        return [p for p in iterator if is_supported_file(p)]
    return []


def ingest_path(db: Session, input_path: str, recursive: bool = True) -> IngestStats:
    stats = IngestStats()
    target = Path(input_path).expanduser().resolve()
    if not target.exists():
        stats.failed_count = 1
        stats.errors.append(f"Path does not exist: {target}")
        return stats

    files = collect_files(target, recursive=recursive)
    if not files:
        stats.failed_count = 1
        stats.errors.append(f"No supported files found at: {target}")
        return stats

    for file_path in files:
        try:
            text = parse_text_file(file_path)
            if not text:
                stats.failed_count += 1
                stats.errors.append(f"Empty file: {file_path}")
                continue

            chunks = split_into_chunks(text)
            status = upsert_document_with_chunks(
                db=db,
                source_path=str(file_path),
                title=file_path.stem,
                body_text=text,
                chunks=chunks,
            )
            if status == "skipped":
                stats.skipped_count += 1
            else:
                stats.ingested_count += 1
        except Exception as exc:  # pragma: no cover - defensive branch
            stats.failed_count += 1
            stats.errors.append(f"{file_path}: {exc}")

    return stats

