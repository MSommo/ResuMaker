"""Spans for the agent's graph nodes (and anything else worth timing). A no-op unless Sentry tracing is on."""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

_enabled = False


def enable() -> None:
    global _enabled
    _enabled = True


@contextmanager
def span(name: str, op: str = "function") -> Iterator[None]:
    if not _enabled:
        yield
        return
    import sentry_sdk

    with sentry_sdk.start_span(op=op, name=name):
        yield
