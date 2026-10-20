"""initial schema: users, refresh_tokens, roasts

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-10 00:00:00

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSONType = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

roast_intensity = sa.Enum("mild", "medium", "extra_spicy", name="roast_intensity")
roast_status = sa.Enum(
    "pending", "fetching", "analyzing", "completed", "failed", name="roast_status"
)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("avatar_url", sa.String(length=512), nullable=True),
        sa.Column("google_id", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("is_admin", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_google_id", "users", ["google_id"], unique=True)

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])

    # create_table creates the enum types automatically (create_type defaults to True).
    op.create_table(
        "roasts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("repo_url", sa.String(length=512), nullable=False),
        sa.Column("repo_owner", sa.String(length=100), nullable=False),
        sa.Column("repo_name", sa.String(length=100), nullable=False),
        sa.Column("default_branch", sa.String(length=100), nullable=True),
        sa.Column("commit_sha", sa.String(length=40), nullable=True),
        sa.Column("intensity", roast_intensity, nullable=False),
        sa.Column("status", roast_status, server_default="pending", nullable=False),
        sa.Column("overall_score", sa.Integer(), nullable=True),
        sa.Column("score_breakdown", JSONType, nullable=True),
        sa.Column("roast_text", sa.Text(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("tips", JSONType, server_default=sa.text("'[]'"), nullable=False),
        sa.Column("files_analyzed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("language_breakdown", JSONType, nullable=True),
        sa.Column("model_used", sa.String(length=100), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "completion_tokens", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        sa.Column("is_public", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("share_slug", sa.String(length=32), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)",
            name="ck_roasts_overall_score_range",
        ),
    )
    op.create_index("ix_roasts_user_id", "roasts", ["user_id"])
    op.create_index("ix_roasts_status", "roasts", ["status"])
    op.create_index("ix_roasts_share_slug", "roasts", ["share_slug"], unique=True)
    op.create_index(
        "ix_roasts_user_id_created_at",
        "roasts",
        ["user_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_roasts_user_id_created_at", table_name="roasts")
    op.drop_index("ix_roasts_share_slug", table_name="roasts")
    op.drop_index("ix_roasts_status", table_name="roasts")
    op.drop_index("ix_roasts_user_id", table_name="roasts")
    op.drop_table("roasts")
    roast_status.drop(op.get_bind(), checkfirst=True)
    roast_intensity.drop(op.get_bind(), checkfirst=True)

    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")

    op.drop_index("ix_users_google_id", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
