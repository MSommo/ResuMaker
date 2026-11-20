"""What an AI request used: the single place every AI path reports to (issues #24 and #25).

A *scope* is one thing a person asked the AI to do: a chat turn, an Improve, a tailoring run, a CV import, a memory added by
hand, or the same through MCP. `services/ai_usage.track()` opens one around the work and stores it as one `ai_usage` row
when the work ends; the metrics (`observability.metrics`) are fed from here too.

Inside a scope, every model call goes through `Metered` (wrapped around the LLM in `Infra.start`), which adds the model,
tokens, latency and outcome of the call, and the graph node that made it. The graph and services add what only they know:
the router's intent, ops applied and rejected, contact-guard rejections, repair and critic rounds.

Only metadata lives here, never prompt, CV or chat text. Nothing in this module talks to the database or the network.
"""

from __future__ import annotations

import time
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Callable

FEATURES = ("chat", "improve", "tailor", "import", "memory")
SOURCES = ("web", "mcp")


@dataclass
class Call:
    model: str
    node: str | None  # the graph node that made the call (None outside the graph: improve, import, ...)
    kind: str  # "generate" | "embed"
    input_tokens: int
    output_tokens: int
    ms: float
    ok: bool


@dataclass
class Scope:
    user_id: uuid.UUID
    feature: str
    source: str = "web"
    resume_id: uuid.UUID | None = None
    request_id: str | None = None
    started: float = field(default_factory=time.monotonic)
    calls: list[Call] = field(default_factory=list)
    intent: str | None = None  # the router's: edit | answer | remember | off_topic
    status: str = "ok"  # ok | error | rejected
    reason: str | None = None  # why not ok: llm_error, conflict, error, rate_limit, daily_limit, not_entitled
    ops_applied: int = 0
    ops_rejected: int = 0
    guard_rejections: int = 0  # ops refused by the contact guard (a link, email or phone number nobody provided)
    repairs: int = 0
    critic_rounds: int = 0

    @property
    def input_tokens(self) -> int:
        return sum(c.input_tokens for c in self.calls)

    @property
    def output_tokens(self) -> int:
        return sum(c.output_tokens for c in self.calls)

    @property
    def latency_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)

    def by_model(self) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = {}
        for c in self.calls:
            m = out.setdefault(c.model, {"calls": 0, "input": 0, "output": 0, "errors": 0})
            m["calls"] += 1
            m["input"] += c.input_tokens
            m["output"] += c.output_tokens
            m["errors"] += 0 if c.ok else 1
        return out

    @property
    def model(self) -> str | None:
        """The model that did most of the work (most tokens, then most calls): what a one-line summary shows. In a chat
        turn that's the planner, not the cheap router that made more, smaller calls."""
        models = self.by_model()
        return max(models, key=lambda k: (models[k]["input"] + models[k]["output"], models[k]["calls"])) if models else None


_scope: ContextVar[Scope | None] = ContextVar("ai_usage_scope", default=None)
_node: ContextVar[str | None] = ContextVar("ai_graph_node", default=None)
_tokens: ContextVar[tuple[int, int] | None] = ContextVar("ai_call_tokens", default=None)

# Telemetry hooks: called for every model call / finished scope (metrics, traces). Kept as plain callbacks so this module
# has no dependencies and tests run without any exporter.
on_call: list[Callable[[Scope | None, Call], None]] = []
on_scope_end: list[Callable[[Scope], None]] = []


def current() -> Scope | None:
    return _scope.get()


def enter(scope: Scope) -> Any:
    return _scope.set(scope)


def leave(token: Any) -> None:
    try:
        _scope.reset(token)
    except ValueError:  # a streaming response may finish in another context; the scope object is done either way
        _scope.set(None)


def node_name() -> str | None:
    return _node.get()


def in_node(name: str) -> Any:
    return _node.set(name)


def out_of_node(token: Any) -> None:
    try:
        _node.reset(token)
    except ValueError:
        _node.set(None)


def report_tokens(input_tokens: int | None, output_tokens: int | None) -> None:
    """Called by an LLM implementation just before it returns: how many tokens the provider says the call used."""
    _tokens.set((int(input_tokens or 0), int(output_tokens or 0)))


def _take_tokens() -> tuple[int, int]:
    t = _tokens.get() or (0, 0)
    _tokens.set(None)
    return t


def set_intent(intent: str) -> None:
    if (s := current()) is not None:
        s.intent = intent


def guard_rejected() -> None:
    if (s := current()) is not None:
        s.guard_rejections += 1


def count_node(name: str) -> None:
    if (s := current()) is not None:
        if name == "repair":
            s.repairs += 1
        elif name == "critic":
            s.critic_rounds += 1


def set_ops(applied: int, rejected: int) -> None:
    if (s := current()) is not None:
        s.ops_applied, s.ops_rejected = applied, rejected


def finish(scope: Scope) -> None:
    for fn in on_scope_end:
        try:
            fn(scope)
        except Exception:  # noqa: BLE001  telemetry must never break a request
            pass


class Metered:
    """Wraps an LLM (Gemini, or the test fake): every call is timed and added to the current scope with its model and node.
    Everything else (attributes the tests script, `model`, ...) passes through to the wrapped object."""

    def __init__(self, inner: Any):
        object.__setattr__(self, "inner", inner)

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    # Setting (or a test monkeypatching) an attribute changes the wrapped LLM, so calls stay metered. Restoring one of our
    # own methods just removes the override from the wrapped object.
    def __setattr__(self, name: str, value: Any) -> None:
        if getattr(value, "__self__", None) is self:
            self.inner.__dict__.pop(name, None)
        else:
            setattr(self.inner, name, value)

    def __delattr__(self, name: str) -> None:
        self.inner.__dict__.pop(name, None)

    def _model(self, kind: str, fast: bool = False) -> str:
        if kind == "embed":
            return getattr(self.inner, "embedding_model", None) or type(self.inner).__name__
        main = getattr(self.inner, "model", None) or type(self.inner).__name__
        return (getattr(self.inner, "fast_model", None) or main) if fast else main

    async def _run(self, kind: str, model: str, coro: Any) -> Any:
        _tokens.set(None)
        t0 = time.monotonic()
        ok = False
        try:
            out = await coro
            ok = True
            return out
        finally:
            tin, tout = _take_tokens()
            call = Call(model=model, node=node_name(), kind=kind, input_tokens=tin, output_tokens=tout, ms=(time.monotonic() - t0) * 1000, ok=ok)
            s = current()
            if s is not None:
                s.calls.append(call)
            for fn in on_call:
                try:
                    fn(s, call)
                except Exception:  # noqa: BLE001
                    pass

    async def text(self, *, system: str, prompt: str, temperature: float = 0.5, fast: bool = False) -> str:
        return await self._run("generate", self._model("generate", fast), self.inner.text(system=system, prompt=prompt, temperature=temperature, fast=fast))

    async def json(self, *, system: str, contents: list[dict[str, Any]], schema: Any, temperature: float = 0.3, fast: bool = False) -> Any:
        return await self._run("generate", self._model("generate", fast), self.inner.json(system=system, contents=contents, schema=schema, temperature=temperature, fast=fast))

    async def embed(self, texts: list[str], *, query: bool = False) -> list[list[float]]:
        return await self._run("embed", self._model("embed"), self.inner.embed(texts, query=query))
