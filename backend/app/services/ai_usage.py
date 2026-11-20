"""The AI usage log (issue #25): recording each AI request as one `ai_usage` row, retention, and what the admin Users page shows.

Recording:
    async with ai_usage.track(infra, "chat", user_id, resume_id=rid):
        ...  # every model call made in here (through `usage.Metered`) is added to the row

Rows are written by a background task once the work ends, so neither a slow database nor a client that hangs up mid-stream
(the Stop button) can lose or delay them. Only metadata is stored: never prompt, CV or chat text.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator

from sqlalchemy import and_, case, delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .. import usage
from ..cache import window_key
from ..config import Settings
from ..db import AiUsageRow
from ..observability.context import request_id

log = logging.getLogger("resumaker.ai_usage")

# Refused attempts are logged too, but a client hammering a limit shouldn't turn into a flood of rows: per user and minute,
# only the first few are stored (the metrics still count every one).
MAX_REJECTION_ROWS_PER_MIN = 20

_pending: set[asyncio.Task] = set()


# ------------------------------------------------------------------ recording


def _classify(e: BaseException) -> tuple[str, str]:
    """(status, reason) for a failed AI request. Imported lazily: services import this module."""
    from ..agent.llm import AI_NOT_INCLUDED, LLMError
    from . import resumes as repo
    from .importers import ImportRejected

    if isinstance(e, (asyncio.CancelledError, GeneratorExit)):
        return "cancelled", "cancelled"
    if isinstance(e, LLMError):
        return ("rejected", "not_entitled") if e.status == 403 and str(e) == AI_NOT_INCLUDED else ("error", "llm_error")
    if isinstance(e, repo.VersionConflict):
        return "error", "conflict"
    if isinstance(e, ImportRejected):
        return "error", "bad_input"
    return "error", "error"


def _row(scope: usage.Scope, settings: Settings) -> AiUsageRow:
    models = scope.by_model()
    return AiUsageRow(
        user_id=scope.user_id, resume_id=scope.resume_id, request_id=scope.request_id, feature=scope.feature, source=scope.source,
        intent=scope.intent, status=scope.status, reason=scope.reason, model=scope.model, models=models, calls=len(scope.calls),
        input_tokens=scope.input_tokens, output_tokens=scope.output_tokens,
        cost_usd=sum(settings.cost_usd(m, v["input"], v["output"]) for m, v in models.items()),
        latency_ms=scope.latency_ms, ops_applied=scope.ops_applied, ops_rejected=scope.ops_rejected,
        guard_rejections=scope.guard_rejections, repairs=scope.repairs, critic_rounds=scope.critic_rounds,
    )


async def _store(infra: Any, row: AiUsageRow) -> None:
    try:
        async with infra.session() as s:
            s.add(row)
            await s.commit()
    except Exception as e:  # noqa: BLE001  a lost usage row must never fail the request it describes
        log.warning("could not record AI usage: %s", e)


def _save(infra: Any, scope: usage.Scope) -> None:
    usage.finish(scope)  # metrics
    task = asyncio.get_running_loop().create_task(_store(infra, _row(scope, infra.settings)))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def flush() -> None:
    """Wait for the rows still being written (tests; shutdown)."""
    while _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)


@asynccontextmanager
async def track(infra: Any, feature: str, user_id: uuid.UUID, *, resume_id: uuid.UUID | None = None, source: str = "web") -> AsyncIterator[usage.Scope]:
    """One AI request. Nested `track`s (tailoring runs a chat inside) add to the outer one instead of logging twice."""
    if (outer := usage.current()) is not None:
        yield outer
        return
    scope = usage.Scope(user_id=user_id, feature=feature, source=source, resume_id=resume_id, request_id=request_id())
    token = usage.enter(scope)
    try:
        yield scope
    except BaseException as e:
        scope.status, scope.reason = _classify(e)
        raise
    finally:
        usage.leave(token)
        _save(infra, scope)


async def record_rejection(infra: Any, user_id: uuid.UUID, feature: str, reason: str, *, source: str = "web") -> None:
    """A request refused before any AI ran: rate limit, daily limit, or the account has no AI."""
    scope = usage.Scope(user_id=user_id, feature=feature, source=source, request_id=request_id(), status="rejected", reason=reason)
    if await infra.cache.hit(window_key("ai-rejected", str(user_id)), 60) > MAX_REJECTION_ROWS_PER_MIN:
        usage.finish(scope)  # counted in the metrics, not stored
        return
    _save(infra, scope)


async def purge(s: AsyncSession, settings: Settings) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.ai_usage_retention_days)
    res = await s.execute(delete(AiUsageRow).where(AiUsageRow.created_at < cutoff))
    await s.commit()
    return res.rowcount or 0


# ------------------------------------------------------------------ reading (admin only)


@dataclass
class Summary:
    """One user's AI use, for the Users list. "Requests" leave out refused attempts, which are counted separately."""

    today: int = 0
    week: int = 0
    month: int = 0
    tokens_month: int = 0
    cost_month: float = 0.0
    errors_month: int = 0
    rejected_month: int = 0
    off_topic_month: int = 0
    chats_month: int = 0  # chat turns the router classified: the base for the off-topic share
    last_used_at: datetime | None = None

    @property
    def off_topic_share(self) -> float | None:
        return self.off_topic_month / self.chats_month if self.chats_month else None


