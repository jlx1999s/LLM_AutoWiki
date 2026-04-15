from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.core.config import get_settings
from app.schemas import LlmChatRequest, LlmChatResponse, MiniMaxProxyRequest, MiniMaxProxyResponse
from app.services.llm_proxy import run_chat_completion
from app.services.minimax_proxy import run_minimax_completion


router = APIRouter(prefix="/api/llm", tags=["llm"])


@router.post("/chat", response_model=LlmChatResponse)
def chat_proxy(payload: LlmChatRequest) -> LlmChatResponse:
    settings = get_settings()
    timeout_sec = payload.timeout_sec or settings.llm_proxy_timeout_sec
    try:
        text = run_chat_completion(
            provider=payload.provider,
            api_key=payload.api_key,
            model=payload.model,
            messages=[m.model_dump() for m in payload.messages],
            endpoint=payload.endpoint,
            max_tokens=payload.max_tokens,
            timeout_sec=timeout_sec,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return LlmChatResponse(text=text)


@router.post("/minimax", response_model=MiniMaxProxyResponse)
def minimax_proxy(payload: MiniMaxProxyRequest) -> MiniMaxProxyResponse:
    try:
        text = run_minimax_completion(
            api_key=payload.api_key,
            model=payload.model,
            messages=[m.model_dump() for m in payload.messages],
            endpoint=payload.endpoint,
            max_tokens=payload.max_tokens,
            timeout_sec=payload.timeout_sec,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return MiniMaxProxyResponse(text=text)
