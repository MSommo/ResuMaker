from __future__ import annotations

import html
import json
import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
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
from ..services.cv_import import parse_cv
from ..services.importers import MAX_BYTES, ImportRejected
from ..services.chat import ProposalGone, decide, run_chat, stream_chat
from ..services import memory as mem
from ..services.pdf import render_pdf
from ..services.tailor import stream_tailor
from ..services.improve import improve_text
from . import schemas as sc
from .deps import Principal, current, get_infra, get_session, owned_resume, own_persona, parse_id, rate_limit

# Every route here needs a signed-in user. The few public ones (status, sign-in) live in `public`.
router = APIRouter(dependencies=[Depends(current)])
public = APIRouter()


def _ai(infra: Infra) -> None:
    if infra.llm is None:
        raise HTTPException(501, "AI is not configured. Add GEMINI_API_KEY to .env and restart the API.")


async def _row(s: AsyncSession, resume_id: uuid.UUID):
    """(CV row, its persona row). `resume_id` comes from `owned_resume`, so it is already known to be the caller's."""
    try:
        return await repo.get_resume(s, resume_id)
    except repo.NotFound:
        raise HTTPException(404, "CV not found.") from None


@public.get("/status")
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


@router.get("/personas/{persona_id}", response_model=sc.PersonaDetail)
async def get_persona(pid: uuid.UUID = Depends(own_persona), s: AsyncSession = Depends(get_session)):
    """Your own profile and CVs. (Accounts are created by an administrator: see /admin/users.)"""
    p = await people.get_persona(s, pid)
    rows = await people.persona_resumes(s, p.id)
    return sc.PersonaDetail(persona=sc.PersonaOut.of(p, len(rows)), resumes=[sc.ResumeSummary.of(r) for r in rows])


@router.put("/personas/{persona_id}", response_model=sc.PersonaOut)
async def update_persona(*, body: sc.PersonaIn, pid: uuid.UUID = Depends(own_persona), s: AsyncSession = Depends(get_session)):
    return sc.PersonaOut.of(await people.update_persona(s, pid, body))


@router.post("/personas/{persona_id}/resumes", response_model=sc.ResumeOut, status_code=201)
async def create_resume(*, body: sc.CreateResumeIn, pid: uuid.UUID = Depends(own_persona), s: AsyncSession = Depends(get_session)):
    row, persona = await repo.create_resume(s, pid, resume=body.resume, layout_id=body.layoutId, template=body.template)
    return sc.ResumeOut.of(row, persona)


@router.post("/personas/{persona_id}/imports/cv", response_model=sc.ImportOut, dependencies=[Depends(rate_limit)])
async def import_cv(*, pid: uuid.UUID = Depends(own_persona), file: UploadFile = File(...), infra: Infra = Depends(get_infra)):
    """Read a CV from a PDF, DOCX or HTML file (up to 10 MB) into our format. Saves nothing: it returns a preview with warnings to
    review, and the CV is created with the normal POST /personas/{id}/resumes. The file is processed in memory and not kept."""
    _ai(infra)
    data = await file.read(MAX_BYTES + 1)
    try:
        p = await parse_cv(infra.llm, data)
    except ImportRejected as e:
        raise HTTPException(e.status, str(e)) from None
    except LLMError as e:
        raise HTTPException(e.status, str(e)) from e
    return sc.ImportOut(resume=p.resume, kind=p.kind, language=p.language, warnings=p.warnings, stats=p.stats)


# ------------------------------------------------------------------ memory


def _memory_out(m) -> sc.MemoryOut:
    return sc.MemoryOut(id=str(m.id), kind=m.kind, text=m.text, createdAt=m.created_at)


@router.get("/personas/{persona_id}/memories", response_model=list[sc.MemoryOut])
async def list_memories(pid: uuid.UUID = Depends(own_persona), s: AsyncSession = Depends(get_session)):
    return [_memory_out(m) for m in await mem.list_memories(s, pid)]


@router.post("/personas/{persona_id}/memories", response_model=sc.MemoryOut, status_code=201, dependencies=[Depends(rate_limit)])
async def add_memory(*, body: sc.MemoryIn, pid: uuid.UUID = Depends(own_persona), infra: Infra = Depends(get_infra)):
    """Save a preference or fact by hand (it is embedded with Gemini, so AI must be configured)."""
    _ai(infra)
    async with infra.session() as s:
        try:
            row, _ = await mem.add(s, infra.llm, pid, body.kind, body.text)
        except mem.MemoryFull:
            raise HTTPException(409, f"Memory is full ({mem.MAX_PER_PERSONA} items). Delete some first.") from None
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        except LLMError as e:
            raise HTTPException(e.status, str(e)) from e
        return _memory_out(row)


@router.delete("/memories/{memory_id}", status_code=204)
async def delete_memory(memory_id: str, who: Principal = Depends(current), s: AsyncSession = Depends(get_session)):
    try:
        await mem.delete(s, parse_id(memory_id, "Memory"), owner=who.id)
    except mem.MemoryNotFound:
        raise HTTPException(404, "Memory not found.") from None


