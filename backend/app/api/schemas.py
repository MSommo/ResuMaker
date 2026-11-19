from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..db import PersonaRow, ResumeRow, ResumeVersionRow
from ..domain.models import PersonalDetails, Resume
from ..domain.ops import Op
from ..services.personas import to_details
from ..services.resumes import merged


class PersonaIn(PersonalDetails):
    firstName: str = Field(min_length=1, max_length=100)  # noqa: N815


class PersonaOut(PersonalDetails):
    id: str
    resumeCount: int = 0  # noqa: N815
    createdAt: datetime  # noqa: N815
    updatedAt: datetime  # noqa: N815

    @classmethod
    def of(cls, p: PersonaRow, resume_count: int = 0) -> "PersonaOut":
        return cls(id=str(p.id), resumeCount=resume_count, createdAt=p.created_at, updatedAt=p.updated_at, **to_details(p).model_dump())


class ResumeSummary(BaseModel):
    id: str
    personaId: str  # noqa: N815
    title: str
    layoutId: str  # noqa: N815
    version: int
    updatedAt: datetime  # noqa: N815

    @classmethod
    def of(cls, row: ResumeRow) -> "ResumeSummary":
        return cls(id=str(row.id), personaId=str(row.persona_id), title=row.title, layoutId=row.layout_id, version=row.version, updatedAt=row.updated_at)


class ResumeOut(ResumeSummary):
    createdAt: datetime  # noqa: N815
    persona: PersonaOut
    resume: Resume  # complete: persona details merged in

    @classmethod
    def of(cls, row: ResumeRow, persona: PersonaRow) -> "ResumeOut":  # type: ignore[override]
        return cls(
            id=str(row.id), personaId=str(row.persona_id), title=row.title, layoutId=row.layout_id, version=row.version,
            updatedAt=row.updated_at, createdAt=row.created_at, persona=PersonaOut.of(persona), resume=merged(row, persona),
        )


class PersonaDetail(BaseModel):
    persona: PersonaOut
    resumes: list[ResumeSummary]


class CreateResumeIn(BaseModel):
    resume: Resume | None = None  # import an existing document, or…
    layoutId: str = "sidebar"  # noqa: N815
    template: Literal["blank", "sample"] = "blank"  # …start from a template


class SaveIn(BaseModel):
    resume: Resume
    version: int | None = None  # the version this edit was based on; omit to overwrite


class OpsIn(BaseModel):
    ops: list[Op] = Field(max_length=60)
    dryRun: bool = False  # noqa: N815  (validate and preview; save nothing)


class OpsOut(BaseModel):
    applied: list[str]
    skipped: list[str]
    changes: list[str]  # what the CV looks like after, compared with before
    saved: bool  # False for a dry run
    version: int  # the CV's version (unchanged for a dry run)
    undoVersionId: str | None = None  # noqa: N815  (snapshot taken before the change; restore it to undo)
    resume: Resume  # complete CV after the ops (the proposed state for a dry run)


class VersionOut(BaseModel):
    id: str
    version: int
    source: str
    label: str
    createdAt: datetime  # noqa: N815

    @classmethod
    def of(cls, v: "ResumeVersionRow") -> "VersionOut":
        return cls(id=str(v.id), version=v.version, source=v.source, label=v.label, createdAt=v.created_at)


class DiffOut(BaseModel):
    changes: list[str]


class ImproveIn(BaseModel):
    kind: str = "text"
    text: str = Field(min_length=1, max_length=8000)
    instruction: str = Field(default="", max_length=300)
    context: dict[str, Any] = Field(default_factory=dict)


class ImproveOut(BaseModel):
    text: str
    cached: bool


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class ChatMessageOut(BaseModel):
    id: str
    role: str
    text: str
    applied: list[str] = []
    skipped: list[str] = []
    undoVersionId: str | None = None  # noqa: N815
    undone: bool = False


class ChatOut(BaseModel):
    reply: str
    applied: list[str]
    skipped: list[str]
    changes: list[str] = []
    messageId: str  # noqa: N815
    undoVersionId: str | None = None  # noqa: N815  (restore this version to undo the change)
    resume: ResumeOut
