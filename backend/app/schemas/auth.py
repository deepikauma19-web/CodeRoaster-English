"""Auth request/response schemas."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TokenResponse(BaseModel):
    """Access token returned by /auth/refresh."""

    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    """Public profile of the authenticated user (mirrors frontend `User`)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str | None
    avatar_url: str | None
    is_admin: bool
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class GoogleUserInfo(BaseModel):
    """Verified identity claims extracted from a Google ID token."""

    google_id: str
    email: str
    full_name: str | None = None
    avatar_url: str | None = None
