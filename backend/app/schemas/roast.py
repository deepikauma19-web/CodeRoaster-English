"""Roast request/response schemas (PRP: SHARED CONTRACTS).

`RoastResponse` mirrors `frontend/src/types/roast.ts` `Roast` field-for-field.
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.roast import RoastIntensity, RoastStatus

# Length caps applied to LLM-generated text (trimmed, never rejected).
TIP_TITLE_MAX = 80
TIP_DESCRIPTION_MAX = 500
ROAST_MAX = 2500
SUMMARY_MAX = 600
FILE_PATH_MAX = 300

REPO_URL_PATTERN = r"^https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/?$"

ScoreValue = Annotated[int, Field(ge=0, le=20)]


def _clamp(value: Any, limit: int) -> Any:
    """Trim a string to `limit` characters (adding an ellipsis); pass other values through."""
    if isinstance(value, str):
        value = value.strip()
        if len(value) > limit:
            return value[: limit - 1].rstrip() + "…"
    return value


class RoastCreate(BaseModel):
    """Body of POST /roasts.

    `repo_url` is validated in the router (`github_service.parse_repo_url`) so that an
    invalid URL yields a helpful 400 instead of a generic 422.
    """

    repo_url: str = Field(
        ..., min_length=1, max_length=512, examples=["https://github.com/owner/repo"]
    )
    intensity: RoastIntensity = RoastIntensity.medium


class Tip(BaseModel):
    """One actionable improvement tip."""

    title: str = Field(..., min_length=1)
    description: str = Field(..., min_length=1)
    priority: Literal["high", "medium", "low"]
    file_path: str | None = None

    @field_validator("title", mode="before")
    @classmethod
    def _clamp_title(cls, value: Any) -> Any:
        return _clamp(value, TIP_TITLE_MAX)

    @field_validator("description", mode="before")
    @classmethod
    def _clamp_description(cls, value: Any) -> Any:
        return _clamp(value, TIP_DESCRIPTION_MAX)

    @field_validator("file_path", mode="before")
    @classmethod
    def _normalise_file_path(cls, value: Any) -> Any:
        if isinstance(value, str):
            value = value.strip()
            return _clamp(value, FILE_PATH_MAX) if value else None
        return value


class ScoreBreakdown(BaseModel):
    """Five rubric categories, each 0–20."""

    code_quality: ScoreValue
    structure: ScoreValue
    documentation: ScoreValue
    ai_best_practices: ScoreValue
    security: ScoreValue

    def total(self) -> int:
        """Overall score (0–100) — always computed by the backend."""
        return (
            self.code_quality
            + self.structure
            + self.documentation
            + self.ai_best_practices
            + self.security
        )


class RoastResponse(BaseModel):
    """Owner view of a roast."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    repo_url: str
    repo_owner: str
    repo_name: str
    intensity: RoastIntensity
    status: RoastStatus
    overall_score: int | None
    score_breakdown: ScoreBreakdown | None
    roast_text: str | None
    summary: str | None
    tips: list[Tip]
    files_analyzed: int
    language_breakdown: dict[str, float] | None
    error_message: str | None
    is_public: bool
    share_slug: str | None
    secrets_detected: int = 0
    share_blocked: bool = False
    created_at: datetime
    completed_at: datetime | None

    @field_validator("tips", mode="before")
    @classmethod
    def _none_tips_to_list(cls, value: Any) -> Any:
        return [] if value is None else value


class RoastStatusResponse(BaseModel):
    """Lightweight polling response."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    status: RoastStatus
    error_message: str | None


class RoastQuotaResponse(BaseModel):
    """Daily roast allowance. `limit` and `remaining` are null when the user is unlimited."""

    limit: int | None
    used: int
    remaining: int | None
    resets_at: datetime | None


class RoastListResponse(BaseModel):
    """Paginated list of the current user's roasts (newest first)."""

    items: list[RoastResponse]
    total: int
    page: int
    size: int


class LLMAnalysisOutput(BaseModel):
    """Step 1 output (low temperature): summary, category scores and tips."""

    summary: str = Field(..., min_length=1)
    scores: ScoreBreakdown
    tips: Annotated[list[Tip], Field(min_length=3, max_length=7)]

    @field_validator("summary", mode="before")
    @classmethod
    def _clamp_summary(cls, value: Any) -> Any:
        return _clamp(value, SUMMARY_MAX)


class LLMRoastTextOutput(BaseModel):
    """Step 2 output (high temperature): the roast text only."""

    roast: str = Field(..., min_length=1)

    @field_validator("roast", mode="before")
    @classmethod
    def _clamp_roast(cls, value: Any) -> Any:
        return _clamp(value, ROAST_MAX)


class LLMRoastOutput(BaseModel):
    """The combined, validated result of both steps. Validated before anything is stored."""

    summary: str = Field(..., min_length=1)
    roast: str = Field(..., min_length=1)
    scores: ScoreBreakdown
    tips: Annotated[list[Tip], Field(min_length=3, max_length=7)]

    @field_validator("summary", mode="before")
    @classmethod
    def _clamp_summary(cls, value: Any) -> Any:
        return _clamp(value, SUMMARY_MAX)

    @field_validator("roast", mode="before")
    @classmethod
    def _clamp_roast(cls, value: Any) -> Any:
        return _clamp(value, ROAST_MAX)
