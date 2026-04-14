from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.schemas import WikiBuildResponse, WikiPageDetail, WikiPageSummary
from app.services.wiki_service import build_wiki, get_page_summaries, read_wiki_page_from_disk
from app.store.db import get_db_session
from app.store.repositories import get_wiki_page_by_slug


router = APIRouter(prefix="/api/wiki", tags=["wiki"])


@router.post("/build", response_model=WikiBuildResponse)
def build(db: Session = Depends(get_db_session)) -> WikiBuildResponse:
    pages_generated, index_path = build_wiki(db)
    db.commit()
    return WikiBuildResponse(
        pages_generated=pages_generated,
        index_path=str(index_path),
        generated_at=datetime.utcnow(),
    )


@router.get("/pages", response_model=list[WikiPageSummary])
def pages(db: Session = Depends(get_db_session)) -> list[WikiPageSummary]:
    return [WikiPageSummary(**item) for item in get_page_summaries(db)]


@router.get("/pages/{slug}", response_model=WikiPageDetail)
def page_detail(slug: str, db: Session = Depends(get_db_session)) -> WikiPageDetail:
    page = get_wiki_page_by_slug(db, slug)
    if page is None:
        raise HTTPException(status_code=404, detail=f"Page not found: {slug}")

    content_md = read_wiki_page_from_disk(slug) or page.content_md
    return WikiPageDetail(
        slug=page.slug,
        title=page.title,
        content_md=content_md,
        source_path=page.document.source_path,
        updated_at=page.updated_at,
    )

