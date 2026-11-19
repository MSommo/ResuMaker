"""MCP server for ResuMaker: lets Claude Desktop / Claude Code / any MCP client read and edit your CVs.

    uv run python -m app.mcp_server            # stdio (what desktop clients launch)
    uv run python -m app.mcp_server --http     # streamable HTTP on http://127.0.0.1:8101/mcp

It talks to the same Postgres, Redis and operations engine as the web app, so edits show up in the editor.
Deleting CVs is intentionally not exposed.
"""

from __future__ import annotations

import argparse
import json
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
from .services import personas as people
from .services import resumes as repo
from .services import versions
from .services.chat import ProposalGone, decide, run_chat, stream_chat
from .services.improve import improve_text

_infra: Infra | None = None
PDF_DIR = Path(__file__).resolve().parents[1] / ".data" / "pdfs"


@asynccontextmanager
async def lifespan(_: MCPServer):
    global _infra
    _infra = await Infra().start()
    try:
        yield
    finally:
        await _infra.stop()
        _infra = None


mcp = MCPServer(
    "resumaker",
    instructions=(
        "Tools to read and edit CVs stored in ResuMaker. CVs belong to personas (people): start with list_personas, then list_resumes for a persona, "
        "then get_resume to see ids. Personal details belong to the persona and are shared by all their CVs; the headline is per CV. "
        "Use apply_operations for precise edits (ids come from get_resume) or ask_assistant to delegate a natural-language request. "
        "Never invent facts about the person; ask the user when information is missing."
    ),
    lifespan=lifespan,
)


def infra() -> Infra:
    assert _infra is not None, "server not started"
    return _infra


def _uuid(resume_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(resume_id)
    except ValueError:
        raise ValueError(f"'{resume_id}' is not a valid CV id. Call list_resumes to see ids.") from None


READ_ONLY = ToolAnnotations(read_only_hint=True)  # lets MCP clients auto-approve calls that cannot change anything


async def _cv(s, resume_id: str):
    try:
        return await repo.get_resume(s, _uuid(resume_id))
    except repo.NotFound:
        raise ValueError("CV not found.") from None


@mcp.tool(annotations=READ_ONLY)
async def list_personas() -> list[dict[str, Any]]:
    """List the people (personas) whose CVs are stored, with how many CVs each has."""
    async with infra().session() as s:
        return [{"id": str(p.id), "name": p.display_name, "email": p.email, "resumeCount": n} for p, n in await people.list_personas(s)]


@mcp.tool()
async def create_persona(first_name: str, last_name: str = "", email: str = "", phone: str = "") -> dict[str, str]:
    """Create a persona (a person who owns CVs). More details can be set later with apply_operations (update_basics)."""
    async with infra().session() as s:
        p = await people.create_persona(s, PersonalDetails(firstName=first_name, lastName=last_name, email=email, phone=phone))
        return {"id": str(p.id), "name": p.display_name}


@mcp.tool(annotations=READ_ONLY)
async def list_resumes(persona_id: str = "") -> list[dict[str, Any]]:
    """List CVs (id, title, layout, version, last update). Pass persona_id for one person's CVs; omit it for everyone's."""
    async with infra().session() as s:
        if persona_id:
            try:
                await people.get_persona(s, _uuid(persona_id))
            except people.PersonaNotFound:
                raise ValueError("Persona not found. Call list_personas to see ids.") from None
            rows = await people.persona_resumes(s, _uuid(persona_id))
        else:
            rows = [r for p, _ in await people.list_personas(s) for r in await people.persona_resumes(s, p.id)]
        return [{"id": str(r.id), "personaId": str(r.persona_id), "title": r.title, "layoutId": r.layout_id, "version": r.version, "updatedAt": r.updated_at.isoformat()} for r in rows]


@mcp.tool(annotations=READ_ONLY)
async def get_resume(resume_id: str) -> dict[str, Any]:
    """Get a complete CV as JSON: basics (the persona's details + this CV's headline) plus sections with ids for sections and their items. Sections with zone=null are not shown in the CV."""
    async with infra().session() as s:
        try:
            row, persona = await repo.get_resume(s, _uuid(resume_id))
        except repo.NotFound:
            raise ValueError("CV not found.") from None
        return repo.merged(row, persona).model_dump(mode="json")


@mcp.tool()
async def create_resume(persona_id: str, layout_id: str = "sidebar", template: str = "blank") -> dict[str, str]:
    """Create a new CV for a persona. layout_id: 'sidebar' or 'timeline'. template: 'blank' or 'sample' (sample text; the persona's own details are always used)."""
    async with infra().session() as s:
        try:
            row, _ = await repo.create_resume(s, _uuid(persona_id), layout_id=layout_id, template=template)
        except people.PersonaNotFound:
            raise ValueError("Persona not found. Call list_personas to see ids.") from None
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
        try:
            row, persona = await repo.get_resume(s, _uuid(resume_id))
        except repo.NotFound:
            raise ValueError("CV not found.") from None
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
    try:
        out = await run_chat(infra(), _uuid(resume_id), instruction)
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
    try:
        async for ev in stream_chat(infra(), _uuid(resume_id), instruction, "propose"):
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


@mcp.tool()
async def decide_proposal(resume_id: str, run_id: str, accept: list[int] | str = "all") -> dict[str, Any]:
    """Apply a proposal from propose_changes. accept: "all", "none", or the list of item indices to keep (e.g. [0, 2]).
    A proposal can be decided once; if the CV changed in the meantime this fails and you should propose again."""
    if isinstance(accept, str) and accept not in ("all", "none"):
        raise ValueError('accept must be "all", "none" or a list of item indices.')
    try:
        out = await decide(infra(), _uuid(resume_id), run_id, accept)
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
        try:
            row, _ = await repo.get_resume(s, _uuid(resume_id))
        except repo.NotFound:
            raise ValueError("CV not found.") from None
    data = await i.pdf.render(f"{i.settings.frontend_url}/preview/{row.id}")
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
