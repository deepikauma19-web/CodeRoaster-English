"""Google OAuth login/callback, refresh rotation + reuse detection, logout, /me."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.auth import google_oauth
from app.auth.google_oauth import GoogleOAuthError
from app.auth.refresh_tokens import (
    claim_refresh_token,
    get_refresh_token,
    hash_refresh_token,
    issue_refresh_token,
)
from app.exceptions import UnauthorizedError
from app.models import RefreshToken, User
from app.schemas.auth import GoogleUserInfo
from app.services import auth_service
from tests.conftest import API, auth_headers_for

CALLBACK = f"{API}/auth/google/callback"


def _start_login(client: TestClient) -> str:
    response = client.get(f"{API}/auth/google/login", follow_redirects=False)
    assert response.status_code == 307
    location = response.headers["location"]
    assert location.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    params = parse_qs(urlparse(location).query)
    assert params["client_id"] == ["test-client-id"]
    assert params["response_type"] == ["code"]
    assert "openid" in params["scope"][0]
    set_cookie = response.headers["set-cookie"]
    assert "oauth_state=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Path=/api/v1/auth" in set_cookie
    return params["state"][0]


def _fragment(response: httpx.Response) -> dict[str, list[str]]:
    location = response.headers["location"]
    assert location.startswith("http://localhost:5173/auth/callback#")
    return parse_qs(urlparse(location).fragment)


@pytest.fixture
def google_ok(monkeypatch: pytest.MonkeyPatch) -> Callable[[GoogleUserInfo], None]:
    def _set(info: GoogleUserInfo) -> None:
        async def _exchange(code: str) -> str:
            assert code == "good-code"
            return "id-token"

        async def _verify(token: str) -> GoogleUserInfo:
            assert token == "id-token"
            return info

        monkeypatch.setattr(google_oauth, "exchange_code_for_id_token", _exchange)
        monkeypatch.setattr(google_oauth, "verify_id_token", _verify)

    return _set


NEW_INFO = GoogleUserInfo(
    google_id="g-new", email="new@example.com", full_name="New Person", avatar_url=None
)


def test_full_login_creates_user_and_sets_refresh_cookie(
    client: TestClient, db: Session, google_ok: Callable[[GoogleUserInfo], None]
) -> None:
    google_ok(NEW_INFO)
    state = _start_login(client)
    response = client.get(
        CALLBACK, params={"code": "good-code", "state": state}, follow_redirects=False
    )
    assert response.status_code == 307
    fragment = _fragment(response)
    access = fragment["access_token"][0]
    assert "refresh_token" in client.cookies
    cookies = response.headers.get_list("set-cookie")
    refresh_cookie = next(c for c in cookies if c.startswith("refresh_token="))
    assert "HttpOnly" in refresh_cookie and "Path=/api/v1/auth" in refresh_cookie
    assert "samesite=lax" in refresh_cookie.lower()

    user = db.scalar(select(User).where(User.email == "new@example.com"))
    assert user is not None and user.last_login_at is not None
    assert user.is_admin is False

    me = client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {access}"})
    assert me.status_code == 200
    assert me.json()["email"] == "new@example.com"


def test_returning_login_updates_last_login_and_links_by_email(
    client: TestClient,
    db: Session,
    make_user: Callable[..., User],
    google_ok: Callable[[GoogleUserInfo], None],
) -> None:
    existing = make_user("link@example.com", full_name="Old Name")
    google_ok(
        GoogleUserInfo(
            google_id="g-linked",
            email="link@example.com",
            full_name="New Name",
            avatar_url="https://img/x.png",
        )
    )
    state = _start_login(client)
    response = client.get(
        CALLBACK, params={"code": "good-code", "state": state}, follow_redirects=False
    )
    assert "access_token" in _fragment(response)
    db.expire_all()
    refreshed = db.get(User, existing.id)
    assert refreshed is not None
    assert refreshed.google_id == "g-linked"
    assert refreshed.full_name == "New Name"
    assert refreshed.avatar_url == "https://img/x.png"
    assert refreshed.last_login_at is not None
    assert db.scalar(select(User).where(User.email == "link@example.com")).id == existing.id


def test_admin_email_is_granted_admin(
    client: TestClient, db: Session, google_ok: Callable[[GoogleUserInfo], None]
) -> None:
    google_ok(GoogleUserInfo(google_id="g-boss", email="boss@example.com", full_name=None))
    state = _start_login(client)
    client.get(CALLBACK, params={"code": "good-code", "state": state}, follow_redirects=False)
    boss = db.scalar(select(User).where(User.email == "boss@example.com"))
    assert boss is not None and boss.is_admin is True
    assert boss.full_name == "boss"  # falls back to the email local part


def test_callback_rejects_missing_or_wrong_state(
    client: TestClient, google_ok: Callable[[GoogleUserInfo], None]
) -> None:
    google_ok(NEW_INFO)
    # No state cookie at all.
    response = client.get(
        CALLBACK, params={"code": "good-code", "state": "x"}, follow_redirects=False
    )
    assert _fragment(response) == {"error": ["invalid_state"]}
    # Cookie present but query state differs.
    _start_login(client)
    response = client.get(
        CALLBACK, params={"code": "good-code", "state": "forged"}, follow_redirects=False
    )
    assert _fragment(response) == {"error": ["invalid_state"]}
    # Tampered cookie signature.
    client.cookies.set("oauth_state", "garbage.sig", path="/api/v1/auth")
    response = client.get(
        CALLBACK, params={"code": "good-code", "state": "x"}, follow_redirects=False
    )
    assert _fragment(response) == {"error": ["invalid_state"]}


def test_callback_google_error_and_missing_code(client: TestClient) -> None:
    state = _start_login(client)
    response = client.get(
        CALLBACK, params={"state": state, "error": "access_denied"}, follow_redirects=False
    )
    assert _fragment(response) == {"error": ["oauth_failed"]}


def test_callback_oauth_exchange_failure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(code: str) -> str:
        raise GoogleOAuthError("nope")

    monkeypatch.setattr(google_oauth, "exchange_code_for_id_token", _boom)
    state = _start_login(client)
    response = client.get(CALLBACK, params={"code": "c", "state": state}, follow_redirects=False)
    assert _fragment(response) == {"error": ["oauth_failed"]}


def test_deactivated_user_cannot_login(
    client: TestClient,
    db: Session,
    make_user: Callable[..., User],
    google_ok: Callable[[GoogleUserInfo], None],
) -> None:
    banned = make_user("banned@example.com", is_active=False)
    google_ok(GoogleUserInfo(google_id=banned.google_id, email="banned@example.com"))
    state = _start_login(client)
    response = client.get(
        CALLBACK, params={"code": "good-code", "state": state}, follow_redirects=False
    )
    assert _fragment(response) == {"error": ["account_deactivated"]}
    assert "refresh_token" not in client.cookies
    tokens = db.scalars(select(RefreshToken).where(RefreshToken.user_id == banned.id)).all()
    assert tokens == []


# --------------------------------------------------------------------------- refresh


def _cookie_value(response: httpx.Response, name: str) -> str:
    header = next(c for c in response.headers.get_list("set-cookie") if c.startswith(name + "="))
    return header.split(";", 1)[0].split("=", 1)[1]


def _issue(db: Session, user: User) -> str:
    raw = issue_refresh_token(db, user.id)
    db.commit()
    return raw


def test_refresh_rotates_token(client: TestClient, db: Session, user: User) -> None:
    raw = _issue(db, user)
    client.cookies.set("refresh_token", raw, path="/api/v1/auth")
    response = client.post(f"{API}/auth/refresh")
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer" and body["access_token"]
    new_raw = _cookie_value(response, "refresh_token")
    assert new_raw and new_raw != raw
    db.expire_all()
    old = get_refresh_token(db, raw)
    assert old is not None and old.revoked is True and old.revoked_at is not None
    new = get_refresh_token(db, new_raw)
    assert new is not None and new.revoked is False
    assert new.token_hash == hash_refresh_token(new_raw)  # only the hash is stored
    assert new.token_hash != new_raw


def test_refresh_reuse_revokes_all_tokens(client: TestClient, db: Session, user: User) -> None:
    raw = _issue(db, user)
    client.cookies.set("refresh_token", raw, path="/api/v1/auth")
    first = client.post(f"{API}/auth/refresh")
    assert first.status_code == 200
    new_raw = _cookie_value(first, "refresh_token")

    # Replay the revoked token well after the multi-tab grace window → theft assumed.
    old = get_refresh_token(db, raw)
    assert old is not None and old.revoked_at is not None
    old.revoked_at = datetime.now(UTC) - auth_service.REFRESH_REUSE_GRACE - timedelta(seconds=1)
    db.commit()
    client.cookies.clear()
    client.cookies.set("refresh_token", raw, path="/api/v1/auth")
    replay = client.post(f"{API}/auth/refresh")
    assert replay.status_code == 401
    db.expire_all()
    assert get_refresh_token(db, new_raw).revoked is True  # type: ignore[union-attr]


def test_legacy_revoked_token_without_timestamp_is_reuse(db: Session, user: User) -> None:
    raw = _issue(db, user)
    sibling = _issue(db, user)
    token = get_refresh_token(db, raw)
    assert token is not None
    token.revoked = True  # revoked before revoked_at existed
    db.commit()
    with pytest.raises(UnauthorizedError):
        auth_service.rotate_refresh_token(db, raw)
    db.expire_all()
    assert get_refresh_token(db, sibling).revoked is True  # type: ignore[union-attr]


def test_refresh_within_grace_window_does_not_revoke_all(
    client: TestClient, db: Session, user: User
) -> None:
    raw = _issue(db, user)
    client.cookies.set("refresh_token", raw, path="/api/v1/auth")
    first = client.post(f"{API}/auth/refresh")  # tab A rotates
    assert first.status_code == 200
    sibling_raw = _cookie_value(first, "refresh_token")

    client.cookies.clear()
    client.cookies.set("refresh_token", raw, path="/api/v1/auth")
    second = client.post(f"{API}/auth/refresh")  # tab B, same old cookie, moments later
    assert second.status_code == 401
    db.expire_all()
    sibling = get_refresh_token(db, sibling_raw)
    assert sibling is not None and sibling.revoked is False and sibling.revoked_at is None

    client.cookies.clear()
    client.cookies.set("refresh_token", sibling_raw, path="/api/v1/auth")
    assert client.post(f"{API}/auth/refresh").status_code == 200  # tab A's token still works


def test_rotation_race_loser_gets_401_and_issues_nothing(
    db: Session,
    session_factory: sessionmaker[Session],
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = _issue(db, user)
    sibling = _issue(db, user)
    real_lookup = auth_service.get_refresh_token

    def _lookup_then_lose_race(session: Session, value: str) -> RefreshToken | None:
        token = real_lookup(session, value)  # we read it as active...
        winner = session_factory()
        try:  # ...then a concurrent request claims it before our UPDATE runs.
            assert token is not None and claim_refresh_token(winner, token.id)
            winner.commit()
        finally:
            winner.close()
        return token

    monkeypatch.setattr(auth_service, "get_refresh_token", _lookup_then_lose_race)
    with pytest.raises(UnauthorizedError):
        auth_service.rotate_refresh_token(db, raw)

    db.expire_all()
    tokens = db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id)).all()
    assert len(tokens) == 2  # loser issued no successor
    assert get_refresh_token(db, sibling).revoked is False  # type: ignore[union-attr]
    assert claim_refresh_token(db, get_refresh_token(db, raw).id) is False  # type: ignore[union-attr]


def test_refresh_missing_unknown_expired_and_inactive(
    client: TestClient, db: Session, make_user: Callable[..., User]
) -> None:
    assert client.post(f"{API}/auth/refresh").status_code == 401

    client.cookies.set("refresh_token", "unknown", path="/api/v1/auth")
    assert client.post(f"{API}/auth/refresh").json()["detail"] == "Invalid refresh token"

    u = make_user()
    raw = _issue(db, u)
    token = get_refresh_token(db, raw)
    assert token is not None
    token.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    client.cookies.clear()
    client.cookies.set("refresh_token", raw, path="/api/v1/auth")
    expired = client.post(f"{API}/auth/refresh")
    assert expired.status_code == 401
    assert expired.json()["detail"] == "Refresh token expired"

    inactive = make_user(is_active=False)
    raw2 = _issue(db, inactive)
    client.cookies.clear()
    client.cookies.set("refresh_token", raw2, path="/api/v1/auth")
    response = client.post(f"{API}/auth/refresh")
    assert response.status_code == 401
    assert response.json()["detail"] == "Account unavailable"


def test_logout_revokes_and_clears_cookie(client: TestClient, db: Session, user: User) -> None:
    raw = _issue(db, user)
    client.cookies.set("refresh_token", raw, path="/api/v1/auth")
    response = client.post(f"{API}/auth/logout")
    assert response.status_code == 204
    assert 'refresh_token=""' in response.headers["set-cookie"]
    db.expire_all()
    revoked = get_refresh_token(db, raw)
    assert revoked is not None and revoked.revoked is True and revoked.revoked_at is not None
    # Idempotent, and works without a cookie.
    client.cookies.clear()
    assert client.post(f"{API}/auth/logout").status_code == 204


def test_me(client: TestClient, user: User) -> None:
    response = client.get(f"{API}/auth/me", headers=auth_headers_for(user))
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "alice@example.com"
    assert set(body) == {
        "id",
        "email",
        "full_name",
        "avatar_url",
        "is_admin",
        "is_active",
        "created_at",
        "last_login_at",
    }


# --------------------------------------------------------------------------- services


def test_upsert_keeps_email_when_taken_by_other_user(
    db: Session, make_user: Callable[..., User]
) -> None:
    first = make_user("first@example.com")
    make_user("taken@example.com")
    info = GoogleUserInfo(google_id=first.google_id, email="taken@example.com")
    result = auth_service.upsert_google_user(db, info)
    assert result.id == first.id
    assert result.email == "first@example.com"


# --------------------------------------------------------------------------- google_oauth


async def test_exchange_code_success(respx_mock: respx.MockRouter) -> None:
    route = respx_mock.post(google_oauth.GOOGLE_TOKEN_URL).respond(
        200, json={"id_token": "tok", "access_token": "a"}
    )
    assert await google_oauth.exchange_code_for_id_token("code") == "tok"
    assert b"grant_type=authorization_code" in route.calls.last.request.content


@pytest.mark.parametrize(
    "response_kwargs",
    [
        {"status_code": 400, "json": {"error": "invalid_grant"}},
        {"status_code": 200, "content": b"not json"},
        {"status_code": 200, "json": {"access_token": "a"}},
    ],
)
async def test_exchange_code_failures(
    respx_mock: respx.MockRouter, response_kwargs: dict[str, Any]
) -> None:
    respx_mock.post(google_oauth.GOOGLE_TOKEN_URL).mock(
        return_value=httpx.Response(**response_kwargs)
    )
    with pytest.raises(GoogleOAuthError):
        await google_oauth.exchange_code_for_id_token("code")


async def test_exchange_code_network_error(respx_mock: respx.MockRouter) -> None:
    respx_mock.post(google_oauth.GOOGLE_TOKEN_URL).mock(side_effect=httpx.ConnectError("x"))
    with pytest.raises(GoogleOAuthError, match="ConnectError"):
        await google_oauth.exchange_code_for_id_token("code")


async def test_verify_id_token_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    claims: dict[str, Any] = {
        "sub": "123",
        "email": " Mixed@Example.COM ",
        "email_verified": True,
        "name": "Mixed Case",
        "picture": "https://pic",
    }
    monkeypatch.setattr(google_oauth, "_verify_id_token_sync", lambda token: dict(claims))
    info = await google_oauth.verify_id_token("t")
    assert info.email == "mixed@example.com"
    assert info.google_id == "123"
    assert info.full_name == "Mixed Case"
    assert info.avatar_url == "https://pic"


@pytest.mark.parametrize(
    "claims",
    [
        {"sub": "1", "email": "a@b.c", "email_verified": False},
        {"sub": "1", "email": "a@b.c"},
        {"email": "a@b.c", "email_verified": True},
        {"sub": "1", "email_verified": True},
    ],
)
async def test_verify_id_token_rejects_bad_claims(
    monkeypatch: pytest.MonkeyPatch, claims: dict[str, Any]
) -> None:
    monkeypatch.setattr(google_oauth, "_verify_id_token_sync", lambda token: claims)
    with pytest.raises(GoogleOAuthError):
        await google_oauth.verify_id_token("t")


async def test_verify_id_token_signature_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(token: str) -> dict[str, Any]:
        raise ValueError("bad signature")

    monkeypatch.setattr(google_oauth, "_verify_id_token_sync", _raise)
    with pytest.raises(GoogleOAuthError, match="ValueError"):
        await google_oauth.verify_id_token("t")
