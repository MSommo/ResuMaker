"""MCP server for ResuMaker: lets Claude Desktop / Claude Code / any MCP client read and edit your CVs.

    uv run python -m app.mcp_server            # stdio (what desktop clients launch)
    uv run python -m app.mcp_server --http     # streamable HTTP on http://127.0.0.1:8101/mcp

It talks to the same Postgres, Redis and operations engine as the web app, so edits show up in the editor.
Deleting CVs is intentionally not exposed.

Authentication: the server acts as ONE user, identified by the access token in RESUMAKER_TOKEN (create it with
`make mcp-token LOGIN=you@example.com`). Without a valid token it refuses to start. Every tool is scoped to that user's own CVs,
exactly like the web app: another person's CV looks like it doesn't exist.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations

from .agent.llm import LLMError
from .domain.diff import diff_resumes
from .domain.models import PersonalDetails, Resume
from .domain.ops import Op, apply_ops
from .infra import Infra
from .services import auth
from .services import personas as people
from .services import resumes as repo
from .services import versions
from .services.chat import ProposalGone, decide, run_chat, stream_chat
from .services import memory as mem
from .services.pdf import render_pdf
from .services.tailor import stream_tailor
from .services.improve import improve_text

_infra: Infra | None = None
_user_id: uuid.UUID | None = None  # who this server acts as; fixed at startup from RESUMAKER_TOKEN
PDF_DIR = Path(__file__).resolve().parents[1] / ".data" / "pdfs"


@asynccontextmanager
async def lifespan(_: MCPServer):
    global _infra, _user_id
    token = os.environ.get("RESUMAKER_TOKEN", "").strip()
    if not token:
        sys.exit("RESUMAKER_TOKEN is not set. Create one with `make mcp-token LOGIN=<your sign-in email>` and put it in the MCP client's env.")
    _infra = await Infra().start()
    async with _infra.session() as s:
        user = await auth.resolve_api_token(s, token)
    if user is None:
        await _infra.stop()
        sys.exit("RESUMAKER_TOKEN is invalid, expired, or its user is disabled.")
    _user_id = user.id
    try:
        yield
    finally:
        await _infra.stop()
        _infra = _user_id = None


mcp = MCPServer(
    "resumaker",
    instructions=(
        "Tools to read and edit the signed-in user's CVs in ResuMaker (you act as that one user; you cannot see anyone else's). Start with list_resumes, "
        "then get_resume to see ids. Personal details belong to the user's profile and are shared by all their CVs; the headline is per CV. "
        "Use apply_operations for precise edits (ids come from get_resume) or ask_assistant to delegate a natural-language request. "
        "Never invent facts about the person; ask the user when information is missing."
    ),
    lifespan=lifespan,
)


def infra() -> Infra:
    assert _infra is not None, "server not started"
    return _infra


def me() -> uuid.UUID:
    assert _user_id is not None, "server not started"
    return _user_id


async def _own(resume_id: str) -> uuid.UUID:
    async with infra().session() as s:
        row, _ = await _cv(s, resume_id)
        return row.id


def _uuid(resume_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(resume_id)
    except ValueError:
        raise ValueError(f"'{resume_id}' is not a valid CV id. Call list_resumes to see ids.") from None


READ_ONLY = ToolAnnotations(read_only_hint=True)  # lets MCP clients auto-approve calls that cannot change anything


async def _cv(s, resume_id: str):
    """(CV row, persona): only the acting user's own CVs; anything else is reported as not found."""
    try:
        row, persona = await repo.get_resume(s, _uuid(resume_id))
    except repo.NotFound:
        raise ValueError("CV not found.") from None
    if row.persona_id != me():
        raise ValueError("CV not found.")
    return row, persona


@mcp.tool(annotations=READ_ONLY)
async def whoami() -> dict[str, Any]:
    """The user these tools act as (name, sign-in, role) and how many CVs they have. You can only see and change this user's CVs."""
    async with infra().session() as s:
        u = await people.get_persona(s, me())
        return {"id": str(u.id), "name": u.display_name, "login": u.login, "role": u.role, "resumeCount": len(await people.persona_resumes(s, u.id))}


