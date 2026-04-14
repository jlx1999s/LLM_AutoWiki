from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.schemas import QAQueryRequest, QAQueryResponse
from app.services.qa_service import answer_question
from app.store.db import get_db_session


router = APIRouter(prefix="/api/qa", tags=["qa"])


@router.post("/query", response_model=QAQueryResponse)
def query(payload: QAQueryRequest, db: Session = Depends(get_db_session)) -> QAQueryResponse:
    result = answer_question(
        db=db,
        question=payload.question,
        top_k=payload.top_k,
        strategy=payload.strategy,
    )
    return QAQueryResponse(**result)
