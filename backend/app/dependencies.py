"""Shared FastAPI dependencies."""

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.jwt import decode_access_token
from app.database import get_db
from app.exceptions import ForbiddenError, UnauthorizedError
from app.models import User

__all__ = ["get_current_user", "get_db", "require_admin"]

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the authenticated user from the Bearer access token (401 / 403 on failure)."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise UnauthorizedError()
    user_id = decode_access_token(credentials.credentials)
    user = db.get(User, user_id)
    if user is None:
        raise UnauthorizedError("User not found")
    if not user.is_active:
        raise ForbiddenError("Account is deactivated")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Require the current user to be an admin (403 otherwise)."""
    if not user.is_admin:
        raise ForbiddenError("Admin access required")
    return user
