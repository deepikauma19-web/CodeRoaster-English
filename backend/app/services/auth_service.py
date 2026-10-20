"""Auth business logic: user upsert on Google login, refresh rotation, logout."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import NoReturn

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.auth.jwt import create_access_token
from app.auth.refresh_tokens import (
    claim_refresh_token,
    get_refresh_token,
    is_expired,
    issue_refresh_token,
    revoke_all_user_tokens,
    revoked_within,
)
from app.config import settings
from app.exceptions import UnauthorizedError
from app.models import User
from app.schemas.auth import GoogleUserInfo

logger = logging.getLogger(__name__)

# A token revoked this recently is most likely a benign race (two tabs refreshing with the
# same cookie), not theft: reject it without revoking the user's whole token family.
REFRESH_REUSE_GRACE = timedelta(seconds=30)


class AccountDeactivatedError(Exception):
    """Raised when a deactivated user attempts to sign in."""


@dataclass(frozen=True)
class IssuedTokens:
    """An access JWT plus the raw refresh secret to set as a cookie."""

    access_token: str
    refresh_token: str


def upsert_google_user(db: Session, info: GoogleUserInfo) -> User:
    """
    Create or update a user from verified Google claims (caller commits).

    Matches by google_id first, then by email (linking the Google account).
    Grants admin if the email is in ADMIN_EMAILS; never revokes admin.
    """
    candidates = db.scalars(
        select(User).where(or_(User.google_id == info.google_id, User.email == info.email))
    ).all()
    user = next((u for u in candidates if u.google_id == info.google_id), None)
    if user is None:
        user = next((u for u in candidates if u.email.lower() == info.email), None)
        if user is not None:
            logger.info("Linking Google account to existing user id=%s", user.id)
            user.google_id = info.google_id

    now = datetime.now(UTC)
    if user is None:
        user = User(
            email=info.email,
            google_id=info.google_id,
            full_name=info.full_name or info.email.split("@")[0],
            avatar_url=info.avatar_url,
            is_active=True,
            is_admin=False,
        )
        db.add(user)
        logger.info("Creating new user from Google login")
    else:
        email_taken = any(u is not user and u.email.lower() == info.email for u in candidates)
        if email_taken:
            logger.warning("Google email for user id=%s already used by another user", user.id)
        else:
            user.email = info.email
        if info.full_name:
            user.full_name = info.full_name
        if info.avatar_url:
            user.avatar_url = info.avatar_url

    if info.email in settings.admin_emails:
        user.is_admin = True
    user.last_login_at = now
    db.flush()
    return user


def login_with_google(db: Session, info: GoogleUserInfo) -> IssuedTokens:
    """
    Upsert the Google user and issue tokens.

    Raises:
        AccountDeactivatedError: If the user exists but is deactivated
    """
    user = upsert_google_user(db, info)
    if not user.is_active:
        db.commit()  # persist profile refresh, but issue nothing
        raise AccountDeactivatedError()
    refresh = issue_refresh_token(db, user.id)
    db.commit()
    logger.info("User id=%s signed in with Google", user.id)
    return IssuedTokens(access_token=create_access_token(user.id), refresh_token=refresh)


def rotate_refresh_token(db: Session, raw: str) -> IssuedTokens:
    """
    Validate a refresh token, atomically revoke it and issue a new pair.

    The old token is claimed with a conditional UPDATE, so of several concurrent refreshes
    with the same token only one issues a successor; the others get 401. Presenting an
    already-revoked token is treated as reuse (all of the user's refresh tokens are revoked)
    unless it was revoked within `REFRESH_REUSE_GRACE` — a benign multi-tab race.

    Raises:
        UnauthorizedError: If the token is unknown, revoked, expired, or the user is inactive
    """
    now = datetime.now(UTC)
    token = get_refresh_token(db, raw)
    if token is None:
        raise UnauthorizedError("Invalid refresh token")
    if token.revoked:
        _reject_revoked(db, token.user_id, recently=revoked_within(token, REFRESH_REUSE_GRACE, now))
    if is_expired(token, now):
        claim_refresh_token(db, token.id, now)
        db.commit()
        raise UnauthorizedError("Refresh token expired")
    user = db.get(User, token.user_id)
    if user is None or not user.is_active:
        claim_refresh_token(db, token.id, now)
        db.commit()
        raise UnauthorizedError("Account unavailable")

    if not claim_refresh_token(db, token.id, now):
        # Another request rotated this token between our read and our UPDATE.
        db.rollback()
        logger.info("Refresh token for user id=%s lost a rotation race", token.user_id)
        raise UnauthorizedError("Invalid refresh token")
    new_raw = issue_refresh_token(db, user.id)
    db.commit()
    return IssuedTokens(access_token=create_access_token(user.id), refresh_token=new_raw)


def _reject_revoked(db: Session, user_id: int, *, recently: bool) -> NoReturn:
    """Reject a revoked token; outside the grace window this is reuse → revoke all."""
    if recently:
        logger.info("Recently rotated refresh token presented for user id=%s", user_id)
    else:
        logger.warning("Refresh token reuse detected for user id=%s; revoking all", user_id)
        revoke_all_user_tokens(db, user_id)
        db.commit()
    raise UnauthorizedError("Invalid refresh token")


def revoke_refresh_token(db: Session, raw: str) -> None:
    """Revoke a refresh token if it exists (idempotent)."""
    token = get_refresh_token(db, raw)
    if token is not None and not token.revoked:
        claim_refresh_token(db, token.id)
        db.commit()
