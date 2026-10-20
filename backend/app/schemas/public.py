"""Schemas for the share toggle and the public (unauthenticated) roast view.

PublicRoastResponse deliberately carries NO email, NO user_id and NO roast id.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import RoastIntensity


class PublicTip(BaseModel):
    """A single improvement tip (mirrors the shared `Tip` contract)."""

    title: str
    description: str
    priority: Literal["high", "medium", "low"]
    file_path: str | None = None


class PublicScoreBreakdown(BaseModel):
    """Per-category scores (mirrors the shared `ScoreBreakdown` contract)."""

    code_quality: int
    structure: int
    documentation: int
    ai_best_practices: int
    security: int


class PublicRoastResponse(BaseModel):
    """Public, privacy-safe view of a shared roast."""

    model_config = ConfigDict(extra="forbid")

    repo_owner: str
    repo_name: str
    repo_url: str
    intensity: RoastIntensity
    overall_score: int | None
    score_breakdown: PublicScoreBreakdown | None
    roast_text: str | None
    tips: list[PublicTip]
    author_first_name: str
    author_avatar_url: str | None
    created_at: datetime


class ShareToggleRequest(BaseModel):
    """Body for PATCH /roasts/{id}/share."""

    is_public: bool


class ShareToggleResponse(BaseModel):
    """Result of toggling sharing. `share_url` is the URL users should share (OG-enabled)."""

    is_public: bool
    share_slug: str | None
    share_url: str | None


ReportReason = Literal["owner_request", "harassment", "secrets", "other"]


class RoastReportCreate(BaseModel):
    """Body for POST /public/roasts/{slug}/report."""

    reason: ReportReason
    details: str | None = Field(default=None, max_length=500)


class RoastReportResponse(BaseModel):
    """Acknowledgement of a report (identical whether or not it was a duplicate)."""

    received: bool = True
