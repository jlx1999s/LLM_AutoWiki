from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Binary Thinking Wiki Backend"
    project_root: Path = Path(__file__).resolve().parents[3]
    data_dir: Optional[Path] = None
    wiki_dir: Optional[Path] = None
    index_dir: Optional[Path] = None
    database_url: Optional[str] = None
    cors_allow_origins: str = (
        "http://127.0.0.1:1420,http://localhost:1420,"
        "http://127.0.0.1:5173,http://localhost:5173,"
        "http://127.0.0.1:8000,http://localhost:8000"
    )
    allow_unsafe_bridge_paths: bool = False
    bridge_extra_roots: str = ""
    qa_candidate_limit: int = Field(default=2000, ge=200, le=20000)
    llm_proxy_timeout_sec: int = Field(default=300, ge=10, le=900)

    model_config = SettingsConfigDict(
        env_prefix="LLM_WIKI_",
        env_file=".env",
        extra="ignore",
    )

    @model_validator(mode="after")
    def populate_defaults(self) -> "Settings":
        if self.data_dir is None:
            self.data_dir = self.project_root / "data"
        if self.wiki_dir is None:
            self.wiki_dir = self.data_dir / "wiki"
        if self.index_dir is None:
            self.index_dir = self.data_dir / "index"
        if self.database_url is None:
            db_file = self.index_dir / "wiki.db"
            self.database_url = f"sqlite:///{db_file}"
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [s.strip() for s in self.cors_allow_origins.split(",") if s.strip()]

    @property
    def bridge_extra_root_paths(self) -> list[Path]:
        roots: list[Path] = []
        for item in self.bridge_extra_roots.split(","):
            raw = item.strip()
            if not raw:
                continue
            roots.append(Path(raw).expanduser().resolve())
        return roots


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
