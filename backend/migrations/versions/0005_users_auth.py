"""Authentication: personas become users, who sign in.

`personas` is renamed `users` (foreign keys follow the rename) and gains credentials. Nothing is lost and nobody can sign in
yet: existing rows get no password, so they are "unclaimed" until an admin sends them an invite link (or `make user-passwd`).
The sign-in identifier `login` is pre-filled from the persona's email when that is unique, but it is a separate column: the
email on a CV is contact data anyone may edit, an identity must not be.

Also creates `sessions` (hashed cookie tokens) and `user_tokens` (invite / reset links and MCP access tokens, hashed).

Revision ID: 0005
Revises: 0004
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("personas", "users")
    op.execute("ALTER INDEX IF EXISTS personas_pkey RENAME TO users_pkey")
    op.add_column("users", sa.Column("login", sa.String(254), nullable=True))
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("role", sa.String(10), nullable=False, server_default="user"))
    op.add_column("users", sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()))
    op.add_column("users", sa.Column("failed_logins", sa.Integer, nullable=False, server_default="0"))
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("uq_users_login", "users", ["login"])
    op.create_check_constraint("ck_users_role", "users", "role in ('user','admin')")
    # Pre-fill the login from the email where it is unambiguous (the admin can change it).
    op.execute(
        """
        update users set login = lower(trim(email))
        where trim(email) like '%_@_%' and lower(trim(email)) in (
            select lower(trim(email)) from users group by 1 having count(*) = 1)
        """
    )

    op.create_table(
        "sessions",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("user_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False, server_default="web"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ip", sa.String(64), nullable=False, server_default=""),
        sa.Column("user_agent", sa.String(200), nullable=False, server_default=""),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])
    op.create_table(
        "user_tokens",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("user_id", pg.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("purpose", sa.String(10), nullable=False),
        sa.Column("name", sa.String(100), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_user_tokens_user_id", "user_tokens", ["user_id"])


def downgrade() -> None:
    raise NotImplementedError("0005 renames a table and adds credentials; restore from a backup instead.")
