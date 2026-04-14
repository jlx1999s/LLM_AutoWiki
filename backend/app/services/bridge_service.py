from __future__ import annotations

import json
import math
import shutil
import socket
from collections import deque
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[3]

def _norm(path: str, base: str | None = None) -> Path:
    p = Path(path).expanduser()
    if not p.is_absolute():
        base_path = Path(base).expanduser() if base else PROJECT_ROOT
        p = base_path / p
    return p.resolve()


def _to_posix(path: Path) -> str:
    return str(path).replace("\\", "/")


def project_root() -> str:
    return _to_posix(PROJECT_ROOT)


def resolve_path(path: str, base: str | None = None, must_exist: bool = False) -> str:
    p = _norm(path, base=base)
    if must_exist and not p.exists():
        raise FileNotFoundError(f"Path not found: {p}")
    return _to_posix(p)


def read_file(path: str) -> str:
    p = _norm(path)
    return p.read_text(encoding="utf-8", errors="ignore")


def write_file(path: str, contents: str) -> None:
    p = _norm(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(contents, encoding="utf-8")


def _build_file_node(path: Path) -> dict[str, Any]:
    is_dir = path.is_dir() and not path.is_symlink()
    node: dict[str, Any] = {
        "name": path.name,
        "path": _to_posix(path),
        "is_dir": is_dir,
    }
    if is_dir:
        children = sorted(
            list(path.iterdir()),
            key=lambda x: (not x.is_dir(), x.name.lower()),
        )
        node["children"] = [_build_file_node(child) for child in children]
    return node


def list_directory(path: str) -> list[dict[str, Any]]:
    p = _norm(path)
    if not p.exists() or not p.is_dir():
        return []
    children = sorted(
        list(p.iterdir()),
        key=lambda x: (not x.is_dir(), x.name.lower()),
    )
    return [_build_file_node(child) for child in children]


def copy_file(source: str, destination: str) -> None:
    src = _norm(source)
    dst = _norm(destination)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def copy_directory(source: str, destination: str) -> list[str]:
    src = _norm(source)
    dst = _norm(destination)
    if not src.exists() or not src.is_dir():
        return []
    copied_files: list[str] = []
    for file_path in src.rglob("*"):
        if not file_path.is_file():
            continue
        rel = file_path.relative_to(src)
        out = dst / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file_path, out)
        copied_files.append(_to_posix(out))
    return copied_files


def preprocess_file(path: str) -> str:
    p = _norm(path)
    text = p.read_text(encoding="utf-8", errors="ignore") if p.is_file() else ""
    cache_dir = p.parent / ".cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_file = cache_dir / f"{p.name}.txt"
    cache_file.write_text(text, encoding="utf-8")
    return _to_posix(cache_file)


def delete_file(path: str) -> None:
    p = _norm(path)
    if not p.exists():
        return
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()


def find_related_wiki_pages(projectPath: str, sourceName: str) -> list[str]:
    project_root = _norm(projectPath)
    wiki_root = project_root / "wiki"
    if not wiki_root.exists():
        return []
    needle = sourceName.lower()
    matches: list[str] = []
    for md_file in wiki_root.rglob("*.md"):
        content = md_file.read_text(encoding="utf-8", errors="ignore").lower()
        if needle in content:
            matches.append(_to_posix(md_file))
    return matches


def create_directory(path: str) -> None:
    _norm(path).mkdir(parents=True, exist_ok=True)


def create_project(name: str, path: str) -> dict[str, str]:
    parent = _norm(path)
    project = parent / name
    (project / "raw" / "sources").mkdir(parents=True, exist_ok=True)
    (project / "raw" / "clips").mkdir(parents=True, exist_ok=True)
    (project / "wiki" / "sources").mkdir(parents=True, exist_ok=True)
    (project / ".llmwiki").mkdir(parents=True, exist_ok=True)
    return {"name": name, "path": _to_posix(project)}


def open_project(path: str) -> dict[str, str]:
    project = _norm(path)
    if not project.exists() or not project.is_dir():
        raise FileNotFoundError(f"Project path not found: {project}")
    (project / "raw" / "sources").mkdir(parents=True, exist_ok=True)
    (project / "wiki").mkdir(parents=True, exist_ok=True)
    (project / ".llmwiki").mkdir(parents=True, exist_ok=True)
    return {"name": project.name, "path": _to_posix(project)}


