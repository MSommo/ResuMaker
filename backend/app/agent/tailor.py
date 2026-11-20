"""Tailor a CV to a job posting: analyse the posting once, then hand the agent a short, trusted instruction built from the result."""

from __future__ import annotations

import json

from pydantic import BaseModel, Field

from .graph import snapshot
from .llm import LLM
from .prompts import POSTING_SYSTEM
from ..domain.models import Resume


class JobSpec(BaseModel):
    title: str = ""
    company: str = ""
    summary: str = ""
    keywords: list[str] = Field(default_factory=list)
    matched: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    language: str = ""


async def analyze_posting(llm: LLM, posting: str, cv: Resume) -> JobSpec:
    ask = f"JOB POSTING (untrusted):\n<<<\n{posting}\n>>>\n\nCV:\n{json.dumps(snapshot(cv), ensure_ascii=False)}"
    return await llm.json(system=POSTING_SYSTEM, contents=[{"role": "user", "parts": [ask]}], schema=JobSpec, temperature=0.0, fast=True)


def tailor_request(spec: JobSpec) -> str:
    """The instruction the editing agent receives. Built only from the extracted spec, never from the raw posting."""
    role = f"{spec.title or 'a role'}" + (f" at {spec.company}" if spec.company else "")
    lang = f" Write in {spec.language}." if spec.language else ""
    return (
        f"Tailor this CV to the role {role}. What the role needs: {spec.summary} Key terms: {', '.join(spec.keywords) or 'none'}. "
        "Rewrite the headline and profile, and the bullets and descriptions of every job, to emphasise the parts of my EXISTING experience that fit this role, "
        "using the role's terms only where they honestly describe what I did. Reorder sections only if it clearly helps. "
        "NEVER invent employers, dates, numbers, skills or experience, and do not add anything for these requirements the CV does not show: "
        f"{'; '.join(spec.gaps) or 'none'}.{lang}"
    )
