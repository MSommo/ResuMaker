"""A name for each CV, separate from its headline.

`resumes.name` is the owner's own label for telling CVs apart ("Acme application", "Short version"). Unlike the headline it is
never printed on the CV. `resumes.title`, what lists show, becomes the name, or the headline when there is no name. Existing
CVs get no name, so they keep showing their headline.

Revision ID: 0007
Revises: 0006
"""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resumes", sa.Column("name", sa.String(100), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("resumes", "name")
