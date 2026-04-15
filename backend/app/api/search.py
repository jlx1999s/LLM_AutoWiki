from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import TavilySearchRequest, TavilySearchResponse, WebSearchResult
from app.services.search_proxy import tavily_search

router = APIRouter(prefix="/api/search", tags=["search"])


@router.post("/tavily", response_model=TavilySearchResponse)
def proxy_tavily(payload: TavilySearchRequest) -> TavilySearchResponse:
    try:
        results = tavily_search(
            api_key=payload.api_key,
            query=payload.query,
            max_results=payload.max_results,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return TavilySearchResponse(results=[WebSearchResult(**row) for row in results])
