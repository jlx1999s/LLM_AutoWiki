from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.schemas import EvalLatestResponse, EvalRunRequest, EvalRunResponse
from app.services.eval_service import get_latest_eval, run_eval
from app.store.db import get_db_session


router = APIRouter(prefix="/api/eval", tags=["eval"])


@router.post("/run", response_model=EvalRunResponse)
def eval_run(payload: EvalRunRequest, db: Session = Depends(get_db_session)) -> EvalRunResponse:
    try:
        result = run_eval(
            db=db,
            dataset_path=payload.dataset_path,
            top_k=payload.top_k,
            strategy=payload.strategy,
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return EvalRunResponse(**result)


@router.get("/latest", response_model=EvalLatestResponse)
def eval_latest() -> EvalLatestResponse:
    return EvalLatestResponse(**get_latest_eval())

