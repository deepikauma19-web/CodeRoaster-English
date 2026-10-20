"""Share safeguards: secrets block, unlisted pages, reports + auto-unpublish, admin takedown."""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.exceptions import NotFoundError
from app.models import Roast, RoastReport, User
from app.services import share_service
from tests.conftest import API, auth_headers_for


def _share_response(client: TestClient, roast: Roast, user: User, is_public: bool = True):
    return client.patch(
        f"{API}/roasts/{roast.id}/share",
        json={"is_public": is_public},
        headers=auth_headers_for(user),
    )


def _public_roast(
    client: TestClient, make_roast: Callable[..., Roast], user: User, **overrides: object
) -> tuple[Roast, str]:
    roast = make_roast(user, **overrides)
    slug = _share_response(client, roast, user).json()["share_slug"]
    return roast, slug


# --------------------------------------------------------------------------- secrets


def test_cannot_share_roast_with_detected_secrets(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    roast = make_roast(user, secrets_detected=2)
    response = _share_response(client, roast, user)
    assert response.status_code == 409
    assert "secrets" in response.json()["detail"].lower()


def test_roast_response_exposes_secret_and_block_flags(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    roast = make_roast(user, secrets_detected=1)
    body = client.get(f"{API}/roasts/{roast.id}", headers=auth_headers_for(user)).json()
    assert body["secrets_detected"] == 1
    assert body["share_blocked"] is False


# --------------------------------------------------------------------------- unlisted


def test_public_responses_are_noindex(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    _, slug = _public_roast(client, make_roast, user)
    for path in (f"/public/roasts/{slug}", f"/public/roasts/{slug}/card.png"):
        assert client.get(f"{API}{path}").headers["x-robots-tag"] == "noindex, nofollow"
    page = client.get(f"{API}/public/share/{slug}")
    assert page.headers["x-robots-tag"] == "noindex, nofollow"
    assert '<meta name="robots" content="noindex, nofollow">' in page.text
    missing = client.get(f"{API}/public/share/does-not-exist")
    assert missing.status_code == 404
    assert missing.headers["x-robots-tag"] == "noindex, nofollow"


# --------------------------------------------------------------------------- reports


def test_report_public_roast(
    client: TestClient, make_roast: Callable[..., Roast], user: User, db: Session
) -> None:
    roast, slug = _public_roast(client, make_roast, user)
    response = client.post(
        f"{API}/public/roasts/{slug}/report",
        json={"reason": "owner_request", "details": "  This is my repo, please remove  "},
    )
    assert response.status_code == 201
    assert response.json() == {"received": True}
    report = db.scalars(select(RoastReport).where(RoastReport.roast_id == roast.id)).one()
    assert report.reason == "owner_request"
    assert report.details == "This is my repo, please remove"
    assert "testclient" not in report.reporter_hash  # the IP is hashed, never stored


def test_report_rejects_unknown_reason(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    _, slug = _public_roast(client, make_roast, user)
    response = client.post(f"{API}/public/roasts/{slug}/report", json={"reason": "nope"})
    assert response.status_code == 422


def test_report_private_roast_404(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    roast = make_roast(user)  # never shared
    response = client.post(
        f"{API}/public/roasts/{roast.share_slug or 'x'}/report", json={"reason": "other"}
    )
    assert response.status_code == 404


def test_duplicate_report_from_same_reporter_is_ignored(
    client: TestClient, make_roast: Callable[..., Roast], user: User, db: Session
) -> None:
    roast, slug = _public_roast(client, make_roast, user)
    for _ in range(3):
        assert (
            client.post(f"{API}/public/roasts/{slug}/report", json={"reason": "other"}).status_code
            == 201
        )
    count = db.scalar(select(func.count(RoastReport.id)).where(RoastReport.roast_id == roast.id))
    assert count == 1
    db.refresh(roast)
    assert roast.is_public is True


def test_auto_unpublish_after_threshold_blocks_resharing(
    client: TestClient, make_roast: Callable[..., Roast], user: User, db: Session
) -> None:
    roast, slug = _public_roast(client, make_roast, user)
    db.refresh(roast)  # sharing happened in the API's session; load the shared state here
    for n in range(settings.REPORT_AUTO_UNPUBLISH_THRESHOLD):
        share_service.report_roast(db, slug, "harassment", None, f"10.0.0.{n}")
    db.refresh(roast)
    assert roast.is_public is False
    assert roast.share_blocked is True
    assert client.get(f"{API}/public/roasts/{slug}").status_code == 404
    with pytest.raises(NotFoundError):
        share_service.report_roast(db, slug, "other", None, "10.0.0.99")
    again = _share_response(client, roast, user)
    assert again.status_code == 409
    assert "reported" in again.json()["detail"].lower()


# --------------------------------------------------------------------------- admin


def test_admin_reports_and_sharing_block(
    client: TestClient,
    make_roast: Callable[..., Roast],
    user: User,
    admin_headers: dict[str, str],
    db: Session,
) -> None:
    roast, slug = _public_roast(client, make_roast, user)
    client.post(f"{API}/public/roasts/{slug}/report", json={"reason": "secrets", "details": "key"})

    listing = client.get(f"{API}/admin/reports", headers=admin_headers)
    assert listing.status_code == 200
    item = listing.json()["items"][0]
    assert item["roast_id"] == roast.id
    assert item["reason"] == "secrets"
    assert item["report_count"] == 1
    assert item["is_public"] is True

    blocked = client.patch(
        f"{API}/admin/roasts/{roast.id}/sharing", json={"blocked": True}, headers=admin_headers
    )
    assert blocked.status_code == 200
    assert blocked.json()["is_public"] is False
    assert blocked.json()["share_blocked"] is True
    assert blocked.json()["user_email"] == user.email
    assert client.get(f"{API}/public/roasts/{slug}").status_code == 404

    unblocked = client.patch(
        f"{API}/admin/roasts/{roast.id}/sharing", json={"blocked": False}, headers=admin_headers
    )
    assert unblocked.json()["share_blocked"] is False
    assert _share_response(client, roast, user).status_code == 200


def test_admin_report_endpoints_require_admin(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.get(f"{API}/admin/reports", headers=auth_headers).status_code == 403
    assert (
        client.patch(
            f"{API}/admin/roasts/1/sharing", json={"blocked": True}, headers=auth_headers
        ).status_code
        == 403
    )
