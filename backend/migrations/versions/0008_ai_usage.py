"""AI usage per user: one row per AI request (or refused attempt), metadata only.

Never holds prompt, CV or chat text: ids, the feature, the router's intent, models, token counts, latency, outcome, and how
many ops were applied, rejected or refused by the contact guard. Rows older than AI_USAGE_RETENTION_DAYS are deleted by the
API (services/ai_usage.py). They go with the user; a deleted CV only loses its link.

Revision ID: 0008
Revises: 0007
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_usage",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resume_id", UUID(as_uuid=True), sa.ForeignKey("resumes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column("feature", sa.String(20), nullable=False),
        sa.Column("source", sa.String(10), nullable=False, server_default="web"),
        sa.Column("intent", sa.String(20), nullable=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("reason", sa.String(20), nullable=True),
        sa.Column("model", sa.String(80), nullable=True),
        sa.Column("models", JSONB, nullable=False, server_default="{}"),
        sa.Column("calls", sa.Integer, nullable=False, server_default="0"),
        sa.Column("input_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Float, nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer, nullable=False, server_default="0"),
        sa.Column("ops_applied", sa.Integer, nullable=False, server_default="0"),
        sa.Column("ops_rejected", sa.Integer, nullable=False, server_default="0"),
        sa.Column("guard_rejections", sa.Integer, nullable=False, server_default="0"),
        sa.Column("repairs", sa.Integer, nullable=False, server_default="0"),
        sa.Column("critic_rounds", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index("ix_ai_usage_user_created", "ai_usage", ["user_id", "created_at"])
    op.create_index("ix_ai_usage_created_at", "ai_usage", ["created_at"])


def downgrade() -> None:
    op.drop_table("ai_usage")
