"""Admin endpoints. Every route requires an authenticated admin (require_admin)."""

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.dependencies import get_db, require_admin
from app.models import RoastStatus, User
from app.schemas.admin import (
    AdminReportResponse,
    AdminRoastResponse,
    AdminStats,
    AdminUserResponse,
    AdminUserUpdate,
    Page,
    SharingUpdate,
)
from app.services import admin_service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/users", response_model=Page[AdminUserResponse])
async def list_users(
    search: str | None = Query(default=None, max_length=255),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> Page[AdminUserResponse]:
    """Paginated users (newest first) with roast counts; `search` matches email or name."""
    return admin_service.list_users(db, search, page, size)


@router.put("/users/{user_id}", response_model=AdminUserResponse)
async def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserResponse:
    """Toggle a user's is_active / is_admin. Admins cannot demote or deactivate themselves."""
    return admin_service.update_user(db, admin, user_id, payload)


@router.get("/roasts", response_model=Page[AdminRoastResponse])
async def list_roasts(
    status_filter: RoastStatus | None = Query(default=None, alias="status"),
    user_id: int | None = Query(default=None, ge=1),
    date_from: date | datetime | None = Query(default=None, alias="from"),
    date_to: date | datetime | None = Query(default=None, alias="to"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> Page[AdminRoastResponse]:
    """Paginated roasts (newest first) with owner email, filterable by status/user/date."""
    return admin_service.list_roasts(db, status_filter, user_id, date_from, date_to, page, size)


@router.delete("/roasts/{roast_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_roast(
    roast_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Response:
    """Delete a roast. The deletion is logged with the acting admin's id."""
    admin_service.delete_roast(db, admin, roast_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/reports", response_model=Page[AdminReportResponse])
async def list_reports(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> Page[AdminReportResponse]:
    """Paginated reports filed against shared roasts (newest first)."""
    return admin_service.list_reports(db, page, size)


@router.patch("/roasts/{roast_id}/sharing", response_model=AdminRoastResponse)
async def update_roast_sharing(
    roast_id: int,
    payload: SharingUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminRoastResponse:
    """Block (and unpublish) or unblock public sharing of a roast. The action is logged."""
    roast = admin_service.set_sharing_blocked(db, admin, roast_id, payload.blocked)
    owner = db.get(User, roast.user_id)
    return AdminRoastResponse.from_row(roast, owner.email if owner else "")


@router.get("/stats", response_model=AdminStats)
async def get_stats(db: Session = Depends(get_db)) -> AdminStats:
    """Aggregated platform statistics."""
    return admin_service.get_stats(db)
