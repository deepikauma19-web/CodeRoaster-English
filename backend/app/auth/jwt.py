"""JWT access-token helpers."""

from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from app.config import settings
from app.exceptions import UnauthorizedError

ACCESS_TOKEN_TYPE = "access"


def create_access_token(user_id: int, expires_delta: timedelta | None = None) -> str:
    """
    Create a signed access token for a user.

    Args:
        user_id: ID of the user the token is issued to
        expires_delta: Optional custom lifetime (defaults to ACCESS_TOKEN_EXPIRE_MINUTES)

    Returns:
        Encoded JWT string
    """
    now = datetime.now(UTC)
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {"sub": str(user_id), "type": ACCESS_TOKEN_TYPE, "iat": now, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> int:
    """
    Validate an access token and return the user ID it was issued to.

    Raises:
        UnauthorizedError: If the token is invalid, expired, or not an access token
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise UnauthorizedError("Invalid or expired token") from exc
    if payload.get("type") != ACCESS_TOKEN_TYPE:
        raise UnauthorizedError("Invalid token type")
    try:
        return int(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise UnauthorizedError("Invalid token subject") from exc
