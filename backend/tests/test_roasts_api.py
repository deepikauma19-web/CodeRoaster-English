"""Roast endpoints: create/list/get/status/retry/delete, validation and ownership."""

from collections.abc import Callable

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from app.exceptions import ConflictError
from app.models import Roast, RoastIntensity, RoastStatus, User
from app.services import roast_service
from app.services.github_service import MSG_INVALID_URL, MSG_REPO_NOT_FOUND
from tests.conftest import API, GH_API, FakeOpenAI, auth_headers_for, mock_github_repo


def test_create_roast_runs_pipeline_to_completion(
    client: TestClient,
    auth_headers: dict[str, str],
    respx_mock: respx.MockRouter,
    fake_openai: FakeOpenAI,
) -> None:
    mock_github_repo(respx_mock)
    fake_openai.queue_json()
    response = client.post(
        f"{API}/roasts",
        json={"repo_url": "https://github.com/octo/hello.git/", "intensity": "extra_spicy"},
        headers=auth_headers,
    )
    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "pending"
    assert body["repo_url"] == "https://github.com/octo/hello"
    assert body["intensity"] == "extra_spicy"
    assert body["is_public"] is False and body["share_slug"] is None
    assert body["tips"] == []

    detail = client.get(f"{API}/roasts/{body['id']}", headers=auth_headers).json()
    assert detail["status"] == "completed"
    assert detail["overall_score"] == sum(detail["score_breakdown"].values())
    assert 3 <= len(detail["tips"]) <= 7
    assert detail["roast_text"]

    status = client.get(f"{API}/roasts/{body['id']}/status", headers=auth_headers).json()
    assert status == {"id": body["id"], "status": "completed", "error_message": None}


def test_create_roast_default_intensity_and_failure_message(
    client: TestClient, auth_headers: dict[str, str], respx_mock: respx.MockRouter
) -> None:
    respx_mock.get(f"{GH_API}/repos/octo/private-one").respond(404)
    response = client.post(
        f"{API}/roasts",
        json={"repo_url": "https://github.com/octo/private-one"},
        headers=auth_headers,
    )
    assert response.status_code == 202
    assert response.json()["intensity"] == "medium"
    status = client.get(f"{API}/roasts/{response.json()['id']}/status", headers=auth_headers)
    assert status.json()["status"] == "failed"
    assert status.json()["error_message"] == MSG_REPO_NOT_FOUND


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/octo/hello/tree/main",
        "https://gitlab.com/a/b",
        "http://github.com/a/b",
        "not a url",
    ],
)
def test_create_roast_invalid_url_400(
    client: TestClient, auth_headers: dict[str, str], url: str
) -> None:
    response = client.post(f"{API}/roasts", json={"repo_url": url}, headers=auth_headers)
    assert response.status_code == 400
    assert response.json()["detail"] == MSG_INVALID_URL


@pytest.mark.parametrize(
    "body",
    [{}, {"repo_url": ""}, {"repo_url": "https://github.com/a/b", "intensity": "nuclear"}],
)
def test_create_roast_schema_422(
    client: TestClient, auth_headers: dict[str, str], body: dict[str, str]
) -> None:
    assert client.post(f"{API}/roasts", json=body, headers=auth_headers).status_code == 422


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/roasts"),
        ("get", "/roasts"),
        ("get", "/roasts/1"),
        ("get", "/roasts/1/status"),
        ("post", "/roasts/1/retry"),
        ("delete", "/roasts/1"),
        ("patch", "/roasts/1/share"),
    ],
)
def test_requires_auth(client: TestClient, method: str, path: str) -> None:
    kwargs = {"json": {"repo_url": "https://github.com/a/b", "is_public": True}}
    response = getattr(client, method)(
        f"{API}{path}", **(kwargs if method in ("post", "patch") else {})
    )
    assert response.status_code == 401


