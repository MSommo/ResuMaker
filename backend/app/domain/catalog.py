"""Layouts and section templates. Mirrors src/layouts/registry.ts and src/model/templates.ts."""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from .models import (
    Address,
    Basics,
    DetailsSection,
    Entry,
    EntriesSection,
    IconId,
    Leveled,
    LevelsSection,
    LinkItem,
    LinksSection,
    Resume,
    Section,
    SectionKind,
    TextSection,
)


def new_id() -> str:
    return secrets.token_hex(4)


@dataclass(frozen=True)
class Zone:
    id: str
    label: str
    accepts: frozenset[str]


@dataclass(frozen=True)
class Layout:
    id: str
    name: str
    zones: tuple[Zone, ...]


_SIDE = Zone("side", "Sidebar", frozenset({"details", "text", "levels", "links"}))
_MAIN = Zone("main", "Main column", frozenset({"text", "entries"}))

LAYOUTS: dict[str, Layout] = {
    "sidebar": Layout("sidebar", "Sidebar", (_SIDE, _MAIN)),
    "timeline": Layout("timeline", "Timeline", (_SIDE, _MAIN)),
}
DEFAULT_LAYOUT = "sidebar"


def get_layout(layout_id: str) -> Layout:
    return LAYOUTS.get(layout_id) or LAYOUTS[DEFAULT_LAYOUT]


@dataclass(frozen=True)
class Template:
    id: str
    label: str
    kind: SectionKind
    zone: str  # preferred zone
    title: str
    icon: IconId = "none"
    job: bool = False


TEMPLATES: tuple[Template, ...] = (
    Template("details", "Personal details", "details", "side", "Details"),
    Template("profile", "Profile", "text", "main", "Profile", "user"),
    Template("employment", "Employment history", "entries", "main", "Employment History", "briefcase", job=True),
    Template("education", "Education", "entries", "main", "Education", "cap"),
    Template("courses", "Courses", "entries", "main", "Courses", "badge"),
    Template("achievements", "Achievements", "entries", "main", "Achievement", "star"),
    Template("skills", "Skills", "levels", "side", "Skills"),
    Template("languages", "Languages", "levels", "side", "Languages"),
    Template("links", "Links", "links", "side", "Links"),
    Template("hobbies", "Hobbies", "text", "side", "Hobbies"),
    Template("custom-text", "Custom text", "text", "main", "New section", "bookmark"),
    Template("custom-timeline", "Custom timeline", "entries", "main", "New timeline", "bookmark"),
    Template("custom-levels", "Custom skill list", "levels", "side", "New list"),
    Template("custom-links", "Custom links", "links", "side", "New links"),
)


def get_template(template_id: str) -> Template | None:
    return next((t for t in TEMPLATES if t.id == template_id), None)


def make_section(t: Template, section_id: str | None = None, zone: str | None = None) -> Section:
    base = {"id": section_id or new_id(), "title": t.title, "zone": zone, "icon": t.icon}
    match t.kind:
        case "details":
            return DetailsSection(**base)
        case "text":
            return TextSection(**base)
        case "entries":
            return EntriesSection(**base, job=t.job)
        case "levels":
            return LevelsSection(**base)
        case "links":
            return LinksSection(**base)
    raise ValueError(t.kind)


# Default placement of the built-in components in a new CV.
_PLACEMENT: dict[str, str] = {
    "details": "side", "skills": "side", "languages": "side", "links": "side", "hobbies": "side",
    "profile": "main", "employment": "main", "education": "main", "courses": "main", "achievements": "main",
}


def blank_resume(layout_id: str = DEFAULT_LAYOUT) -> Resume:
    sections = [make_section(get_template(tid), zone=zone) for tid, zone in _PLACEMENT.items()]  # type: ignore[arg-type]
    return Resume(layoutId=get_layout(layout_id).id, basics=Basics(), sections=sections)


def sample_resume(layout_id: str = DEFAULT_LAYOUT) -> Resume:
    r = blank_resume(layout_id)
    r.basics = Basics(
        firstName="Jane", lastName="Doe", headline="Senior Software Engineer", email="jane.doe@example.com",
        phone="+44 7000 000000", address=Address(street="1 Example Street", city="London", postcode="EC1A 1AA", country="GB"),
        birthDate="1990-01-01", birthPlace="London, UK", nationality="British",
    )
    by_title = {s.title: s for s in r.sections}
    by_title["Profile"].text = (  # type: ignore[union-attr]
        "Experienced engineer with a track record of delivering reliable products end to end. "
        "Strong background in TypeScript, cloud infrastructure and mentoring teams."
    )
    by_title["Employment History"].items = [  # type: ignore[union-attr]
        Entry(id=new_id(), title="Senior Software Engineer", organisation="Acme Corp", location="London, UK", start="2022-01", current=True,
              description="Lead engineer on the platform team.",
              bullets=["# Architecture", "Designed an event-driven backend serving **2M requests** per day.", "# Leadership", "Coached four engineers through promotion."]),
        Entry(id=new_id(), title="Software Engineer", organisation="Globex", location="Bristol, UK", start="2018-06", end="2021-12",
              bullets=["Built and maintained customer-facing React applications.", "Introduced automated testing, cutting regressions by 40%."]),
    ]
    by_title["Education"].items = [  # type: ignore[union-attr]
        Entry(id=new_id(), title="BSc Computer Science", organisation="University of Example", location="Bristol, UK", start="2014-09", end="2018-06",
              note="First Class Honours", description="Focus on distributed systems and software engineering.")
    ]
    by_title["Skills"].items = [Leveled(id=new_id(), name=n, level=lv) for n, lv in [("TypeScript", 5), ("React", 4), ("Node.js", 4), ("SQL", 3)]]  # type: ignore[union-attr]
    by_title["Languages"].items = [Leveled(id=new_id(), name=n, level=lv) for n, lv in [("English", 5), ("French", 3)]]  # type: ignore[union-attr]
    by_title["Links"].items = [  # type: ignore[union-attr]
        LinkItem(id=new_id(), label="LinkedIn", url="https://linkedin.com/in/example"),
        LinkItem(id=new_id(), label="GitHub", url="https://github.com/example"),
    ]
    by_title["Hobbies"].text = "Chess and tactical puzzles.\n\nBuilding side projects."  # type: ignore[union-attr]
    return r
