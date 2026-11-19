from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]  # repo root: shares the .env with the frontend tooling


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    # Cheaper model for small decisions such as routing a chat message. Empty = use the main model for everything.
    gemini_fast_model: str = "gemini-flash-lite-latest"

    # Defaults point at the SCRATCH stack's host ports (docker-compose.yml: 5434/6381), on purpose: running the API or tests
    # on the host without configuration must never touch the frozen stack, which holds the real data (5433/6380).
    database_url: str = "postgresql+asyncpg://resumaker:resumaker@localhost:5434/resumaker"
    redis_url: str = "redis://localhost:6381/0"

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
