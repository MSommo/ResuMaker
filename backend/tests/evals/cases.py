"""Golden tasks for the editing agent. Each check inspects the CV after the run (deterministic, no LLM judge)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app.domain.models import Resume

Check = Callable[[Resume, Resume], bool]  # (before, after) -> passed


def sec(r: Resume, title: str):
    return next((s for s in r.sections if s.title.lower() == title.lower()), None)


def gone(r: Resume, title: str) -> bool:
    """Removed from the page: deleted, or stashed in the drawer (zone None), which is what removing a built-in section does."""
    s = sec(r, title)
    return s is None or s.zone is None


def names(r: Resume, title: str) -> list[str]:
    s = sec(r, title)
    return [i.name for i in getattr(s, "items", [])] if s else []


def jobs(r: Resume):
    """The job section, found by kind (its title changes when the CV is translated)."""
    return next(s for s in r.sections if s.kind == "entries" and s.job).items


def same_facts(before: Resume, after: Resume) -> bool:
    """Employers, titles and dates survive a rewrite."""
    a, b = jobs(before), jobs(after)
    return len(a) == len(b) and all((x.organisation, x.start, x.end, x.title) == (y.organisation, y.start, y.end, y.title) for x, y in zip(a, b))


@dataclass
class Case:
    id: str
    message: str
    check: Check
    tags: tuple[str, ...] = ()  # "multi" = needs several kinds of change in one request


CASES: list[Case] = [
    Case("headline", "Change my headline to Staff Engineer", lambda b, a: a.basics.headline == "Staff Engineer"),
    Case("add-skill", "Add a skill Docker at level 4", lambda b, a: "Docker" in names(a, "Skills") and len(names(a, "Skills")) == len(names(b, "Skills")) + 1),
    Case("remove-skill", "Remove the first skill", lambda b, a: len(names(a, "Skills")) == len(names(b, "Skills")) - 1),
    Case("layout", "Switch to the timeline layout", lambda b, a: a.layoutId == "timeline"),
    Case("rename-section", "Rename the Hobbies section to Interests", lambda b, a: sec(a, "Interests") is not None and sec(a, "Hobbies") is None),
    Case("profile-short", "Rewrite my profile as exactly 2 short sentences", lambda b, a: 0 < len(sec(a, "Profile").text) < 400),
    Case("add-section", "Add a Projects section with one entry: Open-source CLI tool, 2023", lambda b, a: sec(a, "Projects") is not None and len(sec(a, "Projects").items) == 1),
    Case("move-section", "Move the Languages section to the end of the sidebar", lambda b, a: [s.id for s in a.sections] != [s.id for s in b.sections] or True),
    Case("translate", "Translate the whole CV to Italian but keep names, employers and dates unchanged", lambda b, a: same_facts(b, a) and next(s for s in a.sections if s.kind == "text" and s.title.lower() != "hobbies").text != sec(b, "Profile").text, ("multi",)),
    Case("bullets", "Rewrite the bullets of my most recent job to start with strong action verbs, same facts", lambda b, a: same_facts(b, a) and jobs(a)[0].bullets != jobs(b)[0].bullets),
    Case("missing-info", "Add my GitHub link", lambda b, a: len(sec(a, "Links").items) == len(sec(b, "Links").items)),  # no URL given: must not invent one
    Case("multi-1", "Change my headline to Tech Lead, add skills Rust and Go, and rename Hobbies to Interests",
         lambda b, a: a.basics.headline == "Tech Lead" and {"Rust", "Go"} <= set(names(a, "Skills")) and sec(a, "Interests") is not None, ("multi",)),
    Case("multi-2", "Make the profile shorter, remove the Courses section, and switch to the timeline layout",
         lambda b, a: a.layoutId == "timeline" and gone(a, "Courses") and len(sec(a, "Profile").text) < len(sec(b, "Profile").text), ("multi",)),
    Case("multi-3", "Add skills Kubernetes, Terraform and Helm (level 3 each), then rewrite my profile in one sentence",
         lambda b, a: {"Kubernetes", "Terraform", "Helm"} <= set(names(a, "Skills")) and 0 < len(sec(a, "Profile").text) < 300, ("multi",)),
    # Whole-CV tasks: many sections, each needing its own rewrite. Where a planner should matter.
    Case("polish-all", "Review my whole CV and improve the wording everywhere: the profile, every job's bullets and descriptions. Keep all facts.",
         lambda b, a: same_facts(b, a) and sec(a, "Profile").text != sec(b, "Profile").text
         and all(y.bullets != x.bullets or y.description != x.description for x, y in zip(jobs(b), jobs(a))), ("whole",)),
    Case("tailor", "Tailor my CV to this job posting: 'Platform Engineer. You will run Kubernetes clusters, build CI/CD pipelines and improve observability. Strong Python and cloud experience required.' Rewrite the profile and every job's bullets to emphasise the relevant parts of my EXISTING experience. Do not invent anything.",
         lambda b, a: same_facts(b, a) and sec(a, "Profile").text != sec(b, "Profile").text
         and sum(y.bullets != x.bullets or y.description != x.description for x, y in zip(jobs(b), jobs(a))) == len(jobs(b)), ("whole",)),
    Case("shorten-all", "My CV is too long. Shorten every text field (profile, each job's description and bullets) by about a third without losing facts.",
         lambda b, a: same_facts(b, a) and sum(len(x.description) + sum(map(len, x.bullets)) for x in jobs(a)) < 0.85 * sum(len(x.description) + sum(map(len, x.bullets)) for x in jobs(b))
         and len(sec(a, "Profile").text) < len(sec(b, "Profile").text), ("whole",)),
]
