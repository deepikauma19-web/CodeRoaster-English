"""Logging setup. Use `logging.getLogger(__name__)` everywhere; never print()."""

import logging
import sys

from app.config import settings

LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"


def setup_logging(level: str | None = None) -> None:
    """Configure root logging once for the application."""
    resolved = (level or settings.LOG_LEVEL).upper()
    logging.basicConfig(level=resolved, format=LOG_FORMAT, stream=sys.stdout, force=True)
    # Quieten noisy third-party loggers.
    for noisy in ("httpx", "httpx2", "httpcore", "openai"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
