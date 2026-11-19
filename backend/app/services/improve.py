from __future__ import annotations

import re
from typing import Any

from ..agent.prompts import IMPROVE_SYSTEM, KIND_RULES
from ..cache import digest
from ..infra import Infra

SINGLE_LINE = {"headline", "bullet", "subheading", "note"}


def build_prompt(kind: str, text: str, instruction: str, context: dict[str, Any]) -> str:
    ctx = "\n".join(
        line
        for line in (
            context.get("headline") and f"Person's headline: {context['headline']}",
            context.get("section") and f"CV section: {context['section']}",
            context.get("role") and f"Role/title: {context['role']}",
            context.get("organisation") and f"Organisation: {context['organisation']}",
        )
        if line
    )
    parts = [
        f"Field type: {kind}. {KIND_RULES[kind]}",
        f"Context (do not repeat it unless relevant):\n{ctx}" if ctx else "",
        f"Extra instruction: {instruction.strip()[:300]}" if instruction.strip() else "",
        f'Text to rewrite:\n"""\n{text}\n"""',
    ]
    return "\n\n".join(p for p in parts if p)


def clean(out: str, kind: str, original: str) -> str:
    out = out.strip()
    out = re.sub(r"^```[a-z]*\n?", "", out, flags=re.I)
    out = re.sub(r"\n?```$", "", out).strip()
    if re.fullmatch(r'(["“]).*(["”])', out, flags=re.S) and not re.match(r'["“]', original.strip()):
        out = out[1:-1].strip()
    if kind == "bullet":
        out = re.sub(r"^[-•*]\s+", "", out)
    if kind in SINGLE_LINE:
        out = re.sub(r"\s*\n\s*", " ", out)
    return out


async def improve_text(infra: Infra, *, kind: str, text: str, instruction: str = "", context: dict[str, Any] | None = None) -> tuple[str, bool]:
    """Returns (suggestion, served_from_cache). Identical requests are answered from Redis without calling Gemini."""
    if infra.llm is None:
        raise RuntimeError("AI is not configured")
    kind = kind if kind in KIND_RULES else "text"
    context = context or {}
    key = "improve:v1:" + digest(infra.settings.gemini_model, kind, text, instruction.strip(), context)
    if (hit := await infra.cache.get(key)) is not None:
        return hit.decode(), True
    out = await infra.llm.text(system=IMPROVE_SYSTEM, prompt=build_prompt(kind, text, instruction, context), temperature=0.5)
    out = clean(out, kind, text)
    await infra.cache.set(key, out, infra.settings.improve_cache_ttl)
    return out, False
