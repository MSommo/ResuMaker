"""Live evaluation of the editing agent against real Gemini. Opt-in: `make eval-agent`. Writes backend/.data/eval-report.json."""

import json
import os
import time
from pathlib import Path

import pytest

from app.agent.graph import build_graph
from app.agent.llm import GeminiLLM
from app.domain.catalog import sample_resume
from app.domain.models import Resume
from tests.evals.cases import CASES

pytestmark = pytest.mark.live
MIN_PASS = float(os.environ.get("EVAL_MIN_PASS", "0.8"))


async def test_agent_eval():
    key = os.environ.get("REAL_GEMINI_API_KEY", "")
    if not key:
        pytest.skip("needs a real GEMINI_API_KEY")
    llm = GeminiLLM(key, os.environ.get("GEMINI_MODEL", "gemini-flash-latest"), "gemini-flash-lite-latest")
    graph = build_graph(llm)
    rows = []
    for c in CASES:
        before = sample_resume()
        data = before.model_dump(mode="json")
        t0 = time.time()
        try:
            out = await graph.ainvoke({"messages": [{"role": "user", "text": c.message}], "resume": data, "original": data, "mode": "apply", "base_version": 1})
            after = Resume.model_validate(out["resume"])
            ok, err = bool(c.check(before, after)), ""
            applied, skipped, repairs = len(out.get("applied", [])), len(out.get("skipped", [])), out.get("attempts", 0)
        except Exception as e:  # noqa: BLE001
            ok, err, applied, skipped, repairs = False, f"{type(e).__name__}: {e}"[:200], 0, 0, 0
        rows.append({"id": c.id, "tags": c.tags, "pass": ok, "applied": applied, "skipped": skipped, "repairs": repairs, "seconds": round(time.time() - t0, 1), "error": err})
    n = len(rows)
    multi = [r for r in rows if "multi" in r["tags"]]
    whole = [r for r in rows if "whole" in r["tags"]]
    summary = {
        "pass_rate": sum(r["pass"] for r in rows) / n,
        "multi_pass_rate": sum(r["pass"] for r in multi) / len(multi),
        "whole_cv_pass_rate": sum(r["pass"] for r in whole) / len(whole),
        "avg_seconds": round(sum(r["seconds"] for r in rows) / n, 1),
        "repairs": sum(r["repairs"] for r in rows),
    }
    report = Path(__file__).resolve().parents[2] / ".data" / "eval-report.json"
    report.parent.mkdir(exist_ok=True)
    report.write_text(json.dumps({"summary": summary, "cases": rows}, indent=2))
    print("\n" + "\n".join(f"{'PASS' if r['pass'] else 'FAIL'} {r['id']:<15} applied={r['applied']} skipped={r['skipped']} repairs={r['repairs']} {r['seconds']}s {r['error']}" for r in rows))
    print(summary)
    assert summary["pass_rate"] >= MIN_PASS
