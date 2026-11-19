import os
import re

# Tests use their own database and Redis db, never the dev data. Hosts/ports come from the environment so the same
# tests run on the host (the scratch stack on localhost:5434) and inside the docker network (db:5432). The default
# deliberately is NOT the frozen stack (5433), so a bare `pytest` can never touch its server.
_DEV_DB = os.environ.get("DATABASE_URL", "postgresql+asyncpg://resumaker:resumaker@localhost:5434/resumaker")
_DEV_REDIS = os.environ.get("REDIS_URL", "redis://localhost:6381/0")
TEST_DB_URL = re.sub(r"/[^/]+$", "/resumaker_test", _DEV_DB)
PLAIN_TEST_DB_URL = TEST_DB_URL.replace("+asyncpg", "")
ADMIN_DB_URL = re.sub(r"/[^/]+$", "/postgres", _DEV_DB).replace("+asyncpg", "")
os.environ["DATABASE_URL"] = TEST_DB_URL
os.environ["REDIS_URL"] = re.sub(r"/\d+$", "", _DEV_REDIS) + "/15"
os.environ["GEMINI_API_KEY"] = "test-key-not-used"

import asyncpg
import httpx
import pytest
import pytest_asyncio

from app.agent.graph import AgentPlan
from app.config import get_settings
from app.infra import Infra
from app.main import create_app

HEADERS = {"x-resumaker": "1"}


class FakeLLM:
    """Scripted stand-in for Gemini: records calls and replays queued plans."""

    def __init__(self):
        self.text_calls: list[str] = []
        self.plans: list[AgentPlan] = []
        self.json_calls = 0

    async def text(self, *, system: str, prompt: str, temperature: float = 0.5) -> str:
        self.text_calls.append(prompt)
        return "Improved text."

    async def json(self, *, system, contents, schema, temperature=0.3):
        self.json_calls += 1
        return self.plans.pop(0)


class FakePdf:
    available = True

    def __init__(self):
        self.renders = 0

    async def render(self, url: str) -> bytes:
        self.renders += 1
        return b"%PDF-1.7 fake " + url.encode()

    async def close(self):
        pass


async def _ensure_test_db():
    conn = await asyncpg.connect(ADMIN_DB_URL)
    try:
        if not await conn.fetchval("select 1 from pg_database where datname='resumaker_test'"):
            await conn.execute("create database resumaker_test")
    finally:
        await conn.close()
    # Start every run from an empty schema, so the Alembic migrations are exercised from scratch.
    conn = await asyncpg.connect(PLAIN_TEST_DB_URL)
    try:
        await conn.execute("drop schema public cascade; create schema public")
    finally:
        await conn.close()


@pytest_asyncio.fixture(scope="session")
async def infra():
    await _ensure_test_db()
    llm = FakeLLM()
    i = Infra(get_settings(), llm=llm)
    await i.start()
    i.pdf = FakePdf()
    await i.redis.flushdb()  # redis db 15 is ours alone
    yield i
    await i.stop()


@pytest_asyncio.fixture
async def client(infra):
    app = create_app(infra)
    app.state.infra = infra  # ASGITransport doesn't run lifespan; infra is already started
    infra.llm.plans.clear()
    infra.llm.text_calls.clear()
    infra.llm.json_calls = 0
    infra.pdf.renders = 0
    infra.settings.ai_rate_limit_per_min = 1000
    await infra.redis.flushdb()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as c:
        yield c
