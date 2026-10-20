"""Share toggle, public roast JSON (privacy), OG card PNG and the share HTML page."""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Roast, RoastIntensity, RoastStatus, User
from app.services import card_service, share_service
from tests.conftest import API, auth_headers_for

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _share(client: TestClient, roast_id: int, user: User, is_public: bool = True) -> dict:
    response = client.patch(
        f"{API}/roasts/{roast_id}/share",
        json={"is_public": is_public},
        headers=auth_headers_for(user),
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("status", [RoastStatus.pending, RoastStatus.analyzing, RoastStatus.failed])
def test_share_requires_completed(
    client: TestClient, make_roast: Callable[..., Roast], user: User, status: RoastStatus
) -> None:
    roast = make_roast(user, status=status)
    response = client.patch(
        f"{API}/roasts/{roast.id}/share", json={"is_public": True}, headers=auth_headers_for(user)
    )
    assert response.status_code == 409


def test_share_not_owner_404(
    client: TestClient, make_roast: Callable[..., Roast], user: User, other_user: User
) -> None:
    roast = make_roast(other_user)
    response = client.patch(
        f"{API}/roasts/{roast.id}/share", json={"is_public": True}, headers=auth_headers_for(user)
    )
    assert response.status_code == 404


def test_toggle_generates_and_reuses_slug(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    roast = make_roast(user)
    on = _share(client, roast.id, user)
    slug = on["share_slug"]
    assert on["is_public"] is True
    assert slug and len(slug) == 16  # token_urlsafe(12)
    assert on["share_url"] == f"http://localhost:8000/api/v1/public/share/{slug}"
    assert client.get(f"{API}/public/roasts/{slug}").status_code == 200

    off = _share(client, roast.id, user, is_public=False)
    assert off == {"is_public": False, "share_slug": slug, "share_url": None}
    # Link stops working once private.
    assert client.get(f"{API}/public/roasts/{slug}").status_code == 404
    assert client.get(f"{API}/public/roasts/{slug}/card.png").status_code == 404
    assert client.get(f"{API}/public/share/{slug}").status_code == 404

    again = _share(client, roast.id, user)
    assert again["share_slug"] == slug  # reused, not regenerated

    other = make_roast(user)
    assert _share(client, other.id, user)["share_slug"] != slug


def test_roasts_private_by_default(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    roast = make_roast(user, share_slug="presetslug")
    assert roast.is_public is False
    assert client.get(f"{API}/public/roasts/presetslug").status_code == 404


def test_public_roast_has_no_private_fields(
    client: TestClient, make_roast: Callable[..., Roast], make_user: Callable[..., User]
) -> None:
    author = make_user(
        "secret.person@example.com", full_name="Priya Raman", avatar_url="https://img/p.png"
    )
    roast = make_roast(author, intensity=RoastIntensity.extra_spicy)
    slug = _share(client, roast.id, author)["share_slug"]

    response = client.get(f"{API}/public/roasts/{slug}")
    assert response.status_code == 200
    body = response.json()
    forbidden = {"email", "user_id", "id", "user", "author_email", "error_message", "summary"}
    assert forbidden.isdisjoint(body.keys())
    assert set(body) == {
        "repo_owner",
        "repo_name",
        "repo_url",
        "intensity",
        "overall_score",
        "score_breakdown",
        "roast_text",
        "tips",
        "author_first_name",
        "author_avatar_url",
        "created_at",
    }
    assert body["author_first_name"] == "Priya"
    assert body["author_avatar_url"] == "https://img/p.png"
    assert body["intensity"] == "extra_spicy"
    assert len(body["tips"]) == 3
    text = response.text
    assert "secret.person@example.com" not in text
    assert "Raman" not in text


def test_public_roast_hidden_when_author_deactivated(
    client: TestClient,
    db: Session,
    make_roast: Callable[..., Roast],
    user: User,
) -> None:
    roast = make_roast(user)
    slug = _share(client, roast.id, user)["share_slug"]
    user.is_active = False
    db.commit()
    assert client.get(f"{API}/public/roasts/{slug}").status_code == 404


def test_public_unknown_or_overlong_slug(client: TestClient) -> None:
    assert client.get(f"{API}/public/roasts/nope").status_code == 404
    assert client.get(f"{API}/public/roasts/{'x' * 40}").status_code == 404


def test_public_response_tolerates_malformed_data(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    roast = make_roast(
        user,
        score_breakdown={"code_quality": "lots"},
        tips=[{"title": "ok", "description": "d", "priority": "high"}, {"bogus": True}],
    )
    slug = _share(client, roast.id, user)["share_slug"]
    body = client.get(f"{API}/public/roasts/{slug}").json()
    assert body["score_breakdown"] is None
    assert [t["title"] for t in body["tips"]] == ["ok"]


def test_card_png(client: TestClient, make_roast: Callable[..., Roast], user: User) -> None:
    roast = make_roast(
        user,
        roast_text="## Heading\n**What is** this 🔥🔥 " + "very long words " * 20,
        overall_score=91,
        intensity=RoastIntensity.mild,
    )
    slug = _share(client, roast.id, user)["share_slug"]
    response = client.get(f"{API}/public/roasts/{slug}/card.png")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "public, max-age=3600"
    assert response.content.startswith(PNG_MAGIC)
    # Second request is served from the LRU cache (identical bytes).
    assert client.get(f"{API}/public/roasts/{slug}/card.png").content == response.content


@pytest.mark.parametrize(
    ("score", "intensity"),
    [(10, RoastIntensity.extra_spicy), (45, RoastIntensity.medium), (70, RoastIntensity.mild)],
)
def test_render_card_dimensions(score: int, intensity: RoastIntensity) -> None:
    from io import BytesIO

    from PIL import Image

    data = card_service.CardData(
        slug=f"s{score}",
        completed_at=None,
        repo_owner="a-really-long-owner-name-that-needs-fitting",
        repo_name="and-an-even-longer-repository-name-for-the-card",
        score=score,
        intensity=intensity,
        roast_line="",
        author_first_name="",
    )
    png = card_service.render_card(data)
    with Image.open(BytesIO(png)) as image:
        assert image.size == (1200, 630)
        assert image.format == "PNG"


def test_share_html_escapes_and_has_og_tags(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    roast = make_roast(
        user,
        summary='Nice "repo" & <script>alert(1)</script> <img src=x onerror=alert(2)>',
        roast_text="<script>steal()</script>",
    )
    slug = _share(client, roast.id, user)["share_slug"]
    response = client.get(f"{API}/public/share/{slug}")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    html = response.text
    assert html.count("<script>") == 1  # only the redirect script
    assert "alert(1)</script>" not in html
    assert "<img src=x" not in html
    assert "&quot;repo&quot; &amp;" in html
    for tag in ("og:title", "og:description", "og:image", "og:url", "twitter:card"):
        assert f'property="{tag}"' in html or f'name="{tag}"' in html
    assert f'content="http://localhost:8000/api/v1/public/roasts/{slug}/card.png"' in html
    assert "62/100" in html
    assert f"http://localhost:5173/r/{slug}" in html
    assert "alice@example.com" not in html


def test_share_html_not_found(client: TestClient) -> None:
    response = client.get(f"{API}/public/share/missing")
    assert response.status_code == 404
    assert "Roast not found" in response.text
    assert 'name="robots" content="noindex"' in response.text


def test_share_html_falls_back_to_roast_line_and_band(
    make_roast: Callable[..., Roast], user: User, db: Session
) -> None:
    roast = make_roast(
        user,
        summary="",
        share_slug="abc",
        overall_score=None,
        roast_text="## Intro\nThere is no README here!",
    )
    html = share_service.render_share_html(roast)
    assert "There is no README here!" in html
    roast.roast_text = None
    html = share_service.render_share_html(roast)
    assert "Burnt — Code Roaster" in html


@pytest.mark.parametrize(
    ("score", "band"), [(95, "Excellent!"), (60, "Decent"), (40, "Half-boiled"), (0, "Burnt")]
)
def test_score_band(score: int, band: str) -> None:
    assert share_service.score_band(score) == band


def test_text_helpers() -> None:
    assert share_service.first_name("  Priya  Raman ") == "Priya"
    assert share_service.first_name(None) == ""
    assert share_service.first_roast_line(None) == ""
    assert share_service.first_roast_line("# Only heading") == ""
    assert (
        share_service.first_roast_line("```\ncode\n```\n> **Bold** [link](http://x) here")
        == "Bold link here"
    )
    assert share_service.truncate("word " * 50, 20).endswith("…")
    assert len(share_service.truncate("word " * 50, 20)) <= 20
    assert share_service.strip_unrenderable("hi 🔥‍ there\x07") == "hi  there"


def test_slug_collision_retries(
    db: Session,
    make_roast: Callable[..., Roast],
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    make_roast(user, share_slug="taken-slug", is_public=True)
    target = make_roast(user)
    slugs = iter(["taken-slug", "fresh-slug"])
    monkeypatch.setattr(share_service.secrets, "token_urlsafe", lambda n: next(slugs))
    result = share_service.set_sharing(db, target, True)
    assert result.share_slug == "fresh-slug" and result.is_public is True


def test_slug_collision_gives_up(
    db: Session,
    make_roast: Callable[..., Roast],
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.exceptions import ConflictError

    make_roast(user, share_slug="taken-slug", is_public=True)
    target = make_roast(user)
    monkeypatch.setattr(share_service.secrets, "token_urlsafe", lambda n: "taken-slug")
    with pytest.raises(ConflictError):
        share_service.set_sharing(db, target, True)
