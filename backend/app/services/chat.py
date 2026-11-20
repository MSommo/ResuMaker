"""One assistant turn: load the CV and the conversation, drive the LangGraph agent, persist what changed.

`stream_chat` is the single implementation. It yields progress events while the graph runs and ends with either
`done` (the change is committed) or `proposal` (propose mode: the run is paused for review, stored in Postgres).
The plain endpoint, the SSE endpoint and MCP all consume it.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from langgraph.types import Command

from ..agent.graph import needs_repair
from ..agent.llm import LLMError
from ..db import PersonaRow
from ..domain.diff import diff_resumes
from ..domain.models import Resume
from ..infra import Infra
from . import resumes as repo
from . import versions

log = logging.getLogger("resumaker.chat")


class ProposalGone(Exception):
    """The proposal was already decided, or never existed (or expired)."""


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
    intent: str = "edit"


def _thread(rid: uuid.UUID, run_id: str) -> dict[str, Any]:
    # The CV id is part of the thread id, so a run can only be resumed through the CV it belongs to.
    return {"configurable": {"thread_id": f"chat:{rid}:{run_id}"}}


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _detail(node: str, state: dict[str, Any]) -> str:
    if node == "route":
        return str(state.get("intent", ""))
    if node == "decompose":
        n = len(state.get("tasks", []))
        return f"{n} tasks" if n > 1 else "1 task"
    if node == "write":
        return f"{len(state.get('results', []))} of {len(state.get('tasks', []))}"
    if node == "critic":
        n = len(state.get("critique", {}).get("problems", []))
        return f"{n} issues" if n else "ok"
    if node == "plan":
        return f"{_plural(len(state.get('plan', {}).get('ops', [])), 'change')} proposed"
    if node == "apply":
        n_skipped = len(state.get("skipped", []))
        return f"{len(state.get('applied', []))} applied" + (f", {n_skipped} failed" if n_skipped else "")
    if node == "repair":
        return f"retry {state.get('attempts', 0)}"
    return ""


def _status_after(node: str, state: dict[str, Any]) -> str | None:
    """What the user should read while the next step runs."""
    if node == "route":
        return "Writing an answer…" if state.get("intent") == "answer" else "Planning the work…"
    if node == "decompose":
        n = len(state.get("tasks", []))
        return f"Writing {n} parts in parallel…" if n > 1 else "Planning the changes…"
    if node == "write":
        return f"Writing the parts… ({len(state.get('results', []))} of {len(state.get('tasks', []))} done)"
    if node == "merge":
        return "Checking the result…" if state.get("applied") else "Saving…"
    if node == "critic":
        n = len(state.get("critique", {}).get("problems", []))
        return f"Fixing {_plural(n, 'issue')} the review found…" if n else ("Preparing your review…" if state.get("mode") == "propose" else "Saving…")
    if node == "revise":
        return "Preparing your review…" if state.get("mode") == "propose" else "Saving…"
    if node == "plan":
        return "Checking the changes…"
    if node == "repair":
        return "Checking the corrected changes…"
    if node == "apply":
        if needs_repair(state):  # type: ignore[arg-type]
            return f"Fixing {_plural(len(state.get('failed', [])), 'failed change')}…"
        return "Preparing your review…" if state.get("mode") == "propose" and state.get("applied") else "Saving…"
    return None


async def _drive(graph: Any, graph_input: Any, config: dict[str, Any] | None, final: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
    """Run the graph, merge each node's update into `final`, and yield step/status events (and `interrupt` when it pauses)."""
    async for update in graph.astream(graph_input, config, stream_mode="updates"):
        for node, delta in update.items():
            if node == "__interrupt__":
                yield {"type": "interrupt", "value": delta[0].value}
                continue
            delta = dict(delta or {})
            if node == "write":  # parallel writers each report one result: accumulate them
                delta["results"] = [*final.get("results", []), *delta.get("results", [])]
            final.update(delta)
            yield {"type": "step", "node": node, "detail": _detail(node, final)}
            if (label := _status_after(node, final)) and node not in ("review", "finalize"):
                yield {"type": "status", "label": label}


