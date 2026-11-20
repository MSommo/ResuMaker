from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..db import UserRow, ResumeRow, ResumeVersionRow
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
    def of(cls, p: UserRow, resume_count: int = 0) -> "PersonaOut":
        return cls(id=str(p.id), resumeCount=resume_count, createdAt=p.created_at, updatedAt=p.updated_at, **to_details(p).model_dump())


def _headline(row: ResumeRow) -> str:
    return str(((row.data or {}).get("basics") or {}).get("headline", ""))


class ResumeSummary(BaseModel):
    id: str
    personaId: str  # noqa: N815
    title: str  # what to show: the name, else the headline, else "Untitled CV"
    name: str  # the owner's own label, never printed ("" = none)
    headline: str  # printed under the name on the CV
    layoutId: str  # noqa: N815
    version: int
    updatedAt: datetime  # noqa: N815

    @classmethod
    def of(cls, row: ResumeRow) -> "ResumeSummary":
        return cls(id=str(row.id), personaId=str(row.persona_id), title=row.title, name=row.name, headline=_headline(row), layoutId=row.layout_id, version=row.version, updatedAt=row.updated_at)


class ResumeOut(ResumeSummary):
    createdAt: datetime  # noqa: N815
    persona: PersonaOut
    resume: Resume  # complete: persona details merged in

    @classmethod
    def of(cls, row: ResumeRow, persona: UserRow) -> "ResumeOut":  # type: ignore[override]
        return cls(
            id=str(row.id), personaId=str(row.persona_id), title=row.title, name=row.name, headline=_headline(row), layoutId=row.layout_id, version=row.version,
            updatedAt=row.updated_at, createdAt=row.created_at, persona=PersonaOut.of(persona), resume=merged(row, persona),
        )


class PersonaDetail(BaseModel):
    persona: PersonaOut
    resumes: list[ResumeSummary]


class CreateResumeIn(BaseModel):
    resume: Resume | None = None  # import an existing document, or…
    layoutId: str = "sidebar"  # noqa: N815
    template: Literal["blank", "sample"] = "blank"  # …start from a template
    name: str = Field("", max_length=100)


class RenameIn(BaseModel):
    name: str = Field(max_length=100)  # "" clears it


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


class ChatStreamIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    # "propose": don't change the CV yet; stream a proposal to accept or reject (POST .../chat/{runId}/decide).
    mode: Literal["apply", "propose"] = "apply"


class TailorIn(BaseModel):
    posting: str = Field(min_length=40, max_length=12000)  # pasted text; the server never fetches URLs


class DecideIn(BaseModel):
    # "all", "none", or the indices (from the proposal's `items`) of the changes to keep.
    accept: Literal["all", "none"] | list[int] = "all"


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
    intent: str = "edit"  # "edit" | "answer" | "remember": lets the UI refresh the Memory panel
    resume: ResumeOut


class MemoryIn(BaseModel):
    kind: Literal["preference", "fact"] = "preference"
    text: str = Field(min_length=1, max_length=300)


class MemoryOut(BaseModel):
    id: str
    kind: str
    text: str
    createdAt: datetime  # noqa: N815


class ImportOut(BaseModel):
    """A CV read from a file. Nothing is saved: review it, then create it with POST /personas/{id}/resumes."""

    resume: Resume  # includes the personal details found in the file (the persona's own are used when the CV is created)
    kind: str  # "pdf" | "docx" | "html"
    language: str = ""
    warnings: list[str] = []
    stats: dict[str, int] = {}  # items per section


# ------------------------------------------------------------------ accounts


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class MeOut(BaseModel):
    """The signed-in user: their profile (as a persona) plus what they may do."""

    login: str
    role: Literal["user", "admin"]
    ai: bool  # this account may use the AI features (the server must also have AI: see /status)
    persona: PersonaOut

    @classmethod
    def of(cls, u: UserRow, resume_count: int = 0) -> "MeOut":
        return cls(login=u.login or "", role=u.role, ai=u.has_ai, persona=PersonaOut.of(u, resume_count))  # type: ignore[arg-type]


class PasswordIn(BaseModel):
    current: str = Field(min_length=1, max_length=256)
    new: str = Field(min_length=1, max_length=256)


class AcceptIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=1, max_length=256)


class ConfirmIn(BaseModel):
    """Destructive actions ask for the caller's own password again."""

    password: str = Field(min_length=1, max_length=256)


class AiUsageSummaryOut(BaseModel):
    """One person's AI use, for the Users list (admins only). Requests leave out refused attempts, counted in `rejected`."""

    today: int  # UTC day, like the daily limit
    week: int
    month: int  # last 30 days, like everything below
    tokens: int
    costUsd: float  # noqa: N815  # estimated, from AI_PRICES
    errors: int
    rejected: int
    offTopicShare: float | None  # noqa: N815  # of the chat turns the router classified; None = no chat yet
    lastUsedAt: datetime | None  # noqa: N815
    dailyLimit: int  # noqa: N815  # 0 = unlimited

    @classmethod
    def of(cls, u: Any, daily_limit: int) -> "AiUsageSummaryOut":
        return cls(
            today=u.today, week=u.week, month=u.month, tokens=u.tokens_month, costUsd=round(u.cost_month, 6), errors=u.errors_month,
            rejected=u.rejected_month, offTopicShare=u.off_topic_share, lastUsedAt=u.last_used_at, dailyLimit=daily_limit,
        )


