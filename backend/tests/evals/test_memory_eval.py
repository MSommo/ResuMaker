"""Live eval of memory (real Gemini, opt-in: `make eval-memory`): useful, and never stronger than the CV."""

import os

import pytest

from app.agent.graph import Memo, build_graph
from app.agent.llm import GeminiLLM
from app.agent.prompts import MEMORY_SYSTEM
from app.domain.catalog import sample_resume
from app.domain.models import Resume
from app.services.memory import DUPLICATE_DISTANCE, RELEVANT_DISTANCE
from tests.evals.cases import jobs

pytestmark = pytest.mark.live


def dist(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    return 1 - dot / ((sum(x * x for x in a) ** 0.5) * (sum(y * y for y in b) ** 0.5))


def llm():
    key = os.environ.get("REAL_GEMINI_API_KEY", "")
    if not key:
        pytest.skip("needs a real GEMINI_API_KEY")
    return GeminiLLM(key, os.environ.get("GEMINI_MODEL", "gemini-flash-latest"), "gemini-flash-lite-latest")


async def test_embeddings_separate_related_from_unrelated_at_our_thresholds():
    m = llm()
    fact = "Was Staff Engineer at Acme from 2021, leading the payments platform."
    related = ["Update my headline to Staff Engineer at Acme", "Rewrite my payments platform experience", "What did I do at Acme?"]
    unrelated = ["Add a skill: Docker", "Translate the CV to Italian", "Move the hobbies section to the end"]
    [f] = await m.embed([fact])
    rel = [dist(f, v) for v in await m.embed(related, query=True)]
    unrel = [dist(f, v) for v in await m.embed(unrelated, query=True)]
    paraphrase = dist(f, (await m.embed(["He was a Staff Engineer at Acme starting 2021 and led the payments platform."]))[0])
    print(f"\nrelated {[round(x, 2) for x in rel]}  unrelated {[round(x, 2) for x in unrel]}  paraphrase {paraphrase:.2f}")
    assert max(rel) <= RELEVANT_DISTANCE, f"related facts must be found (threshold {RELEVANT_DISTANCE}): {rel}"
    assert min(unrel) > RELEVANT_DISTANCE, f"unrelated facts must be left out: {unrel}"
    assert paraphrase < DUPLICATE_DISTANCE, f"a paraphrase of the same fact should count as a duplicate: {paraphrase}"


async def test_remember_extraction():
    m = llm()
    cases = {
        "Remember that I prefer short bullets": ("preference", ["short", "bullet"]),
        "Note that my title at Acme was Staff Engineer": ("fact", ["staff engineer", "acme"]),
    }
    for text, (kind, words) in cases.items():
        r = await m.json(system=MEMORY_SYSTEM, contents=[{"role": "user", "parts": [text]}], schema=Memo, temperature=0.0, fast=True)
        assert r.ok and r.kind == kind and all(w in r.text.lower() for w in words), (text, r)
    vague = await m.json(system=MEMORY_SYSTEM, contents=[{"role": "user", "parts": ["remember"]}], schema=Memo, temperature=0.0, fast=True)
    assert not vague.ok


async def run(m, message, memory):
    before = sample_resume()
    d = before.model_dump(mode="json")
    out = await build_graph(m).ainvoke({"messages": [{"role": "user", "text": message}], "resume": d, "original": d, "mode": "apply", "base_version": 1, "memory": memory})
    return before, Resume.model_validate(out["resume"])


async def test_a_preference_changes_the_output():
    m = llm()
    _, after = await run(m, "Rewrite the bullets of my most recent job", "- Preference: Wants every bullet under 9 words.")
    words = [len(b.split()) for b in jobs(after)[0].bullets if not b.startswith("#")]
    assert words and max(words) <= 12, f"bullets should follow the 'under 9 words' preference (slack to 12): {words}"


async def test_a_wrong_memory_never_overrides_the_cv():
    m = llm()
    memory = "- Fact the person confirmed: Was Chief Wizard at Globex.\n- Preference: Likes a confident tone."
    before, after = await run(m, "Improve the wording of my profile", memory)
    assert "chief wizard" not in str(after.model_dump()).lower(), "a remembered fact must not be added to the CV unasked"
    assert [j.title for j in jobs(after)] == [j.title for j in jobs(before)], "job titles come from the CV, not memory"