def test_ownership_returns_404(
    client: TestClient,
    make_roast: Callable[..., Roast],
    user: User,
    other_user: User,
) -> None:
    theirs = make_roast(other_user, status=RoastStatus.failed)
    headers = auth_headers_for(user)
    for method, path in (
        ("get", f"/roasts/{theirs.id}"),
        ("get", f"/roasts/{theirs.id}/status"),
        ("post", f"/roasts/{theirs.id}/retry"),
        ("delete", f"/roasts/{theirs.id}"),
    ):
        response = getattr(client, method)(f"{API}{path}", headers=headers)
        assert response.status_code == 404, path
        assert response.json() == {"detail": "Roast not found"}
    # Nonexistent ids look identical.
    assert client.get(f"{API}/roasts/999999", headers=headers).status_code == 404
    # Other user's list does not include it.
    assert client.get(f"{API}/roasts", headers=headers).json()["total"] == 0


def test_list_pagination_newest_first(
    client: TestClient,
    make_roast: Callable[..., Roast],
    user: User,
    other_user: User,
) -> None:
    ids = [make_roast(user, repo_name=f"r{i}").id for i in range(5)]
    make_roast(other_user)
    headers = auth_headers_for(user)
    page1 = client.get(f"{API}/roasts", params={"page": 1, "size": 2}, headers=headers).json()
    page3 = client.get(f"{API}/roasts", params={"page": 3, "size": 2}, headers=headers).json()
    assert page1["total"] == 5 and page1["page"] == 1 and page1["size"] == 2
    assert [r["id"] for r in page1["items"]] == [ids[4], ids[3]]
    assert [r["id"] for r in page3["items"]] == [ids[0]]
    defaults = client.get(f"{API}/roasts", headers=headers).json()
    assert defaults["size"] == 10 and len(defaults["items"]) == 5
    assert client.get(f"{API}/roasts?size=51", headers=headers).status_code == 422
    assert client.get(f"{API}/roasts?page=0", headers=headers).status_code == 422


def test_retry_only_failed(
    client: TestClient,
    db: Session,
    make_roast: Callable[..., Roast],
    user: User,
    respx_mock: respx.MockRouter,
    fake_openai: FakeOpenAI,
) -> None:
    headers = auth_headers_for(user)
    done = make_roast(user)
    conflict = client.post(f"{API}/roasts/{done.id}/retry", headers=headers)
    assert conflict.status_code == 409

    failed = make_roast(
        user,
        status=RoastStatus.failed,
        error_message="old error",
        intensity=RoastIntensity.mild,
        prompt_tokens=10,
    )
    mock_github_repo(respx_mock)
    fake_openai.queue_json(prompt_tokens=5)
    response = client.post(f"{API}/roasts/{failed.id}/retry", headers=headers)
    assert response.status_code == 202
    assert response.json()["status"] == "pending"
    assert response.json()["error_message"] is None

    db.expire_all()
    roast = db.get(Roast, failed.id)
    assert roast is not None
    assert roast.status == RoastStatus.completed
    assert roast.prompt_tokens == 20  # 10 before + 2 calls x 5 tokens, accumulated
    assert roast.intensity == RoastIntensity.mild


def test_delete(
    client: TestClient, db: Session, make_roast: Callable[..., Roast], user: User
) -> None:
    roast = make_roast(user)
    headers = auth_headers_for(user)
    assert client.delete(f"{API}/roasts/{roast.id}", headers=headers).status_code == 204
    assert client.get(f"{API}/roasts/{roast.id}", headers=headers).status_code == 404
    assert client.delete(f"{API}/roasts/{roast.id}", headers=headers).status_code == 404


def test_reset_for_retry_is_conditional(
    db: Session,
    session_factory: sessionmaker[Session],
    make_roast: Callable[..., Roast],
    user: User,
) -> None:
    failed = make_roast(user, status=RoastStatus.failed, error_message="boom")
    stale_view = session_factory()
    try:
        stale = stale_view.get(Roast, failed.id)
        assert stale is not None and stale.status == RoastStatus.failed
        # Another request retries first...
        reset = roast_service.reset_for_retry(db, failed)
        assert reset.status == RoastStatus.pending and reset.error_message is None
        # ...so the second, racing retry (still seeing `failed` in memory) gets a 409.
        with pytest.raises(ConflictError):
            roast_service.reset_for_retry(stale_view, stale)
    finally:
        stale_view.close()
