from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class UserRow(Base):
    """A person who signs in and owns CVs (what the UI calls a persona). Holds the personal details shared by all their CVs,
    and the credentials used to authenticate them. `email` is CV contact data the user can edit freely; `login` is the
    identifier they sign in with and is only ever changed by an admin."""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role in ('user','admin')", name="ck_users_role"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    first_name: Mapped[str] = mapped_column(String(100), default="")
    last_name: Mapped[str] = mapped_column(String(100), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(60), default="")
    street: Mapped[str] = mapped_column(String(200), default="")
    city: Mapped[str] = mapped_column(String(100), default="")
    postcode: Mapped[str] = mapped_column(String(30), default="")
    country: Mapped[str] = mapped_column(String(2), default="")  # ISO 3166-1 alpha-2
    birth_date: Mapped[str] = mapped_column(String(10), default="")  # YYYY-MM-DD
    birth_place: Mapped[str] = mapped_column(String(200), default="")
    nationality: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # ---- authentication / authorisation
    login: Mapped[str | None] = mapped_column(String(254), unique=True, nullable=True)  # lower-cased; NULL = cannot sign in
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)  # Argon2id; NULL = not claimed yet
    role: Mapped[str] = mapped_column(String(10), default="user", server_default="user")  # user | admin
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def display_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or "Unnamed"


class ResumeRow(Base):
    """One CV of a persona. `data` is the CV document *without* the personal details (those live on the persona),
    keeping only this CV's own headline in `basics`."""

    __tablename__ = "resumes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    persona_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="Untitled CV")  # derived from the headline
    layout_id: Mapped[str] = mapped_column(String(50), default="sidebar")
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    # Optimistic locking: a save must name the version it was based on.
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ResumeVersionRow(Base):
    """A snapshot of a CV's content (without the persona's details, like `ResumeRow.data`) taken *before* a change, so the
    change can be inspected (diff) and undone (restore). Taken before AI / operation / restore changes, and as a periodic
    checkpoint before a manual editing session."""

    __tablename__ = "resume_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resume_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)  # the CV's version number when the snapshot was taken
    source: Mapped[str] = mapped_column(String(20))  # ai | ops | mcp | autosave | before-restore | import
    label: Mapped[str] = mapped_column(String(200), default="")  # e.g. the instruction that caused the change
    layout_id: Mapped[str] = mapped_column(String(50), default="sidebar")
    title: Mapped[str] = mapped_column(String(200), default="Untitled CV")
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class ChatMessageRow(Base):
    """Assistant conversation per CV, so it survives reloads."""

    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resume_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    applied: Mapped[list[str]] = mapped_column(JSONB, default=list)
    skipped: Mapped[list[str]] = mapped_column(JSONB, default=list)
    # The snapshot taken just before this message's changes: what "Undo" restores. Cleared (SET NULL) if it is pruned.
    undo_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("resume_versions.id", ondelete="SET NULL"), nullable=True)
    undone: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


def make_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


class MemoryRow(Base):
    """Something to remember about a person: a style preference ("short bullets") or a fact they confirmed. Searchable by meaning."""

    __tablename__ = "memories"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    persona_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # "preference" | "fact"
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float]] = mapped_column(Vector(768))
    source_resume_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SessionRow(Base):
    """A signed-in browser. Only the SHA-256 of the cookie's token is stored, so a database leak yields no usable sessions.
    kind "render" is a 2-minute, read-only session minted for the headless Chrome that renders a PDF."""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10), default="web")  # web | render
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # absolute lifetime
    ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(200), default="")


class UserTokenRow(Base):
    """A single-purpose secret, stored hashed. `invite` / `reset`: one-time links to set a password (expire, then are spent).
    `api`: a personal access token for the MCP server, which acts as this user."""

    __tablename__ = "user_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(10))  # invite | reset | api
    name: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
