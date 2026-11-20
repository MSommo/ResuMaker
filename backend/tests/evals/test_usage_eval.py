"""Token usage per model call, measured live (real Gemini, opt-in: `make eval-usage`). Writes backend/.data/eval-usage.json;
`make usage-table` turns it into the README's table. Pass/fail of the edits is `make eval-agent`'s job; this only measures."""

import datetime
import json
import os

import pytest

from app.agent.graph import build_graph
from app.agent.llm import GeminiLLM, call_label
from app.agent import prompts as P
from app.agent.tailor import analyze_posting
from app.domain.catalog import sample_resume
from app.services.cv_import import parse_cv
from tests.evals.cases import CASES, big_resume
from tests.evals.usage import DATA

pytestmark = pytest.mark.live

# label -> (system prompt, uses the fast model)
PROMPTS = {
    "route": (P.ROUTER_SYSTEM, True), "answer": (P.ANSWER_SYSTEM, False), "remember": (P.MEMORY_SYSTEM, True), "decompose": (P.DECOMPOSE_SYSTEM, True),
    "plan": (P.CHAT_SYSTEM, False), "write": (P.CHAT_SYSTEM, False), "revise": (P.CHAT_SYSTEM, False), "repair": (P.CHAT_SYSTEM, False),
    "critic": (P.CRITIC_SYSTEM, False), "improve": (P.IMPROVE_SYSTEM, False), "tailor_posting": (P.POSTING_SYSTEM, True), "import": (P.IMPORT_SYSTEM, False),
}
EXTRA_MESSAGES = [  # what the editing cases do not reach: questions and "remember"
    ("answer", "Is my profile too long?"), ("answer", "Which job is my most relevant one?"),
    ("remember", "Remember that I prefer short bullets"), ("remember", "Note that my title at Acme was Staff Engineer"),
]
POSTING = "Senior Backend Engineer. You will design event-driven backend systems on cloud infrastructure, write TypeScript, test thoroughly and mentor engineers."
CV_HTML = b"<html><body><h1>Jane Doe</h1><p>Backend engineer, Turin, Italy. jane@example.com</p><h2>Experience</h2><h3>Engineer, Acme (2019-2023)</h3><ul><li>Built payment services in Go</li><li>Cut deploy time by 40%</li></ul><h2>Skills</h2><p>Go, Python, Docker</p></body></html>"


async def test_usage_eval():
    key = os.environ.get("REAL_GEMINI_API_KEY", "")
    if not key:
        pytest.skip("needs a real GEMINI_API_KEY")
    llm = GeminiLLM(key, os.environ.get("GEMINI_MODEL", "gemini-flash-latest"), "gemini-flash-lite-latest")
    llm.usage = []
    graph = build_graph(llm)
    records: list[dict] = []

    def collect(case: str, cv: str) -> None:
        records.extend({**r, "case": case, "cv": cv} for r in llm.usage)
        llm.usage.clear()

    async def run(message: str, resume) -> None:
        data = resume.model_dump(mode="json")
        await graph.ainvoke({"messages": [{"role": "user", "text": message}], "resume": data, "original": data, "mode": "apply", "base_version": 1})

    cases = {"normal": [], "big": []}
    for c in CASES:
        cv = "big" if c.big else "normal"
        cases[cv].append(c.id)
        try:
            await run(c.message, big_resume() if c.big else sample_resume())
        except Exception as e:  # noqa: BLE001 - a failed task still spent tokens; what it spent is kept
            print(f"{c.id}: {type(e).__name__}: {e}"[:200])
        collect(c.id, cv)

    for label, message in EXTRA_MESSAGES:
        await run(message, sample_resume())
        collect(f"{label}:{message[:20]}", "normal")

    # Calls outside the graph: each tagged as its service would be.
    for label, call in (
        ("improve", lambda: llm.text(system=P.IMPROVE_SYSTEM, prompt="Improve this bullet: worked on payment services and made deploys faster", temperature=0.5)),
        ("tailor_posting", lambda: analyze_posting(llm, POSTING, sample_resume())),
        ("import", lambda: parse_cv(llm, CV_HTML)),
        ("embed", lambda: llm.embed(["Was Staff Engineer at Acme from 2021, leading the payments platform."])),
        ("embed", lambda: llm.embed(["Rewrite my payments platform experience"], query=True)),
    ):
        token = call_label.set(label)
        try:
            await call()
        finally:
            call_label.reset(token)
        collect(label, "normal")

    prompt_tokens = {label: await llm.count_tokens(system, fast=fast) for label, (system, fast) in PROMPTS.items()}
    DATA.parent.mkdir(exist_ok=True)
    DATA.write_text(json.dumps({"date": datetime.date.today().isoformat(), "prompt_tokens": prompt_tokens, "cases": cases, "records": records}, indent=2))
    print(f"\n{len(records)} model calls recorded -> {DATA}; run `make usage-table`")
    assert records, "no usage was recorded"
