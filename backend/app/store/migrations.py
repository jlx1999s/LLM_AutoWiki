from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.core.config import get_settings


def run_migrations() -> None:
    settings = get_settings()
    backend_dir = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    engine = create_engine(settings.database_url)
    inspector = inspect(engine)
    has_documents = inspector.has_table("documents")
    with engine.connect() as connection:
        current_revision = MigrationContext.configure(connection).get_current_revision()

    if has_documents and current_revision is None:
        command.stamp(cfg, "head")
        return
    command.upgrade(cfg, "head")
