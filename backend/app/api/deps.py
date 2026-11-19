from __future__ import annotations

import uuid
from typing import AsyncIterator

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from ..cache import window_key
from ..infra import Infra

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def get_infra(request: Request) -> Infra:
    return request.app.state.infra


async def get_session(infra: Infra = Depends(get_infra)) -> AsyncIterator[AsyncSession]:
    async with infra.session() as s:
        yield s


async def require_app_header(request: Request) -> None:
    """Cross-site requests can't set custom headers without a CORS preflight, which we only allow for our own origins."""
    if request.method in UNSAFE and request.headers.get("x-resumaker") != "1":
        raise HTTPException(403, "Forbidden.")


def parse_id(resume_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(resume_id)
    except ValueError:
        raise HTTPException(404, "CV not found.") from None


async def rate_limit(request: Request, infra: Infra = Depends(get_infra)) -> None:
    """Protects the Gemini key from runaway loops: N AI calls per minute per client."""
    who = request.client.host if request.client else "unknown"
    n = await infra.cache.hit(window_key("ai", who), 60)
    if n > infra.settings.ai_rate_limit_per_min:
        raise HTTPException(429, "Too many AI requests. Please wait a minute.")
