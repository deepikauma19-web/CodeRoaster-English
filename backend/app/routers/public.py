"""Public (unauthenticated) endpoints for shared roasts: JSON view, OG card and share page."""

from fastapi import APIRouter, Depends, Request, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, Response
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.database import get_db
from app.rate_limit import limiter
from app.schemas.public import PublicRoastResponse, RoastReportCreate, RoastReportResponse
from app.services import badge_service, card_service, share_service

# Shared roasts are unlisted: reachable by link, never offered to search engines.
NOINDEX = {"X-Robots-Tag": "noindex, nofollow"}


def _add_noindex(response: Response) -> None:
    response.headers.update(NOINDEX)


router = APIRouter(prefix="/public", tags=["public"], dependencies=[Depends(_add_noindex)])


@router.get("/roasts/{share_slug}", response_model=PublicRoastResponse)
@limiter.limit("60/minute")
async def get_public_roast(
    request: Request,
    share_slug: str,
    db: Session = Depends(get_db),
) -> PublicRoastResponse:
    """Privacy-safe public view of a shared roast (404 unless public and completed)."""
    roast = share_service.get_public_roast(db, share_slug)
    return share_service.to_public_response(roast)


@router.get(
    "/roasts/{share_slug}/card.png",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}},
)
@limiter.limit("60/minute")
async def get_roast_card(
    request: Request,
    share_slug: str,
    db: Session = Depends(get_db),
) -> Response:
    """1200x630 PNG Open Graph card for a shared roast."""
    roast = share_service.get_public_roast(db, share_slug)
    data = card_service.card_data_from_roast(roast)
    png = await run_in_threadpool(card_service.get_card_png, data)
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600", **NOINDEX},
    )


@router.get(
    "/roasts/{share_slug}/badge.svg",
    response_class=Response,
    responses={200: {"content": {"image/svg+xml": {}}}},
)
@limiter.limit("600/minute")  # GitHub's image proxy shares a few IPs across many READMEs
async def get_roast_badge(
    request: Request,
    share_slug: str,
    db: Session = Depends(get_db),
) -> Response:
    """README badge ("code roasted | 72/100") for a shared roast; 404 unless public."""
    roast = share_service.get_public_roast(db, share_slug)
    svg = badge_service.render_badge_svg(roast.overall_score or 0)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "public, max-age=3600",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
            "X-Content-Type-Options": "nosniff",
            **NOINDEX,
        },
    )


@router.get("/share/{share_slug}", response_class=HTMLResponse)
@limiter.limit("60/minute")
async def get_share_page(
    request: Request,
    share_slug: str,
    db: Session = Depends(get_db),
) -> HTMLResponse:
    """OG-tagged HTML for social crawlers; redirects browsers to the SPA's /r/{slug}."""
    roast = share_service.find_public_roast(db, share_slug)
    if roast is None:
        return HTMLResponse(share_service.render_not_found_html(), status_code=404, headers=NOINDEX)
    return HTMLResponse(
        share_service.render_share_html(roast),
        headers={"Cache-Control": "public, max-age=300", **NOINDEX},
    )


@router.post(
    "/roasts/{share_slug}/report",
    response_model=RoastReportResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("5/hour")
async def report_roast(
    request: Request,
    share_slug: str,
    payload: RoastReportCreate,
    db: Session = Depends(get_db),
) -> RoastReportResponse:
    """Report a public roast (owner request, harassment, leaked secrets or other)."""
    share_service.report_roast(
        db, share_slug, payload.reason, payload.details, get_remote_address(request)
    )
    return RoastReportResponse()
