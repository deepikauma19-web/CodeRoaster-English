"""Shared fixtures: isolated SQLite DB per test, TestClient, users/tokens, fake OpenAI and a
respx router that blocks every real network call (GitHub routes are registered per test)."""

import os

# Must be set BEFORE any `app` import: settings, limiter and engine read them at import time.
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["SECRET_KEY"] = "test-secret-key-for-pytest-only-0123456789"
os.environ["ADMIN_EMAILS"] = "boss@example.com"
os.environ["OPENAI_API_KEY"] = "test-openai-key"
os.environ["OPENAI_MODEL"] = "gpt-4o-mini"
os.environ["GITHUB_TOKEN"] = ""
os.environ["GOOGLE_CLIENT_ID"] = "test-client-id"
os.environ["GOOGLE_CLIENT_SECRET"] = "test-client-secret"
os.environ["FRONTEND_URL"] = "http://localhost:5173"
os.environ["PUBLIC_API_URL"] = "http://localhost:8000"

import json  # noqa: E402
from collections.abc import Callable, Generator, Iterator  # noqa: E402
from dataclasses import dataclass, field  # noqa: E402
from datetime import UTC, datetime  # noqa: E402
from pathlib import Path  # noqa: E402
from types import SimpleNamespace  # noqa: E402
from typing import Any  # noqa: E402

import pytest  # noqa: E402
import respx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.engine import Engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app.auth.jwt import create_access_token  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Roast, RoastIntensity, RoastStatus, User  # noqa: E402
from app.rate_limit import limiter  # noqa: E402
from app.services import card_service, roast_pipeline, roast_service  # noqa: E402

API = "/api/v1"
GH_API = "https://api.github.com"
GH_RAW = "https://raw.githubusercontent.com"
DEFAULT_SHA = "a" * 40
REAL_GET_OPENAI_CLIENT = roast_service.get_openai_client


