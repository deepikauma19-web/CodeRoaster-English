"""Admin panel business logic: user management, roast moderation and stats."""

import logging
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import Select, case, func, or_, select
from sqlalchemy.orm import Session

from app.auth.refresh_tokens import revoke_all_user_tokens
from app.exceptions import ConflictError, NotFoundError
from app.models import Roast, RoastIntensity, RoastReport, RoastStatus, User
from app.schemas.admin import (
    AdminReportResponse,
    AdminRoastResponse,
    AdminStats,
    AdminUserResponse,
    AdminUserUpdate,
    Page,
)

logger = logging.getLogger(__name__)


def _to_utc_naive(value: datetime) -> datetime:
    """Normalise a datetime to naive UTC (portable across PostgreSQL and SQLite)."""
    if value.tzinfo is not None:
        value = value.astimezone(UTC)
    return value.replace(tzinfo=None)


LIKE_ESCAPE = "\\"


def escape_like(term: str) -> str:
    """Escape LIKE wildcards (`%`, `_`) and the escape char itself so user input matches
    literally."""
    return (
        term.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
        .replace("%", LIKE_ESCAPE + "%")
        .replace("_", LIKE_ESCAPE + "_")
    )


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _count(db: Session, stmt: Select[*tuple[Any, ...]]) -> int:
    """Count the rows a select statement would return."""
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    return int(total or 0)


# --------------------------------------------------------------------------- users


