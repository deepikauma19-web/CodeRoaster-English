"""share safeguards: secrets_detected, share_blocked and roast_reports

Revision ID: 0003_share_safeguards
Revises: 0002_refresh_token_revoked_at
Create Date: 2026-10-18 00:00:00

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_share_safeguards"
down_revision: str | None = "0002_refresh_token_revoked_at"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "roasts",
        sa.Column("secrets_detected", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "roasts",
        sa.Column("share_blocked", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.create_table(
        "roast_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "roast_id", sa.Integer(), sa.ForeignKey("roasts.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("reason", sa.String(length=30), nullable=False),
        sa.Column("details", sa.String(length=500), nullable=True),
        sa.Column("reporter_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("roast_id", "reporter_hash", name="uq_report_roast_reporter"),
    )
    op.create_index("ix_roast_reports_roast_id", "roast_reports", ["roast_id"])


def downgrade() -> None:
    op.drop_index("ix_roast_reports_roast_id", table_name="roast_reports")
    op.drop_table("roast_reports")
    op.drop_column("roasts", "share_blocked")
    op.drop_column("roasts", "secrets_detected")
