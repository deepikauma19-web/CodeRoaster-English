"""Application exceptions translated into JSON {"detail": ...} responses."""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Base application error with an HTTP status code and client-safe detail."""

    status_code: int = 500
    default_detail: str = "Internal server error"

    def __init__(self, detail: str | None = None, status_code: int | None = None) -> None:
        self.detail = detail or self.default_detail
        if status_code is not None:
            self.status_code = status_code
        super().__init__(self.detail)


class BadRequestError(AppError):
    status_code = 400
    default_detail = "Bad request"


class UnauthorizedError(AppError):
    status_code = 401
    default_detail = "Not authenticated"


class ForbiddenError(AppError):
    status_code = 403
    default_detail = "Forbidden"


class NotFoundError(AppError):
    status_code = 404
    default_detail = "Not found"


class ConflictError(AppError):
    status_code = 409
    default_detail = "Conflict"


class UnprocessableError(AppError):
    status_code = 422
    default_detail = "Unprocessable entity"


class TooManyRequestsError(AppError):
    """429 with a `Retry-After` header (seconds)."""

    status_code = 429
    default_detail = "Too many requests"

    def __init__(self, detail: str | None = None, retry_after: int | None = None) -> None:
        super().__init__(detail)
        self.retry_after = retry_after


async def app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Render an AppError as {"detail": ...}."""
    if not isinstance(exc, AppError):  # pragma: no cover - defensive
        raise exc
    if exc.status_code >= 500:
        logger.error("AppError on %s %s: %s", request.method, request.url.path, exc.detail)
    headers: dict[str, str] = {}
    if isinstance(exc, TooManyRequestsError) and exc.retry_after is not None:
        headers["Retry-After"] = str(max(1, exc.retry_after))
    return JSONResponse(
        status_code=exc.status_code, content={"detail": exc.detail}, headers=headers or None
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
