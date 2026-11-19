from __future__ import annotations

import html
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent.graph import MAX_REPAIRS, NODE_DOCS, build_graph
from ..agent.llm import LLMError
from ..cache import digest
from ..domain.diff import diff_resumes
from ..domain.models import Resume
from ..domain.ops import apply_ops
from ..infra import Infra
from ..services import personas as people
from ..services import resumes as repo
from ..services import versions as vers
from ..services.chat import run_chat
from ..services.improve import improve_text
from . import schemas as sc
from .deps import get_infra, get_session, parse_id, rate_limit

router = APIRouter()


def _ai(infra: Infra) -> None:
    if infra.llm is None:
        raise HTTPException(501, "AI is not configured. Add GEMINI_API_KEY to .env and restart the API.")


async def _row(s: AsyncSession, resume_id: str):
    """(CV row, its persona row)"""
    try:
        return await repo.get_resume(s, parse_id(resume_id))
    except repo.NotFound:
        raise HTTPException(404, "CV not found.") from None


@router.get("/status")
async def status(infra: Infra = Depends(get_infra)):
    return await infra.status()


@router.get("/agent/graph", summary="Draw the LangGraph editing agent")
async def agent_graph(format: Literal["ascii", "mermaid", "json", "html"] = "ascii", infra: Infra = Depends(get_infra)):
    """The agent's state machine, drawn. `ascii` (default) reads well in a terminal; `mermaid` is the diagram source;
    `json` lists nodes and edges; `html` renders the diagram in a browser (loads mermaid.js from a CDN)."""
    # Only the structure is drawn, so this works even when no Gemini key is configured (the nodes are never run here).
    drawable = (infra.graph or build_graph(None)).get_graph()
    if format == "ascii":
        return PlainTextResponse(drawable.draw_ascii() + "\n")
    mermaid = drawable.draw_mermaid()
    if format == "mermaid":
        return PlainTextResponse(mermaid)
    if format == "json":
        return {
            "maxRepairs": MAX_REPAIRS,
            "nodes": [{"id": n.id, "description": NODE_DOCS.get(n.id)} for n in drawable.nodes.values()],
            "edges": [{"source": e.source, "target": e.target, "conditional": e.conditional} for e in drawable.edges],
            "mermaid": mermaid,
        }
    return HTMLResponse(
        "<!doctype html><meta charset=utf-8><title>ResuMaker agent graph</title>"
        "<style>body{font-family:system-ui;margin:2rem;color:#1a1a18}pre.mermaid{background:#fff}</style>"
        "<h1>ResuMaker agent graph</h1>"
        f'<pre class="mermaid">{html.escape(mermaid)}</pre>'
        '<script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";mermaid.initialize({startOnLoad:true});</script>'
    )


# ------------------------------------------------------------------ Personas


async def _persona(s: AsyncSession, persona_id: str):
    try:
        return await people.get_persona(s, parse_id(persona_id))
    except people.PersonaNotFound:
        raise HTTPException(404, "Persona not found.") from None


@router.get("/personas", response_model=list[sc.PersonaOut])
async def list_personas(s: AsyncSession = Depends(get_session)):
    return [sc.PersonaOut.of(p, n) for p, n in await people.list_personas(s)]


@router.post("/personas", response_model=sc.PersonaOut, status_code=201)
async def create_persona(body: sc.PersonaIn, s: AsyncSession = Depends(get_session)):
    return sc.PersonaOut.of(await people.create_persona(s, body))


@router.get("/personas/{persona_id}", response_model=sc.PersonaDetail)
async def get_persona(persona_id: str, s: AsyncSession = Depends(get_session)):
    p = await _persona(s, persona_id)
    rows = await people.persona_resumes(s, p.id)
    return sc.PersonaDetail(persona=sc.PersonaOut.of(p, len(rows)), resumes=[sc.ResumeSummary.of(r) for r in rows])


@router.put("/personas/{persona_id}", response_model=sc.PersonaOut)
async def update_persona(persona_id: str, body: sc.PersonaIn, s: AsyncSession = Depends(get_session)):
    await _persona(s, persona_id)
    return sc.PersonaOut.of(await people.update_persona(s, parse_id(persona_id), body))


