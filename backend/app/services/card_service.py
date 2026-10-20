"""Render 1200x630 Open Graph "roast cards" with Pillow, with an in-memory LRU cache.

Rendering is CPU-bound and synchronous: call `get_card_png` via `run_in_threadpool`.
"""

import io
import logging
import threading
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.models import Roast, RoastIntensity
from app.services.share_service import (
    first_name,
    first_roast_line,
    score_band,
    strip_unrenderable,
    truncate,
)

logger = logging.getLogger(__name__)

WIDTH, HEIGHT = 1200, 630
CACHE_MAX_ENTRIES = 128
FONT_PATH = Path(__file__).resolve().parent.parent / "assets" / "fonts" / "Inter-Variable.ttf"

RGB = tuple[int, int, int]
Font = ImageFont.FreeTypeFont | ImageFont.ImageFont

BG_TOP: RGB = (10, 10, 10)
BG_BOTTOM: RGB = (28, 30, 22)
GLOW: RGB = (212, 242, 60)
TEXT: RGB = (255, 255, 255)
MUTED: RGB = (176, 176, 170)
ORANGE: RGB = (255, 122, 38)
LIME: RGB = (212, 242, 60)
CHILI_RED: RGB = (226, 38, 38)
CHILI_STEM: RGB = (64, 168, 72)
CHILI_OFF: RGB = (110, 70, 60)

BAND_COLOURS: dict[str, RGB] = {
    "Burnt": (239, 68, 68),
    "Half-boiled": (249, 115, 22),
    "Decent": (250, 204, 21),
    "Excellent!": (34, 197, 94),
}

INTENSITY_LEVEL: dict[RoastIntensity, tuple[int, str]] = {
    RoastIntensity.mild: (1, "MILD"),
    RoastIntensity.medium: (2, "MEDIUM"),
    RoastIntensity.extra_spicy: (3, "EXTRA SPICY"),
}


@dataclass(frozen=True)
class CardData:
    """Everything needed to render a card (detached from the ORM session)."""

    slug: str
    completed_at: datetime | None
    repo_owner: str
    repo_name: str
    score: int
    intensity: RoastIntensity
    roast_line: str
    author_first_name: str


def card_data_from_roast(roast: Roast) -> CardData:
    """Extract render inputs from a (public, completed) roast."""
    return CardData(
        slug=roast.share_slug or "",
        completed_at=roast.completed_at,
        repo_owner=roast.repo_owner,
        repo_name=roast.repo_name,
        score=max(0, min(100, roast.overall_score or 0)),
        intensity=roast.intensity,
        roast_line=first_roast_line(roast.roast_text),
        author_first_name=first_name(roast.user.full_name),
    )


# --------------------------------------------------------------------------- fonts


@lru_cache(maxsize=32)
def _font(size: int, weight: int = 400) -> Font:
    """Bundled Inter at a given size/weight; falls back to Pillow's default font."""
    try:
        font = ImageFont.truetype(str(FONT_PATH), size)
        try:
            font.set_variation_by_axes([min(32, max(14, size)), weight])
        except OSError:
            logger.debug("Font variations unsupported; using default weight")
        return font
    except OSError:
        logger.warning("Bundled font missing at %s; using Pillow default font", FONT_PATH)
        return ImageFont.load_default(size=size)


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: Font) -> float:
    return draw.textlength(text, font=font)


def _fit_text(draw: ImageDraw.ImageDraw, text: str, font: Font, max_width: int) -> str:
    """Shorten `text` with an ellipsis until it fits `max_width` pixels."""
    if _text_width(draw, text, font) <= max_width:
        return text
    while text and _text_width(draw, text + "…", font) > max_width:
        text = text[:-1]
    return text.rstrip() + "…"


