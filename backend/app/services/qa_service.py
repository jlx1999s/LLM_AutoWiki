import time
from typing import Literal

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.retrieval.lexical import lexical_overlap_score
from app.retrieval.lexical import tokenize as lexical_tokenize
from app.retrieval.vector import vector_similarity
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


def answer_question(
    db: Session,
    question: str,
    top_k: int = 5,
    strategy: Literal["lexical", "vector", "hybrid"] = "hybrid",
) -> dict:
    started = time.perf_counter()
    settings = get_settings()
    candidate_limit = settings.qa_candidate_limit
    tokens = [t for t in lexical_tokenize(question) if len(t) >= 2][:8]

    base_stmt = (
        select(Chunk)
        .options(joinedload(Chunk.document))
        .order_by(Chunk.id.desc())
        .limit(candidate_limit)
    )
    if strategy in {"lexical", "hybrid"} and tokens:
        predicates = [Chunk.text.ilike(f"%{t}%") for t in tokens]
        stmt = (
            select(Chunk)
            .options(joinedload(Chunk.document))
            .where(or_(*predicates))
            .order_by(Chunk.id.desc())
            .limit(candidate_limit)
        )
    else:
        stmt = base_stmt

    chunks = list(db.scalars(stmt))
    if not chunks and tokens:
        chunks = list(db.scalars(base_stmt))
    scored: list[tuple[float, float, float, Chunk]] = []
    for chunk in chunks:
        lexical_score = lexical_overlap_score(question, chunk.text)
        vector_score = vector_similarity(question, chunk.text)
        if strategy == "lexical":
            final_score = lexical_score
        elif strategy == "vector":
            final_score = vector_score
        else:
            final_score = 0.6 * lexical_score + 0.4 * vector_score

        if final_score > 0:
            scored.append((final_score, lexical_score, vector_score, chunk))

    scored.sort(key=lambda x: x[0], reverse=True)
    best = scored[:top_k]

    citations = [
        {
            "chunk_id": chunk.id,
            "document_title": chunk.document.title,
            "source_path": chunk.document.source_path,
            "snippet": chunk.text[:220].replace("\n", " "),
            "score": round(final_score, 4),
        }
        for final_score, _, _, chunk in best
    ]
    answer = _make_answer(question, [c["snippet"] for c in citations[:3]])
    latency_ms = int((time.perf_counter() - started) * 1000)

    return {
        "answer": answer,
        "citations": citations,
        "latency_ms": latency_ms,
        "strategy": strategy,
    }
