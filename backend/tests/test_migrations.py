"""Run the real Alembic migrations over a database that looks like the pre-persona one (created by the old `create_all`)."""

import asyncio
import json
import re
import uuid

import asyncpg
import pytest

from app.config import get_settings
from tests.conftest import ADMIN_DB_URL

LEGACY_DB = "resumaker_migr_test"


def legacy_basics(first, last, email, headline):
    return {
        "firstName": first, "lastName": last, "headline": headline, "email": email, "phone": "1",
        "address": {"street": "1 Road", "city": "Belfast", "postcode": "BT1", "country": "GB"},
        "birthDate": "1990-01-01", "birthPlace": "Naples", "nationality": "Italian",
    }


async def test_legacy_database_is_migrated_and_backfilled(monkeypatch):
    admin = await asyncpg.connect(ADMIN_DB_URL)
    await admin.execute(f"drop database if exists {LEGACY_DB} with (force)")
    await admin.execute(f"create database {LEGACY_DB}")
    await admin.close()
    plain = re.sub(r"/[^/]+$", f"/{LEGACY_DB}", ADMIN_DB_URL)

    conn = await asyncpg.connect(plain)
    await conn.execute(
        """
        create table resumes (id uuid primary key, name varchar(200) not null default 'Untitled CV', layout_id varchar(50) not null default 'sidebar',
          data jsonb not null, version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
        create table chat_messages (id uuid primary key, resume_id uuid not null references resumes(id) on delete cascade, role varchar(20) not null,
          text text not null, applied jsonb not null default '[]', skipped jsonb not null default '[]', created_at timestamptz not null default now());
        """
    )
    ids = [uuid.uuid4() for _ in range(3)]
    rows = [
        (ids[0], "Mario M", legacy_basics("Mario", "M", "m@x.org", "AI Strategy Lead")),
        (ids[1], "Mario M", legacy_basics("mario", "m", "M@X.ORG", "Senior Engineer")),  # same person (case-insensitive)
        (ids[2], "Zoe Z", legacy_basics("Zoe", "Z", "z@x.org", "")),
    ]
    for rid, name, basics in rows:
        await conn.execute("insert into resumes (id, name, data) values ($1, $2, $3::jsonb)", rid, name, json.dumps({"layoutId": "sidebar", "basics": basics, "sections": []}))
    await conn.execute("insert into chat_messages (id, resume_id, role, text) values ($1, $2, 'user', 'hi')", uuid.uuid4(), ids[0])
    await conn.close()

    from app import infra

    monkeypatch.setenv("DATABASE_URL", re.sub(r"/[^/]+$", f"/{LEGACY_DB}", get_settings().database_url))
    get_settings.cache_clear()
    try:
        await asyncio.to_thread(infra.run_migrations)  # same as the app: alembic runs its own event loop
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()

    conn = await asyncpg.connect(plain)
    try:
        people = await conn.fetch("select * from users order by first_name")
        assert [p["first_name"].lower() for p in people] == ["mario", "zoe"]  # two CVs of one person → one persona
        mario = next(p for p in people if p["first_name"].lower() == "mario")
        assert (mario["email"], mario["city"], mario["country"], mario["nationality"], mario["birth_date"]) == ("m@x.org", "Belfast", "GB", "Italian", "1990-01-01")
        cvs = {r["id"]: r for r in await conn.fetch("select * from resumes")}
        assert cvs[ids[0]]["persona_id"] == cvs[ids[1]]["persona_id"] == mario["id"] and cvs[ids[2]]["persona_id"] != mario["id"]
        assert cvs[ids[0]]["title"] == "AI Strategy Lead" and cvs[ids[2]]["title"] == "Untitled CV"
        assert json.loads(cvs[ids[0]]["data"])["basics"] == {"headline": "AI Strategy Lead"}  # identity moved out of the CV
        assert "name" not in cvs[ids[0]]
        assert await conn.fetchval("select count(*) from chat_messages") == 1  # chat history survived
        # ...and old messages got the new columns' defaults: nothing to undo, not undone.
        assert await conn.fetchval("select count(*) from chat_messages where undone is false and undo_version_id is null") == 1
        # Persona deletion cascades at the database level.
        await conn.execute("delete from users where id = $1", mario["id"])
        assert await conn.fetchval("select count(*) from resumes") == 1
        assert await conn.fetchval("select version_num from alembic_version") == "0005"  # head: personas (0002), versions (0003), memories (0004), users + auth (0005)
        assert await conn.fetchval("select count(*) from resume_versions") == 0  # 0003 added the (empty) history table
        assert await conn.fetchval("select count(*) from memories") == 0  # 0004 added the (empty) memory table
        # 0005: personas became users, unclaimed (nobody can sign in), with the login pre-filled from the email.
        assert mario["password_hash"] is None and mario["role"] == "user" and mario["is_active"] is True and mario["login"] == "m@x.org"
        assert await conn.fetchval("select count(*) from users where password_hash is not null") == 0
        assert await conn.fetchval("select to_regclass('personas')") is None
        assert await conn.fetchval("select count(*) from sessions") == 0 and await conn.fetchval("select count(*) from user_tokens") == 0
        assert await conn.fetchval("select extname from pg_extension where extname = 'vector'") == "vector"
    finally:
        await conn.close()
        admin = await asyncpg.connect(ADMIN_DB_URL)
        await admin.execute(f"drop database if exists {LEGACY_DB} with (force)")
        await admin.close()
