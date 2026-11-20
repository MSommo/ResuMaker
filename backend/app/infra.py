"""Shared infrastructure (DB, Redis, Gemini, agent, PDF renderer). One instance per process: FastAPI and the MCP server each create their own."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
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
        self.llm: LLM | None = self._llm_override or (GeminiLLM(s.gemini_api_key, s.gemini_model, s.gemini_fast_model or None, s.gemini_embedding_model, s.embedding_dims) if s.gemini_api_key else None)

        # LangGraph's own tables (checkpoints) live in the same database but are created and versioned by the library,
        # not by Alembic (migrations/env.py ignores them). Runs that pause for review are stored here.
        self._pool = AsyncConnectionPool(
            s.database_url.replace("postgresql+asyncpg://", "postgresql://"),
            kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
            min_size=1, max_size=4, open=False,
        )
        await self._pool.open()
        self.checkpointer = AsyncPostgresSaver(self._pool)  # type: ignore[arg-type]
        # Replicas (or the API and the MCP server) may start together: one sets up LangGraph's tables at a time, like Alembic.
        async with self._pool.connection() as conn:
            await conn.execute("select pg_advisory_lock(727275)")
            try:
                await AsyncPostgresSaver(conn).setup()  # type: ignore[arg-type]
            finally:
                await conn.execute("select pg_advisory_unlock(727275)")
        await self._prune_stale_proposals()

        # Two compiled copies of the same graph: plain runs are not persisted (no point storing a CV snapshot per message);
        # runs in "propose" mode use the checkpointer so a pending review survives restarts.
        self.graph = build_graph(self.llm) if self.llm else None
        self.graph_hitl = build_graph(self.llm, checkpointer=self.checkpointer) if self.llm else None
        self.pdf = PdfRenderer(s.chrome_path, s.chrome_no_sandbox)
        return self

    async def _prune_stale_proposals(self, days: int = 7) -> None:
        """Proposals nobody accepted or rejected would otherwise stay in Postgres forever. Best effort."""
        try:
            async with self._pool.connection() as conn:
                cur = await conn.execute(
                    "select distinct thread_id from checkpoints where (checkpoint->>'ts')::timestamptz < now() - make_interval(days => %s)", (days,)
                )
                stale = [r["thread_id"] for r in await cur.fetchall()]
            for thread_id in stale:
                await self.checkpointer.adelete_thread(thread_id)
        except Exception as e:  # noqa: BLE001
            logging.getLogger("resumaker.infra").warning("could not prune old proposals: %s", e)

    async def stop(self) -> None:
        await self.pdf.close()
        await self._pool.close()
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
