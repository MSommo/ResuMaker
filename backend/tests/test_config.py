"""Deployment settings: platform URLs are normalised, and production refuses to start with unsafe settings."""

import httpx
import pytest

from app.config import Settings, UnsafeSettings

SAFE = dict(
    app_env="production", database_url="postgres://app:s3cret@db.internal:5432/railway", redis_url="redis://default:pw@redis.internal:6379",
    public_url="https://cv.example.org", frontend_url="http://web.railway.internal:8080",
)


def make(**kw) -> Settings:
    return Settings(_env_file=None, **{**SAFE, **kw})  # type: ignore[call-arg]


@pytest.mark.parametrize("given", ["postgres://u:p@h:5432/d", "postgresql://u:p@h:5432/d", "postgresql+asyncpg://u:p@h:5432/d"])
def test_platform_database_urls_get_the_async_driver(given):
    assert make(database_url=given).database_url == "postgresql+asyncpg://u:p@h:5432/d"


def test_a_bare_redis_address_becomes_a_url():
    assert make(redis_url="redis.internal:6379").redis_url == "redis://redis.internal:6379"


def test_addresses_have_no_built_in_default(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(Exception, match="database_url"):
        Settings(_env_file=None, redis_url="redis://x")  # type: ignore[call-arg]


def test_a_safe_production_configuration_starts():
    s = make()
    assert s.problems() == [] and s.secure_cookies
    s.check()


@pytest.mark.parametrize("bad, words", [
    (dict(public_url=""), "PUBLIC_URL is not set"),
    (dict(public_url="http://cv.example.org"), "must be https"),
    (dict(cookie_secure=False), "COOKIE_SECURE"),
    (dict(frontend_url=""), "FRONTEND_URL"),
    (dict(database_url="postgresql://resumaker:resumaker@db/resumaker"), "DATABASE_URL"),
    (dict(database_url="postgresql://app@db/resumaker"), "DATABASE_URL"),
    (dict(redis_url="redis://redis:6379/0"), "REDIS_URL"),
    (dict(cors_origins=["http://other.example.org"]), "CORS_ORIGINS"),
])
def test_production_refuses_unsafe_settings(bad, words):
    s = make(**bad)
    with pytest.raises(UnsafeSettings, match=words):
        s.check()


def test_development_is_never_blocked():
    make(app_env="development", public_url="", redis_url="redis://localhost:6381/0").check()


async def test_production_serves_no_api_docs(infra, monkeypatch):
    from app import main

    for env in ("development", "production"):
        monkeypatch.setattr(main, "get_settings", lambda env=env: make(app_env=env))
        app = main.create_app(infra)
        app.state.infra = infra
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            codes = [(await c.get(p)).status_code for p in ("/docs", "/openapi.json")]
        assert codes == ([200, 200] if env == "development" else [404, 404])
