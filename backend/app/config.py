"""Application settings loaded from environment variables / .env."""

from functools import cached_property
from typing import Literal, Self

from pydantic import computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

KNOWN_DEFAULT_SECRET_KEYS: frozenset[str] = frozenset(
    {
        "dev-insecure-secret-key-change-me",
        "your-secret-key-change-in-production",
        "your-secret-key",
        "CHANGE_ME",
    }
)
MIN_SECRET_KEY_LENGTH = 32
_PLACEHOLDER_MARKERS = ("CHANGE_ME", "your-")


def _is_placeholder(value: str) -> bool:
    return not value.strip() or any(marker in value for marker in _PLACEHOLDER_MARKERS)


class Settings(BaseSettings):
    """Typed application configuration. Defaults are safe for local development only."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
        # Never echo raw setting values (secrets) in validation errors / startup tracebacks.
        hide_input_in_errors=True,
    )

    APP_NAME: str = "Code Roaster"
    ENVIRONMENT: Literal["development", "production", "test"] = "development"
    LOG_LEVEL: str = "INFO"

    # Database
    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/assignment_roaster"

    # Auth
    SECRET_KEY: str = "dev-insecure-secret-key-change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # Raw comma-separated string; use `admin_emails` for the parsed list.
    ADMIN_EMAILS: str = ""
    COOKIE_SECURE: bool = False

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/google/callback"

    # OpenAI
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"

    # GitHub (optional; raises rate limit 60 -> 5000 req/hr)
    GITHUB_TOKEN: str | None = None

    # Analysis limits
    MAX_FILES_ANALYZED: int = 40
    MAX_TOTAL_CHARS: int = 120_000

    # Fair use: roasts a user may start per rolling 24 hours (failed roasts are not counted,
    # admins are exempt). 0 disables the limit.
    DAILY_ROAST_LIMIT: int = 10

    # Moderation: a public roast is hidden once this many distinct reporters flag it.
    REPORT_AUTO_UNPUBLISH_THRESHOLD: int = 3

    # URLs
    FRONTEND_URL: str = "http://localhost:5173"
    PUBLIC_API_URL: str = "http://localhost:8000"

    @field_validator("DATABASE_URL")
    @classmethod
    def _use_psycopg3_driver(cls, value: str) -> str:
        """Map plain postgres URLs to the installed psycopg (v3) driver."""
        for prefix in ("postgresql://", "postgres://"):
            if value.startswith(prefix):
                return "postgresql+psycopg://" + value[len(prefix) :]
        return value

    @field_validator("GITHUB_TOKEN")
    @classmethod
    def _empty_token_is_none(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("FRONTEND_URL", "PUBLIC_API_URL")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @model_validator(mode="after")
    def _refuse_insecure_production(self) -> Self:
        """In production, refuse to start with dev defaults, placeholders or plain HTTP.

        The error lists every problem by setting name only — secret values are never echoed.
        """
        if self.ENVIRONMENT != "production":
            return self
        problems: list[str] = []
        if (
            self.SECRET_KEY in KNOWN_DEFAULT_SECRET_KEYS
            or "CHANGE_ME" in self.SECRET_KEY
            or len(self.SECRET_KEY) < MIN_SECRET_KEY_LENGTH
        ):
            problems.append(
                f"SECRET_KEY must be a unique random value of at least "
                f"{MIN_SECRET_KEY_LENGTH} characters (not a known default)"
            )
        if not self.COOKIE_SECURE:
            problems.append("COOKIE_SECURE must be true")
        for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OPENAI_API_KEY"):
            if _is_placeholder(getattr(self, name)):
                problems.append(f"{name} must be set to a real value (empty or placeholder)")
        for name in ("FRONTEND_URL", "PUBLIC_API_URL"):
            if not getattr(self, name).startswith("https://"):
                problems.append(f"{name} must start with https://")
        if problems:
            raise ValueError(
                "Refusing to start with insecure production settings: " + "; ".join(problems)
            )
        return self

    @computed_field  # type: ignore[prop-decorator]
    @cached_property
    def admin_emails(self) -> list[str]:
        """ADMIN_EMAILS parsed into a lowercase list."""
        return [e.strip().lower() for e in self.ADMIN_EMAILS.split(",") if e.strip()]

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"


settings = Settings()
