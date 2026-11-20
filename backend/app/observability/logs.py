"""Logging: every record carries the request id. In production each line is one JSON object (what Railway's log search and
any log drain parse); in development, a readable line."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from .context import request_id


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id() or "-"
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
        }
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, ensure_ascii=False)


def setup_logging(json_lines: bool, level: int = logging.INFO) -> None:
    """Idempotent: replaces only the handler installed by an earlier call (other handlers, such as pytest's, stay)."""
    handler = logging.StreamHandler()
    handler.addFilter(RequestIdFilter())
    handler.setFormatter(JsonFormatter() if json_lines else logging.Formatter("%(levelname)s %(name)s [%(request_id)s]: %(message)s"))
    handler._resumaker = True  # type: ignore[attr-defined]
    root = logging.getLogger()
    root.handlers[:] = [h for h in root.handlers if not getattr(h, "_resumaker", False)] + [handler]
    root.setLevel(level)
    # uvicorn's own loggers go through the same handler (request id, JSON). Its access log repeats what the metrics count,
    # with full URLs: production keeps it quiet.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).handlers[:] = []
        logging.getLogger(name).propagate = True
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING if json_lines else logging.INFO)