@router.delete("/personas/{persona_id}", status_code=204)
async def delete_persona(persona_id: str, s: AsyncSession = Depends(get_session)):
    await _persona(s, persona_id)
    await people.delete_persona(s, parse_id(persona_id))
    return Response(status_code=204)


@router.post("/personas/{persona_id}/resumes", response_model=sc.ResumeOut, status_code=201)
async def create_resume(persona_id: str, body: sc.CreateResumeIn, s: AsyncSession = Depends(get_session)):
    await _persona(s, persona_id)
    row, persona = await repo.create_resume(s, parse_id(persona_id), resume=body.resume, layout_id=body.layoutId, template=body.template)
    return sc.ResumeOut.of(row, persona)


# ------------------------------------------------------------------ CVs


@router.get("/resumes/{resume_id}", response_model=sc.ResumeOut)
async def get_resume(resume_id: str, s: AsyncSession = Depends(get_session)):
    return sc.ResumeOut.of(*await _row(s, resume_id))


@router.put("/resumes/{resume_id}", response_model=sc.ResumeOut)
async def save_resume(resume_id: str, body: sc.SaveIn, s: AsyncSession = Depends(get_session)):
    """Save the CV's content and headline. Personal details are ignored here: they belong to the persona (PUT /personas/{id})."""
    try:
        return sc.ResumeOut.of(*await repo.save_resume(s, parse_id(resume_id), body.resume, body.version, update_persona=False, checkpoint=True))
    except repo.NotFound:
        raise HTTPException(404, "CV not found.") from None
    except repo.VersionConflict as e:
        return JSONResponse(status_code=409, content={"error": "This CV was changed elsewhere.", "current": sc.ResumeOut.of(e.current, e.persona).model_dump(mode="json")})


@router.delete("/resumes/{resume_id}", status_code=204)
async def delete_resume(resume_id: str, s: AsyncSession = Depends(get_session)):
    try:
        await repo.delete_resume(s, parse_id(resume_id))
    except repo.NotFound:
        raise HTTPException(404, "CV not found.") from None
    return Response(status_code=204)


@router.post("/resumes/{resume_id}/ops", response_model=sc.OpsOut)
async def apply_resume_ops(resume_id: str, body: sc.OpsIn, s: AsyncSession = Depends(get_session)):
    """Apply validated edit operations directly (the same engine the agent and the MCP server use).

    With `dryRun` nothing is saved: you get what would be applied, what would be skipped, and a readable list of changes."""
    row, persona = await _row(s, resume_id)
    before = repo.merged(row, persona)
    res = apply_ops(before, body.ops)
    changes = diff_resumes(before, res.resume)
    undo_id = None
    saved = bool(res.applied) and not body.dryRun
    if saved:
        snap = await vers.snapshot(s, row, source="ops", label=f"{len(res.applied)} operation(s) via API")
        undo_id = str(snap.id)
        row, persona = await repo.save_resume(s, row.id, res.resume, row.version, update_persona=True)
    return sc.OpsOut(applied=res.applied, skipped=res.skipped, changes=changes, saved=saved, version=row.version, undoVersionId=undo_id, resume=res.resume if res.applied else before)


# ------------------------------------------------------------------ Version history


@router.get("/resumes/{resume_id}/versions", response_model=list[sc.VersionOut])
async def list_versions(resume_id: str, s: AsyncSession = Depends(get_session)):
    row, _ = await _row(s, resume_id)
    return [sc.VersionOut.of(v) for v in await vers.list_versions(s, row.id)]


async def _version(s: AsyncSession, row, version_id: str):
    try:
        return await vers.get_version(s, row.id, parse_id(version_id))
    except vers.VersionNotFound:
        raise HTTPException(404, "Version not found.") from None


@router.get("/resumes/{resume_id}/versions/{version_id}", response_model=Resume)
async def get_version(resume_id: str, version_id: str, s: AsyncSession = Depends(get_session)):
    """The CV as it was in that snapshot (with the persona's current details)."""
    row, persona = await _row(s, resume_id)
    v = await _version(s, row, version_id)
    return repo.merged_from(v.data, persona)


