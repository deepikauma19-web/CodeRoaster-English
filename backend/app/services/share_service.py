"""Business logic for sharing roasts publicly: slugs, public lookups and OG share pages."""

import hashlib
import html
import logging
import re
import secrets
import unicodedata
from typing import Any
from urllib.parse import quote

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.exceptions import ConflictError, NotFoundError
from app.models import Roast, RoastReport, RoastStatus, User
from app.schemas.public import (
    PublicRoastResponse,
    PublicScoreBreakdown,
    PublicTip,
    ReportReason,
    ShareToggleResponse,
)

logger = logging.getLogger(__name__)

SLUG_BYTES = 12
MAX_SLUG_ATTEMPTS = 5
ROAST_LINE_MAX_CHARS = 120

_FENCE_RE = re.compile(r"```.*?(```|$)", re.DOTALL)
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_HTML_TAG_RE = re.compile(r"<[^>]*>")
_LINE_PREFIX_RE = re.compile(r"^\s*(?:#{1,6}\s+|>+\s*|[-*+]\s+|\d+[.)]\s+)+")
_EMPHASIS_RE = re.compile(r"(\*\*|__|\*|_|~~|`)")
_WS_RE = re.compile(r"\s+")
_HEADING_RE = re.compile(r"^\s*#{1,6}\s")


# --------------------------------------------------------------------------- URLs


def share_page_url(slug: str) -> str:
    """Absolute URL of the OG-enabled share page (the URL users should share)."""
    return f"{settings.PUBLIC_API_URL}/api/v1/public/share/{quote(slug, safe='')}"


def card_image_url(slug: str) -> str:
    """Absolute URL of the rendered 1200x630 OG card image."""
    return f"{settings.PUBLIC_API_URL}/api/v1/public/roasts/{quote(slug, safe='')}/card.png"


def frontend_roast_url(slug: str) -> str:
    """Absolute URL of the SPA's public roast page."""
    return f"{settings.FRONTEND_URL}/r/{quote(slug, safe='')}"


# --------------------------------------------------------------------------- text helpers


def strip_unrenderable(text: str) -> str:
    """Remove emoji / symbol / control characters that the bundled font cannot render."""
    kept: list[str] = []
    for ch in text:
        code = ord(ch)
        if ch in "\n\t ":
            kept.append(ch)
            continue
        if 0xFE00 <= code <= 0xFE0F or code in (0x200D, 0x20E3):
            continue
        if unicodedata.category(ch) in ("So", "Cs", "Co", "Cn", "Cc", "Cf"):
            continue
        kept.append(ch)
    return "".join(kept)


def strip_markdown(text: str) -> str:
    """Convert markdown / HTML-ish text to plain text (best effort, line structure kept)."""
    text = _FENCE_RE.sub(" ", text)
    text = _IMAGE_RE.sub(r"\1", text)
    text = _LINK_RE.sub(r"\1", text)
    text = _HTML_TAG_RE.sub(" ", text)
    lines = []
    for raw in text.splitlines():
        line = _LINE_PREFIX_RE.sub("", raw)
        line = _EMPHASIS_RE.sub("", line)
        lines.append(_WS_RE.sub(" ", line).strip())
    return "\n".join(lines)


