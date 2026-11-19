"""Version history: snapshots taken before changes, so changes can be diffed and undone durably.

Adds `resume_versions`, and links assistant chat messages to the snapshot their changes can be undone to.

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resume_versions",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("resume_id", pg.UUID(as_uuid=True), sa.ForeignKey("resumes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("label", sa.String(200), nullable=False, server_default=""),
        sa.Column("layout_id", sa.String(50), nullable=False, server_default="sidebar"),
        sa.Column("title", sa.String(200), nullable=False, server_default="Untitled CV"),
        sa.Column("data", pg.JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_resume_versions_resume_id", "resume_versions", ["resume_id"])
    op.create_index("ix_resume_versions_created_at", "resume_versions", ["created_at"])

    op.add_column("chat_messages", sa.Column("undo_version_id", pg.UUID(as_uuid=True), nullable=True))
    op.add_column("chat_messages", sa.Column("undone", sa.Boolean, nullable=False, server_default=sa.false()))
    op.create_foreign_key("fk_chat_messages_undo_version", "chat_messages", "resume_versions", ["undo_version_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint("fk_chat_messages_undo_version", "chat_messages", type_="foreignkey")
    op.drop_column("chat_messages", "undone")
    op.drop_column("chat_messages", "undo_version_id")
    op.drop_table("resume_versions")
