"""Per-user AI entitlement.

`users.ai_enabled` says whether this account may use the AI features (import, improve, chat, tailor, memory). It is the
switch a future paywall will flip; for now administrators set it. Everyone who exists today keeps AI, and so do new
accounts by default. Administrators always have AI regardless of the flag.

Revision ID: 0006
Revises: 0005
"""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("ai_enabled", sa.Boolean, nullable=False, server_default=sa.true()))


def downgrade() -> None:
    op.drop_column("users", "ai_enabled")
