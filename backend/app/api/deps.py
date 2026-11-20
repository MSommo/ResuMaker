from __future__ import annotations

import uuid
from typing import AsyncIterator
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent.llm import AI_NOT_INCLUDED
from ..cache import window_key
from ..config import Settings
from ..db import ResumeRow, SessionRow, UserRow
from ..infra import Infra
from ..services import auth

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
SAFE_FOR_RENDER = {"GET", "HEAD", "OPTIONS"}
COOKIE = "rm_session"


def get_infra(request: Request) -> Infra:
    return request.app.state.infra


async def get_session(infra: Infra = Depends(get_infra)) -> AsyncIterator[AsyncSession]:
    async with infra.session() as s:
        yield s


def _allowed_origins(settings: Settings, request: Request) -> set[str]:
    origins = {settings.frontend_url.rstrip("/"), settings.base_url, *(o.rstrip("/") for o in settings.cors_origins)}
    host = request.headers.get("host")
    if host:  # the page was served by the same host that is receiving this request (nginx passes Host through)
        origins |= {f"http://{host}", f"https://{host}"}
    return origins


async def require_app_header(request: Request) -> None:
    """CSRF defence, in layers. Unsafe requests must carry a custom header (cross-site pages can't set one without a CORS
    preflight, which only our own origins pass) and, when the browser says where they come from, that must be us.
    The session cookie is also SameSite=Strict."""
    if request.method in UNSAFE:
        if request.headers.get("x-resumaker") != "1":
            raise HTTPException(403, "Forbidden.")
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in _allowed_origins(request.app.state.infra.settings, request):
            raise HTTPException(403, "Forbidden.")


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        COOKIE, token, max_age=settings.session_max_days * 86400, httponly=True, secure=settings.secure_cookies,
        samesite="strict", path="/api",  # not sent for the page itself, only for API calls
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(COOKIE, path="/api", httponly=True, secure=settings.secure_cookies, samesite="strict")


class Principal:
    """Who is making this request. Built once per request by `current`; routes only ever see a Principal."""

    def __init__(self, user: UserRow, session: SessionRow):
        self.user, self.session = user, session

    @property
    def id(self) -> uuid.UUID:
        return self.user.id

    @property
    def is_admin(self) -> bool:
        return self.user.role == "admin"


async def current(request: Request, infra: Infra = Depends(get_infra)) -> Principal:
    """Authenticate the request from its session cookie. Applied to every router except the few public endpoints."""
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Please sign in.")
    async with infra.session() as s:
        found = await auth.resolve_session(s, infra.settings, token)
    if found is None:
        raise HTTPException(401, "Please sign in.")
    user, sess = found
    if sess.kind == "render" and request.method not in SAFE_FOR_RENDER:
        raise HTTPException(403, "Forbidden.")
    request.state.principal = Principal(user, sess)
    return request.state.principal


async def require_admin(me: Principal = Depends(current)) -> Principal:
    if not me.is_admin:
        raise HTTPException(403, "Administrators only.")
    return me


def parse_id(resume_id: str, what: str = "CV") -> uuid.UUID:
    try:
        return uuid.UUID(resume_id)
    except ValueError:
        raise HTTPException(404, f"{what} not found.") from None


async def owned_resume(resume_id: str, me: Principal = Depends(current), s: AsyncSession = Depends(get_session)) -> uuid.UUID:
    """The id of a CV that belongs to the caller. Anyone else's (or a missing one) is a plain 404: no hint that it exists.
    Every route with a `{resume_id}` depends on this: tests/test_auth.py fails if one doesn't."""
    rid = parse_id(resume_id)
    owner = await s.scalar(select(ResumeRow.persona_id).where(ResumeRow.id == rid))
    if owner != me.id:
        raise HTTPException(404, "CV not found.")
    return rid


def own_persona(persona_id: str, me: Principal = Depends(current)) -> uuid.UUID:
    """Users only ever act on their own profile."""
    pid = parse_id(persona_id, "Persona")
    if pid != me.id:
        raise HTTPException(404, "Persona not found.")
    return pid


AI_NOT_CONFIGURED = "AI is not configured. Ask the administrator to set it up."


def require_ai(infra: Infra = Depends(get_infra), me: Principal = Depends(current)) -> None:
    """Gate for every AI endpoint: the server must have AI (501 otherwise) and this account must be entitled to it (403).
    Runs before `rate_limit`, so a refused request doesn't use up the caller's AI quota."""
    if infra.llm is None:
        raise HTTPException(501, AI_NOT_CONFIGURED)
    if not me.user.has_ai:
        raise HTTPException(403, AI_NOT_INCLUDED)


async def rate_limit(request: Request, infra: Infra = Depends(get_infra), me: Principal = Depends(current)) -> None:
    """Protects the Gemini key (and the household's quota) from runaway loops: N AI calls per minute per user."""
    n = await infra.cache.hit(window_key("ai", str(me.id)), 60)
    if n > infra.settings.ai_rate_limit_per_min:
        raise HTTPException(429, "Too many AI requests. Please wait a minute.")


async def login_rate_limit(request: Request, infra: Infra = Depends(get_infra)) -> None:
    n = await infra.cache.hit(window_key("login", client_ip(request), 600), 600)
    if n > infra.settings.login_rate_limit_per_ip:
        raise HTTPException(429, "Too many sign-in attempts. Please wait a few minutes.")