# ------------------------------------------------------------------ CVs


@router.get("/resumes/{resume_id}", response_model=sc.ResumeOut)
async def get_resume(*, rid: uuid.UUID = Depends(owned_resume), s: AsyncSession = Depends(get_session)):
    return sc.ResumeOut.of(*await _row(s, rid))


@router.put("/resumes/{resume_id}", response_model=sc.ResumeOut)
async def save_resume(*, rid: uuid.UUID = Depends(owned_resume), body: sc.SaveIn, s: AsyncSession = Depends(get_session)):
    """Save the CV's content and headline. Personal details are ignored here: they belong to the persona (PUT /personas/{id})."""
    try:
        return sc.ResumeOut.of(*await repo.save_resume(s, rid, body.resume, body.version, update_persona=False, checkpoint=True))
    except repo.NotFound:
        raise HTTPException(404, "CV not found.") from None
    except repo.VersionConflict as e:
        return JSONResponse(status_code=409, content={"error": "This CV was changed elsewhere.", "current": sc.ResumeOut.of(e.current, e.persona).model_dump(mode="json")})


@router.delete("/resumes/{resume_id}", status_code=204)
async def delete_resume(*, rid: uuid.UUID = Depends(owned_resume), s: AsyncSession = Depends(get_session)):
    try:
        await repo.delete_resume(s, rid)
    except repo.NotFound:
        raise HTTPException(404, "CV not found.") from None
    return Response(status_code=204)


@router.post("/resumes/{resume_id}/ops", response_model=sc.OpsOut)
async def apply_resume_ops(*, rid: uuid.UUID = Depends(owned_resume), body: sc.OpsIn, s: AsyncSession = Depends(get_session)):
    """Apply validated edit operations directly (the same engine the agent and the MCP server use).

    With `dryRun` nothing is saved: you get what would be applied, what would be skipped, and a readable list of changes."""
    row, persona = await _row(s, rid)
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
async def list_versions(*, rid: uuid.UUID = Depends(owned_resume), s: AsyncSession = Depends(get_session)):
    row, _ = await _row(s, rid)
    return [sc.VersionOut.of(v) for v in await vers.list_versions(s, row.id)]


async def _version(s: AsyncSession, row, version_id: str):
    try:
        return await vers.get_version(s, row.id, parse_id(version_id))
    except vers.VersionNotFound:
        raise HTTPException(404, "Version not found.") from None


@router.get("/resumes/{resume_id}/versions/{version_id}", response_model=Resume)
async def get_version(*, rid: uuid.UUID = Depends(owned_resume), version_id: str, s: AsyncSession = Depends(get_session)):
    """The CV as it was in that snapshot (with the persona's current details)."""
    row, persona = await _row(s, rid)
    v = await _version(s, row, version_id)
    return repo.merged_from(v.data, persona)


@router.get("/resumes/{resume_id}/versions/{version_id}/diff", response_model=sc.DiffOut)
async def diff_version(*, rid: uuid.UUID = Depends(owned_resume), version_id: str, s: AsyncSession = Depends(get_session)):
    """What restoring this version would change: the snapshot compared with the CV as it is now."""
    row, persona = await _row(s, rid)
    v = await _version(s, row, version_id)
    return sc.DiffOut(changes=diff_resumes(repo.merged(row, persona), repo.merged_from(v.data, persona)))


@router.post("/resumes/{resume_id}/versions/{version_id}/restore", response_model=sc.ResumeOut)
async def restore_version(*, rid: uuid.UUID = Depends(owned_resume), version_id: str, s: AsyncSession = Depends(get_session)):
    """Make the CV match that snapshot. The current state is snapshotted first, so a restore can be undone too."""
    row, _ = await _row(s, rid)
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
async def chat(*, rid: uuid.UUID = Depends(owned_resume), body: sc.ChatIn, infra: Infra = Depends(get_infra)):
    _ai(infra)
    try:
        out = await run_chat(infra, rid, body.message)
    except repo.NotFound:
        raise HTTPException(404, "CV not found.") from None
    except repo.VersionConflict:
        raise HTTPException(409, "The CV changed while the assistant was working. Please try again.") from None
    except LLMError as e:
        raise HTTPException(e.status, str(e)) from e
    return _chat_out(out)


