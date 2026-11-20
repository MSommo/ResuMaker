"""Live round-trip eval of CV import (real Gemini, opt-in: `make eval-import`, needs `make stack` for the PDF).

A known CV is turned into a DOCX, an HTML page and a real PDF (rendered by the app itself), imported again, and compared with the
original: is everything recovered, and is anything invented?"""

import difflib
import io
import os

import httpx
import pytest
from docx import Document

from app.agent.llm import GeminiLLM
from app.domain.models import Resume
from app.services.cv_import import parse_cv

pytestmark = pytest.mark.live
API = os.environ.get("EVAL_API") or f"http://{os.environ.get('APP_HOST', 'localhost')}:{os.environ.get('API_PORT', '8180')}/api"  # `make eval-import` sets EVAL_API
H = {"x-resumaker": "1"}


def truth_resume() -> Resume:
    """The ground truth: a CV created through the real API (so the PDF we import is the app's own rendering of it)."""
    with httpx.Client(base_url=API, headers=H, timeout=60) as c:
        p = c.post("/personas", json={
            "firstName": "Jane", "lastName": "Doe", "email": "jane.doe@example.com", "phone": "+44 7000 000000",
            "address": {"street": "1 Example Street", "city": "London", "postcode": "EC1A 1AA", "country": "GB"},
        }).json()
        doc = c.post(f"/personas/{p['id']}/resumes", json={"template": "sample", "layoutId": "sidebar"}).json()
        pdf = c.post(f"/resumes/{doc['id']}/pdf")
        assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-", "needs the scratch stack with PDF rendering"
        truth_resume.pdf = pdf.content  # type: ignore[attr-defined]
        c.delete(f"/personas/{p['id']}")
        return Resume.model_validate(doc["resume"])


def jobs(r: Resume):
    return next(s for s in r.sections if s.kind == "entries" and s.job).items


def names(r: Resume, title: str) -> set[str]:
    s = next((s for s in r.sections if s.title.lower() == title.lower()), None)
    return {i.name.lower() for i in getattr(s, "items", [])}


def to_docx(r: Resume) -> bytes:
    d = Document()
    d.add_heading(f"{r.basics.firstName} {r.basics.lastName}", 0)
    d.add_paragraph(r.basics.headline)
    d.add_paragraph(f"{r.basics.email} | {r.basics.phone} | {r.basics.address.street}, {r.basics.address.city} {r.basics.address.postcode}")
    for s in r.sections:
        if s.kind == "details":
            continue
        d.add_heading(s.title, 1)
        if s.kind == "text":
            d.add_paragraph(s.text)
        elif s.kind == "entries":
            for e in s.items:
                d.add_paragraph(f"{e.title}, {e.organisation} ({e.location})  {e.start} to {e.end or 'Present'}").runs[0].bold = True
                if e.description:
                    d.add_paragraph(e.description)
                for b in e.bullets:
                    d.add_paragraph(b.lstrip("# ").strip(), style="List Bullet" if not b.startswith("#") else "Normal")
        elif s.kind == "levels":
            t = d.add_table(rows=0, cols=2)
            for i in s.items:
                row = t.add_row().cells
                row[0].text, row[1].text = i.name, f"{i.level}/5"
        else:
            for i in s.items:
                d.add_paragraph(f"{i.label}: {i.url}")
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def to_html(r: Resume) -> bytes:
    out = [f"<html><body><h1>{r.basics.firstName} {r.basics.lastName}</h1><p>{r.basics.headline}</p><p>{r.basics.email} · {r.basics.phone} · {r.basics.address.city}</p>"]
    for s in r.sections:
        if s.kind == "details":
            continue
        out.append(f"<h2>{s.title}</h2>")
        if s.kind == "text":
            out.append(f"<p>{s.text}</p>")
        elif s.kind == "entries":
            for e in s.items:
                out.append(f"<h3>{e.title} — {e.organisation}</h3><p>{e.location} · {e.start} – {e.end or 'Present'}</p><p>{e.description}</p><ul>" + "".join(f"<li>{b.lstrip('# ')}</li>" for b in e.bullets) + "</ul>")
        elif s.kind == "levels":
            out.append("<ul>" + "".join(f"<li>{i.name} — {'●' * i.level}{'○' * (5 - i.level)}</li>" for i in s.items) + "</ul>")
        else:
            out.append("<ul>" + "".join(f'<li><a href="{i.url}">{i.label}</a></li>' for i in s.items) + "</ul>")
    out.append("</body></html>")
    return "\n".join(out).encode()


def score(truth: Resume, got: Resume) -> dict:
    tj, gj = jobs(truth), jobs(got)
    t_orgs, g_orgs = {j.organisation.lower() for j in tj}, {j.organisation.lower() for j in gj}
    dates = sum(any(g.organisation.lower() == t.organisation.lower() and g.start == t.start and (g.end == t.end) and g.current == t.current for g in gj) for t in tj) / len(tj)
    t_bul = [b for j in tj for b in j.bullets if not b.startswith("#")]
    g_bul = [b for j in gj for b in j.bullets]
    bullets = sum(max((difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio() for b in g_bul), default=0) >= 0.8 for a in t_bul) / len(t_bul)
    skills = names(truth, "Skills")
    return {
        "name": (got.basics.firstName, got.basics.lastName) == (truth.basics.firstName, truth.basics.lastName),
        "contact": got.basics.email == truth.basics.email and "".join(got.basics.phone.split()) == "".join(truth.basics.phone.split()),
        "orgs_recall": len(t_orgs & g_orgs) / len(t_orgs),
        "invented_orgs": sorted(g_orgs - t_orgs),
        "dates": dates,
        "bullets": bullets,
        "skills_recall": len(skills & names(got, "Skills")) / len(skills),
        "invented_skills": sorted(names(got, "Skills") - skills),
        "education": any(s.kind == "entries" and not s.job and any("university of example" in i.organisation.lower() for i in s.items) for s in got.sections),
    }


