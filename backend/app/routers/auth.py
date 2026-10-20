"""Auth endpoints: Google OAuth login/callback, refresh rotation, logout, current user."""

import hmac
import logging
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import JSONResponse, RedirectResponse
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.orm import Session

from app.auth import google_oauth
from app.auth.google_oauth import GoogleOAuthError
from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.exceptions import UnauthorizedError
from app.models import User
from app.rate_limit import limiter
from app.schemas.auth import TokenResponse, UserResponse
from app.services import auth_service
from app.services.auth_service import AccountDeactivatedError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

AUTH_COOKIE_PATH = "/api/v1/auth"
STATE_COOKIE = "oauth_state"
REFRESH_COOKIE = "refresh_token"
STATE_MAX_AGE_SECONDS = 600
_STATE_SALT = "google-oauth-state"


def _state_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.SECRET_KEY, salt=_STATE_SALT)


def _frontend_redirect(fragment: dict[str, str]) -> RedirectResponse:
    """Redirect to the frontend callback page with data in the URL fragment."""
    url = f"{settings.FRONTEND_URL}/auth/callback#{urlencode(fragment)}"
    return RedirectResponse(url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


def _error_redirect(code: str) -> RedirectResponse:
    response = _frontend_redirect({"error": code})
    _delete_cookie(response, STATE_COOKIE)
    return response


def _delete_cookie(response: Response, key: str) -> None:
    response.delete_cookie(
        key,
        path=AUTH_COOKIE_PATH,
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        raw_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path=AUTH_COOKIE_PATH,
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )


def _state_is_valid(received: str | None, signed_cookie: str | None) -> bool:
    """Check the signed state cookie (signature + max age) against the query state."""
    if not received or not signed_cookie:
        return False
    try:
        expected = _state_serializer().loads(signed_cookie, max_age=STATE_MAX_AGE_SECONDS)
    except BadSignature:  # includes SignatureExpired
        return False
    if not isinstance(expected, str):
        return False
    return hmac.compare_digest(expected.encode(), received.encode())


@router.get("/google/login", status_code=status.HTTP_307_TEMPORARY_REDIRECT)
@limiter.limit("10/minute")
async def google_login(request: Request) -> RedirectResponse:
    """Start Google sign-in: set a signed state cookie and redirect to Google consent."""
    state = secrets.token_urlsafe(32)
    response = RedirectResponse(
        google_oauth.build_authorization_url(state),
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )
    response.set_cookie(
        STATE_COOKIE,
        _state_serializer().dumps(state),
        max_age=STATE_MAX_AGE_SECONDS,
        path=AUTH_COOKIE_PATH,
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/google/callback", status_code=status.HTTP_307_TEMPORARY_REDIRECT)
@limiter.limit("10/minute")
async def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Handle Google's redirect: verify state + ID token, upsert user, issue tokens."""
    if not _state_is_valid(state, request.cookies.get(STATE_COOKIE)):
        logger.warning("Google OAuth callback with invalid or missing state")
        return _error_redirect("invalid_state")
    if error or not code:
        logger.info("Google OAuth callback returned error=%s", error or "missing_code")
        return _error_redirect("oauth_failed")

    try:
        id_token = await google_oauth.exchange_code_for_id_token(code)
        info = await google_oauth.verify_id_token(id_token)
    except GoogleOAuthError as exc:
        logger.warning("Google OAuth failed: %s", exc)
        return _error_redirect("oauth_failed")

    try:
        tokens = auth_service.login_with_google(db, info)
    except AccountDeactivatedError:
        logger.info("Deactivated account attempted Google sign-in")
        return _error_redirect("account_deactivated")

    response = _frontend_redirect({"access_token": tokens.access_token})
    _set_refresh_cookie(response, tokens.refresh_token)
    _delete_cookie(response, STATE_COOKIE)
    return response


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("10/minute")
async def refresh(request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    """Rotate the refresh-token cookie and return a new access token (401 if invalid)."""
    raw = request.cookies.get(REFRESH_COOKIE)
    try:
        if not raw:
            raise UnauthorizedError("Missing refresh token")
        tokens = auth_service.rotate_refresh_token(db, raw)
    except UnauthorizedError as exc:
        failure = JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED, content={"detail": exc.detail}
        )
        _delete_cookie(failure, REFRESH_COOKIE)
        return failure

    ok = JSONResponse(TokenResponse(access_token=tokens.access_token).model_dump())
    _set_refresh_cookie(ok, tokens.refresh_token)
    return ok


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    """Revoke the refresh token (if any) and clear its cookie."""
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        auth_service.revoke_refresh_token(db, raw)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _delete_cookie(response, REFRESH_COOKIE)
    return response


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> User:
    """Return the authenticated user's profile."""
    return user
