from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.deps import require_app_header
from .api.routes import router
from .config import get_settings
from .infra import Infra

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def create_app(infra: Infra | None = None) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.infra = await (infra or Infra(settings)).start()
        try:
            yield
        finally:
            await app.state.infra.stop()

    app = FastAPI(title="ResuMaker API", version="0.1.0", lifespan=lifespan, dependencies=[Depends(require_app_header)])

    origins = [settings.frontend_url, *settings.cors_origins]
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

    app.include_router(router, prefix="/api")
    return app


app = create_app()
