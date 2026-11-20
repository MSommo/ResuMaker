"""Import a CV from a file: extract -> structure (LLM, validated) -> convert (deterministic) -> check.
Nothing is saved here: the caller gets a preview to review, and creating the CV is the normal create call."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Literal

import pycountry
from pydantic import BaseModel, Field, ValidationError

from ..agent.llm import LLM, LLMError
from ..agent.prompts import IMPORT_SYSTEM
from ..domain.catalog import blank_resume, get_template, make_section, new_id
from ..domain.models import Address, Basics, Entry, Leveled, LinkItem, Resume
from .importers import ImportRejected, FileKind, docx_to_text, html_to_text, sniff

log = logging.getLogger("resumaker.import")

MAX_SECTIONS, MAX_ITEMS, MAX_BULLETS = 30, 80, 40
MAX_FIELD, MAX_TEXT = 1000, 12000


# ---------------------------------------------------------------- what the model returns


class ImpAddress(BaseModel):
    street: str = ""
    city: str = ""
    postcode: str = ""
    country: str = ""


class ImpBasics(BaseModel):
    firstName: str = ""  # noqa: N815
    lastName: str = ""  # noqa: N815
    headline: str = ""
    email: str = ""
    phone: str = ""
    address: ImpAddress = Field(default_factory=ImpAddress)
    birthDate: str = ""  # noqa: N815
    birthPlace: str = ""  # noqa: N815
    nationality: str = ""


class ImpEntry(BaseModel):
    title: str = ""
    organisation: str = ""
    location: str = ""
    start: str = ""
    end: str = ""
    current: bool = False
    note: str = ""
    description: str = ""
    bullets: list[str] = Field(default_factory=list)


class ImpLevel(BaseModel):
    name: str = ""
    level: int | None = None


class ImpLink(BaseModel):
    label: str = ""
    url: str = ""


class ImpSection(BaseModel):
    title: str = ""
    kind: Literal["text", "entries", "levels", "links"] = "text"
    job: bool = False
    text: str = ""
    entries: list[ImpEntry] = Field(default_factory=list)
    levels: list[ImpLevel] = Field(default_factory=list)
    links: list[ImpLink] = Field(default_factory=list)


class ImportedCV(BaseModel):
    language: str = ""
    basics: ImpBasics = Field(default_factory=ImpBasics)
    sections: list[ImpSection] = Field(default_factory=list)
    unplaced: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------- normalising what the model wrote

_CURRENT = {"present", "current", "now", "ongoing", "today", "oggi", "presente", "attuale", "ad oggi", "heute", "aujourd'hui", "actuel", "actualidad", "hoy"}
_MONTHS = [("janv", 1), ("jan", 1), ("gen", 1), ("ene", 1), ("feb", 2), ("fév", 2), ("fev", 2), ("mär", 3), ("mrz", 3), ("mar", 3), ("apr", 4), ("avr", 4), ("abr", 4),
           ("mag", 5), ("may", 5), ("mai", 5), ("juil", 7), ("jul", 7), ("lug", 7), ("juin", 6), ("jun", 6), ("giu", 6), ("aug", 8), ("ago", 8), ("aoû", 8), ("aou", 8),
           ("sep", 9), ("set", 9), ("oct", 10), ("ott", 10), ("okt", 10), ("nov", 11), ("dec", 12), ("dic", 12), ("déc", 12), ("dez", 12)]
_COUNTRY_ALIASES = {"uk": "GB", "u.k.": "GB", "england": "GB", "scotland": "GB", "wales": "GB", "great britain": "GB", "usa": "US", "u.s.a.": "US", "america": "US"}


def norm_date(raw: str) -> tuple[str, bool, bool]:
    """-> (YYYY-MM or "", is_current, year_only). Accepts the formats CVs actually use, in several languages."""
    s = raw.strip().lower()
    if not s:
        return "", False, False
    if s in _CURRENT:
        return "", True, False
    if m := re.match(r"^(\d{4})[-/.](\d{1,2})\b", s):
        return (f"{m[1]}-{int(m[2]):02d}", False, False) if 1 <= int(m[2]) <= 12 else (f"{m[1]}-01", False, True)
    if m := re.match(r"^(\d{1,2})[-/.](\d{4})$", s):
        return (f"{m[2]}-{int(m[1]):02d}", False, False) if 1 <= int(m[1]) <= 12 else (f"{m[2]}-01", False, True)
    if m := re.match(r"^(\d{4})$", s):
        return f"{m[1]}-01", False, True
    year = re.search(r"\b(19|20)\d{2}\b", s)
    if year:
        for token in re.findall(r"[a-zàâäéèêëîïôöùûüç]+", s):
            for prefix, num in _MONTHS:
                if token.startswith(prefix):
                    return f"{year[0]}-{num:02d}", False, False
        return f"{year[0]}-01", False, True
    return "", False, False


def norm_country(raw: str) -> str:
    s = raw.strip()
    if not s:
        return ""
    if s.lower() in _COUNTRY_ALIASES:
        return _COUNTRY_ALIASES[s.lower()]
    if len(s) == 2 and pycountry.countries.get(alpha_2=s.upper()):
        return s.upper()
    try:
        return pycountry.countries.lookup(s).alpha_2
    except LookupError:
        return ""


def _clip(s: str, n: int = MAX_FIELD) -> str:
    return s.strip()[:n]


_KEYWORDS = {
    "profile": ("profile", "summary", "about", "objective", "profilo", "sommario", "chi sono", "profil", "résumé professionnel", "perfil", "über mich"),
    "employment": ("experience", "employment", "work", "career", "history", "esperienza", "lavor", "expérience", "experiencia", "berufs", "arbeits"),
    "education": ("education", "studies", "academic", "istruzione", "formazione", "études", "formation", "educación", "ausbildung", "studium"),
    "courses": ("course", "corsi", "certif", "training", "cours", "curso"),
    "achievements": ("achievement", "award", "honour", "honor", "premi", "riconoscimenti", "distinction", "logro"),
    "hobbies": ("hobb", "interest", "interess", "loisir", "aficion", "freizeit"),
    "skills": ("skill", "competenz", "compétence", "habilidad", "kenntnisse", "technolog", "tools"),
    "languages": ("language", "lingue", "langues", "idioma", "sprachen"),
    "links": ("link", "social", "website", "contact", "profili", "portfolio", "sito"),
}


def _which(title: str, kind: str) -> str | None:
    t = title.lower()
    for key, words in _KEYWORDS.items():
        if any(w in t for w in words):
            template_kind = {"profile": "text", "hobbies": "text", "employment": "entries", "education": "entries", "courses": "entries", "achievements": "entries",
                             "skills": "levels", "languages": "levels", "links": "links"}[key]
            if template_kind == kind:
                return key
    return None


@dataclass
class Preview:
    resume: Resume
    kind: FileKind
    language: str = ""
    warnings: list[str] = field(default_factory=list)
    stats: dict[str, int] = field(default_factory=dict)


def to_resume(imp: ImportedCV, layout_id: str = "sidebar") -> tuple[Resume, list[str]]:
    """Deterministic, defensive conversion: ids, dates, country codes, zones, icons and size caps are decided here, not by the model."""
    warnings: list[str] = []
    r = blank_resume(layout_id)
    r.sections = [make_section(get_template("details"), zone="side")]  # personal details are always shown
    b = imp.basics
    country = norm_country(b.address.country)
    if b.address.country.strip() and not country:
        warnings.append(f"Country “{b.address.country.strip()}” was not recognised and was left empty.")
    r.basics = Basics(
        firstName=_clip(b.firstName, 100), lastName=_clip(b.lastName, 100), headline=_clip(b.headline, 200), email=_clip(b.email, 200), phone=_clip(b.phone, 60),
        address=Address(street=_clip(b.address.street), city=_clip(b.address.city), postcode=_clip(b.address.postcode, 30), country=country),
        birthDate=_clip(b.birthDate, 10), birthPlace=_clip(b.birthPlace), nationality=_clip(b.nationality),
    )

    year_only = defaulted_levels = dropped = 0
    for sec in imp.sections[:MAX_SECTIONS]:
        key = _which(sec.title, sec.kind)
        match sec.kind:
            case "text":
                tpl = get_template({"profile": "profile", "hobbies": "hobbies"}.get(key or "", "custom-text"))
                text = sec.text.strip()[:MAX_TEXT]
                if not text:
                    dropped += 1
                    continue
                s = make_section(tpl, zone=tpl.zone)
                s.text = text  # type: ignore[union-attr]
            case "entries":
                tpl = get_template({"employment": "employment", "education": "education", "courses": "courses", "achievements": "achievements"}.get(key or "", "custom-timeline"))
                s = make_section(tpl, zone=tpl.zone)
                s.job = tpl.job or sec.job  # type: ignore[union-attr]
                for e in sec.entries[:MAX_ITEMS]:
                    start, cur_a, yo_a = norm_date(e.start)
                    end, cur_b, yo_b = norm_date(e.end)
                    year_only += yo_a + yo_b
                    current = e.current or cur_a or cur_b
                    if current:
                        end = ""
                    entry = Entry(
                        id=new_id(), title=_clip(e.title), organisation=_clip(e.organisation), location=_clip(e.location), start=start, end=end, current=current,
                        note=_clip(e.note), description=e.description.strip()[:MAX_TEXT],
                        bullets=[re.sub(r"^[\s•·▪◦\-–*]+", "", x).strip()[:MAX_FIELD] for x in e.bullets[:MAX_BULLETS] if x.strip()],
                    )
                    if entry.title or entry.organisation or entry.description or entry.bullets:
                        s.items.append(entry)  # type: ignore[union-attr]
                    else:
                        dropped += 1
            case "levels":
                tpl = get_template({"skills": "skills", "languages": "languages"}.get(key or "", "custom-levels"))
                s = make_section(tpl, zone=tpl.zone)
                for lv in sec.levels[:MAX_ITEMS]:
                    if not lv.name.strip():
                        dropped += 1
                        continue
                    if lv.level is None:
                        defaulted_levels += 1
                    s.items.append(Leveled(id=new_id(), name=_clip(lv.name, 200), level=min(5, max(1, lv.level)) if lv.level is not None else 3))  # type: ignore[union-attr]
            case _:
                tpl = get_template("links" if key == "links" else "custom-links")
                s = make_section(tpl, zone=tpl.zone)
                for ln in sec.links[:MAX_ITEMS]:
                    if ln.url.strip() or ln.label.strip():
                        s.items.append(LinkItem(id=new_id(), label=_clip(ln.label, 200), url=_clip(ln.url, 500)))  # type: ignore[union-attr]
                    else:
                        dropped += 1
        if sec.title.strip():
            s.title = _clip(sec.title, 100)
        if getattr(s, "items", None) == [] and sec.kind != "text":
            dropped += 1
            continue
        r.sections.append(s)

    if len(imp.sections) > MAX_SECTIONS:
        warnings.append(f"The file has more than {MAX_SECTIONS} sections; the rest were skipped.")
    if year_only:
        warnings.append(f"{year_only} date(s) had only a year and were set to January. Check them.")
    if defaulted_levels:
        warnings.append(f"{defaulted_levels} skill/language level(s) were not in the file and were set to 3 of 5.")
    if dropped:
        warnings.append(f"{dropped} empty item(s) or section(s) were left out.")
    for u in imp.unplaced:
        if u.strip():
            warnings.append(f"Not placed anywhere: “{u.strip()[:150]}”")
    return r, warnings


def check(r: Resume) -> list[str]:
    """Things that look wrong in the result, so the person looks at them before creating the CV."""
    w: list[str] = []
    if not (r.basics.firstName or r.basics.lastName):
        w.append("No name was found.")
    if not r.basics.email and not r.basics.phone:
        w.append("No email or phone was found.")
    if len(r.sections) <= 1:
        w.append("No sections were found. The file may be an image-only scan.")
    for s in r.sections:
        for e in getattr(s, "items", []):
            if isinstance(e, Entry) and e.start and e.end and e.end < e.start:
                w.append(f"“{e.title or e.organisation}” in “{s.title}” ends before it starts ({e.start} to {e.end}).")
    return w


async def parse_cv(llm: LLM, data: bytes) -> Preview:
    """Raises ImportRejected (bad file) or LLMError (model problem). Saves nothing."""
    kind = sniff(data)
    if kind == "pdf":
        # Gemini reads PDFs natively, so layout and scanned pages work without a separate OCR step.
        parts: list[Any] = [{"mime": "application/pdf", "data": data}, "Extract this CV."]
    else:
        text = docx_to_text(data) if kind == "docx" else html_to_text(data)
        if len(text.strip()) < 30:
            raise ImportRejected("No readable text was found in this file.", 422)
        parts = [f"CV TEXT (extracted from the file; structure is approximate):\n<<<\n{text}\n>>>", "Extract this CV."]
    imp = await llm.json(system=IMPORT_SYSTEM, contents=[{"role": "user", "parts": parts}], schema=ImportedCV, temperature=0.0)
    resume, warnings = to_resume(imp)
    try:
        Resume.model_validate(resume.model_dump())
    except ValidationError as e:  # pragma: no cover - the converter clamps everything, this is the last line of defence
        log.warning("imported CV failed validation: %s", e)
        raise LLMError("The CV could not be read reliably. Try another format.") from e
    warnings += check(resume)
    stats = {s.title: len(getattr(s, "items", [])) or (1 if getattr(s, "text", "") else 0) for s in resume.sections if s.kind != "details"}
    return Preview(resume=resume, kind=kind, language=imp.language, warnings=warnings, stats=stats)
