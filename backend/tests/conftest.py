import json
import os
import re
import uuid
import zlib

# Tests use their own database and Redis db, never the dev data. Hosts/ports come from the environment so the same
# tests run on the host (the scratch stack on localhost:5434) and inside the docker network (db:5432). The default
# deliberately is NOT the stable stack (5433), so a bare `pytest` can never touch its server.
_HOST = os.environ.get("APP_HOST", "localhost")
_DEV_DB = os.environ.get("DATABASE_URL", f"postgresql+asyncpg://resumaker:resumaker@{_HOST}:{os.environ.get('SCRATCH_PG_PORT', '5434')}/resumaker")
_DEV_REDIS = os.environ.get("REDIS_URL", f"redis://{_HOST}:{os.environ.get('SCRATCH_REDIS_PORT', '6381')}/0")
TEST_DB_URL = re.sub(r"/[^/]+$", "/resumaker_test", _DEV_DB)
PLAIN_TEST_DB_URL = TEST_DB_URL.replace("+asyncpg", "")
ADMIN_DB_URL = re.sub(r"/[^/]+$", "/postgres", _DEV_DB).replace("+asyncpg", "")
os.environ["DATABASE_URL"] = TEST_DB_URL
os.environ["REDIS_URL"] = re.sub(r"/\d+$", "", _DEV_REDIS) + "/15"
os.environ.setdefault("REAL_GEMINI_API_KEY", os.environ.get("GEMINI_API_KEY", ""))  # only for the marker-gated live eval
os.environ["GEMINI_API_KEY"] = "test-key-not-used"

import asyncpg
import httpx
import pytest
import pytest_asyncio

from app.services.cv_import import ImportedCV
from app.agent.graph import AgentPlan, Critique, Decomposition, Memo, Route
from app.agent.llm import LLMError
from app.agent.prompts import ANSWER_SYSTEM
from app.agent.tailor import JobSpec
from app.config import get_settings
from app.infra import Infra
from app.main import create_app

# One test run at a time per Postgres server. Every run wipes resumaker_test (and the fixed migration-test database) and
# flushes Redis db 15, so two runs at once (two worktrees, a pre-push hook next to `make test-local`) would destroy each
# other's data mid-test. A session-level advisory lock, held on its own connection until the run ends, makes the second
# run wait; Postgres releases it by itself if a run crashes.
_RUN_LOCK = 727299
_run_lock_conn = None


def pytest_sessionstart(session):
    global _run_lock_conn
    import psycopg

    _run_lock_conn = psycopg.connect(ADMIN_DB_URL, autocommit=True)
    if not _run_lock_conn.execute("select pg_try_advisory_lock(%s)", (_RUN_LOCK,)).fetchone()[0]:
        print("\nAnother test run is using the test database; waiting for it to finish...", flush=True)
        _run_lock_conn.execute("select pg_advisory_lock(%s)", (_RUN_LOCK,))


def pytest_sessionfinish(session, exitstatus):
    if _run_lock_conn is not None:
        _run_lock_conn.close()  # releases the lock


HEADERS = {"x-resumaker": "1"}
PASSWORD = "correct horse battery staple"