async def test_round_trip():
    key = os.environ.get("REAL_GEMINI_API_KEY", "")
    if not key:
        pytest.skip("needs a real GEMINI_API_KEY")
    llm = GeminiLLM(key, os.environ.get("GEMINI_MODEL", "gemini-flash-latest"), "gemini-flash-lite-latest")
    truth = truth_resume()
    files = {"docx": to_docx(truth), "html": to_html(truth), "pdf": truth_resume.pdf}  # type: ignore[attr-defined]
    problems = []
    for kind, data in files.items():
        p = await parse_cv(llm, data)
        s = score(truth, p.resume)
        print(f"\n{kind}: {s}\n   warnings: {p.warnings}")
        if not (s["name"] and s["contact"]): problems.append(f"{kind}: name/contact {s['name']} {s['contact']}")
        if s["orgs_recall"] < 1 or s["invented_orgs"]: problems.append(f"{kind}: employers {s['orgs_recall']} invented {s['invented_orgs']}")
        if s["dates"] < 1: problems.append(f"{kind}: job dates {s['dates']:.2f}")
        if s["bullets"] < 0.8: problems.append(f"{kind}: bullets recall {s['bullets']:.2f}")
        if s["skills_recall"] < 0.9 or s["invented_skills"]: problems.append(f"{kind}: skills {s['skills_recall']:.2f} invented {s['invented_skills']}")
        if not s["education"]: problems.append(f"{kind}: education missing")
    print("\nimport eval problems:", problems or "none")
    assert not problems, problems


ITALIAN = """<html><body>
<h1>Francesca Bianchi</h1><p>Ingegnere biomedico</p>
<p>Via Roma 12, 20121 Milano (Italia) · francesca.bianchi@example.it · +39 333 1234567 · nata a Torino il 12/05/1991</p>
<h2>Profilo</h2><p>Ingegnere biomedico con esperienza in dispositivi medici e qualità. Appassionata di ricerca clinica.</p>
<h2>Esperienza lavorativa</h2>
<p><b>Responsabile Qualità</b>, MedTech S.r.l., Milano — marzo 2019 – giugno 2022</p>
<ul><li>Gestione del sistema qualità ISO 13485</li><li>Coordinamento di 3 audit esterni</li></ul>
<p><b>Ingegnere Clinico</b>, Ospedale San Marco, Bergamo — settembre 2022 – oggi</p>
<ul><li>Manutenzione e collaudo delle apparecchiature elettromedicali</li></ul>
<h2>Istruzione e formazione</h2>
<p><b>Laurea Magistrale in Ingegneria Biomedica</b>, Politecnico di Milano, 2013 – 2016 — 110/110</p>
<h2>Competenze</h2><p>ISO 13485, Risk management, Python, MATLAB</p>
<h2>Lingue</h2><ul><li>Italiano: madrelingua</li><li>Inglese: B2</li></ul>
</body></html>""".encode()


async def test_a_messy_italian_cv():
    key = os.environ.get("REAL_GEMINI_API_KEY", "")
    if not key:
        pytest.skip("needs a real GEMINI_API_KEY")
    llm = GeminiLLM(key, os.environ.get("GEMINI_MODEL", "gemini-flash-latest"), "gemini-flash-lite-latest")
    p = await parse_cv(llm, ITALIAN)
    r = p.resume
    by = {s.title.lower(): s for s in r.sections}
    print("\nitalian:", p.stats, p.warnings)
    problems = []
    if (r.basics.firstName, r.basics.lastName) != ("Francesca", "Bianchi"): problems.append(f"name {r.basics.firstName} {r.basics.lastName}")
    if r.basics.address.country != "IT": problems.append(f"country {r.basics.address.country!r}")
    if "1991-05-12" not in r.basics.birthDate and "12" not in r.basics.birthDate: problems.append(f"birth date {r.basics.birthDate!r}")
    job = next((s for s in r.sections if s.kind == "entries" and s.job), None)
    if job is None or len(job.items) != 2: problems.append("two jobs expected")
    else:
        got = {(j.organisation.lower().split(",")[0], j.start, j.end, j.current) for j in job.items}
        want = {("medtech s.r.l.", "2019-03", "2022-06", False), ("ospedale san marco", "2022-09", "", True)}
        if got != want: problems.append(f"jobs {got}")
        if job.title.lower() != "esperienza lavorativa" or job.zone != "main": problems.append(f"job section kept as written: {job.title!r} {job.zone}")
    lang = by.get("lingue")
    if lang is None or lang.zone != "side" or {i.name.lower(): i.level for i in lang.items}.get("inglese") != 3 and {i.name.lower() for i in lang.items} != {"italiano", "inglese"}:
        problems.append(f"languages {lang}")
    if not any(s.title.lower().startswith("compet") for s in r.sections): problems.append("skills section missing")
    print("italian problems:", problems or "none")
    assert not problems, problems
