"""Daily roast quota."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Roast, RoastStatus, User
from app.services import roast_service
from tests.conftest import API, GH_API, auth_headers_for

NOW = datetime.now(UTC)


@pytest.fixture(autouse=True)
def _small_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DAILY_ROAST_LIMIT", 2)


def _ago(hours: float) -> datetime:
    return NOW - timedelta(hours=hours)


# --------------------------------------------------------------------------- quota


def test_quota_endpoint_counts_recent_non_failed_roasts(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    make_roast(user, created_at=_ago(1))
    make_roast(user, status=RoastStatus.failed, created_at=_ago(2))  # failures are free
    make_roast(user, created_at=_ago(30))  # outside the 24h window
    body = client.get(f"{API}/roasts/quota", headers=auth_headers_for(user)).json()
    assert body["limit"] == 2 and body["used"] == 1 and body["remaining"] == 1
    assert body["resets_at"] is None  # not limited yet


def test_quota_only_counts_own_roasts(
    client: TestClient, make_roast: Callable[..., Roast], user: User, other_user: User
) -> None:
    make_roast(other_user, created_at=_ago(1))
    make_roast(other_user, created_at=_ago(1))
    body = client.get(f"{API}/roasts/quota", headers=auth_headers_for(user)).json()
    assert body["used"] == 0 and body["remaining"] == 2


def test_create_roast_blocked_at_the_limit_with_retry_after(
    client: TestClient,
    make_roast: Callable[..., Roast],
    user: User,
    respx_mock: respx.MockRouter,
) -> None:
    make_roast(user, created_at=_ago(10))  # frees up in 14h
    make_roast(user, created_at=_ago(1))
    respx_mock.get(url__startswith=f"{GH_API}/repos/").respond(404)
    response = client.post(
        f"{API}/roasts",
        json={"repo_url": "https://github.com/octo/hello"},
        headers=auth_headers_for(user),
    )
    assert response.status_code == 429
    assert "all 2 roasts for today" in response.json()["detail"]
    assert "13h" in response.json()["detail"] or "14h" in response.json()["detail"]
    retry_after = int(response.headers["retry-after"])
    assert 13 * 3600 < retry_after <= 14 * 3600

    quota = client.get(f"{API}/roasts/quota", headers=auth_headers_for(user)).json()
    assert quota["remaining"] == 0 and quota["resets_at"] is not None


def test_a_failed_roast_frees_a_slot(
    client: TestClient,
    make_roast: Callable[..., Roast],
    user: User,
    respx_mock: respx.MockRouter,
) -> None:
    make_roast(user, created_at=_ago(1))
    make_roast(user, status=RoastStatus.failed, created_at=_ago(1))
    respx_mock.get(url__startswith=f"{GH_API}/repos/").respond(404)
    response = client.post(
        f"{API}/roasts",
        json={"repo_url": "https://github.com/octo/hello"},
        headers=auth_headers_for(user),
    )
    assert response.status_code == 202


def test_retry_counts_against_the_quota(
    client: TestClient,
    make_roast: Callable[..., Roast],
    user: User,
    respx_mock: respx.MockRouter,
) -> None:
    make_roast(user, created_at=_ago(1))
    make_roast(user, created_at=_ago(2))
    failed = make_roast(user, status=RoastStatus.failed, created_at=_ago(1))
    respx_mock.get(url__startswith=f"{GH_API}/repos/").respond(404)
    response = client.post(f"{API}/roasts/{failed.id}/retry", headers=auth_headers_for(user))
    assert response.status_code == 429


def test_retry_of_completed_roast_still_conflicts_not_429(
    client: TestClient, make_roast: Callable[..., Roast], user: User
) -> None:
    make_roast(user, created_at=_ago(1))
    done = make_roast(user, created_at=_ago(2))
    response = client.post(f"{API}/roasts/{done.id}/retry", headers=auth_headers_for(user))
    assert response.status_code == 409


def test_admins_are_unlimited(
    client: TestClient,
    make_roast: Callable[..., Roast],
    admin_user: User,
    admin_headers: dict[str, str],
    respx_mock: respx.MockRouter,
) -> None:
    for _ in range(3):
        make_roast(admin_user, created_at=_ago(1))
    body = client.get(f"{API}/roasts/quota", headers=admin_headers).json()
    assert body == {"limit": None, "used": 3, "remaining": None, "resets_at": None}
    respx_mock.get(url__startswith=f"{GH_API}/repos/").respond(404)
    response = client.post(
        f"{API}/roasts", json={"repo_url": "https://github.com/octo/hello"}, headers=admin_headers
    )
    assert response.status_code == 202


def test_limit_of_zero_disables_the_quota(
    client: TestClient,
    make_roast: Callable[..., Roast],
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "DAILY_ROAST_LIMIT", 0)
    for _ in range(3):
        make_roast(user, created_at=_ago(1))
    body = client.get(f"{API}/roasts/quota", headers=auth_headers_for(user)).json()
    assert body["limit"] is None and body["remaining"] is None


def test_quota_requires_auth(client: TestClient) -> None:
    assert client.get(f"{API}/roasts/quota").status_code == 401


def test_enforce_handles_naive_datetimes(
    db: Session, make_roast: Callable[..., Roast], user: User
) -> None:
    make_roast(user, created_at=_ago(1).replace(tzinfo=None))
    quota = roast_service.get_roast_quota(db, user)
    assert quota.used == 1 and quota.remaining == 1