def clip_server_status() -> str:
    try:
        with socket.create_connection(("127.0.0.1", 19827), timeout=0.5):
            return "running"
    except OSError:
        return "error"


def _looks_like_project(path: Path) -> bool:
    return (
        path.is_dir()
        and (path / "wiki").is_dir()
        and (path / "raw").is_dir()
    )


def list_projects(
    base: str | None = None,
    max_depth: int = 3,
    limit: int = 50,
) -> list[dict[str, str]]:
    root = _norm(base, base=PROJECT_ROOT) if base else PROJECT_ROOT
    if not root.exists() or not root.is_dir():
        return []

    results: list[Path] = []
    visited: set[Path] = set()
    queue: deque[tuple[Path, int]] = deque([(root, 0)])

    while queue and len(results) < max(1, int(limit)):
        current, depth = queue.popleft()
        if current in visited:
            continue
        visited.add(current)

        if _looks_like_project(current):
            results.append(current)
            continue

        if depth >= max(0, int(max_depth)):
            continue

        try:
            children = sorted(
                [p for p in current.iterdir() if p.is_dir() and not p.name.startswith(".")],
                key=lambda p: p.name.lower(),
            )
        except Exception:
            continue

        for child in children:
            queue.append((child, depth + 1))

    return [{"name": p.name, "path": _to_posix(p)} for p in results]


def _vector_file(project_path: str) -> Path:
    root = _norm(project_path)
    store_dir = root / ".llmwiki"
    store_dir.mkdir(parents=True, exist_ok=True)
    return store_dir / "vectors.json"


def _load_vectors(project_path: str) -> dict[str, list[float]]:
    vf = _vector_file(project_path)
    if not vf.exists():
        return {}
    try:
        data = json.loads(vf.read_text(encoding="utf-8"))
        return {str(k): [float(x) for x in v] for k, v in data.items()}
    except Exception:
        return {}


def _save_vectors(project_path: str, vectors: dict[str, list[float]]) -> None:
    vf = _vector_file(project_path)
    vf.write_text(json.dumps(vectors), encoding="utf-8")


def vector_upsert(projectPath: str, pageId: str, embedding: list[float]) -> None:
    vectors = _load_vectors(projectPath)
    vectors[pageId] = [float(v) for v in embedding]
    _save_vectors(projectPath, vectors)


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def vector_search(
    projectPath: str,
    queryEmbedding: list[float],
    topK: int = 10,
) -> list[dict[str, float | str]]:
    vectors = _load_vectors(projectPath)
    query = [float(v) for v in queryEmbedding]
    scored = [
        {"page_id": page_id, "score": _cosine(query, emb)}
        for page_id, emb in vectors.items()
    ]
    scored.sort(key=lambda x: float(x["score"]), reverse=True)
    return scored[: max(int(topK), 1)]


def vector_delete(projectPath: str, pageId: str) -> None:
    vectors = _load_vectors(projectPath)
    if pageId in vectors:
        del vectors[pageId]
        _save_vectors(projectPath, vectors)


def vector_count(projectPath: str) -> int:
    return len(_load_vectors(projectPath))


COMMAND_MAP = {
    "project_root": project_root,
    "resolve_path": resolve_path,
    "read_file": read_file,
    "write_file": write_file,
    "list_directory": list_directory,
    "copy_file": copy_file,
    "copy_directory": copy_directory,
    "preprocess_file": preprocess_file,
    "delete_file": delete_file,
    "find_related_wiki_pages": find_related_wiki_pages,
    "create_directory": create_directory,
    "create_project": create_project,
    "open_project": open_project,
    "list_projects": list_projects,
    "clip_server_status": clip_server_status,
    "vector_upsert": vector_upsert,
    "vector_search": vector_search,
    "vector_delete": vector_delete,
    "vector_count": vector_count,
}


def invoke_command(command: str, args: dict[str, Any]) -> Any:
    fn = COMMAND_MAP.get(command)
    if fn is None:
        raise ValueError(f"Unsupported command: {command}")
    return fn(**args)