@mcp.tool(annotations=READ_ONLY)
async def list_resumes() -> list[dict[str, Any]]:
    """List your CVs (id, title, layout, version, last update)."""
    async with infra().session() as s:
        rows = await people.persona_resumes(s, me())
        return [{"id": str(r.id), "title": r.title, "layoutId": r.layout_id, "version": r.version, "updatedAt": r.updated_at.isoformat()} for r in rows]


@mcp.tool(annotations=READ_ONLY)
async def get_resume(resume_id: str) -> dict[str, Any]:
    """Get a complete CV as JSON: basics (the persona's details + this CV's headline) plus sections with ids for sections and their items. Sections with zone=null are not shown in the CV."""
    async with infra().session() as s:
        row, persona = await _cv(s, resume_id)
        return repo.merged(row, persona).model_dump(mode="json")


@mcp.tool()
async def create_resume(layout_id: str = "sidebar", template: str = "blank") -> dict[str, str]:
    """Create a new CV for you. layout_id: 'sidebar' or 'timeline'. template: 'blank' or 'sample' (sample text; your own details are always used)."""
    async with infra().session() as s:
        row, _ = await repo.create_resume(s, me(), layout_id=layout_id, template=template)
        return {"id": str(row.id), "title": row.title}


@mcp.tool()
async def apply_operations(resume_id: str, operations: list[Op], dry_run: bool = False) -> dict[str, Any]:
    """Apply precise edits to a CV and save it. Invalid operations are skipped with a reason; valid ones still apply.

    With dry_run=true nothing is saved: you get what would be applied or skipped and a readable list of "changes". Use it to
    preview before committing. Real changes are snapshotted first, so they can be undone with restore_version (see "undoVersionId").

    Operations (patch holds only the fields to set; use ids from get_resume, and choose new ids for things you create):
    - update_basics {patch}: firstName,lastName,headline,email,phone,street,city,postcode,country(ISO alpha-2),birthDate(YYYY-MM-DD),birthPlace,nationality
    - update_section {sectionId, patch}: title,text (text sections),icon,job (timeline sections)
    - add_section {sectionId(new), template, zone?, position?, patch?}; remove_section {sectionId}; move_section {sectionId, zone, position?}
    - add_item {sectionId, itemId(new), position?, patch}: entry(title,organisation,location,start YYYY-MM,end,current,note,description,bullets) | skill(name,level 1-5) | link(label,url)
    - update_item {sectionId, itemId, patch}; remove_item {sectionId, itemId}; move_item {sectionId, itemId, position}
    - set_layout {layoutId}
    In an entry's bullets, a line starting with "# " is a subheading.
    """
    async with infra().session() as s:
        row, persona = await _cv(s, resume_id)
        before = repo.merged(row, persona)
        res = apply_ops(before, operations)
        undo_id = None
        saved = bool(res.applied) and not dry_run
        if saved:
            undo_id = str((await versions.snapshot(s, row, source="mcp", label=f"{len(res.applied)} operation(s) via MCP")).id)
            row, _ = await repo.save_resume(s, row.id, res.resume, row.version, update_persona=True)
        return {"applied": res.applied, "skipped": res.skipped, "changes": diff_resumes(before, res.resume), "saved": saved, "version": row.version, "undoVersionId": undo_id}


@mcp.tool(annotations=READ_ONLY)
async def list_versions(resume_id: str) -> list[dict[str, Any]]:
    """The CV's version history, newest first: snapshots taken before AI/API/MCP changes and before manual editing sessions."""
    async with infra().session() as s:
        row, _ = await _cv(s, resume_id)
        return [{"id": str(v.id), "version": v.version, "source": v.source, "label": v.label, "createdAt": v.created_at.isoformat()} for v in await versions.list_versions(s, row.id)]


@mcp.tool(annotations=READ_ONLY)
async def diff_version(resume_id: str, version_id: str) -> list[str]:
    """What restoring a version would change: the snapshot compared with the CV as it is now, as readable lines."""
    async with infra().session() as s:
        row, persona = await _cv(s, resume_id)
        try:
            v = await versions.get_version(s, row.id, _uuid(version_id))
        except versions.VersionNotFound:
            raise ValueError("Version not found. Call list_versions to see ids.") from None
        return diff_resumes(repo.merged(row, persona), repo.merged_from(v.data, persona))


