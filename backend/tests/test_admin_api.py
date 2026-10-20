"""Admin endpoints: access control, user management, roast moderation, stats."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth.refresh_tokens import issue_refresh_token
from app.models import RefreshToken, Roast, RoastIntensity, RoastStatus, User
from app.services import admin_service
from tests.conftest import API, auth_headers_for


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/admin/users"),
        ("put", "/admin/users/1"),
        ("get", "/admin/roasts"),
        ("delete", "/admin/roasts/1"),
        ("get", "/admin/stats"),
    ],
)
def test_non_admin_forbidden(
    client: TestClient, auth_headers: dict[str, str], method: str, path: str
) -> None:
    kwargs = {"json": {"is_active": False}} if method == "put" else {}
    assert (
        getattr(client, method)(f"{API}{path}", headers=auth_headers, **kwargs).status_code == 403
    )
    assert getattr(client, method)(f"{API}{path}", **kwargs).status_code == 401


def test_list_users_with_counts_and_search(
    client: TestClient,
    admin_headers: dict[str, str],
    user: User,
    other_user: User,
    make_roast: Callable[..., Roast],
) -> None:
    make_roast(user)
    make_roast(user)
    response = client.get(f"{API}/admin/users", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3 and body["page"] == 1 and body["size"] == 20
    counts = {u["email"]: u["roast_count"] for u in body["items"]}
    assert counts == {"alice@example.com": 2, "bob@example.com": 0, "boss@example.com": 0}

    found = client.get(f"{API}/admin/users", params={"search": "builder"}, headers=admin_headers)
    assert [u["email"] for u in found.json()["items"]] == ["bob@example.com"]
    paged = client.get(f"{API}/admin/users", params={"size": 1, "page": 2}, headers=admin_headers)
    assert paged.json()["total"] == 3 and len(paged.json()["items"]) == 1


def test_self_demotion_and_self_deactivation_409(
    client: TestClient, admin_user: User, admin_headers: dict[str, str]
) -> None:
    for payload in ({"is_admin": False}, {"is_active": False}):
        response = client.put(
            f"{API}/admin/users/{admin_user.id}", json=payload, headers=admin_headers
        )
        assert response.status_code == 409
    # A no-op self update is fine.
    ok = client.put(
        f"{API}/admin/users/{admin_user.id}", json={"is_admin": True}, headers=admin_headers
    )
    assert ok.status_code == 200


def test_deactivate_revokes_tokens_and_blocks_access(
    client: TestClient, db: Session, admin_headers: dict[str, str], user: User
) -> None:
    issue_refresh_token(db, user.id)
    issue_refresh_token(db, user.id)
    db.commit()
    response = client.put(
        f"{API}/admin/users/{user.id}", json={"is_active": False}, headers=admin_headers
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False
    db.expire_all()
    tokens = db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id)).all()
    assert len(tokens) == 2 and all(t.revoked and t.revoked_at is not None for t in tokens)
    assert client.get(f"{API}/auth/me", headers=auth_headers_for(user)).status_code == 403

    promote = client.put(
        f"{API}/admin/users/{user.id}",
        json={"is_active": True, "is_admin": True},
        headers=admin_headers,
    )
    assert promote.json()["is_admin"] is True and promote.json()["is_active"] is True
    assert client.get(f"{API}/admin/stats", headers=auth_headers_for(user)).status_code == 200


def test_update_user_validation(client: TestClient, admin_headers: dict[str, str]) -> None:
    assert (
        client.put(
            f"{API}/admin/users/9999", json={"is_admin": True}, headers=admin_headers
        ).status_code
        == 404
    )
    assert (
        client.put(f"{API}/admin/users/1", json={"email": "x"}, headers=admin_headers).status_code
        == 422
    )


def test_list_roasts_filters(
    client: TestClient,
    db: Session,
    admin_headers: dict[str, str],
    user: User,
    other_user: User,
    make_roast: Callable[..., Roast],
) -> None:
    a = make_roast(user)
    b = make_roast(user, status=RoastStatus.failed, error_message="x")
    c = make_roast(other_user, status=RoastStatus.pending)
    old = datetime(2024, 1, 15, 12, 0)
    db.execute(update(Roast).where(Roast.id == c.id).values(created_at=old))
    db.commit()

    def ids(**params: object) -> list[int]:
        response = client.get(f"{API}/admin/roasts", params=params, headers=admin_headers)
        assert response.status_code == 200, response.text
        return [r["id"] for r in response.json()["items"]]

    assert ids() == [b.id, a.id, c.id]
    assert ids(status="failed") == [b.id]
    assert ids(user_id=other_user.id) == [c.id]
    assert ids(**{"from": "2024-01-01", "to": "2024-01-15"}) == [c.id]
    assert ids(**{"to": "2024-01-14"}) == []
    assert ids(**{"from": "2024-01-16T00:00:00Z"}) == [b.id, a.id]
    assert ids(**{"to": "2024-01-15T13:00:00+00:00"}) == [c.id]

    item = client.get(
        f"{API}/admin/roasts", params={"user_id": other_user.id}, headers=admin_headers
    ).json()["items"][0]
    assert item["user_email"] == "bob@example.com" and item["user_id"] == other_user.id
    assert client.get(f"{API}/admin/roasts?status=bogus", headers=admin_headers).status_code == 422


def test_admin_delete_roast(
    client: TestClient,
    admin_headers: dict[str, str],
    user: User,
    make_roast: Callable[..., Roast],
) -> None:
    roast = make_roast(user)
    assert client.delete(f"{API}/admin/roasts/{roast.id}", headers=admin_headers).status_code == 204
    assert client.delete(f"{API}/admin/roasts/{roast.id}", headers=admin_headers).status_code == 404
    assert client.get(f"{API}/roasts/{roast.id}", headers=auth_headers_for(user)).status_code == 404


def test_stats(
    client: TestClient,
    db: Session,
    admin_headers: dict[str, str],
    make_user: Callable[..., User],
    make_roast: Callable[..., Roast],
) -> None:
    now = datetime.now(UTC)
    recent = make_user(last_login_at=now - timedelta(days=1))
    make_user(last_login_at=now - timedelta(days=30))
    make_roast(recent, overall_score=60, prompt_tokens=100, completion_tokens=10)
    make_roast(
        recent,
        overall_score=81,
        intensity=RoastIntensity.mild,
        prompt_tokens=200,
        completion_tokens=20,
    )
    make_roast(recent, status=RoastStatus.failed, prompt_tokens=50, completion_tokens=5)
    make_roast(recent, status=RoastStatus.pending)
    old = make_roast(recent, status=RoastStatus.failed, intensity=RoastIntensity.extra_spicy)
    db.execute(update(Roast).where(Roast.id == old.id).values(created_at=now - timedelta(days=3)))
    db.commit()

    response = client.get(f"{API}/admin/stats", headers=admin_headers)
    assert response.status_code == 200
    stats = response.json()
    assert stats["total_users"] == 3  # 2 made here + admin
    assert stats["active_users_7d"] == 1
    assert stats["total_roasts"] == 5
    assert stats["roasts_today"] == 4
    assert stats["avg_score"] == 70.5
    assert stats["failure_rate"] == 0.5  # 2 failed / 4 terminal
    assert stats["intensity_split"] == {"mild": 1, "medium": 3, "extra_spicy": 1}
    assert stats["total_prompt_tokens"] == 350
    assert stats["total_completion_tokens"] == 35


def test_stats_empty(client: TestClient, admin_headers: dict[str, str]) -> None:
    stats = client.get(f"{API}/admin/stats", headers=admin_headers).json()
    assert stats["total_roasts"] == 0
    assert stats["avg_score"] is None and stats["failure_rate"] == 0.0
    assert stats["intensity_split"] == {"mild": 0, "medium": 0, "extra_spicy": 0}


@pytest.mark.parametrize("term", ["%", "_", "\\", "a%e", "%%"])
def test_search_wildcards_match_literally(
    client: TestClient, admin_headers: dict[str, str], user: User, other_user: User, term: str
) -> None:
    found = client.get(f"{API}/admin/users", params={"search": term}, headers=admin_headers)
    assert found.status_code == 200
    assert found.json()["total"] == 0 and found.json()["items"] == []


def test_search_matches_literal_wildcard_chars(
    client: TestClient, admin_headers: dict[str, str], make_user: Callable[..., User]
) -> None:
    make_user("per_cent@example.com", full_name="100% Real")
    make_user("percent@example.com", full_name="Plain")
    by_pct = client.get(f"{API}/admin/users", params={"search": "100%"}, headers=admin_headers)
    assert [u["email"] for u in by_pct.json()["items"]] == ["per_cent@example.com"]
    by_us = client.get(f"{API}/admin/users", params={"search": "per_"}, headers=admin_headers)
    assert [u["email"] for u in by_us.json()["items"]] == ["per_cent@example.com"]


def test_escape_like() -> None:
    assert admin_service.escape_like("a%b_c\\d") == "a\\%b\\_c\\\\d"