def _day_start(now: datetime) -> datetime:
    """The daily AI limit counts UTC days (a Redis window per epoch day), so "today" does too."""
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def summaries(s: AsyncSession, user_ids: list[uuid.UUID] | None = None, now: datetime | None = None) -> dict[uuid.UUID, Summary]:
    now = now or datetime.now(timezone.utc)
    today, week, month = _day_start(now), now - timedelta(days=7), now - timedelta(days=30)
    u = AiUsageRow
    used = u.status != "rejected"

    def n(cond: Any) -> Any:
        return func.count().filter(cond)

    q = (
        select(
            u.user_id,
            n(and_(used, u.created_at >= today)), n(and_(used, u.created_at >= week)), n(used),
            func.coalesce(func.sum(u.input_tokens + u.output_tokens), 0), func.coalesce(func.sum(u.cost_usd), 0.0),
            n(u.status == "error"), n(u.status == "rejected"), n(u.intent == "off_topic"), n(and_(u.feature == "chat", u.intent.is_not(None))),
            func.max(case((used, u.created_at))),
        )
        .where(u.created_at >= month)
        .group_by(u.user_id)
    )
    if user_ids is not None:
        q = q.where(u.user_id.in_(user_ids))
    out: dict[uuid.UUID, Summary] = {}
    for r in (await s.execute(q)).all():
        out[r[0]] = Summary(r[1], r[2], r[3], int(r[4]), float(r[5]), r[6], r[7], r[8], r[9], r[10])
    if user_ids:  # "last used" may be older than 30 days
        missing = [i for i in user_ids if i not in out]
        if missing:
            for uid, last in (await s.execute(select(u.user_id, func.max(u.created_at)).where(u.user_id.in_(missing), used).group_by(u.user_id))).all():
                out[uid] = Summary(last_used_at=last)
    return out


async def detail(s: AsyncSession, settings: Settings, user_id: uuid.UUID, start: datetime, end: datetime, recent: int = 50) -> dict[str, Any]:
    """Usage over time (per UTC day), by feature, by model, and the most recent requests: metadata only."""
    u = AiUsageRow
    where = and_(u.user_id == user_id, u.created_at >= start, u.created_at < end)
    used = u.status != "rejected"
    day = func.date_trunc("day", func.timezone("UTC", u.created_at)).label("day")

    series = [
        {"day": r.day.date().isoformat(), "requests": r.requests, "tokens": int(r.tokens), "cost": float(r.cost), "errors": r.errors, "rejected": r.rejected}
        for r in (await s.execute(
            select(day, func.count().filter(used).label("requests"), func.coalesce(func.sum(u.input_tokens + u.output_tokens), 0).label("tokens"),
                   func.coalesce(func.sum(u.cost_usd), 0.0).label("cost"), func.count().filter(u.status == "error").label("errors"),
                   func.count().filter(u.status == "rejected").label("rejected"))
            .where(where).group_by(day).order_by(day)
        )).all()
    ]
    by_feature = [
        {"feature": r.feature, "requests": r.requests, "tokens": int(r.tokens), "cost": float(r.cost), "errors": r.errors, "rejected": r.rejected}
        for r in (await s.execute(
            select(u.feature, func.count().filter(used).label("requests"), func.coalesce(func.sum(u.input_tokens + u.output_tokens), 0).label("tokens"),
                   func.coalesce(func.sum(u.cost_usd), 0.0).label("cost"), func.count().filter(u.status == "error").label("errors"),
                   func.count().filter(u.status == "rejected").label("rejected"))
            .where(where).group_by(u.feature).order_by(func.count().desc())
        )).all()
    ]
    # Per model from the per-row breakdown. Cost here is from today's prices (the stored per-row cost isn't split by model).
    by_model = []
    rows = await s.execute(
        text(
            "select m.key as model, sum((m.value->>'calls')::int) as calls, sum((m.value->>'input')::int) as input, "
            "sum((m.value->>'output')::int) as output, sum((m.value->>'errors')::int) as errors "
            "from ai_usage, jsonb_each(ai_usage.models) as m "
            "where ai_usage.user_id = :uid and ai_usage.created_at >= :start and ai_usage.created_at < :end "
            "group by m.key order by sum((m.value->>'output')::int) desc"
        ),
        {"uid": user_id, "start": start, "end": end},
    )
    for r in rows.all():
        by_model.append({"model": r.model, "calls": int(r.calls), "inputTokens": int(r.input), "outputTokens": int(r.output),
                         "errors": int(r.errors), "cost": settings.cost_usd(r.model, int(r.input), int(r.output))})
    latest = (await s.execute(select(u).where(where).order_by(u.created_at.desc()).limit(recent))).scalars().all()
    return {"series": series, "byFeature": by_feature, "byModel": by_model, "recent": latest}