@mcp.tool()
async def restore_version(resume_id: str, version_id: str) -> dict[str, Any]:
    """Make the CV match a snapshot (this is how to undo a change). The current state is snapshotted first, so a restore can be undone too."""
    async with infra().session() as s:
        row, _ = await _cv(s, resume_id)
        try:
            row, _ = await versions.restore(s, row.id, _uuid(version_id))
        except versions.VersionNotFound:
            raise ValueError("Version not found. Call list_versions to see ids.") from None
        return {"restored": True, "version": row.version}


@mcp.tool(name="improve_text")
async def improve_text_tool(text: str, kind: str = "text", instruction: str = "") -> str:
    """Rewrite CV text to be clearer and more impactful without inventing facts. kind: headline | summary | description | bullet | subheading | note | text. Results are cached."""
    try:
        out, _ = await improve_text(infra(), kind=kind, text=text, instruction=instruction)
    except (LLMError, RuntimeError) as e:
        raise ValueError(str(e)) from None
    return out


@mcp.tool()
async def ask_assistant(resume_id: str, instruction: str) -> dict[str, Any]:
    """Delegate a natural-language request to ResuMaker's own LangGraph agent (route → plan → apply → repair). It edits the CV
    directly and returns "undoVersionId" (pass it to restore_version to undo). Questions are answered without changing anything.
    To review changes before they are applied, use propose_changes instead."""
    rid = await _own(resume_id)
    try:
        out = await run_chat(infra(), rid, instruction)
    except repo.NotFound:
        raise ValueError("CV not found.") from None
    except LLMError as e:
        raise ValueError(str(e)) from None
    return {"reply": out.reply, "applied": out.applied, "skipped": out.skipped, "changes": out.changes, "version": out.row.version, "undoVersionId": out.undo_version_id}


@mcp.tool()
async def propose_changes(resume_id: str, instruction: str) -> dict[str, Any]:
    """Like ask_assistant, but NOTHING is changed yet: the agent plans and validates the changes, then pauses. You get
    "runId" and a numbered list of "items". Show them to the user, then call decide_proposal with the ones to keep.
    If the request was only a question there is nothing to review and you get the answer in "reply" directly."""
    rid = await _own(resume_id)
    try:
        async for ev in stream_chat(infra(), rid, instruction, "propose"):
            if ev["type"] == "proposal":
                return {k: ev[k] for k in ("runId", "reply", "items", "skipped", "changes")}
            if ev["type"] == "done":
                o = ev["outcome"]
                return {"reply": o.reply, "items": [], "changes": o.changes, "version": o.row.version}
    except repo.NotFound:
        raise ValueError("CV not found.") from None
    except LLMError as e:
        raise ValueError(str(e)) from None
    raise ValueError("The assistant did not finish.")


@mcp.tool(annotations=ToolAnnotations(read_only_hint=True))
async def list_memories() -> list[dict[str, Any]]:
    """What ResuMaker remembers about you: style preferences and facts you confirmed. The editing agent uses these."""
    async with infra().session() as s:
        return [{"id": str(m.id), "kind": m.kind, "text": m.text} for m in await mem.list_memories(s, me())]


@mcp.tool()
async def remember(text: str, kind: str = "preference") -> dict[str, Any]:
    """Save one preference (how they want their CV written) or fact (something they confirmed about themselves). Only do this
    when the person asked you to remember it. Saying the same thing twice keeps one memory."""
    i = infra()
    if i.llm is None:
        raise ValueError("AI is not configured, so memory (which uses embeddings) is unavailable.")
    async with i.session() as s:
        try:
            row, created = await mem.add(s, i.llm, me(), kind, text)
        except (ValueError, mem.MemoryNotFound, mem.MemoryFull, LLMError) as e:
            raise ValueError(str(e) or "Could not save that memory.") from None
    return {"id": str(row.id), "text": row.text, "created": created}


