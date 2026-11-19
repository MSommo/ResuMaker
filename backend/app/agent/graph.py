"""The CV-editing agent, as a LangGraph state machine.

        ┌──────┐   ┌───────┐  all ops applied   ┌─────┐
 START ─▶ plan ├──▶ apply ├───────────────────▶ END │
        └──────┘   └───┬───┘                    └─────┘
                       │ some ops failed (and retries left)
                   ┌───▼────┐
                   │ repair │  ← shows the model what failed and why, asks for corrected ops
                   └───┬────┘
                       └──────▶ apply

`plan` and `repair` call the LLM; `apply` is deterministic (the shared operations engine) and is what makes
the agent safe: the model only proposes, validated code decides what actually changes.
"""

from __future__ import annotations

import json
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, Field

from ..domain.catalog import LAYOUTS, TEMPLATES
from ..domain.models import Resume
from ..domain.ops import OP_NAMES, Op, apply_ops
from .llm import LLM
from .prompts import CHAT_SYSTEM, REPAIR_NOTE

MAX_REPAIRS = 2

# Human-readable description of each node, served with the graph drawing (GET /api/agent/graph?format=json).
NODE_DOCS = {
    "plan": "LLM call: reads the CV and the conversation, returns a reply plus structured edit operations.",
    "apply": "Deterministic: runs the operations through the validated engine; collects what was applied and what failed.",
    "repair": "LLM call: shows the model which operations failed and why, asks for corrected ones (max 2 rounds).",
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


def to_ops(plan: AgentPlan) -> list[Op]:
    return [Op(**{**o.model_dump(exclude={"patch"}), "patch": o.patch.model_dump(exclude_none=True)}) for o in plan.ops]


# ---------------------------------------------------------------- state


class AgentState(TypedDict, total=False):
    messages: list[dict[str, str]]   # chat history, last item = the user's new message
    resume: dict[str, Any]           # the CV as it is right now (updated by `apply`)
    plan: dict[str, Any]             # latest plan from the model
    first_reply: str
    applied: list[str]
    skipped: list[str]               # failures from the most recent apply round
    failed: list[dict[str, str]]     # the ops behind `skipped`, with reasons
    attempts: int


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


# ---------------------------------------------------------------- graph


def build_graph(llm: LLM | None):
    async def plan(state: AgentState) -> AgentState:
        p = await llm.json(system=CHAT_SYSTEM, contents=_contents(state), schema=AgentPlan, temperature=0.3)
        return {"plan": p.model_dump(), "first_reply": p.reply, "attempts": 0, "applied": [], "skipped": [], "failed": []}

    async def apply(state: AgentState) -> AgentState:
        ops = to_ops(AgentPlan.model_validate(state["plan"]))
        if not ops:  # nothing proposed: keep whatever failed earlier so it is still reported
            return {"failed": state.get("failed", []), "skipped": state.get("skipped", [])}
        res = apply_ops(Resume.model_validate(state["resume"]), ops)
        return {
            "resume": res.resume.model_dump(mode="json"),
            "applied": [*state.get("applied", []), *res.applied],
            "skipped": res.skipped,
            "failed": [{"op": o.model_dump_json(exclude_none=True, exclude_defaults=True), "reason": why} for o, why in res.failed],
        }

    async def repair(state: AgentState) -> AgentState:
        failures = "\n".join(f"- {f['op']}  →  {f['reason']}" for f in state["failed"])
        p = await llm.json(system=CHAT_SYSTEM, contents=_contents(state, REPAIR_NOTE.format(failures=failures)), schema=AgentPlan, temperature=0.2)
        return {"plan": p.model_dump(), "attempts": state["attempts"] + 1}

    def route(state: AgentState) -> Literal["repair", "__end__"]:
        has_ops = bool(state["plan"].get("ops"))
        return "repair" if has_ops and state.get("skipped") and state["attempts"] < MAX_REPAIRS else END

    g = StateGraph(AgentState)
    g.add_node("plan", plan)
    g.add_node("apply", apply)
    g.add_node("repair", repair)
    g.add_edge(START, "plan")
    g.add_edge("plan", "apply")
    g.add_conditional_edges("apply", route, {"repair": "repair", END: END})
    g.add_edge("repair", "apply")
    return g.compile()
