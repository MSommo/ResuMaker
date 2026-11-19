import asyncio

from alembic import context
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import get_settings
from app.db import Base

target_metadata = Base.metadata


def _run(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        # Two processes (API + MCP) may start together: only one migrates at a time. Released when the transaction ends.
        connection.execute(text("select pg_advisory_xact_lock(727274)"))
        context.run_migrations()


async def _run_async() -> None:
    engine = create_async_engine(get_settings().database_url)
    async with engine.connect() as conn:
        await conn.run_sync(_run)
    await engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline migrations are not supported.")
asyncio.run(_run_async())
