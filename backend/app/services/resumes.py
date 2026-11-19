"""CVs. A CV is stored *without* the personal details (they live on its persona); this module merges them back in when
reading and splits them out when saving, so the rest of the app can keep working with one complete `Resume`."""

from __future__ import annotations

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import ChatMessageRow, PersonaRow, ResumeRow, utcnow
from ..domain.catalog import blank_resume, sample_resume
from ..domain.models import Basics, PersonalDetails, Resume
from . import versions
from .personas import PersonaNotFound, apply_details, to_details


class NotFound(Exception):
    pass


class VersionConflict(Exception):
    def __init__(self, current: ResumeRow, persona: PersonaRow):
        self.current, self.persona = current, persona


def merged_from(data: dict, persona: PersonaRow) -> Resume:
    """The complete CV for stored CV `data` (the live row or a version snapshot): the persona's details + its own content."""
    headline = (data.get("basics") or {}).get("headline", "")
    return Resume.model_validate({**data, "basics": {**to_details(persona).model_dump(), "headline": headline}})


def merged(row: ResumeRow, persona: PersonaRow) -> Resume:
    """The complete CV: the persona's details + this CV's own content and headline."""
    return merged_from(row.data, persona)


def _store(row: ResumeRow, resume: Resume) -> None:
    row.data = {**resume.model_dump(mode="json"), "basics": {"headline": resume.basics.headline}}
    row.layout_id = resume.layoutId
    row.title = resume.basics.headline.strip() or "Untitled CV"


def _personal(resume: Resume) -> PersonalDetails:
    return PersonalDetails.model_validate(resume.basics.model_dump(exclude={"headline"}))


async def get_resume(s: AsyncSession, rid: uuid.UUID) -> tuple[ResumeRow, PersonaRow]:
    row = await s.get(ResumeRow, rid)
    if row is None:
        raise NotFound(str(rid))
    return row, await s.get(PersonaRow, row.persona_id)  # type: ignore[return-value]


async def create_resume(s: AsyncSession, persona_id: uuid.UUID, *, resume: Resume | None = None, layout_id: str = "sidebar", template: str = "blank") -> tuple[ResumeRow, PersonaRow]:
    persona = await s.get(PersonaRow, persona_id)
    if persona is None:
        raise PersonaNotFound(str(persona_id))
    base = resume or (sample_resume(layout_id) if template == "sample" else blank_resume(layout_id))
    # Whatever personal details the template carries are replaced by the persona's; only the headline is the CV's own.
    base.basics = Basics(**to_details(persona).model_dump(), headline=base.basics.headline)
    row = ResumeRow(id=uuid.uuid4(), persona_id=persona_id, version=1)
    _store(row, base)
    s.add(row)
    await s.commit()
    return row, persona


async def save_resume(
    s: AsyncSession, rid: uuid.UUID, resume: Resume, expected_version: int | None, *, update_persona: bool, checkpoint: bool = False
) -> tuple[ResumeRow, PersonaRow]:
    """Replace the CV. With `expected_version` it is an optimistic-lock save (409 if someone else saved in between).

    `update_persona`: also write the personal details in `resume.basics` to the persona. The web editor edits those through
    the persona endpoint instead, so its CV saves pass False; the agent, ops endpoint and MCP pass True.
    `checkpoint`: manual (autosave) edits get a version-history snapshot at the start of an editing session. Callers that
    make a deliberate change (agent, ops, MCP) take their own labelled snapshot with `versions.snapshot` instead.
    """
    row = await s.scalar(select(ResumeRow).where(ResumeRow.id == rid).with_for_update())
    if row is None:
        raise NotFound(str(rid))
    persona = await s.get(PersonaRow, row.persona_id)
    assert persona is not None
    if expected_version is not None and row.version != expected_version:
        raise VersionConflict(row, persona)
    if checkpoint:
        await versions.checkpoint_if_stale(s, row)
    if update_persona:
        apply_details(persona, _personal(resume))
    _store(row, resume)
    row.version += 1
    row.updated_at = utcnow()
    await s.commit()
    return row, persona


async def delete_resume(s: AsyncSession, rid: uuid.UUID) -> None:
    row, _ = await get_resume(s, rid)
    await s.delete(row)
    await s.commit()


# ---- chat history

async def chat_history(s: AsyncSession, rid: uuid.UUID, limit: int = 40) -> list[ChatMessageRow]:
    rows = (await s.scalars(select(ChatMessageRow).where(ChatMessageRow.resume_id == rid).order_by(ChatMessageRow.created_at.desc()).limit(limit))).all()
    return list(reversed(rows))


async def add_chat(
    s: AsyncSession, rid: uuid.UUID, role: str, text: str, applied: list[str] | None = None, skipped: list[str] | None = None,
    undo_version_id: uuid.UUID | None = None,
) -> ChatMessageRow:
    row = ChatMessageRow(resume_id=rid, role=role, text=text, applied=applied or [], skipped=skipped or [], undo_version_id=undo_version_id)
    s.add(row)
    await s.flush()
    return row


async def clear_chat(s: AsyncSession, rid: uuid.UUID) -> None:
    await s.execute(delete(ChatMessageRow).where(ChatMessageRow.resume_id == rid))
    await s.commit()
