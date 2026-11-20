"""Memory: things the assistant should remember about a person, searchable by meaning (pgvector).

Needs the `vector` extension (the scratch stack uses the pgvector/pgvector image). Rows belong to a persona and go with it.
No ANN index on purpose: a household has tens of memories per person, and an exact scan is both faster and exact at that size.

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql as pg

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "memories",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("persona_id", pg.UUID(as_uuid=True), sa.ForeignKey("personas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("embedding", Vector(768), nullable=False),
        sa.Column("source_resume_id", pg.UUID(as_uuid=True), sa.ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_memories_persona_id", "memories", ["persona_id"])


def downgrade() -> None:
    op.drop_table("memories")
