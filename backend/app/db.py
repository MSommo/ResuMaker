from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class PersonaRow(Base):
    """A person (you, a family member…) who owns CVs. Holds the personal details shared by all their CVs."""

    __tablename__ = "personas"

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

    @property
    def display_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or "Unnamed"


class ResumeRow(Base):
    """One CV of a persona. `data` is the CV document *without* the personal details (those live on the persona),
    keeping only this CV's own headline in `basics`."""

    __tablename__ = "resumes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    persona_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("personas.id", ondelete="CASCADE"), index=True)
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