def _chat_out(out) -> sc.ChatOut:
    return sc.ChatOut(
        reply=out.reply, applied=out.applied, skipped=out.skipped, changes=out.changes, messageId=out.message_id,
        undoVersionId=out.undo_version_id, intent=out.intent, resume=sc.ResumeOut.of(out.row, out.persona),
    )


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.post("/resumes/{resume_id}/chat/stream", dependencies=[Depends(rate_limit)])
async def chat_stream(*, rid: uuid.UUID = Depends(owned_resume), body: sc.ChatStreamIn, infra: Infra = Depends(get_infra)):
    """The assistant turn as Server-Sent Events: `status` (what it is doing now), `step` (a graph node finished), then
    `done` with the result, or `proposal` (mode=propose: nothing is changed until you POST .../chat/{runId}/decide), or `error`."""
    _ai(infra)
    async with infra.session() as s:
        await _row(s, rid)  # 404 as a normal JSON error before the stream starts

    async def events():
        try:
            async for ev in stream_chat(infra, rid, body.message, body.mode):
                if ev["type"] == "done":
                    ev = {"type": "done", "result": _chat_out(ev["outcome"]).model_dump(mode="json")}
                yield _sse(ev)
        except repo.VersionConflict:
            yield _sse({"type": "error", "status": 409, "message": "The CV changed while the assistant was working. Please try again."})
        except LLMError as e:
            yield _sse({"type": "error", "status": e.status, "message": str(e)})
        except Exception:  # noqa: BLE001  never leave a stream hanging without telling the client
            logging.getLogger("resumaker.api").exception("chat stream failed")
            yield _sse({"type": "error", "status": 500, "message": "Something went wrong while the assistant was working."})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/resumes/{resume_id}/tailor/stream", dependencies=[Depends(rate_limit)])
async def tailor_stream(*, rid: uuid.UUID = Depends(owned_resume), body: sc.TailorIn, infra: Infra = Depends(get_infra)):
    """Tailor this CV to a pasted job posting, as Server-Sent Events: `status`, `spec` (what the role needs, what your CV
    matches, what it lacks), `variant` (a NEW CV was created: the original is never touched), step/status, then `proposal`
    to accept or reject with POST /resumes/{variant id}/chat/{runId}/decide, or `error`."""
    _ai(infra)
    async with infra.session() as s:
        await _row(s, rid)

    async def events():
        try:
            async for ev in stream_tailor(infra, rid, body.posting):
                yield _sse(ev)
        except LLMError as e:
            yield _sse({"type": "error", "status": e.status, "message": str(e)})
        except Exception:  # noqa: BLE001
            logging.getLogger("resumaker.api").exception("tailor stream failed")
            yield _sse({"type": "error", "status": 500, "message": "Something went wrong while tailoring the CV."})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/resumes/{resume_id}/chat/{run_id}/decide", response_model=sc.ChatOut, dependencies=[Depends(rate_limit)])
async def chat_decide(*, rid: uuid.UUID = Depends(owned_resume), run_id: str, body: sc.DecideIn, infra: Infra = Depends(get_infra)):
    """Accept all, none, or some of the changes in a proposal. Resumes the paused run (stored in Postgres)."""
    _ai(infra)
    try:
        out = await decide(infra, rid, run_id, body.accept)
    except ProposalGone:
        raise HTTPException(410, "This proposal was already decided, or has expired. Ask again.") from None
    except repo.NotFound:
        raise HTTPException(404, "CV not found.") from None
    except repo.VersionConflict:
        raise HTTPException(409, "The CV was changed while you were reviewing. Ask again to get a fresh proposal.") from None
    except LLMError as e:
        raise HTTPException(e.status, str(e)) from e
    return _chat_out(out)


@router.get("/resumes/{resume_id}/chat", response_model=list[sc.ChatMessageOut])
async def chat_history(*, rid: uuid.UUID = Depends(owned_resume), s: AsyncSession = Depends(get_session)):
    row, _ = await _row(s, rid)
    return [
        sc.ChatMessageOut(
            id=str(m.id), role=m.role, text=m.text, applied=m.applied or [], skipped=m.skipped or [],
            undoVersionId=str(m.undo_version_id) if m.undo_version_id else None, undone=m.undone,
        )
        for m in await repo.chat_history(s, row.id)
    ]


@router.delete("/resumes/{resume_id}/chat", status_code=204)
async def clear_chat(*, rid: uuid.UUID = Depends(owned_resume), s: AsyncSession = Depends(get_session)):
    row, _ = await _row(s, rid)
    await repo.clear_chat(s, row.id)
    return Response(status_code=204)


# ------------------------------------------------------------------ PDF


@router.post("/resumes/{resume_id}/pdf")
async def pdf(*, rid: uuid.UUID = Depends(owned_resume), who: Principal = Depends(current), infra: Infra = Depends(get_infra), s: AsyncSession = Depends(get_session)):
    if not infra.pdf.available:
        raise HTTPException(501, "Chrome was not found. Set CHROME_PATH in .env.")
    row, persona = await _row(s, rid)
    # The key hashes the complete CV (including the persona's details), so any edit invalidates the cached PDF.
    key = f"pdf:{row.id}:{digest(repo.merged(row, persona).model_dump(mode='json'))}"
    headers = {"content-disposition": 'attachment; filename="cv.pdf"'}
    if (hit := await infra.cache.get(key)) is not None:
        return Response(hit, media_type="application/pdf", headers={**headers, "x-cache": "hit"})
    try:
        data = await render_pdf(infra, s, who.user, row.id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"PDF rendering failed: {e}") from e
    await infra.cache.set(key, data, infra.settings.pdf_cache_ttl)
    return Response(data, media_type="application/pdf", headers={**headers, "x-cache": "miss"})