def list_users(db: Session, search: str | None, page: int, size: int) -> Page[AdminUserResponse]:
    """List users (newest first) with their roast counts, optionally filtered by search."""
    roast_counts = (
        select(Roast.user_id.label("user_id"), func.count(Roast.id).label("roast_count"))
        .group_by(Roast.user_id)
        .subquery()
    )
    base = select(User)
    if search and search.strip():
        pattern = f"%{escape_like(search.strip())}%"
        base = base.where(
            or_(
                User.email.ilike(pattern, escape=LIKE_ESCAPE),
                User.full_name.ilike(pattern, escape=LIKE_ESCAPE),
            )
        )

    total = _count(db, base)

    stmt = (
        base.add_columns(func.coalesce(roast_counts.c.roast_count, 0))
        .outerjoin(roast_counts, roast_counts.c.user_id == User.id)
        .order_by(User.created_at.desc(), User.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = [
        AdminUserResponse.model_validate(user).model_copy(update={"roast_count": int(count)})
        for user, count in db.execute(stmt).all()
    ]
    return Page[AdminUserResponse](items=items, total=total, page=page, size=size)


def _roast_count_for(db: Session, user_id: int) -> int:
    return int(db.scalar(select(func.count(Roast.id)).where(Roast.user_id == user_id)) or 0)


def update_user(
    db: Session, admin: User, user_id: int, payload: AdminUserUpdate
) -> AdminUserResponse:
    """Update a user's is_active / is_admin flags.

    Raises NotFoundError if the user does not exist and ConflictError if an admin
    tries to deactivate or demote themselves. Deactivation revokes refresh tokens.
    """
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")

    if user.id == admin.id and (payload.is_active is False or payload.is_admin is False):
        raise ConflictError("Admins cannot deactivate or demote themselves")

    changes: dict[str, bool] = {}
    if payload.is_active is not None and payload.is_active != user.is_active:
        user.is_active = payload.is_active
        changes["is_active"] = payload.is_active
        if not payload.is_active:
            revoke_all_user_tokens(db, user.id)
    if payload.is_admin is not None and payload.is_admin != user.is_admin:
        user.is_admin = payload.is_admin
        changes["is_admin"] = payload.is_admin

    if changes:
        db.commit()
        db.refresh(user)
        logger.info("Admin %s updated user %s: %s", admin.id, user.id, changes)

    response = AdminUserResponse.model_validate(user)
    return response.model_copy(update={"roast_count": _roast_count_for(db, user.id)})


# --------------------------------------------------------------------------- roasts


def list_roasts(
    db: Session,
    status: RoastStatus | None,
    user_id: int | None,
    date_from: datetime | date | None,
    date_to: datetime | date | None,
    page: int,
    size: int,
) -> Page[AdminRoastResponse]:
    """List roasts (newest first) with their owner's email, applying optional filters.

    A date-only `date_to` is inclusive of that whole UTC day.
    """
    base = select(Roast, User.email).join(User, User.id == Roast.user_id)
    if status is not None:
        base = base.where(Roast.status == status)
    if user_id is not None:
        base = base.where(Roast.user_id == user_id)
    if date_from is not None:
        start = (
            _to_utc_naive(date_from)
            if isinstance(date_from, datetime)
            else datetime.combine(date_from, time.min)
        )
        base = base.where(Roast.created_at >= start)
    if date_to is not None:
        if isinstance(date_to, datetime):
            base = base.where(Roast.created_at <= _to_utc_naive(date_to))
        else:
            end = datetime.combine(date_to + timedelta(days=1), time.min)
            base = base.where(Roast.created_at < end)

    total = _count(db, base)
    stmt = (
        base.order_by(Roast.created_at.desc(), Roast.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = [AdminRoastResponse.from_row(roast, email) for roast, email in db.execute(stmt).all()]
    return Page[AdminRoastResponse](items=items, total=total, page=page, size=size)


def delete_roast(db: Session, admin: User, roast_id: int) -> None:
    """Delete a roast by id (NotFoundError if missing); the action is logged."""
    roast = db.get(Roast, roast_id)
    if roast is None:
        raise NotFoundError("Roast not found")
    owner_id = roast.user_id
    db.delete(roast)
    db.commit()
    logger.info("Admin %s deleted roast %s (owner user %s)", admin.id, roast_id, owner_id)


def list_reports(db: Session, page: int, size: int) -> Page[AdminReportResponse]:
    """List reports on shared roasts (newest first) with each roast's sharing state."""
    counts = (
        select(RoastReport.roast_id.label("roast_id"), func.count(RoastReport.id).label("n"))
        .group_by(RoastReport.roast_id)
        .subquery()
    )
    base = (
        select(RoastReport, Roast, counts.c.n)
        .join(Roast, Roast.id == RoastReport.roast_id)
        .join(counts, counts.c.roast_id == RoastReport.roast_id)
    )
    total = _count(db, base)
    stmt = (
        base.order_by(RoastReport.created_at.desc(), RoastReport.id.desc())
        .offset((page - 1) * size)
        .limit(size)
    )
    items = [
        AdminReportResponse(
            id=report.id,
            roast_id=roast.id,
            repo_owner=roast.repo_owner,
            repo_name=roast.repo_name,
            reason=report.reason,
            details=report.details,
            is_public=roast.is_public,
            share_blocked=roast.share_blocked,
            report_count=int(n),
            created_at=report.created_at,
        )
        for report, roast, n in db.execute(stmt).all()
    ]
    return Page[AdminReportResponse](items=items, total=total, page=page, size=size)


def set_sharing_blocked(db: Session, admin: User, roast_id: int, blocked: bool) -> Roast:
    """Block (and unpublish) or unblock sharing for a roast; the action is logged."""
    roast = db.get(Roast, roast_id)
    if roast is None:
        raise NotFoundError("Roast not found")
    roast.share_blocked = blocked
    if blocked:
        roast.is_public = False
    db.commit()
    db.refresh(roast)
    logger.info("Admin %s set sharing_blocked=%s on roast %s", admin.id, blocked, roast_id)
    return roast


# --------------------------------------------------------------------------- stats


def get_stats(db: Session) -> AdminStats:
    """Compute dashboard statistics with aggregate SQL (portable PG / SQLite)."""
    now = _utc_now()
    today_start = datetime.combine(now.date(), time.min)
    week_ago = now - timedelta(days=7)

    user_row = db.execute(
        select(
            func.count(User.id),
            func.coalesce(
                func.sum(case((User.last_login_at >= week_ago, 1), else_=0)),
                0,
            ),
        )
    ).one()

    terminal = Roast.status.in_([RoastStatus.completed, RoastStatus.failed])
    roast_row = db.execute(
        select(
            func.count(Roast.id),
            func.coalesce(func.sum(case((Roast.created_at >= today_start, 1), else_=0)), 0),
            func.avg(case((Roast.status == RoastStatus.completed, Roast.overall_score))),
            func.coalesce(func.sum(case((Roast.status == RoastStatus.failed, 1), else_=0)), 0),
            func.coalesce(func.sum(case((terminal, 1), else_=0)), 0),
            func.coalesce(func.sum(Roast.prompt_tokens), 0),
            func.coalesce(func.sum(Roast.completion_tokens), 0),
        )
    ).one()
    (
        total_roasts,
        roasts_today,
        avg_score_raw,
        failed,
        terminal_count,
        prompt_tokens,
        completion_tokens,
    ) = roast_row

    intensity_split: dict[RoastIntensity, int] = dict.fromkeys(RoastIntensity, 0)
    for intensity, count in db.execute(
        select(Roast.intensity, func.count(Roast.id)).group_by(Roast.intensity)
    ).all():
        intensity_split[RoastIntensity(intensity)] = int(count)

    return AdminStats(
        total_users=int(user_row[0]),
        active_users_7d=int(user_row[1]),
        total_roasts=int(total_roasts),
        roasts_today=int(roasts_today),
        avg_score=round(float(avg_score_raw), 1) if avg_score_raw is not None else None,
        failure_rate=round(int(failed) / int(terminal_count), 3) if terminal_count else 0.0,
        intensity_split=intensity_split,
        total_prompt_tokens=int(prompt_tokens),
        total_completion_tokens=int(completion_tokens),
    )
