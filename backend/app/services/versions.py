"""Version history of a CV: snapshots before changes, listing, restoring."""

from __future__ import annotations

import copy
import uuid
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import ChatMessageRow, UserRow, ResumeRow, ResumeVersionRow, utcnow

# A manual editing session gets one checkpoint (taken before its first save), not one per autosave.
CHECKPOINT_AFTER = timedelta(minutes=15)
KEEP = 100  # per CV; older snapshots are pruned


class VersionNotFound(Exception):
    pass


async def snapshot(s: AsyncSession, row: ResumeRow, *, source: str, label: str = "") -> ResumeVersionRow:
    """Record the CV as it is *now* (call before changing it). Flushes but does not commit: it commits with the change."""
    v = ResumeVersionRow(
        id=uuid.uuid4(), resume_id=row.id, version=row.version, source=source, label=" ".join(label.split())[:200],
        layout_id=row.layout_id, title=row.title, data=copy.deepcopy(row.data), created_at=utcnow(),
    )
    s.add(v)
    await s.flush()
    stale = (
        await s.scalars(select(ResumeVersionRow.id).where(ResumeVersionRow.resume_id == row.id).order_by(ResumeVersionRow.created_at.desc()).offset(KEEP))
    ).all()
    if stale:
        await s.execute(delete(ResumeVersionRow).where(ResumeVersionRow.id.in_(stale)))
    return v


async def checkpoint_if_stale(s: AsyncSession, row: ResumeRow) -> None:
    """Before a manual save: snapshot the CV if there has been no snapshot for a while (the start of an editing session)."""
    latest = await s.scalar(select(func.max(ResumeVersionRow.created_at)).where(ResumeVersionRow.resume_id == row.id))
    if latest is None or utcnow() - latest > CHECKPOINT_AFTER:
        await snapshot(s, row, source="autosave", label="Before editing")


async def list_versions(s: AsyncSession, rid: uuid.UUID, limit: int = 50) -> list[ResumeVersionRow]:
    q = select(ResumeVersionRow).where(ResumeVersionRow.resume_id == rid).order_by(ResumeVersionRow.created_at.desc()).limit(limit)
    return list((await s.scalars(q)).all())


async def get_version(s: AsyncSession, rid: uuid.UUID, vid: uuid.UUID) -> ResumeVersionRow:
    v = await s.get(ResumeVersionRow, vid)
    if v is None or v.resume_id != rid:
        raise VersionNotFound(str(vid))
    return v


async def restore(s: AsyncSession, rid: uuid.UUID, vid: uuid.UUID) -> tuple[ResumeRow, UserRow]:
    """Make the CV match snapshot `vid`. The current state is snapshotted first, so a restore can itself be undone.
    Only the CV's own content is restored: the persona's personal details are shared by all their CVs and are left alone."""
    from .resumes import NotFound  # local import: resumes imports this module

    row = await s.scalar(select(ResumeRow).where(ResumeRow.id == rid).with_for_update())
    if row is None:
        raise NotFound(str(rid))
    v = await get_version(s, rid, vid)
    await snapshot(s, row, source="before-restore", label=f"Before restoring “{v.label or v.source}”")
    row.data = copy.deepcopy(v.data)
    row.layout_id = v.layout_id
    row.title = v.title
    row.version += 1
    row.updated_at = utcnow()
    # The assistant message(s) whose changes this snapshot undoes are now undone.
    await s.execute(ChatMessageRow.__table__.update().where(ChatMessageRow.undo_version_id == vid).values(undone=True))
    await s.commit()
    persona = await s.get(UserRow, row.persona_id)
    return row, persona  # type: ignore[return-value]
