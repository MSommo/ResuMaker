from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.deps import require_app_header
from .api import auth_routes
from .api.routes import public as public_routes
from .api.routes import router
from .config import get_settings
from .services import auth
from .infra import Infra

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def create_app(infra: Infra | None = None) -> FastAPI:
    settings = get_settings()
    settings.check()  # production refuses to boot with unsafe settings (http PUBLIC_URL, default passwords, ...)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.infra = await (infra or Infra(settings)).start()
        try:
            async with app.state.infra.session() as s:
                await auth.purge_expired(s, settings)
            yield
        finally:
            await app.state.infra.stop()

    # The API description is a map for attackers too: development only.
    docs = {} if not settings.production else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    app = FastAPI(title="ResuMaker API", version="0.1.0", lifespan=lifespan, dependencies=[Depends(require_app_header)], **docs)

    origins = [o for o in (settings.frontend_url, *settings.cors_origins) if o]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=False)

    # The frontend reads {"error": "..."} for every failure.
    @app.exception_handler(HTTPException)
    async def http_error(_: Request, e: HTTPException):
        return JSONResponse(status_code=e.status_code, content={"error": e.detail})

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, e: RequestValidationError):
        first = e.errors()[0] if e.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        return JSONResponse(status_code=422, content={"error": f"Invalid request: {where} {first.get('msg', '')}".strip()})

    @app.middleware("http")
    async def no_store(request: Request, call_next):
        """API responses hold personal data and per-user state: never let a browser or proxy cache them."""
        resp = await call_next(request)
        resp.headers.setdefault("Cache-Control", "no-store")
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        return resp

    # Public: health, sign-in, accepting an invite. Everything else requires a session (see api/deps.py: `current`).
    for r in (public_routes, auth_routes.public):
        app.include_router(r, prefix="/api")
    for r in (router, auth_routes.protected, auth_routes.admin):
        app.include_router(r, prefix="/api")
    return app


app = create_app()
