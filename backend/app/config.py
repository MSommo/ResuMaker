from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]  # repo root: shares the .env with the frontend tooling


class UnsafeSettings(RuntimeError):
    """Production was asked to start with a configuration that would be insecure. The message lists every problem."""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    # production: refuses to start with unsafe settings (see `problems`), and serves no API docs (/docs, /openapi.json).
    app_env: Literal["development", "production"] = "development"

    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    # Cheaper model for small decisions such as routing a chat message. Empty = use the main model for everything.
    gemini_fast_model: str = "gemini-flash-lite-latest"
    gemini_embedding_model: str = "gemini-embedding-001"
    embedding_dims: int = 768  # must match the memories.embedding column

    # No defaults: where the data lives always comes from the environment (docker compose, the Makefile, CI, Railway, or
    # .env; see .env.example). A forgotten variable fails loudly instead of quietly connecting somewhere unexpected.
    database_url: str
    redis_url: str

    # Where the React app is served; headless Chrome loads it to render PDFs.
    frontend_url: str = ""
    chrome_path: str = ""
    # Chrome cannot use its sandbox inside a default Docker container; only render our own pages when this is on.
    chrome_no_sandbox: bool = False
    cors_origins: list[str] = []

    # Per user, per minute, for the endpoints that call Gemini.
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

    @field_validator("database_url")
    @classmethod
    def _asyncpg(cls, v: str) -> str:
        """Hosting platforms (Railway, Heroku, ...) hand out `postgres://` or `postgresql://`; SQLAlchemy needs the driver named."""
        for prefix in ("postgres://", "postgresql://", "postgresql+psycopg://", "postgresql+psycopg2://"):
            if v.startswith(prefix):
                return "postgresql+asyncpg://" + v[len(prefix):]
        return v

    @field_validator("redis_url")
    @classmethod
    def _redis(cls, v: str) -> str:
        return v if "://" in v else f"redis://{v}"  # a bare host:port

    @property
    def production(self) -> bool:
        return self.app_env == "production"

    @property
    def secure_cookies(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return (self.public_url or self.frontend_url).startswith("https://")

    @property
    def base_url(self) -> str:
        return (self.public_url or self.frontend_url).rstrip("/")

    def problems(self) -> list[str]:
        """What makes this configuration unfit for the public internet. Empty = fine. Checked at start in production."""
        out: list[str] = []
        if not self.public_url:
            out.append("PUBLIC_URL is not set (the https:// address people open; used in invite links and for cookies).")
        elif not self.public_url.startswith("https://"):
            out.append(f"PUBLIC_URL must be https:// in production (got {self.public_url!r}): over http, sign-in cookies are not marked Secure.")
        if self.cookie_secure is False:
            out.append("COOKIE_SECURE=false: session cookies would also be sent over plain http.")
        if not self.frontend_url:
            out.append("FRONTEND_URL is not set (the address the API reaches the web app at, to render PDFs).")
        db = urlsplit(self.database_url)
        if not db.password or db.password == "resumaker":
            out.append("DATABASE_URL has no password, or the local development one.")
        if not urlsplit(self.redis_url).password:
            out.append("REDIS_URL has no password: anyone who can reach Redis can read cached CVs and reset rate limits.")
        if insecure := [o for o in self.cors_origins if not o.startswith("https://")]:
            out.append(f"CORS_ORIGINS must all be https:// in production (got {insecure}).")
        return out

    def check(self) -> None:
        """Refuse to run production with unsafe settings. Development is never blocked."""
        if self.production and (found := self.problems()):
            raise UnsafeSettings("Refusing to start in production:\n  - " + "\n  - ".join(found))


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # database_url / redis_url come from the environment
