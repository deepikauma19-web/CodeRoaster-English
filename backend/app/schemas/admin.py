"""Admin panel schemas (mirror frontend/src/types/admin.ts)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from app.models import Roast, RoastIntensity, RoastStatus

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """Generic paginated response: {items, total, page, size}."""

    items: list[T]
    total: int
    page: int
    size: int


class AdminUserResponse(BaseModel):
    """A user as seen by an admin, including their roast count."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str | None
    avatar_url: str | None
    is_admin: bool
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None
    roast_count: int = 0


class AdminUserUpdate(BaseModel):
    """Partial update of a user's flags by an admin."""

    model_config = ConfigDict(extra="forbid")

    is_active: bool | None = None
    is_admin: bool | None = None


class AdminReportResponse(BaseModel):
    """A report filed against a public roast, with the roast's current sharing state."""

    id: int
    roast_id: int
    repo_owner: str
    repo_name: str
    reason: str
    details: str | None
    is_public: bool
    share_blocked: bool
    report_count: int
    created_at: datetime


class SharingUpdate(BaseModel):
    """Body for PATCH /admin/roasts/{id}/sharing."""

    blocked: bool


class AdminRoastResponse(BaseModel):
    """A roast (all owner-view fields) plus its owner's id and email."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    repo_url: str
    repo_owner: str
    repo_name: str
    intensity: RoastIntensity
    status: RoastStatus
    overall_score: int | None
    score_breakdown: dict[str, int] | None
    roast_text: str | None
    summary: str | None
    tips: list[dict[str, Any]] = Field(default_factory=list)
    files_analyzed: int
    language_breakdown: dict[str, float] | None
    error_message: str | None
    is_public: bool
    share_slug: str | None
    share_blocked: bool = False
    created_at: datetime
    completed_at: datetime | None
    user_id: int
    user_email: str

    @classmethod
    def from_row(cls, roast: Roast, user_email: str) -> AdminRoastResponse:
        """Build the response from a Roast ORM object and its owner's email."""
        data = {name: getattr(roast, name) for name in cls.model_fields if name != "user_email"}
        data["tips"] = data["tips"] or []
        return cls(**data, user_email=user_email)


class AdminStats(BaseModel):
    """Aggregated platform statistics for the admin dashboard."""

    total_users: int
    active_users_7d: int
    total_roasts: int
    roasts_today: int
    avg_score: float | None
    failure_rate: float
    intensity_split: dict[RoastIntensity, int]
    total_prompt_tokens: int
    total_completion_tokens: int
