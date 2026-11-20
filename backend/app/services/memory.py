"""Per-person memory: preferences ("short bullets, no buzzwords") and facts the person confirmed.

Memory is explicit and visible: it is only written when the person asks (or adds it in the Memory panel), every item can be
deleted, and it is context for the writers, never a source of truth: the CV's own text always wins.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent.llm import LLM, LLMError
from ..db import MemoryRow, UserRow

log = logging.getLogger("resumaker.memory")

KINDS = ("preference", "fact")
MAX_PER_PERSONA = 100
MAX_TEXT = 300
DUPLICATE_DISTANCE = 0.08   # cosine distance below which a new memory is the same as an existing one
RELEVANT_DISTANCE = 0.38    # facts further than this from the request are left out. Measured with gemini-embedding-001 (make eval-memory): related 0.25-0.34, unrelated 0.40-0.45
MAX_PREFERENCES = 10        # preferences always apply, so the prompt carries all of them (capped)
MAX_FACTS = 5


class MemoryNotFound(Exception):
    pass


class MemoryFull(Exception):
    pass


async def list_memories(s: AsyncSession, persona_id: uuid.UUID) -> list[MemoryRow]:
    rows = await s.execute(select(MemoryRow).where(MemoryRow.persona_id == persona_id).order_by(MemoryRow.created_at.desc()))
    return list(rows.scalars())


async def add(s: AsyncSession, llm: LLM, persona_id: uuid.UUID, kind: str, text: str, source_resume_id: uuid.UUID | None = None) -> tuple[MemoryRow, bool]:
    """Returns (memory, created). Saying the same thing twice keeps one memory (created=False)."""
    text = " ".join(text.split())
    if kind not in KINDS or not text:
        raise ValueError("A memory needs a kind (preference or fact) and some text.")
    if len(text) > MAX_TEXT:
        raise ValueError(f"A memory can be at most {MAX_TEXT} characters.")
    if await s.get(UserRow, persona_id) is None:
        raise MemoryNotFound("persona")
    [vec] = await llm.embed([text])
    near = (
        await s.execute(
            select(MemoryRow, MemoryRow.embedding.cosine_distance(vec).label("d"))
            .where(MemoryRow.persona_id == persona_id).order_by("d").limit(1)
        )
    ).first()
    if near and near.d < DUPLICATE_DISTANCE:
        return near[0], False
    if len(await list_memories(s, persona_id)) >= MAX_PER_PERSONA:
        raise MemoryFull()
    row = MemoryRow(id=uuid.uuid4(), persona_id=persona_id, kind=kind, text=text, embedding=vec, source_resume_id=source_resume_id)
    s.add(row)
    await s.commit()
    return row, True


async def delete(s: AsyncSession, memory_id: uuid.UUID, *, owner: uuid.UUID) -> None:
    """Only the owner's memories can be deleted; anyone else's looks like it doesn't exist."""
    row = await s.get(MemoryRow, memory_id)
    if row is None or row.persona_id != owner:
        raise MemoryNotFound(str(memory_id))
    await s.delete(row)
    await s.commit()


async def context_block(s: AsyncSession, llm: LLM, persona_id: uuid.UUID, request: str) -> str:
    """What the writers get: all of the person's preferences, plus the facts closest in meaning to this request.
    Best effort: if search fails the agent simply runs without memory."""
    try:
        prefs = (
            await s.execute(select(MemoryRow).where(MemoryRow.persona_id == persona_id, MemoryRow.kind == "preference").order_by(MemoryRow.created_at).limit(MAX_PREFERENCES))
        ).scalars().all()
        facts: list[MemoryRow] = []
        if await s.scalar(select(MemoryRow.id).where(MemoryRow.persona_id == persona_id, MemoryRow.kind == "fact").limit(1)) is not None:
            [vec] = await llm.embed([request], query=True)
            hits = (
                await s.execute(
                    select(MemoryRow, MemoryRow.embedding.cosine_distance(vec).label("d"))
                    .where(MemoryRow.persona_id == persona_id, MemoryRow.kind == "fact").order_by("d").limit(MAX_FACTS)
                )
            ).all()
            facts = [r[0] for r in hits if r.d <= RELEVANT_DISTANCE]
    except (LLMError, Exception) as e:  # noqa: BLE001
        log.warning("memory lookup failed, continuing without it: %s", e)
        return ""
    lines = [*(f"- Preference: {m.text}" for m in prefs), *(f"- Fact the person confirmed: {m.text}" for m in facts)]
    return "\n".join(lines)
