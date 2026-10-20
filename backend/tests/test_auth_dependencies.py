"""JWT helpers and the get_current_user / require_admin dependencies."""

from collections.abc import Callable
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from jose import jwt

from app.auth.jwt import create_access_token, decode_access_token
from app.config import settings
from app.exceptions import UnauthorizedError
from app.models import User
from tests.conftest import API


def test_token_roundtrip() -> None:
    assert decode_access_token(create_access_token(42)) == 42


def test_expired_token_rejected() -> None:
    token = create_access_token(1, expires_delta=timedelta(seconds=-5))
    with pytest.raises(UnauthorizedError, match="expired"):
        decode_access_token(token)


def test_wrong_type_and_bad_subject() -> None:
    refresh_like = jwt.encode({"sub": "1", "type": "refresh"}, settings.SECRET_KEY, "HS256")
    with pytest.raises(UnauthorizedError, match="type"):
        decode_access_token(refresh_like)
    bad_sub = jwt.encode({"sub": "abc", "type": "access"}, settings.SECRET_KEY, "HS256")
    with pytest.raises(UnauthorizedError, match="subject"):
        decode_access_token(bad_sub)
    forged = jwt.encode({"sub": "1", "type": "access"}, "other-key", "HS256")
    with pytest.raises(UnauthorizedError):
        decode_access_token(forged)


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer not-a-jwt"},
        {"Authorization": "Basic Zm9vOmJhcg=="},
        {"Authorization": f"Bearer {create_access_token(1, timedelta(seconds=-1))}"},
    ],
)
def test_me_unauthorized(client: TestClient, headers: dict[str, str]) -> None:
    response = client.get(f"{API}/auth/me", headers=headers)
    assert response.status_code == 401
    assert "detail" in response.json()


def test_unknown_user_is_401(client: TestClient) -> None:
    headers = {"Authorization": f"Bearer {create_access_token(99999)}"}
    response = client.get(f"{API}/auth/me", headers=headers)
    assert response.status_code == 401
    assert response.json()["detail"] == "User not found"


def test_deactivated_user_is_403(client: TestClient, make_user: Callable[..., User]) -> None:
    inactive = make_user(is_active=False)
    headers = {"Authorization": f"Bearer {create_access_token(inactive.id)}"}
    assert client.get(f"{API}/auth/me", headers=headers).status_code == 403
    response = client.post(
        f"{API}/roasts", json={"repo_url": "https://github.com/o/r"}, headers=headers
    )
    assert response.status_code == 403
