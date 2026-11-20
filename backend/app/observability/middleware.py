"""One ASGI middleware for every request: a request id (from nginx's X-Request-ID, or new), echoed back in the response,
on every log line and error report; and the HTTP metrics, timed to the end of the response (streams included)."""

from __future__ import annotations

import time
from typing import Any

from . import errors, metrics
from .context import new_request_id, reset_request_id, set_request_id


def route_label(scope: dict[str, Any]) -> str:
    """The route as a template (/api/resumes/{resume_id}/chat): bounded, and free of ids. Requests that matched no route
    (404s, scanners) share one label, so they can't blow up the number of series."""
    if scope.get("route") is None:
        return "unmatched"
    path = scope.get("path", "")
    for name, value in (scope.get("path_params") or {}).items():
        if value:
            path = path.replace(str(value), "{" + name + "}")
    return path


class Telemetry:
    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = next((v.decode("latin-1") for k, v in scope.get("headers", []) if k == b"x-request-id"), None)
        rid = new_request_id(incoming)
        token = set_request_id(rid)
        errors.tag_request()
        status = 500
        started = time.perf_counter()

        async def send_with_id(message: dict[str, Any]) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message.setdefault("headers", [])
                message["headers"] = [*message["headers"], (b"x-request-id", rid.encode())]
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            metrics.observe_http(scope.get("method", "GET"), route_label(scope), status, time.perf_counter() - started)
            reset_request_id(token)
