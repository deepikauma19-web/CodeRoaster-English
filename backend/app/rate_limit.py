"""Shared slowapi limiter. Decorate endpoints with `@limiter.limit("5/minute")`.

Endpoints using the decorator must accept a `request: Request` parameter.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings

limiter = Limiter(key_func=get_remote_address, enabled=settings.ENVIRONMENT != "test")
