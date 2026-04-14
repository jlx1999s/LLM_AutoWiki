from pathlib import Path


SUPPORTED_SUFFIXES = {".md", ".txt"}


def is_supported_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES


def parse_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore").strip()

