from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from ..agent.llm import LLMError
from ..db import PersonaRow
from ..domain.diff import diff_resumes
from ..domain.models import Resume
from ..infra import Infra
from . import resumes as repo
from . import versions


@dataclass
class ChatOutcome:
    reply: str
    applied: list[str]
    skipped: list[str]
    row: repo.ResumeRow
    persona: PersonaRow
    message_id: str
    changes: list[str] = field(default_factory=list)
    undo_version_id: str | None = None


async def run_chat(infra: Infra, rid: uuid.UUID, message: str) -> ChatOutcome:
    """One assistant turn: load the CV + history, run the LangGraph agent, persist the changes and the conversation."""
    if infra.graph is None:
        raise LLMError("AI is not configured. Add GEMINI_API_KEY to .env and restart the API.", 501)
    async with infra.session() as s:
        row, persona = await repo.get_resume(s, rid)
        history = await repo.chat_history(s, rid, limit=14)
        base_version = row.version
        before = repo.merged(row, persona)
        messages = [{"role": m.role, "text": m.text + (f"\n[Changes applied: {'; '.join(m.applied)}]" if m.applied else "")} for m in history]
        messages.append({"role": "user", "text": message})

        final = await infra.graph.ainvoke({"messages": messages, "resume": before.model_dump(mode="json")})
        plan = final.get("plan", {})
        applied: list[str] = final.get("applied", [])
        skipped: list[str] = final.get("skipped", [])
        reply = plan.get("reply") or final.get("first_reply") or ("Done." if applied else "I didn’t change anything.")

        changes: list[str] = []
        undo_id = None
        if applied:  # only write when something really changed; the optimistic lock guards against a concurrent save
            after = Resume.model_validate(final["resume"])
            changes = diff_resumes(before, after)
            snap = await versions.snapshot(s, row, source="ai", label=message)  # what Undo restores
            undo_id = snap.id
            row, persona = await repo.save_resume(s, rid, after, base_version, update_persona=True)
        await repo.add_chat(s, rid, "user", message)
        msg = await repo.add_chat(s, rid, "assistant", reply, applied, skipped, undo_version_id=undo_id)
        await s.commit()
        return ChatOutcome(reply, applied, skipped, row, persona, str(msg.id), changes, str(undo_id) if undo_id else None)
