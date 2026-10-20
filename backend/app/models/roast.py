"""Roast model and its enums."""

from __future__ import annotations

import enum
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    false,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User

JSONType = JSON().with_variant(JSONB(), "postgresql")


class RoastIntensity(enum.StrEnum):
    mild = "mild"
    medium = "medium"
    extra_spicy = "extra_spicy"


class RoastStatus(enum.StrEnum):
    pending = "pending"
    fetching = "fetching"
    analyzing = "analyzing"
    completed = "completed"
    failed = "failed"


def _enum_values(enum_cls: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_cls]


class Roast(TimestampMixin, Base):
    __tablename__ = "roasts"
    __table_args__ = (
        CheckConstraint(
            "overall_score IS NULL OR (overall_score >= 0 AND overall_score <= 100)",
            name="ck_roasts_overall_score_range",
        ),
        Index("ix_roasts_user_id_created_at", "user_id", text("created_at DESC")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    repo_url: Mapped[str] = mapped_column(String(512), nullable=False)
    repo_owner: Mapped[str] = mapped_column(String(100), nullable=False)
    repo_name: Mapped[str] = mapped_column(String(100), nullable=False)
    default_branch: Mapped[str | None] = mapped_column(String(100), nullable=True)
    commit_sha: Mapped[str | None] = mapped_column(String(40), nullable=True)
    intensity: Mapped[RoastIntensity] = mapped_column(
        Enum(RoastIntensity, name="roast_intensity", values_callable=_enum_values),
        nullable=False,
        default=RoastIntensity.medium,
    )
    status: Mapped[RoastStatus] = mapped_column(
        Enum(RoastStatus, name="roast_status", values_callable=_enum_values),
        nullable=False,
        default=RoastStatus.pending,
        server_default=RoastStatus.pending.value,
        index=True,
    )
    overall_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score_breakdown: Mapped[dict[str, int] | None] = mapped_column(JSONType, nullable=True)
    roast_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    tips: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONType, nullable=False, default=list, server_default=text("'[]'")
    )
    files_analyzed: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    language_breakdown: Mapped[dict[str, float] | None] = mapped_column(JSONType, nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(100), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    completion_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_public: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    share_slug: Mapped[str | None] = mapped_column(
        String(32), unique=True, index=True, nullable=True
    )
    secrets_detected: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    share_blocked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="roasts")

    def __repr__(self) -> str:
        return f"<Roast id={self.id} repo={self.repo_owner}/{self.repo_name} status={self.status}>"
