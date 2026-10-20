"""Database engine, session factory and declarative base."""

import logging
from collections.abc import Generator
from typing import Any, cast

from sqlalchemy import CursorResult, Executable, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""


def _engine_kwargs(url: str) -> dict[str, Any]:
    if url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    return {"pool_pre_ping": True}


engine = create_engine(settings.DATABASE_URL, **_engine_kwargs(settings.DATABASE_URL))
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a DB session that is always closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def execute_rowcount(db: Session, stmt: Executable) -> int:
    """Execute a DML statement (e.g. a conditional UPDATE) and return the matched row count.

    Used for atomic compare-and-set claims: only the caller that sees 1 won the race.
    """
    result = cast(CursorResult[Any], db.execute(stmt))
    return int(result.rowcount)
