from pathlib import Path

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.eval import router as eval_router
from app.api.health import router as health_router
from app.api.ingest import router as ingest_router
from app.api.qa import router as qa_router
from app.api.wiki import router as wiki_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.store.db import engine
from app.store.models import Base

WEB_DIR = Path(__file__).resolve().parent / "web"


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.wiki_dir.mkdir(parents=True, exist_ok=True)
    settings.index_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    yield


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(title="LLM Wiki Backend", version="0.1.0", lifespan=lifespan)
    app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")

    @app.get("/", include_in_schema=False)
    def root() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    app.include_router(health_router)
    app.include_router(ingest_router)
    app.include_router(wiki_router)
    app.include_router(qa_router)
    app.include_router(eval_router)
    return app


app = create_app()
