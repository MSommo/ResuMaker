"""Token usage per model call: turns the raw records of `make eval-usage` into the table and diagram labels of the README.

    python -m tests.evals.usage            print the table and the diagram
    python -m tests.evals.usage --write    also rewrite the README between its `usage:` markers

The records come from `GeminiLLM.usage` (Gemini's own `usage_metadata` of every call), so nothing here is typed in by hand.
"""

from __future__ import annotations

import json
import statistics
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
DATA = ROOT / "backend" / ".data" / "eval-usage.json"
README = ROOT / "README.md"

# USD per 1M tokens: model name -> (input, output incl. thinking), from https://ai.google.dev/gemini-api/docs/pricing.
# Left empty on purpose: the `-latest` aliases are hot-swapped, the pricing page does not say which model each one points to,
# so a price typed here could silently be for the wrong model. Fill it in (and PRICES_AS_OF) to get the cost table; until then it is omitted.
PRICES_AS_OF = ""
PRICES: dict[str, tuple[float, float]] = {}

# The nodes of the graph in reading order, then the calls outside it.
GRAPH_NODES = ["route", "answer", "remember", "decompose", "plan", "write", "merge", "critic", "revise", "apply", "repair", "review", "finalize"]
OTHER_CALLS = {"improve": "Improve text", "tailor_posting": "Tailor: posting analysis", "import": "Import a CV", "embed": "Memory embedding"}
PLAIN_CODE = {"merge", "apply", "review", "finalize"}


def k(n: float) -> str:
    return f"{n / 1000:.1f}k" if n >= 1000 else str(round(n))


