from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.schemas import IngestRequest, IngestResponse
from app.services.ingest_service import ingest_path
from app.store.db import get_db_session


router = APIRouter(prefix="/api", tags=["ingest"])


@router.post("/ingest", response_model=IngestResponse)
def ingest(payload: IngestRequest, db: Session = Depends(get_db_session)) -> IngestResponse:
    stats = ingest_path(db=db, input_path=payload.path, recursive=payload.recursive)
    db.commit()
    return IngestResponse(
        ingested_count=stats.ingested_count,
        skipped_count=stats.skipped_count,
        failed_count=stats.failed_count,
        errors=stats.errors,
    )

