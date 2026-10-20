"""FastAPI application entrypoint."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI, status
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app import database
from app.config import settings
from app.exceptions import register_exception_handlers
from app.logging_config import setup_logging
from app.rate_limit import limiter
from app.routers import admin, auth, public, roasts, share
from app.services import roast_pipeline

setup_logging()
logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1"


def _fail_stale_roasts() -> None:
    """Mark every roast orphaned by a restart (pending/fetching/analyzing, any age) as failed
    so users can retry. Background tasks run in-process, so none can still be running."""
    if settings.ENVIRONMENT == "test":
        return
    try:
        db = roast_pipeline.session_factory()
        try:
            count = roast_pipeline.mark_stale_roasts_failed(db, older_than=timedelta(0))
        finally:
            db.close()
        if count:
            logger.warning("Marked %d stale roast(s) as failed on startup", count)
    except Exception:
        logger.exception("Stale-roast cleanup on startup failed; continuing")


def _database_ok() -> bool:
    """Run `SELECT 1` on a short-lived session; never raises."""
    try:
        db = database.SessionLocal()
        try:
            db.execute(text("SELECT 1"))
        finally:
            db.close()
    except Exception:
        logger.exception("Health check: database unreachable")
        return False
    return True


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Startup/shutdown hooks."""
    _fail_stale_roasts()
    yield


def create_app() -> FastAPI:
    application = FastAPI(title="Code Roaster", version="2.0.0", lifespan=lifespan)

    application.state.limiter = limiter
    application.add_exception_handler(
        RateLimitExceeded,
        _rate_limit_exceeded_handler,  # type: ignore[arg-type]
    )
    register_exception_handlers(application)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.FRONTEND_URL],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for module in (auth, roasts, share, public, admin):
        application.include_router(module.router, prefix=API_PREFIX)

    @application.get("/health", tags=["health"])
    async def health() -> JSONResponse:
        """Liveness + database check (unauthenticated; never leaks error details)."""
        if await run_in_threadpool(_database_ok):
            return JSONResponse({"status": "ok", "database": "ok"})
        return JSONResponse(
            {"status": "degraded", "database": "error"},
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    logger.info("App created (environment=%s)", settings.ENVIRONMENT)
    return application


app = create_app()
