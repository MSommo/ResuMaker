"""Personas: personal details move out of each CV into a table of people who own CVs.

Existing CVs are backfilled: one persona per distinct person (same first name, last name and email), taken from the
CV's old `basics`. The CV keeps only its own headline; `name` becomes `title`.

Revision ID: 0002
Revises: 0001
"""
import json
import uuid
from datetime import datetime, timezone

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    op.create_table(
        "personas",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("first_name", sa.String(100), nullable=False, server_default=""),
        sa.Column("last_name", sa.String(100), nullable=False, server_default=""),
        sa.Column("email", sa.String(200), nullable=False, server_default=""),
        sa.Column("phone", sa.String(60), nullable=False, server_default=""),
        sa.Column("street", sa.String(200), nullable=False, server_default=""),
        sa.Column("city", sa.String(100), nullable=False, server_default=""),
        sa.Column("postcode", sa.String(30), nullable=False, server_default=""),
        sa.Column("country", sa.String(2), nullable=False, server_default=""),
        sa.Column("birth_date", sa.String(10), nullable=False, server_default=""),
        sa.Column("birth_place", sa.String(200), nullable=False, server_default=""),
        sa.Column("nationality", sa.String(100), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.add_column("resumes", sa.Column("persona_id", pg.UUID(as_uuid=True), nullable=True))
    op.add_column("resumes", sa.Column("title", sa.String(200), nullable=False, server_default="Untitled CV"))

    now = datetime.now(timezone.utc)
    by_person: dict[tuple[str, str, str], uuid.UUID] = {}
    for rid, data in conn.execute(sa.text("select id, data from resumes")).all():
        data = json.loads(data) if isinstance(data, str) else data
        b = data.get("basics") or {}
        a = b.get("address") or {}
        key = ((b.get("firstName") or "").strip().lower(), (b.get("lastName") or "").strip().lower(), (b.get("email") or "").strip().lower())
        if key not in by_person:
            pid = by_person[key] = uuid.uuid4()
            conn.execute(
                sa.text(
                    "insert into personas (id, first_name, last_name, email, phone, street, city, postcode, country, birth_date, birth_place, nationality, created_at, updated_at) "
                    "values (:id, :fn, :ln, :em, :ph, :st, :ci, :pc, :co, :bd, :bp, :na, :now, :now)"
                ),
                dict(id=pid, fn=b.get("firstName") or "", ln=b.get("lastName") or "", em=b.get("email") or "", ph=b.get("phone") or "",
                     st=a.get("street") or "", ci=a.get("city") or "", pc=a.get("postcode") or "", co=(a.get("country") or "")[:2],
                     bd=b.get("birthDate") or "", bp=b.get("birthPlace") or "", na=b.get("nationality") or "", now=now),
            )
        headline = b.get("headline") or ""
        data["basics"] = {"headline": headline}  # the CV keeps only its own headline
        conn.execute(
            sa.text("update resumes set persona_id = :pid, title = :title, data = cast(:data as jsonb) where id = :id"),
            dict(pid=by_person[key], title=headline or "Untitled CV", data=json.dumps(data), id=rid),
        )

    op.alter_column("resumes", "persona_id", nullable=False)
    op.create_foreign_key("fk_resumes_persona", "resumes", "personas", ["persona_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_resumes_persona_id", "resumes", ["persona_id"])
    op.drop_column("resumes", "name")


def downgrade() -> None:
    raise NotImplementedError("0002 moves data between tables; restore from a backup instead.")
