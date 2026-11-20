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
    gemini_embedding_model: str = "gemini-embedding-001"
    embedding_dims: int = 768  # must match the memories.embedding column

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
    ai_daily_limit: int = 300  # AI requests per user per day (0 = unlimited): a backstop against runaway cost

    # ---- authentication
    # Sent only over HTTPS when true. None = decide from FRONTEND_URL / PUBLIC_URL (https => secure). Plain http is for localhost only.
    cookie_secure: bool | None = None
    public_url: str = ""  # the address people open in a browser (invite links); defaults to FRONTEND_URL
    session_idle_hours: int = 24 * 7  # signed out after this long without activity
    session_max_days: int = 30  # ...and at the latest after this, however active
    render_session_seconds: int = 120  # the throw-away session used by the PDF renderer
    login_max_failures: int = 5  # consecutive wrong passwords before the account is locked...
    login_lock_minutes: int = 15  # ...for this long
    login_rate_limit_per_ip: int = 20  # sign-in attempts per IP per 10 minutes
    invite_ttl_hours: int = 72
    min_password_length: int = 12

    improve_cache_ttl: int = 60 * 60 * 24
    pdf_cache_ttl: int = 60 * 60


    @property
    def secure_cookies(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return (self.public_url or self.frontend_url).startswith("https://")

    @property
    def base_url(self) -> str:
        return (self.public_url or self.frontend_url).rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