async def _commit(infra: Infra, s: Any, rid: uuid.UUID, row: repo.ResumeRow, persona: PersonaRow, before: Resume, final: dict[str, Any], message: str, proposed: int | None = None) -> ChatOutcome:
    """Turn a finished run into saved changes: snapshot (for Undo), save with the optimistic lock, and record the conversation."""
    intent = final.get("intent", "edit")
    applied: list[str] = [] if intent == "answer" else final.get("applied", [])
    skipped: list[str] = [] if intent == "answer" else final.get("skipped", [])
    plan = final.get("plan", {})
    if intent == "answer":
        reply = final.get("answer") or "I don’t have an answer for that."
    else:
        reply = final.get("summary") or plan.get("reply") or final.get("first_reply") or ("Done." if applied else "I didn’t change anything.")
        if proposed is not None and len(applied) != proposed:  # the user accepted only some of the proposed changes
            reply = f"Applied {len(applied)} of {_plural(proposed, 'proposed change')}." if applied else "Okay, I didn’t apply any of the proposed changes."

    changes: list[str] = []
    undo_id = None
    if applied:  # only write when something really changed; the optimistic lock guards against a concurrent save
        after = Resume.model_validate(final["resume"])
        changes = diff_resumes(before, after)
        snap = await versions.snapshot(s, row, source="ai", label=message)  # what Undo restores
        undo_id = snap.id
        row, persona = await repo.save_resume(s, rid, after, final["base_version"], update_persona=True)
    await repo.add_chat(s, rid, "user", message)
    msg = await repo.add_chat(s, rid, "assistant", reply, applied, skipped, undo_version_id=undo_id)
    await s.commit()
    return ChatOutcome(reply, applied, skipped, row, persona, str(msg.id), changes, str(undo_id) if undo_id else None, intent)


async def stream_chat(infra: Infra, rid: uuid.UUID, message: str, mode: str = "apply") -> AsyncIterator[dict[str, Any]]:
    """mode "apply": change the CV. mode "propose": pause before changing it and emit a `proposal` to accept or reject."""
    if infra.graph is None or infra.graph_hitl is None:
        raise LLMError("AI is not configured. Add GEMINI_API_KEY to .env and restart the API.", 501)
    async with infra.session() as s:
        row, persona = await repo.get_resume(s, rid)
        history = await repo.chat_history(s, rid, limit=14)
        before = repo.merged(row, persona)
        messages = [{"role": m.role, "text": m.text + (f"\n[Changes applied: {'; '.join(m.applied)}]" if m.applied else "")} for m in history]
        messages.append({"role": "user", "text": message})

        data = before.model_dump(mode="json")
        state_in = {"messages": messages, "resume": data, "original": data, "mode": mode, "base_version": row.version}
        propose = mode == "propose"
        run_id = uuid.uuid4().hex
        final: dict[str, Any] = dict(state_in)

        yield {"type": "status", "label": "Understanding your request…"}
        paused: dict[str, Any] | None = None
        async for ev in _drive(infra.graph_hitl if propose else infra.graph, state_in, _thread(rid, run_id) if propose else None, final):
            if ev["type"] == "interrupt":
                paused = ev["value"]
            else:
                yield ev

        if paused is not None:
            proposed_cv = Resume.model_validate(final["resume"])
            yield {
                "type": "proposal", "runId": run_id, "reply": paused["reply"], "items": paused["items"], "skipped": paused["skipped"],
                "changes": diff_resumes(before, proposed_cv),
            }
            return
        yield {"type": "done", "outcome": await _commit(infra, s, rid, row, persona, before, final, message)}


async def decide(infra: Infra, rid: uuid.UUID, run_id: str, accept: Any) -> ChatOutcome:
    """Resume a paused run with the user's decision: "all", "none", or the indices of the proposed changes to keep."""
    if infra.graph_hitl is None:
        raise LLMError("AI is not configured. Add GEMINI_API_KEY to .env and restart the API.", 501)
    config = _thread(rid, run_id)
    state = await infra.graph_hitl.aget_state(config)
    if not state.values or not state.next:
        raise ProposalGone(run_id)
    final: dict[str, Any] = dict(state.values)
    proposed = len(final.get("applied", []))
    async for _ in _drive(infra.graph_hitl, Command(resume={"accept": accept}), config, final):
        pass
    async with infra.session() as s:
        row, persona = await repo.get_resume(s, rid)
        if row.version != final["base_version"]:  # the CV changed while the proposal was waiting
            raise repo.VersionConflict(row, persona)
        outcome = await _commit(infra, s, rid, row, persona, repo.merged(row, persona), final, final["messages"][-1]["text"], proposed)
    try:
        await infra.checkpointer.adelete_thread(config["configurable"]["thread_id"])  # decided: no need to keep it
    except Exception as e:  # noqa: BLE001
        log.warning("could not delete finished thread: %s", e)
    return outcome


async def run_chat(infra: Infra, rid: uuid.UUID, message: str) -> ChatOutcome:
    """Apply mode, no streaming: what the plain endpoint and MCP use."""
    async for ev in stream_chat(infra, rid, message, "apply"):
        if ev["type"] == "done":
            return ev["outcome"]
    raise LLMError("The assistant did not finish. Please try again.")
