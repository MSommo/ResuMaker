"""Tailor-to-posting: clone the CV into a variant, analyse the posting, and propose the changes on the variant for review.
The master CV is never modified."""

from __future__ import annotations

import logging
import uuid
from typing import Any, AsyncIterator

from ..agent.llm import LLMError
from ..agent.tailor import analyze_posting, tailor_request
from ..infra import Infra
from . import resumes as repo
from .chat import stream_chat

log = logging.getLogger("resumaker.tailor")


async def stream_tailor(infra: Infra, rid: uuid.UUID, posting: str) -> AsyncIterator[dict[str, Any]]:
    """Events: status, spec, variant, then the usual chat events (step/status) ending in `proposal`. Errors raise."""
    if infra.llm is None:
        raise LLMError("AI is not configured. Add GEMINI_API_KEY to .env and restart the API.", 501)
    async with infra.session() as s:
        row, persona = await repo.get_resume(s, rid)
        master = repo.merged(row, persona)
    yield {"type": "status", "label": "Reading the job posting…"}
    spec = await analyze_posting(infra.llm, posting, master)
    yield {"type": "spec", **spec.model_dump()}

    async with infra.session() as s:  # the variant: same persona, same content, its own history
        variant, _ = await repo.create_resume(s, row.persona_id, resume=master.model_copy(deep=True), layout_id=master.layoutId)
        vid = variant.id
    yield {"type": "variant", "resumeId": str(vid), "personaId": str(row.persona_id)}

    proposed = False
    try:
        async for ev in stream_chat(infra, vid, tailor_request(spec), "propose"):
            if ev["type"] == "proposal":
                proposed = True
                yield {**ev, "resumeId": str(vid)}
            elif ev["type"] != "done":  # `done` here means nothing needed changing
                yield ev
    finally:
        if not proposed:  # nothing to review (or it failed): don't leave an empty copy lying around
            async with infra.session() as s:
                try:
                    await repo.delete_resume(s, vid)
                except repo.NotFound:
                    pass
    if not proposed:
        raise LLMError("The assistant found nothing to change for this posting.", 422)