@router.get("/resumes/{resume_id}/versions/{version_id}/diff", response_model=sc.DiffOut)
async def diff_version(resume_id: str, version_id: str, s: AsyncSession = Depends(get_session)):
    """What restoring this version would change: the snapshot compared with the CV as it is now."""
    row, persona = await _row(s, resume_id)
    v = await _version(s, row, version_id)
    return sc.DiffOut(changes=diff_resumes(repo.merged(row, persona), repo.merged_from(v.data, persona)))


@router.post("/resumes/{resume_id}/versions/{version_id}/restore", response_model=sc.ResumeOut)
async def restore_version(resume_id: str, version_id: str, s: AsyncSession = Depends(get_session)):
    """Make the CV match that snapshot. The current state is snapshotted first, so a restore can be undone too."""
    row, _ = await _row(s, resume_id)
    await _version(s, row, version_id)
    return sc.ResumeOut.of(*await vers.restore(s, row.id, parse_id(version_id)))


# ------------------------------------------------------------------ AI


@router.post("/ai/improve", response_model=sc.ImproveOut, dependencies=[Depends(rate_limit)])
async def improve(body: sc.ImproveIn, infra: Infra = Depends(get_infra)):
    _ai(infra)
    try:
        text, cached = await improve_text(infra, kind=body.kind, text=body.text, instruction=body.instruction, context=body.context)
    except LLMError as e:
        raise HTTPException(e.status, str(e)) from e
    return sc.ImproveOut(text=text, cached=cached)


@router.post("/resumes/{resume_id}/chat", response_model=sc.ChatOut, dependencies=[Depends(rate_limit)])
async def chat(resume_id: str, body: sc.ChatIn, infra: Infra = Depends(get_infra)):
    _ai(infra)
    try:
        out = await run_chat(infra, parse_id(resume_id), body.message)
    except repo.NotFound:
        raise HTTPException(404, "CV not found.") from None
    except repo.VersionConflict:
        raise HTTPException(409, "The CV changed while the assistant was working. Please try again.") from None
    except LLMError as e:
        raise HTTPException(e.status, str(e)) from e
    return sc.ChatOut(
        reply=out.reply, applied=out.applied, skipped=out.skipped, changes=out.changes, messageId=out.message_id,
        undoVersionId=out.undo_version_id, resume=sc.ResumeOut.of(out.row, out.persona),
    )


@router.get("/resumes/{resume_id}/chat", response_model=list[sc.ChatMessageOut])
async def chat_history(resume_id: str, s: AsyncSession = Depends(get_session)):
    row, _ = await _row(s, resume_id)
    return [
        sc.ChatMessageOut(
            id=str(m.id), role=m.role, text=m.text, applied=m.applied or [], skipped=m.skipped or [],
            undoVersionId=str(m.undo_version_id) if m.undo_version_id else None, undone=m.undone,
        )
        for m in await repo.chat_history(s, row.id)
    ]


@router.delete("/resumes/{resume_id}/chat", status_code=204)
async def clear_chat(resume_id: str, s: AsyncSession = Depends(get_session)):
    row, _ = await _row(s, resume_id)
    await repo.clear_chat(s, row.id)
    return Response(status_code=204)


# ------------------------------------------------------------------ PDF


@router.post("/resumes/{resume_id}/pdf")
async def pdf(resume_id: str, infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    if not infra.pdf.available:
        raise HTTPException(501, "Chrome was not found. Set CHROME_PATH in .env.")
    row, persona = await _row(s, resume_id)
    # The key hashes the complete CV (including the persona's details), so any edit invalidates the cached PDF.
    key = f"pdf:{row.id}:{digest(repo.merged(row, persona).model_dump(mode='json'))}"
    headers = {"content-disposition": 'attachment; filename="cv.pdf"'}
    if (hit := await infra.cache.get(key)) is not None:
        return Response(hit, media_type="application/pdf", headers={**headers, "x-cache": "hit"})
    try:
        data = await infra.pdf.render(f"{infra.settings.frontend_url}/preview/{row.id}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"PDF rendering failed: {e}") from e
    await infra.cache.set(key, data, infra.settings.pdf_cache_ttl)
    return Response(data, media_type="application/pdf", headers={**headers, "x-cache": "miss"})
