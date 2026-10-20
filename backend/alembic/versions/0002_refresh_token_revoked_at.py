"""refresh_tokens.revoked_at for the rotation grace window

Revision ID: 0002_refresh_token_revoked_at
Revises: 0001_initial
Create Date: 2026-10-10 00:00:01

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_refresh_token_revoked_at"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "refresh_tokens",
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("refresh_tokens", "revoked_at")