class AdminUserOut(BaseModel):
    id: str
    login: str | None
    firstName: str  # noqa: N815
    lastName: str  # noqa: N815
    role: Literal["user", "admin"]
    isActive: bool  # noqa: N815
    aiEnabled: bool  # noqa: N815  # the stored flag; administrators have AI regardless
    status: Literal["draft", "invited", "active", "locked", "disabled"]  # draft: prepared by an admin, no link sent yet
    resumeCount: int  # noqa: N815
    lastLoginAt: datetime | None  # noqa: N815
    createdAt: datetime  # noqa: N815
    aiUsage: AiUsageSummaryOut | None = None  # noqa: N815

    @classmethod
    def of(cls, u: UserRow, resume_count: int, invited: bool = False, ai_usage: AiUsageSummaryOut | None = None) -> "AdminUserOut":
        from ..services.auth import is_locked

        status = "disabled" if not u.is_active else "locked" if is_locked(u) else "active" if u.password_hash else "invited" if invited else "draft"
        return cls(
            id=str(u.id), login=u.login, firstName=u.first_name, lastName=u.last_name, role=u.role, isActive=u.is_active, aiEnabled=u.ai_enabled,  # type: ignore[arg-type]
            status=status, resumeCount=resume_count, lastLoginAt=u.last_login_at, createdAt=u.created_at, aiUsage=ai_usage,
        )


class AdminUserIn(BaseModel):
    """A persona draft: just a name and the email the person will sign in with. No password, no link yet."""

    firstName: str = Field(min_length=1, max_length=100)  # noqa: N815
    lastName: str = Field(default="", max_length=100)  # noqa: N815
    login: str = Field(min_length=3, max_length=254)
    role: Literal["user", "admin"] = "user"


class AdminUserPatch(BaseModel):
    role: Literal["user", "admin"] | None = None
    isActive: bool | None = None  # noqa: N815
    aiEnabled: bool | None = None  # noqa: N815
    login: str | None = Field(default=None, min_length=3, max_length=254)


class AiUsageDayOut(BaseModel):
    day: str  # YYYY-MM-DD, UTC
    requests: int
    tokens: int
    cost: float
    errors: int
    rejected: int


class AiUsageFeatureOut(BaseModel):
    feature: str
    requests: int
    tokens: int
    cost: float
    errors: int
    rejected: int


class AiUsageModelOut(BaseModel):
    model: str
    calls: int
    inputTokens: int  # noqa: N815
    outputTokens: int  # noqa: N815
    errors: int
    cost: float  # at today's prices


class AiUsageRecordOut(BaseModel):
    """One request, metadata only: there is no prompt, CV or chat text to show."""

    id: str
    at: datetime
    feature: str
    source: str
    intent: str | None
    status: str
    reason: str | None
    model: str | None
    calls: int
    inputTokens: int  # noqa: N815
    outputTokens: int  # noqa: N815
    costUsd: float  # noqa: N815
    latencyMs: int  # noqa: N815
    opsApplied: int  # noqa: N815
    opsRejected: int  # noqa: N815
    guardRejections: int  # noqa: N815
    requestId: str | None  # noqa: N815

    @classmethod
    def of(cls, r: Any) -> "AiUsageRecordOut":
        return cls(
            id=str(r.id), at=r.created_at, feature=r.feature, source=r.source, intent=r.intent, status=r.status, reason=r.reason, model=r.model,
            calls=r.calls, inputTokens=r.input_tokens, outputTokens=r.output_tokens, costUsd=round(r.cost_usd, 6), latencyMs=r.latency_ms,
            opsApplied=r.ops_applied, opsRejected=r.ops_rejected, guardRejections=r.guard_rejections, requestId=r.request_id,
        )


class AiUsageDetailOut(BaseModel):
    userId: str  # noqa: N815
    start: datetime
    end: datetime
    summary: AiUsageSummaryOut
    series: list[AiUsageDayOut]
    byFeature: list[AiUsageFeatureOut]  # noqa: N815
    byModel: list[AiUsageModelOut]  # noqa: N815
    recent: list[AiUsageRecordOut]
    pricesConfigured: bool  # noqa: N815  # False: no price for the models used, so costs read 0


class ClientErrorIn(BaseModel):
    """A browser error. Sizes are capped: it's a report, not a log upload."""

    message: str = Field(max_length=1000)
    stack: str = Field(default="", max_length=8000)
    path: str = Field(default="", max_length=500)  # location.pathname: ids at most, never the query
    release: str = Field(default="", max_length=100)


class InviteOut(BaseModel):
    """Shown once. The link is the only copy: only its hash is stored. Share it privately; it expires and works once."""

    user: AdminUserOut
    link: str
    expiresInHours: int  # noqa: N815
