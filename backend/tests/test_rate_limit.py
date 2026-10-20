"""Rate limiting (disabled in ENVIRONMENT=test, enabled explicitly here)."""

import respx
from fastapi.testclient import TestClient

from app.models import User
from app.rate_limit import limiter
from app.routers.roasts import user_rate_limit_key
from tests.conftest import API, GH_API, auth_headers_for


def test_limiter_disabled_by_default_in_tests(client: TestClient) -> None:
    assert limiter.enabled is False
    for _ in range(15):
        assert client.get(f"{API}/auth/google/login", follow_redirects=False).status_code == 307


def test_login_rate_limited(client: TestClient) -> None:
    limiter.enabled = True
    codes = [
        client.get(f"{API}/auth/google/login", follow_redirects=False).status_code
        for _ in range(11)
    ]
    assert codes[:10] == [307] * 10
    assert codes[10] == 429


def test_create_roast_limited_per_user(
    client: TestClient, user: User, other_user: User, respx_mock: respx.MockRouter
) -> None:
    respx_mock.get(url__startswith=f"{GH_API}/repos/").respond(404)
    limiter.enabled = True
    body = {"repo_url": "https://github.com/octo/hello"}
    headers = auth_headers_for(user)
    codes = [client.post(f"{API}/roasts", json=body, headers=headers).status_code for _ in range(6)]
    assert codes == [202] * 5 + [429]
    # A different user has their own bucket.
    other = client.post(f"{API}/roasts", json=body, headers=auth_headers_for(other_user))
    assert other.status_code == 202


def test_user_rate_limit_key() -> None:
    from starlette.requests import Request

    def make(headers: list[tuple[bytes, bytes]]) -> Request:
        return Request(
            {"type": "http", "headers": headers, "client": ("1.2.3.4", 1), "method": "GET"}
        )

    from app.auth.jwt import create_access_token

    token = create_access_token(7).encode()
    assert user_rate_limit_key(make([(b"authorization", b"Bearer " + token)])) == "user:7"
    assert user_rate_limit_key(make([(b"authorization", b"Bearer junk")])) == "ip:1.2.3.4"
    assert user_rate_limit_key(make([])) == "ip:1.2.3.4"
