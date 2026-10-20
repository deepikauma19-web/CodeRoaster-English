"""Roast endpoints (owner only): create, list, get, status, retry, delete."""

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response, status
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.auth.jwt import decode_access_token
from app.database import get_db
from app.dependencies import get_current_user
from app.exceptions import AppError, BadRequestError
from app.models import RoastStatus, User
from app.rate_limit import limiter
from app.schemas.roast import (
    RoastCreate,
    RoastListResponse,
    RoastQuotaResponse,
    RoastResponse,
    RoastStatusResponse,
)
from app.services import roast_service
from app.services.github_service import InvalidRepoUrlError, normalize_repo_url, parse_repo_url
from app.services.roast_pipeline import run_roast

router = APIRouter(prefix="/roasts", tags=["roasts"])

ROAST_CREATE_LIMIT = "5/minute"


def user_rate_limit_key(request: Request) -> str:
    """Rate-limit key: the authenticated user id when a valid Bearer token is present,
    otherwise the client IP."""
    auth_header = request.headers.get("authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() == "bearer" and token:
        try:
            return f"user:{decode_access_token(token.strip())}"
        except AppError:
            pass
    return f"ip:{get_remote_address(request)}"


@router.post("", response_model=RoastResponse, status_code=status.HTTP_202_ACCEPTED)
@limiter.limit(ROAST_CREATE_LIMIT, key_func=user_rate_limit_key)
async def create_roast(
    request: Request,
    payload: RoastCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoastResponse:
    """Create a roast for a public GitHub repo and queue the analysis pipeline (202)."""
    try:
        owner, repo = parse_repo_url(payload.repo_url)
    except InvalidRepoUrlError as exc:
        raise BadRequestError(exc.message) from exc
    roast_service.enforce_daily_quota(db, user)
    roast = roast_service.create_roast(
        db, user, owner, repo, normalize_repo_url(owner, repo), payload.intensity
    )
    background_tasks.add_task(run_roast, roast.id)
    return RoastResponse.model_validate(roast)


@router.get("", response_model=RoastListResponse)
async def list_roasts(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoastListResponse:
    """List the current user's roasts, newest first."""
    items, total = roast_service.list_user_roasts(db, user.id, page, size)
    return RoastListResponse(
        items=[RoastResponse.model_validate(r) for r in items], total=total, page=page, size=size
    )


@router.get("/quota", response_model=RoastQuotaResponse)
async def get_roast_quota(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoastQuotaResponse:
    """How many roasts the current user has left in the rolling 24-hour window."""
    quota = roast_service.get_roast_quota(db, user)
    return RoastQuotaResponse(
        limit=quota.limit, used=quota.used, remaining=quota.remaining, resets_at=quota.resets_at
    )


@router.get("/{roast_id}", response_model=RoastResponse)
async def get_roast(
    roast_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoastResponse:
    """Full roast (owner only; 404 otherwise)."""
    return RoastResponse.model_validate(roast_service.get_user_roast(db, roast_id, user.id))


@router.get("/{roast_id}/status", response_model=RoastStatusResponse)
async def get_roast_status(
    roast_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoastStatusResponse:
    """Lightweight status for polling (owner only; 404 otherwise)."""
    return RoastStatusResponse.model_validate(roast_service.get_user_roast(db, roast_id, user.id))


@router.post(
    "/{roast_id}/retry", response_model=RoastResponse, status_code=status.HTTP_202_ACCEPTED
)
@limiter.limit(ROAST_CREATE_LIMIT, key_func=user_rate_limit_key)
async def retry_roast(
    request: Request,
    roast_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoastResponse:
    """Re-queue a failed roast (409 if it is not failed)."""
    roast = roast_service.get_user_roast(db, roast_id, user.id)
    if roast.status == RoastStatus.failed:
        roast_service.enforce_daily_quota(db, user)
    roast = roast_service.reset_for_retry(db, roast)
    background_tasks.add_task(run_roast, roast.id)
    return RoastResponse.model_validate(roast)


@router.delete("/{roast_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_roast(
    roast_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Delete one of the current user's roasts."""
    roast = roast_service.get_user_roast(db, roast_id, user.id)
    roast_service.delete_roast(db, roast)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
