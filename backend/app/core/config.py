from functools import lru_cache
from pathlib import Path
from typing import Optional

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "LLM Wiki Backend"
    project_root: Path = Path(__file__).resolve().parents[3]
    data_dir: Optional[Path] = None
    wiki_dir: Optional[Path] = None
    index_dir: Optional[Path] = None
    database_url: Optional[str] = None

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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