def truncate(text: str, limit: int) -> str:
    """Truncate on a word boundary, appending an ellipsis when shortened."""
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[: limit - 1]
    if " " in cut[limit // 2 :]:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(" ,.;:-") + "…"


def first_roast_line(roast_text: str | None, limit: int = ROAST_LINE_MAX_CHARS) -> str:
    """First non-empty plain-text line of the roast, at most `limit` characters."""
    if not roast_text:
        return ""
    # Drop markdown headings ("## Intro") so the card shows an actual roast sentence.
    body = "\n".join(ln for ln in roast_text.splitlines() if not _HEADING_RE.match(ln))
    for line in strip_markdown(body).splitlines():
        line = line.strip()
        if line:
            return truncate(line, limit)
    return ""


def first_name(full_name: str | None) -> str:
    """First whitespace-separated token of a full name ("" when unknown)."""
    parts = (full_name or "").split()
    return parts[0] if parts else ""


def score_band(score: int) -> str:
    """Band label for a 0-100 score."""
    if score >= 80:
        return "Excellent!"
    if score >= 60:
        return "Decent"
    if score >= 40:
        return "Half-boiled"
    return "Burnt"


# --------------------------------------------------------------------------- owner actions


def get_owned_roast(db: Session, roast_id: int, user: User) -> Roast:
    """Return the roast if it belongs to `user`; 404 otherwise (never reveal others' roasts)."""
    roast = db.get(Roast, roast_id)
    if roast is None or roast.user_id != user.id:
        raise NotFoundError("Roast not found")
    return roast


def set_sharing(db: Session, roast: Roast, is_public: bool) -> ShareToggleResponse:
    """Toggle public sharing. Generates a random slug on first enable; disabling keeps it."""
    if roast.status != RoastStatus.completed:
        raise ConflictError("This roast is not ready yet")
    if is_public and roast.share_blocked:
        raise ConflictError("Sharing is disabled for this roast because it was reported.")
    if is_public and roast.secrets_detected > 0:
        raise ConflictError(
            "This roast can't be shared because secrets were detected in the repo. "
            "Remove them, then roast again."
        )

    if is_public and roast.share_slug is None:
        roast_id = roast.id
        for attempt in range(1, MAX_SLUG_ATTEMPTS + 1):
            roast.share_slug = secrets.token_urlsafe(SLUG_BYTES)
            roast.is_public = True
            try:
                db.commit()
                break
            except IntegrityError:
                db.rollback()
                logger.warning("share_slug collision for roast %s (attempt %d)", roast_id, attempt)
                refreshed = db.get(Roast, roast_id)
                if refreshed is None:
                    raise NotFoundError("Roast not found") from None
                roast = refreshed
        else:
            raise ConflictError("Could not generate a share link, please try again")
    else:
        roast.is_public = is_public
        db.commit()

    db.refresh(roast)
    logger.info("Roast %s sharing set to %s", roast.id, roast.is_public)
    return ShareToggleResponse(
        is_public=roast.is_public,
        share_slug=roast.share_slug,
        share_url=share_page_url(roast.share_slug)
        if roast.is_public and roast.share_slug
        else None,
    )


# --------------------------------------------------------------------------- public reads


def find_public_roast(db: Session, slug: str) -> Roast | None:
    """Roast for `slug` if it is public, completed and its author is active; else None."""
    if not slug or len(slug) > 32:
        return None
    stmt = (
        select(Roast)
        .join(Roast.user)
        .options(joinedload(Roast.user))
        .where(
            Roast.share_slug == slug,
            Roast.is_public.is_(True),
            Roast.status == RoastStatus.completed,
            User.is_active.is_(True),
        )
    )
    return db.execute(stmt).unique().scalar_one_or_none()


def get_public_roast(db: Session, slug: str) -> Roast:
    """Like find_public_roast but raises 404."""
    roast = find_public_roast(db, slug)
    if roast is None:
        raise NotFoundError("Roast not found")
    return roast


def _reporter_hash(ip: str) -> str:
    """Salted hash of the reporter's IP, so we can de-duplicate without storing the IP."""
    return hashlib.sha256(f"{settings.SECRET_KEY}:{ip}".encode()).hexdigest()


def report_roast(
    db: Session, slug: str, reason: ReportReason, details: str | None, reporter_ip: str
) -> None:
    """
    File a report against a public roast.

    A reporter can report a roast once (repeat reports are silently ignored). Once
    `REPORT_AUTO_UNPUBLISH_THRESHOLD` distinct reporters flag it, it is unpublished and
    sharing is blocked until an admin reviews it.

    Raises:
        NotFoundError: if the roast is not public
    """
    roast = get_public_roast(db, slug)
    cleaned = (details or "").strip()[:500] or None
    db.add(
        RoastReport(
            roast_id=roast.id,
            reason=reason,
            details=cleaned,
            reporter_hash=_reporter_hash(reporter_ip),
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return
    total = db.scalar(select(func.count(RoastReport.id)).where(RoastReport.roast_id == roast.id))
    logger.info("Roast %s reported (%s), %s report(s) total", roast.id, reason, total)
    if (total or 0) >= settings.REPORT_AUTO_UNPUBLISH_THRESHOLD:
        roast.is_public = False
        roast.share_blocked = True
        db.commit()
        logger.warning("Roast %s auto-unpublished after %s reports", roast.id, total)


def _parse_tips(raw: list[dict[str, Any]] | None) -> list[PublicTip]:
    tips: list[PublicTip] = []
    for item in raw or []:
        try:
            tips.append(PublicTip.model_validate(item))
        except ValueError:
            logger.warning("Skipping malformed tip in public roast")
    return tips


def to_public_response(roast: Roast) -> PublicRoastResponse:
    """Build the privacy-safe public payload (no email, user_id or roast id)."""
    breakdown: PublicScoreBreakdown | None = None
    if roast.score_breakdown:
        try:
            breakdown = PublicScoreBreakdown.model_validate(roast.score_breakdown)
        except ValueError:
            logger.warning("Malformed score_breakdown on public roast")
    return PublicRoastResponse(
        repo_owner=roast.repo_owner,
        repo_name=roast.repo_name,
        repo_url=roast.repo_url,
        intensity=roast.intensity,
        overall_score=roast.overall_score,
        score_breakdown=breakdown,
        roast_text=roast.roast_text,
        tips=_parse_tips(roast.tips),
        author_first_name=first_name(roast.user.full_name),
        author_avatar_url=roast.user.avatar_url,
        created_at=roast.created_at,
    )


# --------------------------------------------------------------------------- share HTML


def _esc(value: str) -> str:
    return html.escape(value, quote=True)


def render_share_html(roast: Roast) -> str:
    """Server-rendered OG page for social crawlers that redirects humans to the SPA.

    Every interpolated value is HTML-escaped: roast text is LLM output derived from
    untrusted repositories.
    """
    slug = roast.share_slug or ""
    score = roast.overall_score if roast.overall_score is not None else 0
    repo = f"{roast.repo_owner}/{roast.repo_name}"
    title = f"{repo} got roasted: {score}/100 🔥"
    description_source = strip_markdown(roast.summary or "").replace("\n", " ").strip()
    description = truncate(description_source, 200) or first_roast_line(roast.roast_text)
    if not description:
        description = f"{score_band(score)} — Code Roaster"
    image = card_image_url(slug)
    page_url = share_page_url(slug)
    target = frontend_roast_url(slug)

    t, d, img, url, tgt = (_esc(v) for v in (title, description, image, page_url, target))
    # JSON-ish string for JS: escape for a JS string inside an HTML <script>.
    js_target = (
        target.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t}</title>
<meta name="description" content="{d}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Code Roaster">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:image" content="{img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{t}">
<meta property="og:url" content="{url}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
<meta name="twitter:image" content="{img}">
<link rel="canonical" href="{url}">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="0;url={tgt}">
<script>window.location.replace("{js_target}");</script>
</head>
<body>
<p>Redirecting to the roast… <a href="{tgt}">View the roast</a></p>
</body>
</html>
"""


def render_not_found_html() -> str:
    """Minimal 404 page for share links that are missing or no longer public."""
    home = _esc(settings.FRONTEND_URL)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Roast not found — Code Roaster</title>
</head>
<body>
<h1>Roast not found</h1>
<p>This roast doesn't exist or is no longer public.</p>
<p><a href="{home}">Roast your own repo →</a></p>
</body>
</html>
"""
