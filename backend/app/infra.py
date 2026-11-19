"""Shared infrastructure (DB, Redis, Gemini, agent, PDF renderer). One instance per process: FastAPI and the MCP server each create their own."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from .agent.graph import build_graph
from .agent.llm import LLM, GeminiLLM
from .cache import Cache
from .config import Settings, get_settings
from .db import make_engine, make_sessionmaker
from .services.pdf import PdfRenderer


BACKEND = Path(__file__).resolve().parents[1]


def run_migrations() -> None:
    """Bring the database schema to the latest Alembic revision (a no-op when it already is)."""
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    command.upgrade(cfg, "head")


class Infra:
    def __init__(self, settings: Settings | None = None, llm: LLM | None = None):
        self.settings = settings or get_settings()
        self._llm_override = llm

    async def start(self) -> "Infra":
        s = self.settings
        self.engine = make_engine(s.database_url)
        self.sessionmaker = make_sessionmaker(self.engine)
        await asyncio.to_thread(run_migrations)  # alembic drives its own event loop, so it gets its own thread
        self.redis = Redis.from_url(s.redis_url)
        self.cache = Cache(self.redis)
        self.llm: LLM | None = self._llm_override or (GeminiLLM(s.gemini_api_key, s.gemini_model) if s.gemini_api_key else None)
        self.graph = build_graph(self.llm) if self.llm else None
        self.pdf = PdfRenderer(s.chrome_path, s.chrome_no_sandbox)
        return self

    async def stop(self) -> None:
        await self.pdf.close()
        await self.redis.aclose()
        await self.engine.dispose()

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self.sessionmaker() as s:
            yield s

    async def status(self) -> dict[str, bool]:
        db_ok = True
        try:
            async with self.session() as s:
                from sqlalchemy import text

                await s.execute(text("select 1"))
        except Exception:  # noqa: BLE001
            db_ok = False
        return {"ai": self.llm is not None, "pdf": self.pdf.available, "db": db_ok, "cache": await self.cache.ping()}