@mcp.tool()
async def forget_memory(memory_id: str) -> str:
    """Delete one saved memory by id (from list_memories)."""
    async with infra().session() as s:
        try:
            await mem.delete(s, _uuid(memory_id), owner=me())
        except mem.MemoryNotFound:
            raise ValueError("Memory not found.") from None
    return "Forgotten."


@mcp.tool()
async def tailor_to_posting(resume_id: str, posting: str) -> dict[str, Any]:
    """Tailor a CV to a job posting (paste the posting's text). Creates a NEW variant CV, so the original is never changed,
    and returns "variantResumeId", what the role needs ("spec": matched / gaps), and a numbered list of proposed "items".
    Nothing is applied yet: show the user, then call decide_proposal with resume_id=variantResumeId and the "runId".
    To discard the variant instead, ask the user to delete it in the app."""
    if len(posting.strip()) < 40:
        raise ValueError("Paste the full text of the job posting.")
    rid = await _own(resume_id)
    spec: dict[str, Any] = {}
    variant = ""
    try:
        async for ev in stream_tailor(infra(), rid, posting[:12000]):
            if ev["type"] == "spec":
                spec = {k: v for k, v in ev.items() if k != "type"}
            elif ev["type"] == "variant":
                variant = ev["resumeId"]
            elif ev["type"] == "proposal":
                return {"variantResumeId": variant, "spec": spec, **{k: ev[k] for k in ("runId", "reply", "items", "skipped", "changes")}}
    except repo.NotFound:
        raise ValueError("CV not found.") from None
    except LLMError as e:
        raise ValueError(str(e)) from None
    raise ValueError("The assistant did not finish.")


@mcp.tool()
async def decide_proposal(resume_id: str, run_id: str, accept: list[int] | str = "all") -> dict[str, Any]:
    """Apply a proposal from propose_changes. accept: "all", "none", or the list of item indices to keep (e.g. [0, 2]).
    A proposal can be decided once; if the CV changed in the meantime this fails and you should propose again."""
    if isinstance(accept, str) and accept not in ("all", "none"):
        raise ValueError('accept must be "all", "none" or a list of item indices.')
    rid = await _own(resume_id)
    try:
        out = await decide(infra(), rid, run_id, accept)
    except ProposalGone:
        raise ValueError("This proposal was already decided, or has expired. Propose again.") from None
    except repo.VersionConflict:
        raise ValueError("The CV changed while the proposal was waiting. Propose again.") from None
    except repo.NotFound:
        raise ValueError("CV not found.") from None
    except LLMError as e:
        raise ValueError(str(e)) from None
    return {"reply": out.reply, "applied": out.applied, "changes": out.changes, "version": out.row.version, "undoVersionId": out.undo_version_id}


@mcp.tool()
async def export_pdf(resume_id: str) -> str:
    """Render a CV to PDF and return the file path. Requires the frontend to be running (FRONTEND_URL) and Chrome installed."""
    i = infra()
    async with i.session() as s:
        row, persona = await _cv(s, resume_id)
        data = await render_pdf(i, s, persona, row.id)
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    path = PDF_DIR / f"{row.title.lower().replace(' ', '-').replace('/', '-')}-{str(row.id)[:8]}.pdf"
    path.write_bytes(data)
    return str(path)


@mcp.resource("resume://{resume_id}", mime_type="application/json")
async def resume_resource(resume_id: str) -> str:
    """A CV document as JSON."""
    return json.dumps(await get_resume(resume_id), ensure_ascii=False, indent=2)


@mcp.prompt()
def review_cv(resume_id: str) -> str:
    """Ask for a concise review of a CV."""
    return (
        f"Fetch the CV with id {resume_id} using get_resume. Review it as a recruiter would: point out unclear or weak bullets, "
        "missing dates or sections, and inconsistencies. Be specific and brief. Do not change anything unless I ask."
    )


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--http", action="store_true", help="serve streamable HTTP instead of stdio")
    p.add_argument("--port", type=int, default=8101)
    args = p.parse_args()
    if args.http:
        mcp.run(transport="streamable-http", host="127.0.0.1", port=args.port)
    else:
        mcp.run()


if __name__ == "__main__":
    main()
