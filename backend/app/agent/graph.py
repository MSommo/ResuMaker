"""The CV-editing agent, as a LangGraph state machine.

          ┌───────┐ answer  ┌────────┐
  START ──▶ route ├─────────▶ answer ├──────────────────────────────────────────▶ END
          └───┬───┘         └────────┘
              │ edit
          ┌───▼──┐    ┌───────┐   all applied (apply mode)                         ┌─────┐
          │ plan ├────▶ apply ├───────────────────────────────────────────────────▶ END │
          └──────┘    └─┬───┬─┘                                                    └─────┘
                        │   │ propose mode: changes to review
            some failed │   └──────────────────────────▶ review ───▶ finalize ───▶ END
            (retries    │                          (pauses: interrupt)
             left)      │
                   ┌────▼───┐
                   │ repair │  shows the model what failed and why; asks for corrected ops ──▶ apply
                   └────────┘

`route` uses a cheap model to tell questions from edit requests. `plan`, `repair` and `answer` use the main model.
`apply` and `finalize` are deterministic (the shared operations engine) and are what make the agent safe: the model only
proposes, validated code decides what actually changes. `review` is the only place the graph pauses: with a checkpointer
the paused run is stored in Postgres and resumes (even after an API restart) when the user accepts or rejects the changes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import operator
from typing import Annotated, Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send, interrupt
from pydantic import BaseModel, Field

from ..domain.catalog import LAYOUTS, TEMPLATES
from ..domain.diff import diff_resumes
from ..domain.models import Resume
from ..domain.ops import OP_NAMES, Op, apply_ops
from .llm import LLM
from .prompts import ANSWER_SYSTEM, CHAT_SYSTEM, CRITIC_SYSTEM, DECOMPOSE_SYSTEM, MEMORY_SYSTEM, REPAIR_NOTE, REVISE_NOTE, ROUTER_SYSTEM

log = logging.getLogger("resumaker.agent")

MAX_REPAIRS = 2
MAX_PARALLEL = 4  # concurrent writer calls: enough to be fast, few enough to stay under the API's rate limit

# Human-readable description of each node, served with the graph drawing (GET /api/agent/graph?format=json).
NODE_DOCS = {
    "decompose": "Cheap-model LLM call: splits a big request (whole-CV rewrite, tailoring, translation) into focused tasks, one per section or item. Small requests stay a single task.",
    "write": "Runs once per task, in parallel: an LLM call that plans and validates edits for its part of the CV only (with its own repair rounds).",
    "merge": "Deterministic: replays every writer's operations, in task order, on the original CV through the validated engine.",
    "critic": "LLM call: reads the request and the before/after of every changed section; reports missing parts, invented or lost facts, inconsistencies.",
    "revise": "LLM call: fixes exactly the problems the critic found (one round), applying new operations on top of the merged result.",
    "route": "Cheap-model LLM call: is this message a question (answer) or a request to change the CV (edit)? Defaults to edit.",
    "remember": "Cheap-model LLM call: turns \"remember that…\" into one saved memory (a style preference or a confirmed fact). The service saves it.",
    "answer": "LLM call: answers a question about the CV in plain text. Never changes anything.",
    "plan": "LLM call: reads the CV and the conversation, returns a reply plus structured edit operations.",
    "apply": "Deterministic: runs the operations through the validated engine; collects what was applied and what failed.",
    "repair": "LLM call: shows the model which operations failed and why, asks for corrected ops (max 2 rounds).",
    "review": "Human in the loop (propose mode): pauses with the proposed changes until the user accepts or rejects them.",
    "finalize": "Deterministic: re-applies only the accepted changes to the original CV.",
}


# ---------------------------------------------------------------- what the model returns


class Patch(BaseModel):
    """Union of every field an operation may set. All optional; which ones apply depends on the op and the section kind."""

    # personal info
    firstName: str | None = None  # noqa: N815
    lastName: str | None = None  # noqa: N815
    headline: str | None = None
    email: str | None = None
    phone: str | None = None
    street: str | None = None
    city: str | None = None
    postcode: str | None = None
    country: str | None = None
    birthDate: str | None = None  # noqa: N815
    birthPlace: str | None = None  # noqa: N815
    nationality: str | None = None
    # section
    title: str | None = None
    text: str | None = None
    icon: str | None = None
    job: bool | None = None
    # entry
    organisation: str | None = None
    location: str | None = None
    start: str | None = None
    end: str | None = None
    current: bool | None = None
    note: str | None = None
    description: str | None = None
    bullets: list[str] | None = None
    # skill / link
    name: str | None = None
    level: int | None = None
    label: str | None = None
    url: str | None = None


class PlanOp(BaseModel):
    op: Literal[OP_NAMES]  # type: ignore[valid-type]
    sectionId: str | None = None  # noqa: N815
    itemId: str | None = None  # noqa: N815
    template: str | None = None
    zone: str | None = None
    position: int | None = None
    layoutId: str | None = None  # noqa: N815
    patch: Patch = Field(default_factory=Patch)


class AgentPlan(BaseModel):
    reply: str
    ops: list[PlanOp] = Field(default_factory=list)


class Route(BaseModel):
    """The router's decision about the latest user message."""

    intent: Literal["answer", "edit", "remember"]
    reason: str = ""


