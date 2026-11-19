from __future__ import annotations

import uuid
from dataclasses import dataclass

from ..agent.llm import LLMError
from ..db import PersonaRow
from ..domain.models import Resume
from ..infra import Infra
from . import resumes as repo


@dataclass
class ChatOutcome:
    reply: str
    applied: list[str]
    skipped: list[str]
    row: repo.ResumeRow
    persona: PersonaRow
    message_id: str


async def run_chat(infra: Infra, rid: uuid.UUID, message: str) -> ChatOutcome:
    """One assistant turn: load the CV + history, run the LangGraph agent, persist the changes and the conversation."""
    if infra.graph is None:
        raise LLMError("AI is not configured. Add GEMINI_API_KEY to .env and restart the API.", 501)
    async with infra.session() as s:
        row, persona = await repo.get_resume(s, rid)
        history = await repo.chat_history(s, rid, limit=14)
        base_version = row.version
        messages = [{"role": m.role, "text": m.text + (f"\n[Changes applied: {'; '.join(m.applied)}]" if m.applied else "")} for m in history]
        messages.append({"role": "user", "text": message})

        final = await infra.graph.ainvoke({"messages": messages, "resume": repo.merged(row, persona).model_dump(mode="json")})
        plan = final.get("plan", {})
        applied: list[str] = final.get("applied", [])
        skipped: list[str] = final.get("skipped", [])
        reply = plan.get("reply") or final.get("first_reply") or ("Done." if applied else "I didn’t change anything.")

        if applied:  # only write when something really changed; the optimistic lock guards against a concurrent save
            row, persona = await repo.save_resume(s, rid, Resume.model_validate(final["resume"]), base_version, update_persona=True)
        await repo.add_chat(s, rid, "user", message)
        msg = await repo.add_chat(s, rid, "assistant", reply, applied, skipped)
        await s.commit()
        return ChatOutcome(reply, applied, skipped, row, persona, str(msg.id))
