"""Error reports and traces (Sentry), scrubbed so that only ids, code locations and counts leave the server.

Off unless SENTRY_DSN is set. What is sent: exception types and stack frames (file, function, line: code, not data), the
route, the request id, the signed-in user's *id*, and span timings. What never is: request bodies, query strings,
cookies, headers, local variables, log arguments, and exception messages (they can quote CV text, SQL parameters or
an email), except for a short list of our own exception types whose messages are fixed sentences.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from typing import Any

from . import tracing
from .context import request_id

log = logging.getLogger("resumaker.telemetry")
_enabled = False

# Exception types whose message is a fixed sentence we wrote (see agent/llm.py, services/*): safe and useful to keep.
SAFE_MESSAGES = {"LLMError", "ProposalGone", "VersionConflict", "NotFound", "ImportRejected", "UnsafeSettings", "TimeoutError", "CancelledError"}
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_DIGITS = re.compile(r"\+?\d[\d\s().-]{6,}\d")


def redact(text: str, limit: int = 300) -> str:
    """For the little free text we do keep (browser error messages): no emails or phone-like numbers, and short."""
    return _DIGITS.sub("<number>", _EMAIL.sub("<email>", text or ""))[:limit]


def _scrub_request(req: dict[str, Any]) -> dict[str, Any]:
    url = (req.get("url") or "").split("?", 1)[0]
    return {"method": req.get("method"), "url": url}


def _scrub(event: dict[str, Any]) -> dict[str, Any]:
    if "request" in event:
        event["request"] = _scrub_request(event["request"])
    user = event.get("user") or {}
    event["user"] = {"id": user["id"]} if user.get("id") else {}
    event.pop("extra", None)
    event.pop("server_name", None)  # the container's hostname: noise, and nothing anyone needs
    for exc in (event.get("exception") or {}).get("values", []):
        if exc.get("type") not in SAFE_MESSAGES:
            exc["value"] = "<redacted>"
        for frame in (exc.get("stacktrace") or {}).get("frames", []):
            frame.pop("vars", None)
    if (entry := event.get("logentry")) is not None:  # keep the template ("PDF rendering failed for CV %s"), not the values
        event["logentry"] = {"message": entry.get("message")}
        event.pop("message", None)
    crumbs = event.get("breadcrumbs") or {}
    for c in crumbs.get("values", []):
        c.pop("data", None)
        c.pop("message", None)
    return event


def before_send(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    try:
        return _scrub(event)
    except Exception:  # noqa: BLE001  never send an event we could not scrub
        return None


def before_send_transaction(event: dict[str, Any], hint: dict[str, Any]) -> dict[str, Any] | None:
    try:
        event = _scrub(event)
        for span in event.get("spans", []):
            span.pop("data", None)  # e.g. SQL parameters, HTTP query strings
        return event
    except Exception:  # noqa: BLE001
        return None


def init(settings: Any) -> bool:
    """Start Sentry once per process if SENTRY_DSN is set. Returns whether it is on."""
    global _enabled
    if _enabled or not settings.sentry_dsn:
        return _enabled
    import sentry_sdk
    from sentry_sdk.integrations.logging import LoggingIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        release=settings.release or os.environ.get("RAILWAY_GIT_COMMIT_SHA") or None,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        traces_sample_rate=settings.sentry_traces_sample_rate,
        before_send=before_send,
        before_send_transaction=before_send_transaction,
        # Errors logged at ERROR become events (the template only, see _scrub); log lines are not kept as breadcrumbs.
        integrations=[LoggingIntegration(level=None, event_level=logging.ERROR)],
    )
    tracing.enable()
    _enabled = True
    log.info("Sentry error reporting on (traces: %s of requests)", settings.sentry_traces_sample_rate)
    return True


def enabled() -> bool:
    return _enabled


def set_user(user_id: uuid.UUID) -> None:
    if _enabled:
        import sentry_sdk

        sentry_sdk.set_user({"id": str(user_id)})


def tag_request() -> None:
    if _enabled and (rid := request_id()):
        import sentry_sdk

        sentry_sdk.set_tag("request_id", rid)


def capture_client_error(user_id: uuid.UUID, message: str, stack: str, path: str, release: str) -> None:
    """A browser error, sent on by the API (the browser never talks to Sentry: same CSP, same scrubbing)."""
    if not _enabled:
        return
    import sentry_sdk

    with sentry_sdk.new_scope() as scope:
        scope.set_user({"id": str(user_id)})
        scope.set_tag("source", "browser")
        scope.set_tag("path", path)
        if release:
            scope.set_tag("web_release", release)
        scope.set_context("browser_error", {"stack": stack})
        sentry_sdk.capture_message(f"Browser error: {message}", level="error")