def _wrap(
    draw: ImageDraw.ImageDraw, text: str, font: Font, max_width: int, max_lines: int
) -> list[str]:
    """Greedy word-wrap into at most `max_lines` lines (last line ellipsised)."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if _text_width(draw, candidate, font) <= max_width:
            current = candidate
            continue
        if current:
            lines.append(current)
        current = (
            word
            if _text_width(draw, word, font) <= max_width
            else _fit_text(draw, word, font, max_width)
        )
        if len(lines) == max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    if len(lines) == max_lines and " ".join(lines) != " ".join(words):
        lines[-1] = _fit_text(draw, lines[-1] + " …", font, max_width)
    return lines[:max_lines]


# --------------------------------------------------------------------------- drawing


def _background() -> Image.Image:
    """Dark vertical gradient with a soft lime radial glow in the lower right."""
    mask = Image.linear_gradient("L").resize((WIDTH, HEIGHT))
    base = Image.composite(
        Image.new("RGB", (WIDTH, HEIGHT), BG_BOTTOM),
        Image.new("RGB", (WIDTH, HEIGHT), BG_TOP),
        mask,
    )
    glow_mask = Image.new("L", (WIDTH, HEIGHT), 0)
    ImageDraw.Draw(glow_mask).ellipse(
        (WIDTH - 520, HEIGHT - 300, WIDTH + 380, HEIGHT + 400), fill=120
    )
    glow_mask = glow_mask.filter(ImageFilter.GaussianBlur(140))
    base.paste(Image.new("RGB", (WIDTH, HEIGHT), GLOW), (0, 0), glow_mask)
    return base


def _flame(draw: ImageDraw.ImageDraw, x: int, y: int, h: int) -> None:
    """Simple two-tone flame glyph (emoji is not available in the bundled font)."""
    w = int(h * 0.7)
    outer = [
        (x + w * 0.5, y),
        (x + w * 0.85, y + h * 0.38),
        (x + w, y + h * 0.68),
        (x + w * 0.5, y + h),
        (x, y + h * 0.68),
        (x + w * 0.12, y + h * 0.42),
        (x + w * 0.3, y + h * 0.55),
    ]
    draw.polygon(outer, fill=ORANGE)
    draw.ellipse((x, y + h * 0.36, x + w, y + h), fill=ORANGE)
    draw.ellipse((x + w * 0.27, y + h * 0.58, x + w * 0.73, y + h * 0.98), fill=(255, 210, 74))


def _chili(draw: ImageDraw.ImageDraw, x: int, y: int, active: bool) -> None:
    """A small chili pepper: curved body + green stem."""
    body = CHILI_RED if active else CHILI_OFF
    stem = CHILI_STEM if active else CHILI_OFF
    draw.ellipse((x, y + 6, x + 34, y + 30), fill=body)
    draw.polygon(
        [(x + 26, y + 10), (x + 46, y + 22), (x + 52, y + 36), (x + 28, y + 28)], fill=body
    )
    draw.ellipse((x + 40, y + 26, x + 54, y + 38), fill=body)
    draw.rounded_rectangle((x - 8, y + 12, x + 6, y + 20), radius=3, fill=stem)
    draw.rectangle((x - 12, y + 6, x - 7, y + 16), fill=stem)


def render_card(data: CardData) -> bytes:
    """Render the roast card as PNG bytes (synchronous, CPU-bound)."""
    img = _background()
    draw = ImageDraw.Draw(img)
    margin = 64
    band = score_band(data.score)
    band_colour = BAND_COLOURS[band]

    # Wordmark (top left)
    _flame(draw, margin, 46, 40)
    wordmark_font = _font(30, 800)
    draw.text((margin + 40, 50), "Code Roaster", font=wordmark_font, fill=TEXT)
    wm_w = _text_width(draw, "Code Roaster ", wordmark_font)
    draw.text((margin + 40 + wm_w, 50), "2.0", font=wordmark_font, fill=LIME)

    # Intensity chilis (top right)
    level, label = INTENSITY_LEVEL.get(data.intensity, (2, "MEDIUM"))
    label_font = _font(18, 700)
    label_w = _text_width(draw, label, label_font)
    chili_start = WIDTH - margin - 3 * 64 + 12
    for i in range(3):
        _chili(draw, chili_start + i * 64, 42, i < level)
    draw.text((WIDTH - margin - label_w, 92), label, font=label_font, fill=MUTED)

    # Score panel (right)
    panel = (WIDTH - margin - 360, 150, WIDTH - margin, 470)
    draw.rounded_rectangle(panel, radius=28, fill=(18, 18, 18), outline=band_colour, width=4)
    score_font = _font(150, 900)
    out_of_font = _font(40, 700)
    score_text = str(data.score)
    sw = _text_width(draw, score_text, score_font)
    ow = _text_width(draw, "/100", out_of_font)
    cx = (panel[0] + panel[2]) / 2
    sx = cx - (sw + ow + 6) / 2
    draw.text((sx, 330), score_text, font=score_font, fill=band_colour, anchor="ls")
    draw.text((sx + sw + 6, 330), "/100", font=out_of_font, fill=MUTED, anchor="ls")
    band_font = _font(36, 800)
    bw = _text_width(draw, band, band_font)
    pill = (cx - bw / 2 - 24, 365, cx + bw / 2 + 24, 425)
    draw.rounded_rectangle(pill, radius=30, fill=band_colour)
    draw.text((cx, 395), band, font=band_font, fill=(10, 10, 10), anchor="mm")

    # Repo name (left column)
    left_w = panel[0] - margin - 48
    owner_font = _font(30, 500)
    repo_font = _font(60, 800)
    owner = strip_unrenderable(data.repo_owner)
    repo = strip_unrenderable(data.repo_name)
    draw.text(
        (margin, 160),
        _fit_text(draw, owner + " /", owner_font, left_w),
        font=owner_font,
        fill=MUTED,
    )
    draw.text((margin, 200), _fit_text(draw, repo, repo_font, left_w), font=repo_font, fill=TEXT)

    # Roast line (left column)
    line = strip_unrenderable(truncate(data.roast_line, 120)).strip()
    if line:
        quote_font = _font(30, 500)
        wrapped = _wrap(draw, line, quote_font, left_w - 28, 3)
        draw.rectangle((margin, 306, margin + 6, 306 + len(wrapped) * 42 - 8), fill=LIME)
        for i, text_line in enumerate(wrapped):
            draw.text((margin + 28, 300 + i * 42), text_line, font=quote_font, fill=TEXT)

    # Footer
    draw.line((margin, 520, WIDTH - margin, 520), fill=(60, 62, 52), width=2)
    footer_font = _font(26, 600)
    author = strip_unrenderable(data.author_first_name).strip()
    who = f"Roasted for {author}" if author else "Freshly roasted"
    draw.text((margin, 548), _fit_text(draw, who, footer_font, 600), font=footer_font, fill=MUTED)
    cta = "Want your repo roasted too?"
    draw.text((WIDTH - margin, 548), cta, font=footer_font, fill=LIME, anchor="ra")

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


# --------------------------------------------------------------------------- cache

_cache: OrderedDict[tuple[str, datetime | None], bytes] = OrderedDict()
_cache_lock = threading.Lock()


def get_card_png(data: CardData) -> bytes:
    """Return the card PNG, using an LRU cache keyed by (slug, completed_at)."""
    key = (data.slug, data.completed_at)
    with _cache_lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            return cached
    png = render_card(data)
    with _cache_lock:
        _cache[key] = png
        _cache.move_to_end(key)
        while len(_cache) > CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)
    return png


def clear_card_cache() -> None:
    """Drop all cached cards (useful in tests)."""
    with _cache_lock:
        _cache.clear()
