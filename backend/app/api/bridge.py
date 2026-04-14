from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.schemas import BridgeInvokeRequest, BridgeInvokeResponse
from app.services.bridge_service import invoke_command


router = APIRouter(prefix="/api/bridge", tags=["bridge"])


@router.post("/invoke", response_model=BridgeInvokeResponse)
def invoke(payload: BridgeInvokeRequest) -> BridgeInvokeResponse:
    try:
        result = invoke_command(payload.command, payload.args)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive branch
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return BridgeInvokeResponse(result=result)


@router.get("/file")
def file(path: str = Query(..., description="Absolute local file path.")) -> FileResponse:
    p = Path(path).expanduser().resolve()
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {p}")
    return FileResponse(p)

