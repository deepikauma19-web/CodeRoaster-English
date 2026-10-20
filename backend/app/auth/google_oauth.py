"""Google OAuth 2.0 helpers (authorization URL, code exchange, ID-token verification).

Network calls are isolated in small functions so tests can monkeypatch them.
"""

import logging
from typing import Any
from urllib.parse import urlencode

import httpx
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.schemas.auth import GoogleUserInfo

logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_SCOPES = "openid email profile"
HTTP_TIMEOUT_SECONDS = 10.0


class GoogleOAuthError(Exception):
    """Raised when any step of the Google OAuth exchange fails. Never carries tokens."""


def build_authorization_url(state: str) -> str:
    """
    Build the Google consent-screen URL.

    Args:
        state: Random anti-CSRF value echoed back by Google

    Returns:
        Fully-qualified authorization URL
    """
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": GOOGLE_SCOPES,
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def exchange_code_for_id_token(code: str) -> str:
    """
    Exchange an authorization code for a Google ID token.

    Raises:
        GoogleOAuthError: On network failure, non-200 response, or missing id_token
    """
    data = {
        "code": code,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
            response = await client.post(GOOGLE_TOKEN_URL, data=data)
    except httpx.HTTPError as exc:
        raise GoogleOAuthError(f"Token endpoint request failed: {type(exc).__name__}") from exc
    if response.status_code != 200:
        raise GoogleOAuthError(f"Token endpoint returned HTTP {response.status_code}")
    try:
        payload: dict[str, Any] = response.json()
    except ValueError as exc:
        raise GoogleOAuthError("Token endpoint returned invalid JSON") from exc
    token = payload.get("id_token")
    if not isinstance(token, str) or not token:
        raise GoogleOAuthError("Token response missing id_token")
    return token


def _verify_id_token_sync(token: str) -> dict[str, Any]:
    claims: dict[str, Any] = google_id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
        token, google_requests.Request(), settings.GOOGLE_CLIENT_ID
    )
    return claims


async def verify_id_token(token: str) -> GoogleUserInfo:
    """
    Verify a Google ID token (signature, issuer, expiry, aud == GOOGLE_CLIENT_ID).

    Requires `email_verified` to be true.

    Raises:
        GoogleOAuthError: If verification fails or required claims are missing
    """
    try:
        claims = await run_in_threadpool(_verify_id_token_sync, token)
    except Exception as exc:  # google-auth raises ValueError / TransportError
        raise GoogleOAuthError(f"ID token verification failed: {type(exc).__name__}") from exc

    if claims.get("email_verified") is not True:
        raise GoogleOAuthError("Google email is not verified")
    sub = claims.get("sub")
    email = claims.get("email")
    if not isinstance(sub, str) or not sub or not isinstance(email, str) or not email:
        raise GoogleOAuthError("ID token missing sub/email claims")

    name = claims.get("name")
    picture = claims.get("picture")
    return GoogleUserInfo(
        google_id=sub,
        email=email.strip().lower(),
        full_name=name if isinstance(name, str) and name else None,
        avatar_url=picture if isinstance(picture, str) and picture else None,
    )
