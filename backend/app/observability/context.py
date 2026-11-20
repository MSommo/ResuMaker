"""The id of the request being handled, so logs, traces, error reports and usage rows can be matched up."""

from __future__ import annotations

import re
import uuid
from contextvars import ContextVar
from typing import Any

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
_SAFE = re.compile(r"^[A-Za-z0-9._-]{8,64}$")  # what we accept from nginx's X-Request-ID; anything else gets a fresh id


def new_request_id(incoming: str | None = None) -> str:
    return incoming if incoming and _SAFE.match(incoming) else uuid.uuid4().hex


def request_id() -> str | None:
    return _request_id.get()


def set_request_id(rid: str | None) -> Any:
    return _request_id.set(rid)


def reset_request_id(token: Any) -> None:
    try:
        _request_id.reset(token)
    except ValueError:
        _request_id.set(None)
