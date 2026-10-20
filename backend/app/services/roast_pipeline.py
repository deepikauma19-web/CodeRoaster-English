"""Background roast pipeline: pending → fetching → analyzing → completed | failed.

`run_roast` runs via FastAPI BackgroundTasks with its OWN database session and never raises.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import openai
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.database import SessionLocal, execute_rowcount
from app.models import Roast, RoastStatus
from app.services import github_service, roast_service
from app.services.github_service import (
    MSG_REPO_TRUNCATED,
    EmptyRepoError,
    RoastPipelineError,
)
from app.services.roast_service import MSG_LLM_UNAVAILABLE, LLMOutputError
from app.services.signals_service import compute_signals

logger = logging.getLogger(__name__)

MSG_UNEXPECTED = "Something went wrong. Please try again in a little while."
MSG_STALE = "The roast was interrupted by a server restart. Please retry!"
STALE_AFTER = timedelta(minutes=10)
ACTIVE_STATUSES = (RoastStatus.pending, RoastStatus.fetching, RoastStatus.analyzing)

# Indirection so tests can swap in a sqlite/session factory.
SessionFactory = Callable[[], Session]
session_factory: SessionFactory = SessionLocal


def openai_error_hint(exc: openai.OpenAIError) -> str:
    """
    Operator-facing explanation of an OpenAI failure, for logs only (users always get the
    generic MSG_LLM_UNAVAILABLE). Never include `str(exc)`: OpenAI echoes part of the key.
    """
    if isinstance(exc, openai.AuthenticationError):
        return "API key rejected (401): check OPENAI_API_KEY"
    if isinstance(exc, openai.PermissionDeniedError):
        return "permission denied (403): the key or project cannot use this model or region"
    if isinstance(exc, openai.NotFoundError):
        return "model not found (404): check OPENAI_MODEL"
    if isinstance(exc, openai.RateLimitError):
        if getattr(exc, "code", None) == "insufficient_quota":
            return "out of credit (429 insufficient_quota): check OpenAI billing"
        return "rate limited (429): too many requests, will clear on its own"
    if isinstance(exc, openai.APIConnectionError):  # includes APITimeoutError
        return "cannot reach OpenAI (network error or timeout)"
    return "unexpected OpenAI error"


def _set_status(db: Session, roast: Roast, status: RoastStatus) -> None:
    roast.status = status
    db.commit()
    logger.info("Roast %s → %s", roast.id, status.value)


def _mark_failed(
    db: Session,
    roast_id: int,
    message: str,
    *,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
) -> None:
    """Persist a failed status with a user-safe message (best effort)."""
    try:
        db.rollback()
        roast = db.get(Roast, roast_id)
        if roast is None:
            logger.info("Roast %s vanished before it could be marked failed", roast_id)
            return
        roast.status = RoastStatus.failed
        roast.error_message = message[:500]
        roast.prompt_tokens = (roast.prompt_tokens or 0) + prompt_tokens
        roast.completion_tokens = (roast.completion_tokens or 0) + completion_tokens
        db.commit()
    except Exception:
        logger.exception("Could not mark roast %s as failed", roast_id)
        db.rollback()


async def _execute(db: Session, roast: Roast) -> None:
    """Run every pipeline stage for an already-claimed (`fetching`) roast. Raises on failure."""
    owner, repo = roast.repo_owner, roast.repo_name

    async with github_service.create_github_client() as client:
        meta = await github_service.get_repo_meta(client, owner, repo)
        roast.default_branch = meta.default_branch[:100]
        roast.language_breakdown = meta.language_breakdown or None
        db.commit()

        tree = await github_service.get_tree(client, owner, repo, meta.default_branch)
        roast.commit_sha = tree.commit_sha
        db.commit()

        candidates = github_service.candidate_files(tree.entries)
        if not any(github_service.is_code_file(entry.path) for entry in candidates):
            raise EmptyRepoError(log_detail="No analysable code files in tree")
        selected = github_service.select_files(candidates)
        fetched = await github_service.fetch_files(client, owner, repo, tree.commit_sha, selected)

    if not any(github_service.is_code_file(f.path) for f in fetched.files):
        raise EmptyRepoError(log_detail="All code files were empty or unreadable")
    # Only warn when a real cap was hit: GitHub truncated the tree, the file-count /
    # per-category caps dropped selectable files, or the char budget cut content. Blobs
    # select_files never picks (LICENSE, docs, YAML) don't count.
    capped = github_service.count_selectable(candidates) > len(selected)
    truncated = tree.truncated or capped or fetched.truncated

    blob_paths = [e.path for e in tree.entries if e.type == "blob"]
    signals = compute_signals(blob_paths, fetched.files)
    roast.files_analyzed = len(fetched.files)
    roast.secrets_detected = len(signals.secrets_found)
    _set_status(db, roast, RoastStatus.analyzing)
    logger.info(
        "Roast %s analysing %d files (truncated=%s, secrets=%d)",
        roast.id,
        len(fetched.files),
        truncated,
        len(signals.secrets_found),
    )

    result = await roast_service.generate_roast(
        fetched.files,
        signals,
        roast.intensity,
        language_breakdown=meta.language_breakdown or None,
        known_paths=blob_paths,
    )

    output = result.output
    roast.summary = output.summary
    roast.roast_text = output.roast
    roast.score_breakdown = output.scores.model_dump()
    roast.overall_score = result.overall_score
    roast.tips = [tip.model_dump() for tip in output.tips]
    roast.model_used = result.model_used
    roast.prompt_tokens = (roast.prompt_tokens or 0) + result.prompt_tokens
    roast.completion_tokens = (roast.completion_tokens or 0) + result.completion_tokens
    # Truncation is a warning on a completed roast, not a failure.
    roast.error_message = MSG_REPO_TRUNCATED if truncated else None
    roast.completed_at = datetime.now(UTC)
    roast.status = RoastStatus.completed
    db.commit()
    logger.info("Roast %s completed (score=%s)", roast.id, roast.overall_score)


def _claim(db: Session, roast_id: int) -> bool:
    """
    Atomically move a roast pending → fetching. Returns True only for the single caller
    whose conditional UPDATE matched, so concurrent runs can never both execute.
    """
    rowcount = execute_rowcount(
        db,
        update(Roast)
        .where(Roast.id == roast_id, Roast.status == RoastStatus.pending)
        .values(status=RoastStatus.fetching)
        .execution_options(synchronize_session=False),
    )
    db.commit()
    claimed = rowcount == 1
    if claimed:
        logger.info("Roast %s → %s", roast_id, RoastStatus.fetching.value)
    return claimed


async def run_roast(roast_id: int) -> None:
    """
    Background entrypoint. Uses its own DB session, catches every exception and stores a
    user-safe `error_message` on failure. Only runs roasts it can atomically claim from
    `pending` (a duplicate invocation for the same roast is a logged no-op).
    """
    db = session_factory()
    try:
        if not _claim(db, roast_id):
            logger.info("run_roast: roast %s missing or not pending, skipping", roast_id)
            return
        roast = db.get(Roast, roast_id)
        if roast is None:
            logger.warning("run_roast: roast %s vanished after being claimed", roast_id)
            return
        try:
            await _execute(db, roast)
        except LLMOutputError as exc:
            logger.warning("Roast %s failed: %s", roast_id, exc.log_detail)
            _mark_failed(
                db,
                roast_id,
                exc.user_message,
                prompt_tokens=exc.prompt_tokens,
                completion_tokens=exc.completion_tokens,
            )
        except RoastPipelineError as exc:
            logger.warning("Roast %s failed: %s", roast_id, exc.log_detail)
            _mark_failed(db, roast_id, exc.user_message)
        except openai.OpenAIError as exc:
            logger.error(
                "Roast %s failed: OpenAI %s - %s",
                roast_id,
                type(exc).__name__,
                openai_error_hint(exc),
            )
            _mark_failed(db, roast_id, MSG_LLM_UNAVAILABLE)
        except Exception:
            logger.exception("Roast %s failed with an unexpected error", roast_id)
            _mark_failed(db, roast_id, MSG_UNEXPECTED)
    except Exception:
        logger.exception("run_roast crashed for roast %s", roast_id)
    finally:
        db.close()


def mark_stale_roasts_failed(db: Session, older_than: timedelta = STALE_AFTER) -> int:
    """
    Mark roasts stuck in pending/fetching/analyzing for longer than `older_than` as failed
    (they are retryable). With `older_than <= 0` every active roast is failed regardless of
    age — used on startup, because single-process BackgroundTasks never survive a restart.

    Returns:
        Number of roasts marked failed.
    """
    stmt = select(Roast).where(Roast.status.in_(ACTIVE_STATUSES))
    if older_than > timedelta(0):
        stmt = stmt.where(Roast.created_at < datetime.now(UTC) - older_than)
    stale = db.scalars(stmt).all()
    for roast in stale:
        roast.status = RoastStatus.failed
        roast.error_message = MSG_STALE
    db.commit()
    return len(stale)
