"""Golden set for the router, against the REAL fast model. Excluded from normal runs: `make eval-router`."""

import os

import pytest

from app.agent.graph import Route
from app.agent.llm import GeminiLLM
from app.agent.prompts import ROUTER_SYSTEM

pytestmark = pytest.mark.live

QUESTIONS = [
    "Is my profile too long?", "What do you think of my skills section?", "How could I make this CV stronger?",
    "Which job is my most relevant one?", "Does my CV have any typos?", "Should I include my birth date?",
    "Why did you change my headline?", "Is this layout good for a designer role?", "How many years of experience do I list?",
    "What does ATS mean?",
]
EDITS = [
    "Tighten my profile to 3 sentences", "Add a skill: Docker, level 4", "Translate the whole CV to Italian",
    "Rewrite my latest job's bullets to be more impactful", "Remove the hobbies section", "Change my headline to Staff Engineer",
    "Switch to the timeline layout", "Move Skills to the top", "Fix the typos", "Make it shorter",
]
REMEMBERS = [
    "Remember that I prefer short bullets", "Always write my CV in British English", "Note that my title at Acme was Staff Engineer",
    "From now on keep every bullet under 12 words", "Remember I never want buzzwords like synergy", "Please remember that I was promoted in 2022",
]
EDITS += ["Shorten my bullets and always keep them short", "Rewrite my profile and remember that I like a formal tone"]  # a change now beats "remember"
MIN_ACCURACY = 0.9


async def test_router_golden_set():
    key = os.environ.get("REAL_GEMINI_API_KEY", "")
    if not key:
        pytest.skip("needs a real GEMINI_API_KEY")
    llm = GeminiLLM(key, os.environ.get("GEMINI_MODEL", "gemini-flash-latest"), "gemini-flash-lite-latest")
    wrong = []
    for text, want in [(q, "answer") for q in QUESTIONS] + [(e, "edit") for e in EDITS] + [(r, "remember") for r in REMEMBERS]:
        r = await llm.json(system=ROUTER_SYSTEM, contents=[{"role": "user", "parts": [text]}], schema=Route, temperature=0.0, fast=True)
        if r.intent != want:
            wrong.append((text, want, r.intent))
    total = len(QUESTIONS) + len(EDITS) + len(REMEMBERS)
    acc = 1 - len(wrong) / total
    print(f"\nrouter accuracy {acc:.0%} ({total - len(wrong)}/{total}); misses: {wrong}")
    assert acc >= MIN_ACCURACY, wrong
