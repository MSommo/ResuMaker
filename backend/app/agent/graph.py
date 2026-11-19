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

import json
import logging
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from pydantic import BaseModel, Field

from ..domain.catalog import LAYOUTS, TEMPLATES
from ..domain.models import Resume
from ..domain.ops import OP_NAMES, Op, apply_ops
from .llm import LLM
from .prompts import ANSWER_SYSTEM, CHAT_SYSTEM, REPAIR_NOTE, ROUTER_SYSTEM

log = logging.getLogger("resumaker.agent")

MAX_REPAIRS = 2

# Human-readable description of each node, served with the graph drawing (GET /api/agent/graph?format=json).
NODE_DOCS = {
    "route": "Cheap-model LLM call: is this message a question (answer) or a request to change the CV (edit)? Defaults to edit.",
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

    intent: Literal["answer", "edit"]
    reason: str = ""


def to_ops(plan: AgentPlan) -> list[Op]:
    return [Op(**{**o.model_dump(exclude={"patch"}), "patch": o.patch.model_dump(exclude_none=True)}) for o in plan.ops]


# ---------------------------------------------------------------- state


class AgentState(TypedDict, total=False):
    messages: list[dict[str, str]]   # chat history, last item = the user's new message
    resume: dict[str, Any]           # the CV as it is right now (updated by `apply`)
    original: dict[str, Any]         # the CV when the run started, to re-apply only the accepted changes
    mode: str                        # "apply" (change the CV) or "propose" (pause for review first)
    base_version: int                # the CV's version when the run started (optimistic locking at commit time)
    intent: str                      # route: "answer" | "edit"
    answer: str                      # the reply, for questions
    plan: dict[str, Any]             # latest plan from the model
    first_reply: str
    applied: list[str]
    applied_ops: list[dict[str, Any]]  # the ops behind `applied`, same order (reviewed one by one)
    skipped: list[str]               # failures from the most recent apply round
    failed: list[dict[str, str]]     # the ops behind `skipped`, with reasons
    attempts: int
    decision: dict[str, Any]         # the user's answer at `review`: {"accept": "all" | "none" | [indices]}


def needs_repair(state: AgentState) -> bool:
    """After `apply`: did something fail that the model could still fix?"""
    return bool(state["plan"].get("ops")) and bool(state.get("skipped")) and state["attempts"] < MAX_REPAIRS


def catalog() -> dict[str, Any]:
    return {
        "layouts": [{"id": l.id, "name": l.name, "zones": [{"id": z.id, "label": z.label, "accepts": sorted(z.accepts)} for z in l.zones]} for l in LAYOUTS.values()],
        "templates": [{"id": t.id, "label": t.label, "kind": t.kind} for t in TEMPLATES],
    }


def snapshot(r: Resume) -> dict[str, Any]:
    """Compact, id-carrying view of the CV for the model. Basics are flattened to match the update_basics patch."""
    b = r.basics.model_dump()
    addr = b.pop("address")
    return {"layoutId": r.layoutId, "basics": {**b, **addr}, "sections": [s.model_dump() for s in r.sections]}


def _contents(state: AgentState, extra: str | None = None) -> list[dict[str, Any]]:
    turns = state["messages"][-14:]
    out: list[dict[str, Any]] = []
    for i, m in enumerate(turns):
        role = "model" if m["role"] == "assistant" else "user"
        if i == len(turns) - 1 and role == "user":
            ctx = f"CATALOG (layouts, zones, templates):\n{json.dumps(catalog())}\n\nCURRENT CV STATE:\n{json.dumps(snapshot(Resume.model_validate(state['resume'])), ensure_ascii=False)}"
            out.append({"role": "user", "parts": [ctx, m["text"], *([extra] if extra else [])]})
        else:
            out.append({"role": role, "parts": [m["text"]]})
    return out


def _route_contents(state: AgentState) -> list[dict[str, Any]]:
    """The last few turns as plain text (no CV): enough to understand "yes, do it", cheap enough for the fast model."""
    turns = state["messages"][-4:]
    return [{"role": "model" if m["role"] == "assistant" else "user", "parts": [m["text"]]} for m in turns]


# ---------------------------------------------------------------- graph


def build_graph(llm: LLM | None, checkpointer: Any = None):
    """`checkpointer` makes runs durable: required for `review` to pause and resume (propose mode)."""

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
        text = await llm.text(system=ANSWER_SYSTEM, prompt=f"CURRENT CV STATE:\n{cv}\n\nCONVERSATION:\n{convo}", temperature=0.4)
        return {"answer": text.strip(), "applied": [], "applied_ops": [], "skipped": []}

    async def plan(state: AgentState) -> AgentState:
        p = await llm.json(system=CHAT_SYSTEM, contents=_contents(state), schema=AgentPlan, temperature=0.3)
        return {"plan": p.model_dump(), "first_reply": p.reply, "attempts": 0, "applied": [], "applied_ops": [], "skipped": [], "failed": []}

    async def apply(state: AgentState) -> AgentState:
        ops = to_ops(AgentPlan.model_validate(state["plan"]))
        if not ops:  # nothing proposed: keep whatever failed earlier so it is still reported
            return {"failed": state.get("failed", []), "skipped": state.get("skipped", [])}
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
                "reply": state["plan"].get("reply") or state.get("first_reply", ""),
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

    def after_route(state: AgentState) -> Literal["answer", "plan"]:
        return "answer" if state.get("intent") == "answer" else "plan"

    def after_apply(state: AgentState) -> Literal["repair", "review", "__end__"]:
        if needs_repair(state):
            return "repair"
        if state.get("mode") == "propose" and state.get("applied"):
            return "review"
        return END

    g = StateGraph(AgentState)
    for name, fn in (("route", route), ("answer", answer), ("plan", plan), ("apply", apply), ("repair", repair), ("review", review), ("finalize", finalize)):
        g.add_node(name, fn)
    g.add_edge(START, "route")
    g.add_conditional_edges("route", after_route, {"answer": "answer", "plan": "plan"})
    g.add_edge("answer", END)
    g.add_edge("plan", "apply")
    g.add_conditional_edges("apply", after_apply, {"repair": "repair", "review": "review", END: END})
    g.add_edge("repair", "apply")
    g.add_edge("review", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)
