import time

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.retrieval.lexical import lexical_overlap_score
from app.store.models import Chunk


def _make_answer(question: str, snippets: list[str]) -> str:
    if not snippets:
        return "当前知识库中没有足够证据来回答这个问题。"
    combined = "\n".join(f"- {s}" for s in snippets)
    return (
        f"问题：{question}\n\n"
        "基于已导入资料，优先证据如下：\n"
        f"{combined}\n\n"
        "建议：如需更精确结论，请继续导入更完整资料并启用向量检索与重排。"
    )


def answer_question(db: Session, question: str, top_k: int = 5) -> dict:
    started = time.perf_counter()

    chunks = list(
        db.scalars(
            select(Chunk).options(joinedload(Chunk.document)).order_by(Chunk.id.desc())
        )
    )
    scored: list[tuple[float, Chunk]] = []
    for chunk in chunks:
        score = lexical_overlap_score(question, chunk.text)
        if score > 0:
            scored.append((score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    best = scored[:top_k]

    citations = [
        {
            "chunk_id": chunk.id,
            "document_title": chunk.document.title,
            "source_path": chunk.document.source_path,
            "snippet": chunk.text[:220].replace("\n", " "),
            "score": round(score, 4),
        }
        for score, chunk in best
    ]
    answer = _make_answer(question, [c["snippet"] for c in citations[:3]])
    latency_ms = int((time.perf_counter() - started) * 1000)

    return {"answer": answer, "citations": citations, "latency_ms": latency_ms}

