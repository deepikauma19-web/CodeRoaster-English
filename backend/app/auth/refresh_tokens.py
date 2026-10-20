"""Opaque refresh tokens: random secret to the client, SHA-256 hash in the DB."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.database import execute_rowcount
from app.models import RefreshToken

REFRESH_TOKEN_BYTES = 48


def generate_refresh_token() -> str:
    """Return a new random URL-safe refresh token secret."""
    return secrets.token_urlsafe(REFRESH_TOKEN_BYTES)


def hash_refresh_token(token: str) -> str:
    """Return the SHA-256 hex digest stored for a refresh token."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_utc(value: datetime) -> datetime:
    """Treat naive datetimes (e.g. from SQLite) as UTC."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def is_expired(token: RefreshToken, now: datetime | None = None) -> bool:
    """Return True if the refresh token's expiry is in the past."""
    return _as_utc(token.expires_at) <= (now or datetime.now(UTC))


def revoked_within(token: RefreshToken, window: timedelta, now: datetime | None = None) -> bool:
    """Return True if the token was revoked less than `window` ago (False if unknown)."""
    if token.revoked_at is None:
        return False
    return (now or datetime.now(UTC)) - _as_utc(token.revoked_at) <= window


def claim_refresh_token(db: Session, token_id: int, now: datetime | None = None) -> bool:
    """
    Atomically revoke an active refresh token (caller commits).

    Runs `UPDATE ... SET revoked = true WHERE id = :id AND revoked = false`; only the one
    caller whose UPDATE matched may treat the token as consumed (e.g. issue a successor).

    Returns:
        True if this call revoked the token, False if it was already revoked.
    """
    rowcount = execute_rowcount(
        db,
        update(RefreshToken)
        .where(RefreshToken.id == token_id, RefreshToken.revoked.is_(False))
        .values(revoked=True, revoked_at=now or datetime.now(UTC))
        .execution_options(synchronize_session=False),
    )
    return rowcount == 1


def issue_refresh_token(db: Session, user_id: int) -> str:
    """
    Create and persist a refresh token for a user (caller commits).

    Returns:
        The raw token secret to send to the client (never stored)
    """
    raw = generate_refresh_token()
    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=hash_refresh_token(raw),
            expires_at=datetime.now(UTC) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
            revoked=False,
        )
    )
    return raw


def get_refresh_token(db: Session, raw: str) -> RefreshToken | None:
    """Look up a refresh token row by its raw secret."""
    return db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))


def revoke_all_user_tokens(db: Session, user_id: int) -> None:
    """Revoke every refresh token belonging to a user (caller commits)."""
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked.is_(False))
        .values(revoked=True, revoked_at=datetime.now(UTC))
        .execution_options(synchronize_session=False)
    )