# --------------------------------------------------------------------------- database


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[Engine]:
    """A fresh file-backed SQLite database per test (safe across threads/sessions)."""
    eng = create_engine(
        f"sqlite:///{tmp_path / 'test.db'}", connect_args={"check_same_thread": False}
    )

    @event.listens_for(eng, "connect")
    def _fk_on(dbapi_conn: Any, _: Any) -> None:
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(bind=eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


@pytest.fixture
def db(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    session = session_factory()
    yield session
    session.close()


@pytest.fixture
def client(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    def _override_get_db() -> Generator[Session, None, None]:
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = _override_get_db
    monkeypatch.setattr(roast_pipeline, "session_factory", session_factory)
    card_service.clear_card_cache()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    card_service.clear_card_cache()


# --------------------------------------------------------------------------- network guard


@pytest.fixture(autouse=True)
def respx_mock() -> Iterator[respx.MockRouter]:
    """Every httpx request must hit a registered route; unmatched requests raise."""
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as router:
        yield router


@pytest.fixture(autouse=True)
def _block_real_openai(monkeypatch: pytest.MonkeyPatch) -> None:
    def _blocked() -> Any:
        raise AssertionError("Real OpenAI client requested in tests; use the fake_openai fixture")

    monkeypatch.setattr(roast_service, "get_openai_client", _blocked)


@pytest.fixture(autouse=True)
def _reset_limiter() -> Iterator[None]:
    limiter.reset()
    yield
    limiter.enabled = False
    limiter.reset()


# --------------------------------------------------------------------------- users


@pytest.fixture
def make_user(db: Session) -> Callable[..., User]:
    counter = {"n": 0}

    def _make(
        email: str | None = None,
        *,
        full_name: str = "Test User",
        is_admin: bool = False,
        is_active: bool = True,
        avatar_url: str | None = None,
        last_login_at: datetime | None = None,
    ) -> User:
        counter["n"] += 1
        n = counter["n"]
        user = User(
            email=email or f"user{n}@example.com",
            full_name=full_name,
            google_id=f"google-{n}-{email or ''}",
            is_admin=is_admin,
            is_active=is_active,
            avatar_url=avatar_url,
            last_login_at=last_login_at,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    return _make


@pytest.fixture
def user(make_user: Callable[..., User]) -> User:
    return make_user("alice@example.com", full_name="Alice Wonder")


@pytest.fixture
def other_user(make_user: Callable[..., User]) -> User:
    return make_user("bob@example.com", full_name="Bob Builder")


@pytest.fixture
def admin_user(make_user: Callable[..., User]) -> User:
    return make_user("boss@example.com", full_name="Boss Admin", is_admin=True)


def auth_headers_for(u: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(u.id)}"}


@pytest.fixture
def auth_headers(user: User) -> dict[str, str]:
    return auth_headers_for(user)


@pytest.fixture
def admin_headers(admin_user: User) -> dict[str, str]:
    return auth_headers_for(admin_user)


@pytest.fixture
def make_roast(db: Session) -> Callable[..., Roast]:
    def _make(owner: User, **overrides: Any) -> Roast:
        values: dict[str, Any] = {
            "user_id": owner.id,
            "repo_url": "https://github.com/octo/hello",
            "repo_owner": "octo",
            "repo_name": "hello",
            "intensity": RoastIntensity.medium,
            "status": RoastStatus.completed,
            "tips": [],
        }
        status = overrides.get("status", RoastStatus.completed)
        if status == RoastStatus.completed and "overall_score" not in overrides:
            values.update(completed_roast_fields())
        values.update(overrides)
        roast = Roast(**values)
        db.add(roast)
        db.commit()
        db.refresh(roast)
        return roast

    return _make


def completed_roast_fields() -> dict[str, Any]:
    return {
        "overall_score": 62,
        "score_breakdown": {
            "code_quality": 14,
            "structure": 12,
            "documentation": 10,
            "ai_best_practices": 13,
            "security": 13,
        },
        "roast_text": "## Intro\nThere is no README here!\n\n- Second line",
        "summary": "Decent start, needs docs.",
        "tips": sample_tips(),
        "files_analyzed": 4,
        "completed_at": datetime.now(UTC),
    }


def sample_tips(n: int = 3) -> list[dict[str, Any]]:
    return [
        {
            "title": f"Tip {i}",
            "description": f"Do thing {i} properly.",
            "priority": ["high", "medium", "low"][i % 3],
            "file_path": "README.md" if i % 2 == 0 else None,
        }
        for i in range(n)
    ]


# --------------------------------------------------------------------------- fake OpenAI


def llm_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "summary": "Solid-ish beginner repo with gaps.",
        "roast": ("Bro, a bare `pass` inside a try-except won't fix the bug, it will hide it!"),
        "scores": {
            "code_quality": 12,
            "structure": 10,
            "documentation": 8,
            "ai_best_practices": 9,
            "security": 5,
        },
        "tips": sample_tips(3),
    }
    payload.update(overrides)
    return payload


def make_completion(
    content: str | None,
    *,
    refusal: str | None = None,
    prompt_tokens: int = 100,
    completion_tokens: int = 50,
    model: str = "gpt-4o-mini-2024",
) -> SimpleNamespace:
    message = SimpleNamespace(content=content, refusal=refusal)
    return SimpleNamespace(
        choices=[SimpleNamespace(message=message)],
        usage=SimpleNamespace(prompt_tokens=prompt_tokens, completion_tokens=completion_tokens),
        model=model,
    )


@dataclass
class FakeOpenAI:
    """Minimal stand-in for AsyncOpenAI: `.chat.completions.create(**kw)` pops queued replies."""

    responses: list[Any] = field(default_factory=list)
    calls: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def queue(self, *items: Any) -> "FakeOpenAI":
        self.responses.extend(items)
        return self

    def queue_json(self, payload: dict[str, Any] | None = None, **kw: Any) -> "FakeOpenAI":
        """Queue the two replies of one roast: the analysis call, then the roast-text call.
        `kw` (token counts, model) applies to each of the two completions."""
        full = payload or llm_payload()
        analysis = {key: full[key] for key in ("summary", "scores", "tips")}
        return self.queue(
            make_completion(json.dumps(analysis), **kw),
            make_completion(json.dumps({"roast": full["roast"]}), **kw),
        )

    async def _create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if not self.responses:
            raise AssertionError("FakeOpenAI: no queued response")
        item = self.responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


@pytest.fixture
def fake_openai(monkeypatch: pytest.MonkeyPatch) -> FakeOpenAI:
    fake = FakeOpenAI()
    monkeypatch.setattr(roast_service, "get_openai_client", lambda: fake)
    return fake


# --------------------------------------------------------------------------- fake GitHub


DEFAULT_FILES: dict[str, str] = {
    "README.md": "# Hello\nA tiny demo project.\n",
    "requirements.txt": "fastapi==0.110.0\n",
    ".gitignore": ".env\n__pycache__/\n",
    "main.py": "def main() -> None:\n    return None\n",
}


def mock_github_repo(
    router: respx.MockRouter,
    owner: str = "octo",
    repo: str = "hello",
    *,
    files: dict[str, str] | None = None,
    extra_tree: list[dict[str, Any]] | None = None,
    sha: str = DEFAULT_SHA,
    branch: str = "main",
    languages: dict[str, int] | None = None,
    truncated: bool = False,
) -> dict[str, respx.Route]:
    """Register respx routes for a healthy public repo with the given files."""
    files = DEFAULT_FILES if files is None else files
    base = f"{GH_API}/repos/{owner}/{repo}"
    tree = [{"path": p, "type": "blob", "size": len(c)} for p, c in files.items()]
    tree += extra_tree or []
    routes = {
        "meta": router.get(base).respond(
            200,
            json={
                "name": repo,
                "owner": {"login": owner},
                "default_branch": branch,
                "private": False,
            },
        ),
        "languages": router.get(f"{base}/languages").respond(
            200, json=languages if languages is not None else {"Python": 900, "Shell": 100}
        ),
        "branch": router.get(f"{base}/branches/{branch}").respond(
            200, json={"name": branch, "commit": {"sha": sha}}
        ),
        "tree": router.get(f"{base}/git/trees/{sha}").respond(
            200, json={"sha": sha, "tree": tree, "truncated": truncated}
        ),
    }
    for path, content in files.items():
        routes[f"raw:{path}"] = router.get(f"{GH_RAW}/{owner}/{repo}/{sha}/{path}").respond(
            200, content=content.encode()
        )
    return routes


@pytest.fixture
def github_repo(respx_mock: respx.MockRouter) -> dict[str, respx.Route]:
    return mock_github_repo(respx_mock)
