import pytest
from fastapi.testclient import TestClient

import app.main as main_module


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_health_reports_degraded_database(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(main_module, "_database_ok", lambda: False)
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "database": "error"}


def test_openapi_documents_all_routers(client: TestClient) -> None:
    paths = client.get("/openapi.json").json()["paths"]
    for expected in (
        "/api/v1/auth/me",
        "/api/v1/roasts",
        "/api/v1/roasts/{roast_id}/share",
        "/api/v1/public/roasts/{share_slug}",
        "/api/v1/admin/stats",
    ):
        assert expected in paths
