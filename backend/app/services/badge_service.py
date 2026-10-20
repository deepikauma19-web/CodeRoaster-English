"""SVG score badge for READMEs (shields.io-style, rendered locally).

Only a number and a fixed band label go into the SVG, never repo or user text, so the
output cannot carry injected markup.
"""

from app.services.share_service import score_band

LABEL = "code roasted"
CHAR_WIDTH = 6.6  # approximate px per character at 11px Verdana
PADDING = 10
HEIGHT = 20

# band -> (background, text colour); every pair keeps WCAG AA contrast.
BAND_STYLES: dict[str, tuple[str, str]] = {
    "Burnt": ("#dc2626", "#ffffff"),
    "Half-boiled": ("#f97316", "#0a0a0a"),
    "Decent": ("#facc15", "#0a0a0a"),
    "Excellent!": ("#d4f23c", "#0a0a0a"),
}
LABEL_BG = "#0a0a0a"
LABEL_FG = "#ffffff"


def _width(text: str) -> int:
    return round(len(text) * CHAR_WIDTH + 2 * PADDING)


def render_badge_svg(score: int) -> str:
    """Two-part badge: "code roasted | 72/100", coloured by the score band."""
    score = max(0, min(100, int(score)))
    value = f"{score}/100"
    background, foreground = BAND_STYLES[score_band(score)]
    label_w, value_w = _width(LABEL), _width(value)
    total = label_w + value_w
    label_x, value_x = label_w / 2, label_w + value_w / 2
    title = f"Code Roaster: {value}"
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total}" height="{HEIGHT}" '
        f'role="img" aria-label="{title}">'
        f"<title>{title}</title>"
        f'<clipPath id="r"><rect width="{total}" height="{HEIGHT}" rx="4"/></clipPath>'
        f'<g clip-path="url(#r)">'
        f'<rect width="{label_w}" height="{HEIGHT}" fill="{LABEL_BG}"/>'
        f'<rect x="{label_w}" width="{value_w}" height="{HEIGHT}" fill="{background}"/>'
        "</g>"
        '<g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" '
        'text-anchor="middle">'
        f'<text x="{label_x}" y="14" fill="{LABEL_FG}">{LABEL}</text>'
        f'<text x="{value_x}" y="14" fill="{foreground}" font-weight="bold">{value}</text>'
        "</g></svg>"
    )
