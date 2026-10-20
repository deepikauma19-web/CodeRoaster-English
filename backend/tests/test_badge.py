"""README score badge."""

import re
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.models import Roast, User
from app.services import badge_service
from tests.conftest import API, auth_headers_for


def _share(client: TestClient, roast: Roast, user: User) -> str:
    response = client.patch(
        f"{API}/roasts/{roast.id}/share", json={"is_public": True}, headers=auth_headers_for(user)
    )
    return response.json()["share_slug"]


@pytest.mark.parametrize(
    ("score", "band_colour"),
    [(10, "#dc2626"), (50, "#f97316"), (70, "#facc15"), (90, "#d4f23c")],
)
def test_badge_svg_colours_by_band(score: int, band_colour: str) -> None:
    svg = badge_service.render_badge_svg(score)
    assert f"{score}/100" in svg and "code roasted" in svg
    assert band_colour in svg
    assert svg.startswith("<svg") and svg.endswith("</svg>")


def test_badge_svg_clamps_score() -> None:
    assert "100/100" in badge_service.render_badge_svg(1000)
    assert "0/100" in badge_service.render_badge_svg(-5)


def test_badge_endpoint_for_public_roast(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    roast = make_roast(user, overall_score=72)
    slug = _share(client, roast, user)
    response = client.get(f"{API}/public/roasts/{slug}/badge.svg")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert response.headers["cache-control"] == "public, max-age=3600"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'none'" in response.headers["content-security-policy"]
    assert response.headers["x-robots-tag"] == "noindex, nofollow"
    assert "72/100" in response.text
    # No repo/user text can end up in the image.
    assert roast.repo_name not in response.text and user.email not in response.text
    assert re.fullmatch(r"<svg.*</svg>", response.text, re.DOTALL)


def test_badge_404_when_private_or_unknown(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    roast = make_roast(user)
    slug = _share(client, roast, user)
    client.patch(
        f"{API}/roasts/{roast.id}/share", json={"is_public": False}, headers=auth_headers_for(user)
    )
    assert client.get(f"{API}/public/roasts/{slug}/badge.svg").status_code == 404
    assert client.get(f"{API}/public/roasts/nope/badge.svg").status_code == 404