def summarise(records: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    """(label, cv) -> typical (median) and worst (max) input and output tokens per call. Output counts thinking."""
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for r in records:
        groups.setdefault((r["label"], r["cv"]), []).append(r)
    out = {}
    for key, rs in groups.items():
        ins, outs = [r["input"] for r in rs], [r["output"] + r["thinking"] for r in rs]
        out[key] = {"model": rs[0]["model"], "calls": len(rs), "in": statistics.median(ins), "in_max": max(ins), "out": statistics.median(outs), "out_max": max(outs)}
    return out


def request_costs(records: list[dict[str, Any]]) -> dict[str, float]:
    """Cost in USD of each request (case id), summing every call it made."""
    cost: dict[str, float] = {}
    for r in records:
        pin, pout = PRICES.get(r["model"], (0.0, 0.0))
        cost[r["case"]] = cost.get(r["case"], 0.0) + (r["input"] * pin + (r["output"] + r["thinking"]) * pout) / 1e6
    return cost


def cell(s: dict[str, Any] | None) -> str:
    return "–" if not s else f"{k(s['in'])} / {k(s['out'])} (worst {k(s['in_max'])} / {k(s['out_max'])})"


def short(model: str) -> str:
    return {"gemini-flash-lite-latest": "flash-lite", "gemini-flash-latest": "flash", "gemini-embedding-001": "embedding"}.get(model, model)


def model_of(label: str, s: dict[tuple[str, str], dict[str, Any]]) -> str:
    return next((short(v["model"]) for (lab, _), v in s.items() if lab == label), "none" if label in PLAIN_CODE else "flash")  # unseen in this run (e.g. `repair`): it uses the main model


def table(data: dict[str, Any]) -> str:
    s = summarise(data["records"])
    rows = ["| Node / call | Model | System prompt | Normal CV: input / output per call | 10-job CV: input / output per call | Calls (normal / 10-job) |", "|---|---|---|---|---|---|"]
    for label in GRAPH_NODES + list(OTHER_CALLS):
        name = OTHER_CALLS.get(label, f"`{label}`")
        p = data["prompt_tokens"].get(label)
        n, b = s.get((label, "normal")), s.get((label, "big"))
        if label in PLAIN_CODE:
            rows.append(f"| {name} | none (plain code) | – | – | – | – |")
            continue
        rows.append(f"| {name} | {model_of(label, s)} | {k(p) if p else '–'} | {cell(n)} | {cell(b)} | {n['calls'] if n else 0} / {b['calls'] if b else 0} |")
    return "\n".join(rows)


def costs(data: dict[str, Any]) -> str:
    c = request_costs(data["records"])
    wanted = [("One edit (single task)", "headline"), ("Several small edits in one message", "multi-1"), ("Whole-CV rewrite (polish everything)", "polish-all"), ("Tailoring to a posting", "tailor"), ("Whole-CV rewrite, 10-job CV", "polish-all-big"), ("Tailoring, 10-job CV", "tailor-big")]
    rows = ["| Request | Calls | Cost (USD) |", "|---|---|---|"]
    calls: dict[str, int] = {}
    for r in data["records"]:
        calls[r["case"]] = calls.get(r["case"], 0) + 1
    for title, cid in wanted:
        if cid in c:
            rows.append(f"| {title} | {calls[cid]} | ${c[cid]:.4f} |")
    return "\n".join(rows)


def diagram(data: dict[str, Any]) -> str:
    s = summarise(data["records"])

    def label(n: str) -> str:
        if n in PLAIN_CODE:
            return n
        v = s.get((n, "normal"))
        return f"{n}<br/>{model_of(n, s)} · {k(v['in'])} in / {k(v['out'])} out" if v else n

    ids = {n: f'{n}["{label(n)}"]' for n in GRAPH_NODES}
    return f"""```mermaid
graph TD;
  START --> {ids['route']};
  route -->|question| {ids['answer']} --> END;
  route -->|remember| {ids['remember']} --> END;
  route -->|edit| {ids['decompose']};
  decompose -->|one task| {ids['plan']} --> {ids['apply']};
  decompose -->|several tasks, in parallel| {ids['write']} --> {ids['merge']} --> {ids['critic']};
  critic -->|problems| {ids['revise']};
  apply -->|all applied| END;
  apply -->|some failed, retries left| {ids['repair']} --> apply;
  apply -->|review mode| {ids['review']} --> {ids['finalize']} --> END;
```"""


def block(data: dict[str, Any]) -> str:
    n, b = len(data["cases"]["normal"]), len(data["cases"]["big"])
    cost_part = f"""

Gemini bills the whole input of every call, so a request costs the sum of its calls (single runs are noisy):

{costs(data)}

Prices as of {PRICES_AS_OF} (USD per 1M tokens, input / output): {", ".join(f"{short(m)} {a} / {b}" for m, (a, b) in PRICES.items())}.""" if PRICES else ""
    return f"""{diagram(data)}

Node labels show the model and the typical (median) input / output tokens of one call on the normal CV. Measured {data['date']} by `make eval-usage`: the `usage_metadata` of every real Gemini call over {n} editing tasks on the normal CV and {b} on the 10-job CV, plus the router, memory and tailoring checks. Output includes the model's thinking tokens, which are billed as output.

{table(data)}

"System prompt" is the fixed system prompt alone, by Gemini's token counter; the input of a call is that plus the CV, the conversation, memory and the response schema. "Worst" is the largest single call seen, not a bound (single runs are noisy). A request is several calls: for example a whole-CV rewrite is `route`, `decompose`, one `write` per task, then `critic`.{cost_part}"""


START, END = "<!-- usage:start -->", "<!-- usage:end -->"


def main() -> None:
    if not DATA.exists():
        sys.exit(f"{DATA} not found: run `make eval-usage` first (real Gemini, a few cents).")
    data = json.loads(DATA.read_text())
    text = block(data)
    print(text)
    if "--write" in sys.argv:
        md = README.read_text()
        a, z = md.find(START), md.find(END)
        if a < 0 or z < a:
            sys.exit(f"README.md has no {START} … {END} markers.")
        README.write_text(md[: a + len(START)] + "\n" + text + "\n" + md[z:])
        print(f"\nREADME.md updated.", file=sys.stderr)


if __name__ == "__main__":
    main()
