"""Initial schema: resumes and chat messages.

Idempotent on purpose: databases created before Alembic was introduced (by `create_all`) already have these tables.

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("resumes"):
        op.create_table(
            "resumes",
            sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
            sa.Column("name", sa.String(200), nullable=False, server_default="Untitled CV"),
            sa.Column("layout_id", sa.String(50), nullable=False, server_default="sidebar"),
            sa.Column("data", pg.JSONB, nullable=False),
            sa.Column("version", sa.Integer, nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
    if not insp.has_table("chat_messages"):
        op.create_table(
            "chat_messages",
            sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
            sa.Column("resume_id", pg.UUID(as_uuid=True), sa.ForeignKey("resumes.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("role", sa.String(20), nullable=False),
            sa.Column("text", sa.Text, nullable=False),
            sa.Column("applied", pg.JSONB, nullable=False),
            sa.Column("skipped", pg.JSONB, nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, index=True),
        )


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("resumes")
