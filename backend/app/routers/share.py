"""Share toggle endpoint for roasts (owner only)."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_current_user, get_db
from app.models import User
from app.schemas.public import ShareToggleRequest, ShareToggleResponse
from app.services import share_service

router = APIRouter(prefix="/roasts", tags=["share"])


@router.patch("/{roast_id}/share", response_model=ShareToggleResponse)
async def toggle_share(
    roast_id: int,
    body: ShareToggleRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ShareToggleResponse:
    """Make a completed roast public/private. 404 if not owned, 409 if not completed."""
    roast = share_service.get_owned_roast(db, roast_id, user)
    return share_service.set_sharing(db, roast, body.is_public)
