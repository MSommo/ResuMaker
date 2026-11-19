from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]  # repo root: shares the .env with the frontend tooling


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"

    # Host ports match docker-compose.yml (5433/6380 avoid clashing with other local projects).
    database_url: str = "postgresql+asyncpg://resumaker:resumaker@localhost:5433/resumaker"
    redis_url: str = "redis://localhost:6380/0"

    # Where the React app is served; headless Chrome loads it to render PDFs.
    frontend_url: str = "http://localhost:5173"
    chrome_path: str = ""
    # Chrome cannot use its sandbox inside a default Docker container; only render our own pages when this is on.
    chrome_no_sandbox: bool = False
    cors_origins: list[str] = []

    # Per client IP, per minute, for the endpoints that call Gemini.
    ai_rate_limit_per_min: int = 30

    improve_cache_ttl: int = 60 * 60 * 24
    pdf_cache_ttl: int = 60 * 60


@lru_cache
def get_settings() -> Settings:
    return Settings()