class FakeLLM:
    """Scripted stand-in for Gemini: records calls and replays queued plans, routes and answers.

    Unscripted, the router says "edit" and answers are a fixed sentence, so tests only script what they care about.
    `json_calls` counts planning calls (plan + repair) only; routing is counted separately in `route_calls`.
    """

    def __init__(self):
        self.text_calls: list[str] = []  # Improve prompts
        self.plans: list[AgentPlan] = []
        self.routes: list[Route | Exception] = []
        self.decompositions: list[Decomposition | Exception] = []  # unscripted: one task, i.e. the old behaviour
        self.critiques: list[Critique | Exception] = []  # unscripted: the critic approves
        self.decompose_calls = 0
        self.embed_calls = 0
        self.imports: list = []  # scripted ImportedCV results; unscripted: an empty CV
        self.import_inputs: list = []  # what the import call was shown
        self.memos: list = []  # scripted Memo results for the `remember` node; unscripted: a preference echoing the message
        self.critic_calls = 0
        self.specs: list[JobSpec | Exception] = []  # unscripted: a plain spec
        self.seen: list[str] = []  # everything the planning/writing calls were shown
        self.answers: list[str] = []
        self.json_calls = 0
        self.route_calls = 0
        self.answer_calls = 0
        self.fast_flags: list[bool] = []

    async def text(self, *, system: str, prompt: str, temperature: float = 0.5, fast: bool = False) -> str:
        if system == ANSWER_SYSTEM:
            self.answer_calls += 1
            return self.answers.pop(0) if self.answers else "Here is some advice."
        self.text_calls.append(prompt)
        return "Improved text."

    async def embed(self, texts, *, query=False):
        """Deterministic stand-in: hashed bag of words, normalised. Texts sharing words are close, unrelated texts are far."""
        self.embed_calls += 1
        out = []
        for t in texts:
            v = [0.0] * 768
            for w in re.findall(r"[a-z0-9]+", t.lower()):
                v[zlib.crc32(w.encode()) % 768] += 1.0
            n = sum(x * x for x in v) ** 0.5 or 1.0
            out.append([x / n for x in v])
        return out

    async def json(self, *, system, contents, schema, temperature=0.3, fast=False):
        if schema is Route:
            self.route_calls += 1
            self.fast_flags.append(fast)
            nxt = self.routes.pop(0) if self.routes else Route(intent="edit", reason="test default")
            if isinstance(nxt, Exception):
                raise nxt
            return nxt
        if schema is ImportedCV:
            self.import_inputs.append(contents)
            nxt = self.imports.pop(0) if self.imports else ImportedCV()
            if isinstance(nxt, Exception):
                raise nxt
            return nxt
        if schema is Memo:
            nxt = self.memos.pop(0) if self.memos else Memo(ok=True, kind="preference", text=contents[0]["parts"][0])
            if isinstance(nxt, Exception):
                raise nxt
            return nxt
        if schema is JobSpec:
            nxt = self.specs.pop(0) if self.specs else JobSpec(title="Backend Engineer", company="Acme", summary="Builds services.", keywords=["Go"], gaps=["Kubernetes"])
            if isinstance(nxt, Exception):
                raise nxt
            return nxt
        if schema is Critique:
            self.critic_calls += 1
            nxt = self.critiques.pop(0) if self.critiques else Critique(ok=True)
            if isinstance(nxt, Exception):
                raise nxt
            return nxt
        if schema is Decomposition:
            self.decompose_calls += 1
            nxt = self.decompositions.pop(0) if self.decompositions else Decomposition()
            if isinstance(nxt, Exception):
                raise nxt
            return nxt
        self.json_calls += 1
        self.seen.append(json.dumps(contents, default=str))
        nxt = self.plans.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


class FakePdf:
    available = True

    def __init__(self):
        self.renders = 0

    async def render(self, url: str, cookie: dict | None = None) -> bytes:
        self.renders += 1
        self.cookie = cookie
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


async def make_user(infra, *, role="user", first="Jane", last="Doe", login=None, password=PASSWORD):
    """A claimed account, created straight in the database."""
    from app.security import hash_password
    from app.services import auth

    async with infra.session() as s:
        user = await auth.create_user(s, login=login or f"u{uuid.uuid4().hex[:10]}@example.com", first_name=first, last_name=last, role=role)
        if password:
            user.password_hash = hash_password(password)
            await s.commit()
        return user


@pytest_asyncio.fixture
async def app(infra):
    app = create_app(infra)
    app.state.infra = infra  # ASGITransport doesn't run lifespan; infra is already started
    llm = infra.llm
    llm.plans.clear(), llm.routes.clear(), llm.decompositions.clear(), llm.specs.clear(), llm.seen.clear(), llm.critiques.clear(), llm.answers.clear(), llm.text_calls.clear(), llm.fast_flags.clear()
    llm.json_calls = llm.route_calls = llm.answer_calls = llm.decompose_calls = llm.critic_calls = llm.embed_calls = 0
    llm.memos.clear(), llm.imports.clear(), llm.import_inputs.clear()
    infra.pdf.renders = 0
    infra.settings.ai_rate_limit_per_min = 1000
    infra.settings.ai_daily_limit = 300
    infra.settings.login_rate_limit_per_ip = 1000
    await infra.redis.flushdb()
    return app


@pytest_asyncio.fixture
async def anon(app):
    """Not signed in."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS) as c:
        yield c


@pytest_asyncio.fixture
async def make_client(app, infra):
    """Factory: `await make_client()` is a client signed in as a brand-new user (`role="admin"` for an administrator)."""
    made: list[httpx.AsyncClient] = []

    async def factory(*, role="user", first="Jane", last="Doe", login=None):
        user = await make_user(infra, role=role, first=first, last=last, login=login)
        c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=HEADERS)
        made.append(c)
        r = await c.post("/api/auth/login", json={"login": user.login, "password": PASSWORD})
        assert r.status_code == 200, r.text
        c.user = user
        return c

    yield factory
    for c in made:
        await c.aclose()


@pytest_asyncio.fixture
async def client(make_client):
    """Signed in as a fresh, ordinary user."""
    return await make_client()