class Task(BaseModel):
    instruction: str
    sectionIds: list[str] = Field(default_factory=list)  # noqa: N815  (empty = the whole CV)
    itemIds: list[str] = Field(default_factory=list)  # noqa: N815  (empty = every item of those sections)


class Memo(BaseModel):
    """What the `remember` node extracts from "remember that…" (saved by the service, which owns the database)."""

    ok: bool = True
    kind: Literal["preference", "fact"] = "preference"
    text: str = ""
    reason: str = ""


class Critique(BaseModel):
    ok: bool = True
    problems: list[str] = Field(default_factory=list)


class Decomposition(BaseModel):
    summary: str = ""
    tasks: list[Task] = Field(default_factory=list)


MAX_TASKS = 16


def coalesce(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Several updates to the same thing (the profile edited by a writer, then again by the reviewer's fix) become ONE change:
    the later patch lands over the earlier one, at the earlier one's position. Keeps the review list honest."""
    out: list[dict[str, Any]] = []
    seen: dict[tuple, int] = {}
    for o in ops:
        if o.get("op") in ("update_basics", "update_section", "update_item"):
            key = (o["op"], o.get("sectionId"), o.get("itemId"))
            if key in seen:
                prev = out[seen[key]]
                out[seen[key]] = {**prev, "patch": {**prev.get("patch", {}), **o.get("patch", {})}}
                continue
            seen[key] = len(out)
        out.append(o)
    return out


def _replay(original: dict[str, Any], ops: list[dict[str, Any]]):
    """Apply coalesced ops to the CV as it was; if anything fails to apply, report that so callers can fall back."""
    return apply_ops(Resume.model_validate(original), [Op(**o) for o in coalesce(ops)])


def to_ops(plan: AgentPlan) -> list[Op]:
    return [Op(**{**o.model_dump(exclude={"patch"}), "patch": o.patch.model_dump(exclude_none=True)}) for o in plan.ops]


# ---------------------------------------------------------------- state


class AgentState(TypedDict, total=False):
    messages: list[dict[str, str]]   # chat history, last item = the user's new message
    resume: dict[str, Any]           # the CV as it is right now (updated by `apply`)
    original: dict[str, Any]         # the CV when the run started, to re-apply only the accepted changes
    mode: str                        # "apply" (change the CV) or "propose" (pause for review first)
    base_version: int                # the CV's version when the run started (optimistic locking at commit time)
    intent: str                      # route: "answer" | "edit" | "remember"
    memory: str                      # the person's saved preferences and relevant facts, as a prompt block ("" = none)
    memo: dict[str, Any]             # remember: the memory to save
    answer: str                      # the reply, for questions
    plan: dict[str, Any]             # latest plan from the model
    first_reply: str
    applied: list[str]
    applied_ops: list[dict[str, Any]]  # the ops behind `applied`, same order (reviewed one by one)
    skipped: list[str]               # failures from the most recent apply round
    failed: list[dict[str, str]]     # the ops behind `skipped`, with reasons
    attempts: int
    tasks: list[dict[str, Any]]      # decompose: the focused tasks (empty = one task: just run `plan` on the whole request)
    results: Annotated[list[dict[str, Any]], operator.add]  # fan-in: one entry per `write`, collected as they finish
    critic_rounds: int
    critique: dict[str, Any]         # critic: {ok, problems}
    summary: str                     # decompose: one-line description of the whole request, used as the reply for multi-task runs
    decision: dict[str, Any]         # the user's answer at `review`: {"accept": "all" | "none" | [indices]}


def needs_repair(state: AgentState) -> bool:
    """After `apply`: did something fail that the model could still fix?"""
    return bool(state["plan"].get("ops")) and bool(state.get("failed")) and state["attempts"] < MAX_REPAIRS


def catalog() -> dict[str, Any]:
    return {
        "layouts": [{"id": l.id, "name": l.name, "zones": [{"id": z.id, "label": z.label, "accepts": sorted(z.accepts)} for z in l.zones]} for l in LAYOUTS.values()],
        "templates": [{"id": t.id, "label": t.label, "kind": t.kind} for t in TEMPLATES],
    }


def snapshot(r: Resume, section_ids: list[str] | None = None, item_ids: list[str] | None = None) -> dict[str, Any]:
    """Compact, id-carrying view of the CV for the model. Basics are flattened to match the update_basics patch.
    A focused task passes the sections (and items) it works on; everything else is left out to keep the prompt small."""
    b = r.basics.model_dump()
    addr = b.pop("address")
    secs = []
    for s in r.sections:
        if section_ids and s.id not in section_ids:
            continue
        d = s.model_dump()
        if item_ids and "items" in d:
            d["items"] = [i for i in d["items"] if i["id"] in item_ids]
        secs.append(d)
    return {"layoutId": r.layoutId, "basics": {**b, **addr}, "sections": secs}


def _others(r: Resume, section_ids: list[str], item_ids: list[str]) -> dict[str, Any]:
    """What a focused task is NOT editing: whole sections it doesn't own, and the other items of a section it only partly owns."""
    view = snapshot(r)
    secs = []
    for s in view["sections"]:
        if section_ids and s["id"] in section_ids:
            if not item_ids or "items" not in s:
                continue
            s = {**s, "items": [i for i in s["items"] if i["id"] not in item_ids]}
        secs.append(s)
    return {"basics": view["basics"], "sections": secs}


def outline(r: Resume) -> dict[str, Any]:
    """Ids and titles only: what the decomposer needs to split a request, without the (long) text."""
    out = []
    for s in r.sections:
        d: dict[str, Any] = {"id": s.id, "title": s.title, "kind": s.kind, "onPage": s.zone is not None}
        if hasattr(s, "items"):
            d["items"] = [{"id": i.id, "label": getattr(i, "title", "") or getattr(i, "name", "") or getattr(i, "label", ""), "organisation": getattr(i, "organisation", "")} for i in s.items]
        out.append(d)
    return {"layoutId": r.layoutId, "sections": out}


def _contents(state: dict[str, Any], extra: str | None = None, task: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    turns = state["messages"][-14:]
    out: list[dict[str, Any]] = []
    for i, m in enumerate(turns):
        role = "model" if m["role"] == "assistant" else "user"
        if i == len(turns) - 1 and role == "user":
            if task:  # one focused part of a bigger request: show only what it needs
                view = snapshot(Resume.model_validate(state["resume"]), task["sectionIds"], task["itemIds"])
                rest = _others(Resume.model_validate(state["resume"]), task["sectionIds"], task["itemIds"])
                ctx_note = f"\n\nREAD-ONLY CONTEXT, the rest of the CV, so you can ground your work in the person's real experience (never edit it, other writers handle it):\n{json.dumps(rest, ensure_ascii=False)}"
                ask = f"{task['instruction']}\n\n(This is one part of a larger request: \"{m['text'][:600]}\". Do ONLY this part; other parts are handled separately.)"
            else:
                view, ask, ctx_note = snapshot(Resume.model_validate(state["resume"])), m["text"], ""
            mem = f"\n\nMEMORY (saved preferences and confirmed facts about this person):\n{state['memory']}" if state.get("memory") else ""
            ctx = f"CATALOG (layouts, zones, templates):\n{json.dumps(catalog())}\n\nCURRENT CV STATE:\n{json.dumps(view, ensure_ascii=False)}{ctx_note}{mem}"
            out.append({"role": "user", "parts": [ctx, ask, *([extra] if extra else [])]})
        else:
            out.append({"role": role, "parts": [m["text"]]})
    return out


def _route_contents(state: AgentState) -> list[dict[str, Any]]:
    """The last few turns as plain text (no CV): enough to understand "yes, do it", cheap enough for the fast model."""
    turns = state["messages"][-4:]
    return [{"role": "model" if m["role"] == "assistant" else "user", "parts": [m["text"]]} for m in turns]


# ---------------------------------------------------------------- graph


def build_graph(llm: LLM | None, checkpointer: Any = None, use_decompose: bool = True, use_critic: bool = True):
    """`checkpointer` makes runs durable: required for `review` to pause and resume (propose mode).
    `use_decompose=False` / `use_critic=False` switch those steps off (used by the evals to compare)."""
    gate = asyncio.Semaphore(MAX_PARALLEL)

    async def route(state: AgentState) -> AgentState:
        try:
            r = await llm.json(system=ROUTER_SYSTEM, contents=_route_contents(state), schema=Route, temperature=0.0, fast=True)
            return {"intent": r.intent}
        except Exception as e:  # noqa: BLE001  The router is an optimisation: if it fails, treat the message as an edit request.
            log.warning("router failed, defaulting to edit: %s", e)
            return {"intent": "edit"}

    async def answer(state: AgentState) -> AgentState:
        turns = state["messages"][-8:]
        convo = "\n".join(f"{'Assistant' if m['role'] == 'assistant' else 'User'}: {m['text']}" for m in turns)
        cv = json.dumps(snapshot(Resume.model_validate(state["resume"])), ensure_ascii=False)
        text = await llm.text(system=ANSWER_SYSTEM, prompt=f"CURRENT CV STATE:\n{cv}\n\n" + (f"MEMORY (saved preferences and facts about this person):\n{state['memory']}\n\n" if state.get("memory") else "") + f"CONVERSATION:\n{convo}", temperature=0.4)
        return {"answer": text.strip(), "applied": [], "applied_ops": [], "skipped": []}

    async def remember(state: AgentState) -> AgentState:
        m = await llm.json(system=MEMORY_SYSTEM, contents=[{"role": "user", "parts": [state["messages"][-1]["text"]]}], schema=Memo, temperature=0.0, fast=True)
        return {"memo": m.model_dump(), "applied": [], "applied_ops": [], "skipped": []}

    async def decompose(state: AgentState) -> AgentState:
        """Best effort: on any problem the request simply runs as one task, exactly as before."""
        if not use_decompose:
            return {"tasks": [], "summary": ""}
        try:
            cv = Resume.model_validate(state["resume"])
            ask = f"REQUEST:\n{state['messages'][-1]['text']}\n\nCV OUTLINE:\n{json.dumps(outline(cv))}"
            d = await llm.json(system=DECOMPOSE_SYSTEM, contents=[{"role": "user", "parts": [ask]}], schema=Decomposition, temperature=0.0, fast=True)
            known = {s.id: {i.id for i in getattr(s, "items", [])} for s in cv.sections}
            tasks = []
            for t in d.tasks:
                if any(sid not in known for sid in t.sectionIds) or any(not any(iid in known[sid] for sid in (t.sectionIds or known)) for iid in t.itemIds):
                    raise ValueError("task refers to unknown ids")  # a hallucinated id would silently hide content from the writer
                tasks.append(t.model_dump())
            if len(tasks) > MAX_TASKS:
                raise ValueError("too many tasks")
            return {"tasks": tasks if len(tasks) > 1 else [], "summary": d.summary if len(tasks) > 1 else ""}
        except Exception as e:  # noqa: BLE001
            log.warning("decompose failed, running as one task: %s", e)
            return {"tasks": [], "summary": ""}

    async def plan(state: AgentState) -> AgentState:
        p = await llm.json(system=CHAT_SYSTEM, contents=_contents(state), schema=AgentPlan, temperature=0.3)
        return {"plan": p.model_dump(), "first_reply": p.reply, "attempts": 0, "applied": [], "applied_ops": [], "skipped": [], "failed": []}

    async def write(payload: dict[str, Any]) -> dict[str, Any]:
        """One task, start to finish, on its own copy of the CV: plan, validate, and repair. Several run at once, so this node
        never touches shared state; it returns the operations that worked and `merge` replays them in order."""
        idx, task = payload["idx"], payload["task"]
        cv = Resume.model_validate(payload["resume"])
        view = {"messages": payload["messages"], "memory": payload.get("memory", "")}
        applied_ops: list[dict[str, Any]] = []
        skipped: list[str] = []
        reply = ""
        try:
            async with gate:
                extra = None
                for attempt in range(MAX_REPAIRS + 1):
                    p = await llm.json(system=CHAT_SYSTEM, contents=_contents({**view, "resume": cv.model_dump(mode="json")}, extra, task), schema=AgentPlan, temperature=0.3 if attempt == 0 else 0.2)
                    reply = reply or p.reply
                    ops = to_ops(p)
                    if not ops:
                        break
                    res = apply_ops(cv, ops)
                    cv = res.resume
                    applied_ops += [o.model_dump(exclude_none=True) for o in res.applied_ops]
                    skipped = res.skipped  # only the latest round's failures matter: earlier ones were retried
                    if not res.failed:
                        break
                    failures = "\n".join(f"- {o.model_dump_json(exclude_none=True, exclude_defaults=True)}  →  {why}" for o, why in res.failed)
                    extra = REPAIR_NOTE.format(failures=failures)
        except Exception as e:  # noqa: BLE001  one failed part must not sink the others
            log.warning("task %s failed: %s", idx, e)
            skipped = [*skipped, f"“{task['instruction'][:60]}”: the assistant could not complete this part"]
        return {"results": [{"idx": idx, "applied_ops": applied_ops, "skipped": skipped, "reply": reply}]}

    async def merge(state: AgentState) -> AgentState:
        """Replay every writer's operations on the CV as it was, in task order, through the same validated engine."""
        results = sorted(state["results"], key=lambda r: r["idx"])
        res = _replay(state["resume"], [o for r in results for o in r["applied_ops"]])
        skipped = [*(x for r in results for x in r["skipped"]), *res.skipped]
        summary = state.get("summary", "")
        return {
            "resume": res.resume.model_dump(mode="json"),
            "applied": res.applied,
            "applied_ops": [o.model_dump(exclude_none=True) for o in res.applied_ops],
            "skipped": skipped,
            "failed": [],
            "plan": {"reply": summary, "ops": []},
            "first_reply": summary,
            "critic_rounds": 0,
        }

    async def critic(state: AgentState) -> AgentState:
        """Reads the whole result once, which no single writer could. Best effort: if it fails the result stands."""
        try:
            before, after = Resume.model_validate(state["original"]), Resume.model_validate(state["resume"])
            old = {s.id: s.model_dump() for s in before.sections}
            changed = [{"before": old.get(s.id), "after": s.model_dump()} for s in after.sections if old.get(s.id) != s.model_dump()]
            basics = {"before": before.basics.headline, "after": after.basics.headline} if before.basics.headline != after.basics.headline else None
            ask = f"REQUEST:\n{state['messages'][-1]['text']}\n\nCHANGED SECTIONS:\n{json.dumps(changed, ensure_ascii=False)}" + (f"\n\nHEADLINE: {json.dumps(basics, ensure_ascii=False)}" if basics else "")
            c = await llm.json(system=CRITIC_SYSTEM, contents=[{"role": "user", "parts": [ask]}], schema=Critique, temperature=0.0)
            return {"critique": c.model_dump(), "critic_rounds": state.get("critic_rounds", 0) + 1}
        except Exception as e:  # noqa: BLE001
            log.warning("critic failed, keeping the result: %s", e)
            return {"critique": {"ok": True, "problems": []}, "critic_rounds": state.get("critic_rounds", 0) + 1}

    async def revise(state: AgentState) -> AgentState:
        problems = "\n".join(f"- {x}" for x in state["critique"]["problems"])
        try:
            p = await llm.json(system=CHAT_SYSTEM, contents=_contents(state, REVISE_NOTE.format(problems=problems)), schema=AgentPlan, temperature=0.2)
            fixes = [o.model_dump(exclude_none=True) for o in to_ops(p)]
            # Replay everything on the original with repeated edits merged, so the proposal lists each change once.
            res = _replay(state["original"], [*state.get("applied_ops", []), *fixes])
            if res.failed or len(res.applied_ops) < len(coalesce([*state.get("applied_ops", []), *fixes])):
                raise ValueError("coalesced replay did not apply cleanly")
        except Exception as e:  # noqa: BLE001
            log.warning("revise failed, keeping the merged result: %s", e)
            return {}
        return {
            "resume": res.resume.model_dump(mode="json"),
            "applied": res.applied,
            "applied_ops": [o.model_dump(exclude_none=True) for o in res.applied_ops],
        }

    async def apply(state: AgentState) -> AgentState:
        ops = to_ops(AgentPlan.model_validate(state["plan"]))
        if not ops:  # nothing proposed: keep whatever failed earlier so it is still reported
            return {"failed": state.get("failed", [])}
        res = apply_ops(Resume.model_validate(state["resume"]), ops)
        return {
            "resume": res.resume.model_dump(mode="json"),
            "applied": [*state.get("applied", []), *res.applied],
            "applied_ops": [*state.get("applied_ops", []), *(o.model_dump(exclude_none=True) for o in res.applied_ops)],
            "skipped": res.skipped,
            "failed": [{"op": o.model_dump_json(exclude_none=True, exclude_defaults=True), "reason": why} for o, why in res.failed],
        }

    async def repair(state: AgentState) -> AgentState:
        failures = "\n".join(f"- {f['op']}  →  {f['reason']}" for f in state["failed"])
        p = await llm.json(system=CHAT_SYSTEM, contents=_contents(state, REPAIR_NOTE.format(failures=failures)), schema=AgentPlan, temperature=0.2)
        return {"plan": p.model_dump(), "attempts": state["attempts"] + 1}

    async def review(state: AgentState) -> AgentState:
        # Pauses the run here. The value is what the caller sees; the resume value is the user's decision.
        decision = interrupt(
            {
                "items": [{"index": i, "summary": s} for i, s in enumerate(state.get("applied", []))],
                "skipped": state.get("skipped", []),
                "reply": state.get("summary") or state["plan"].get("reply") or state.get("first_reply", ""),
            }
        )
        return {"decision": decision if isinstance(decision, dict) else {"accept": "all"}}

    async def finalize(state: AgentState) -> AgentState:
        accept = (state.get("decision") or {}).get("accept", "all")
        ops = state.get("applied_ops", [])
        if accept == "all":
            keep = list(range(len(ops)))
        elif accept == "none":
            keep = []
        else:
            keep = sorted({i for i in accept if isinstance(i, int) and 0 <= i < len(ops)})
        if len(keep) == len(ops):
            return {}
        # Re-apply only what was accepted to the CV as it was; replaying in order reproduces the same result for those ops.
        res = apply_ops(Resume.model_validate(state["original"]), [Op(**ops[i]) for i in keep])
        return {"resume": res.resume.model_dump(mode="json"), "applied": res.applied, "applied_ops": [o.model_dump(exclude_none=True) for o in res.applied_ops]}

    def after_route(state: AgentState) -> Literal["answer", "remember", "decompose"]:
        return {"answer": "answer", "remember": "remember"}.get(state.get("intent", ""), "decompose")

    def fan_out(state: AgentState) -> Any:
        """Several tasks: one `write` each, all at once. One task: the plain plan -> apply path."""
        if len(state.get("tasks", [])) < 2:
            return "plan"
        return [Send("write", {"idx": i, "task": t, "resume": state["resume"], "messages": state["messages"], "memory": state.get("memory", "")}) for i, t in enumerate(state["tasks"])]

    def finish(state: AgentState) -> Literal["review", "__end__"]:
        return "review" if state.get("mode") == "propose" and state.get("applied") else END

    def after_apply(state: AgentState) -> Literal["repair", "review", "__end__"]:
        return "repair" if needs_repair(state) else finish(state)

    def after_merge(state: AgentState) -> Literal["critic", "review", "__end__"]:
        return "critic" if use_critic and state.get("applied") else finish(state)

    def after_critic(state: AgentState) -> Literal["revise", "review", "__end__"]:
        return "revise" if not state["critique"]["ok"] and state["critique"]["problems"] else finish(state)

    g = StateGraph(AgentState)
    for name, fn in (("route", route), ("answer", answer), ("remember", remember), ("decompose", decompose), ("plan", plan), ("write", write), ("merge", merge), ("critic", critic), ("revise", revise), ("apply", apply), ("repair", repair), ("review", review), ("finalize", finalize)):
        g.add_node(name, fn)
    g.add_edge(START, "route")
    g.add_conditional_edges("route", after_route, {"answer": "answer", "remember": "remember", "decompose": "decompose"})
    g.add_edge("remember", END)
    g.add_edge("answer", END)
    g.add_conditional_edges("decompose", fan_out, ["plan", "write"])
    g.add_edge("plan", "apply")
    g.add_edge("write", "merge")
    g.add_conditional_edges("merge", after_merge, {"critic": "critic", "review": "review", END: END})
    g.add_conditional_edges("critic", after_critic, {"revise": "revise", "review": "review", END: END})
    g.add_conditional_edges("revise", finish, {"review": "review", END: END})
    g.add_conditional_edges("apply", after_apply, {"repair": "repair", "review": "review", END: END})
    g.add_edge("repair", "apply")
    g.add_edge("review", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)
