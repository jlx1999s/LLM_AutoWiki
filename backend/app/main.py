from pathlib import Path

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.bridge import router as bridge_router
from app.api.eval import router as eval_router
from app.api.health import router as health_router
from app.api.ingest import router as ingest_router
from app.api.llm import router as llm_router
from app.api.qa import router as qa_router
from app.api.search import router as search_router
from app.api.wiki import router as wiki_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.store.migrations import run_migrations

WEB_DIR = Path(__file__).resolve().parent / "web"


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.wiki_dir.mkdir(parents=True, exist_ok=True)
    settings.index_dir.mkdir(parents=True, exist_ok=True)
    run_migrations()
    yield


def create_app() -> FastAPI:
    configure_logging()
    settings = get_settings()
    app = FastAPI(title="Binary Thinking Wiki Backend", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")

    @app.get("/", include_in_schema=False)
    def root() -> FileResponse:
        return FileResponse(WEB_DIR / "index.html")

    app.include_router(health_router)
    app.include_router(ingest_router)
    app.include_router(wiki_router)
    app.include_router(qa_router)
    app.include_router(eval_router)
    app.include_router(bridge_router)
    app.include_router(llm_router)
    app.include_router(search_router)
    return app


app = create_app()
