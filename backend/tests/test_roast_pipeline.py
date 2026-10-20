"""Background pipeline: status transitions, failure messages, stale sweep, token accounting.

GitHub is mocked with respx, OpenAI with FakeOpenAI; run_roast uses the test sessionmaker.
"""

import asyncio
import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import openai
import pytest
import respx
from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

from app.models import Roast, RoastStatus, User
from app.services import github_service, roast_pipeline
from app.services.github_service import (
    MSG_GITHUB_RATE_LIMIT,
    MSG_REPO_EMPTY,
    MSG_REPO_NOT_FOUND,
    MSG_REPO_TRUNCATED,
)
from app.services.roast_pipeline import MSG_STALE, MSG_UNEXPECTED
from app.services.roast_service import MSG_LLM_FAILED, MSG_LLM_UNAVAILABLE
from tests.conftest import GH_API, FakeOpenAI, make_completion, mock_github_repo

OPENAI_KEY = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789wxyz"


@pytest.fixture(autouse=True)
def _use_test_sessions(
    session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(roast_pipeline, "session_factory", session_factory)


@pytest.fixture
def pending(make_roast: Callable[..., Roast], user: User) -> Roast:
    return make_roast(user, status=RoastStatus.pending)


def _reload(db: Session, roast_id: int) -> Roast:
    db.expire_all()
    roast = db.get(Roast, roast_id)
    assert roast is not None
    return roast


async def test_happy_path_records_status_transitions(
    db: Session,
    pending: Roast,
    respx_mock: respx.MockRouter,
    fake_openai: FakeOpenAI,
    session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock_github_repo(respx_mock)
    fake_openai.queue_json(prompt_tokens=1234, completion_tokens=567)

    seen: list[RoastStatus] = []
    original = roast_pipeline._set_status

    def _spy(session: Session, roast: Roast, status: RoastStatus) -> None:
        seen.append(status)
        original(session, roast, status)

    monkeypatch.setattr(roast_pipeline, "_set_status", _spy)
    await roast_pipeline.run_roast(pending.id)

    roast = _reload(db, pending.id)
    # pending → fetching is the atomic claim in run_roast; _set_status handles the rest.
    assert seen == [RoastStatus.analyzing]
    assert roast.status == RoastStatus.completed
    assert roast.overall_score == 12 + 10 + 8 + 9 + 5
    assert roast.score_breakdown == {
        "code_quality": 12,
        "structure": 10,
        "documentation": 8,
        "ai_best_practices": 9,
        "security": 5,
    }
    assert len(roast.tips) == 3
    assert roast.files_analyzed == 4
    assert roast.default_branch == "main"
    assert roast.commit_sha == "a" * 40
    assert roast.language_breakdown == {"Python": 90.0, "Shell": 10.0}
    # Two LLM calls (analysis + roast), each reporting 1234 / 567 tokens.
    assert roast.prompt_tokens == 2 * 1234 and roast.completion_tokens == 2 * 567
    assert roast.model_used == "gpt-4o-mini-2024"
    assert roast.completed_at is not None
    assert roast.error_message is None


async def test_secrets_never_reach_llm_or_storage(
    db: Session, pending: Roast, respx_mock: respx.MockRouter, fake_openai: FakeOpenAI
) -> None:
    mock_github_repo(
        respx_mock,
        files={
            "README.md": "# Demo",
            ".env": f"OPENAI_API_KEY={OPENAI_KEY}\n",
            "app.py": f"client = OpenAI(api_key='{OPENAI_KEY}')\n",
        },
    )
    fake_openai.queue_json()
    await roast_pipeline.run_roast(pending.id)
    assert len(fake_openai.calls) == 2  # analysis + roast
    for call in fake_openai.calls:
        sent = str(call["messages"])
        assert OPENAI_KEY not in sent
        assert '"env_file_committed": true' in sent
        assert "sk-...wxyz" in sent
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.completed


async def test_truncation_is_warning_not_failure(
    db: Session,
    pending: Roast,
    respx_mock: respx.MockRouter,
    fake_openai: FakeOpenAI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(github_service.settings, "MAX_FILES_ANALYZED", 2)
    files = {f"m{i}.py": f"x = {i}\n" for i in range(5)}
    mock_github_repo(respx_mock, files=files)
    fake_openai.queue_json()
    await roast_pipeline.run_roast(pending.id)
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.completed
    assert roast.files_analyzed == 2
    assert roast.error_message == MSG_REPO_TRUNCATED


async def test_small_repo_with_license_is_not_flagged_truncated(
    db: Session, pending: Roast, respx_mock: respx.MockRouter, fake_openai: FakeOpenAI
) -> None:
    mock_github_repo(
        respx_mock,
        files={"README.md": "# Demo", "main.py": "x = 1\n", "LICENSE": "MIT"},
    )
    fake_openai.queue_json()
    await roast_pipeline.run_roast(pending.id)
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.completed
    assert roast.error_message is None


async def test_dependency_cap_flags_truncation(
    db: Session, pending: Roast, respx_mock: respx.MockRouter, fake_openai: FakeOpenAI
) -> None:
    # 9 requirements files > MAX_DEPENDENCY_FILES (8): a per-category cap really dropped one.
    files = {f"requirements-{i}.txt": "fastapi\n" for i in range(9)}
    files["main.py"] = "x = 1\n"
    mock_github_repo(respx_mock, files=files)
    fake_openai.queue_json()
    await roast_pipeline.run_roast(pending.id)
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.completed
    assert roast.error_message == MSG_REPO_TRUNCATED


async def test_github_tree_truncation_is_flagged(
    db: Session, pending: Roast, respx_mock: respx.MockRouter, fake_openai: FakeOpenAI
) -> None:
    mock_github_repo(respx_mock, truncated=True)
    fake_openai.queue_json()
    await roast_pipeline.run_roast(pending.id)
    assert _reload(db, pending.id).error_message == MSG_REPO_TRUNCATED


async def test_large_notebook_code_reaches_llm_without_outputs(
    db: Session, pending: Roast, respx_mock: respx.MockRouter, fake_openai: FakeOpenAI
) -> None:
    notebook = json.dumps(
        {
            "cells": [
                {"cell_type": "code", "source": "model = train_unique_marker()", "outputs": []},
                {
                    "cell_type": "code",
                    "source": "plot()",
                    "outputs": [{"data": {"image/png": "OUTPUTBLOB" * 30_000}}],
                },
            ]
        }
    )
    assert 250 * 1024 < len(notebook) < github_service.MAX_NOTEBOOK_BYTES
    mock_github_repo(respx_mock, files={"README.md": "# NB", "analysis.ipynb": notebook})
    fake_openai.queue_json()
    await roast_pipeline.run_roast(pending.id)
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.completed
    sent = str(fake_openai.calls[0]["messages"])
    assert "model = train_unique_marker()" in sent
    assert "OUTPUTBLOB" not in sent
    assert roast.files_analyzed == 2


async def test_run_roast_twice_runs_pipeline_once(
    db: Session, pending: Roast, respx_mock: respx.MockRouter, fake_openai: FakeOpenAI
) -> None:
    mock_github_repo(respx_mock)
    fake_openai.queue_json()
    await asyncio.gather(roast_pipeline.run_roast(pending.id), roast_pipeline.run_roast(pending.id))
    await roast_pipeline.run_roast(pending.id)
    assert len(fake_openai.calls) == 2  # one pipeline run = analysis call + roast call
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.completed and roast.error_message is None


@pytest.mark.parametrize(
    ("setup", "message"),
    [
        (lambda r: r.get(f"{GH_API}/repos/octo/hello").respond(404), MSG_REPO_NOT_FOUND),
        (
            lambda r: r.get(f"{GH_API}/repos/octo/hello").respond(
                403, json={"message": "API rate limit exceeded for 1.2.3.4"}
            ),
            MSG_GITHUB_RATE_LIMIT,
        ),
        (
            lambda r: r.get(f"{GH_API}/repos/octo/hello").mock(
                side_effect=httpx.ConnectError("boom")
            ),
            github_service.MSG_GITHUB_ERROR,
        ),
    ],
)
async def test_github_failures_mark_failed(
    db: Session,
    pending: Roast,
    respx_mock: respx.MockRouter,
    setup: Callable[[respx.MockRouter], Any],
    message: str,
) -> None:
    setup(respx_mock)
    await roast_pipeline.run_roast(pending.id)
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.failed
    assert roast.error_message == message


@pytest.mark.parametrize(
    "files",
    [
        {},  # empty tree
        {"README.md": "# Only docs", "notes.txt": "hello"},  # no code files
        {"README.md": "# Docs", "main.py": "   \n"},  # code file fetched but blank
    ],
)
async def test_empty_repo_fails(
    db: Session, pending: Roast, respx_mock: respx.MockRouter, files: dict[str, str]
) -> None:
    mock_github_repo(respx_mock, files=files)
    await roast_pipeline.run_roast(pending.id)
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.failed
    assert roast.error_message == MSG_REPO_EMPTY


async def test_llm_invalid_output_fails_and_counts_tokens(
    db: Session, pending: Roast, respx_mock: respx.MockRouter, fake_openai: FakeOpenAI
) -> None:
    mock_github_repo(respx_mock)
    fake_openai.queue(
        make_completion("nope", prompt_tokens=10, completion_tokens=1),
        make_completion("still nope", prompt_tokens=20, completion_tokens=2),
    )
    await roast_pipeline.run_roast(pending.id)
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.failed
    assert roast.error_message == MSG_LLM_FAILED
    assert roast.prompt_tokens == 30 and roast.completion_tokens == 3
    assert roast.overall_score is None


async def test_openai_api_error_fails_with_friendly_message(
    db: Session, pending: Roast, respx_mock: respx.MockRouter, fake_openai: FakeOpenAI
) -> None:
    mock_github_repo(respx_mock)
    fake_openai.queue(openai.APIConnectionError(request=httpx.Request("POST", "https://x")))
    await roast_pipeline.run_roast(pending.id)
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.failed
    assert roast.error_message == MSG_LLM_UNAVAILABLE


def _status_error(
    cls: type[openai.APIStatusError], status: int, code: str | None = None
) -> openai.APIStatusError:
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(status, request=request)
    # The message deliberately contains a key-like string: it must never reach the logs.
    body = {"message": "Incorrect API key provided: sk-proj-LEAKME", "code": code}
    return cls("Incorrect API key provided: sk-proj-LEAKME", response=response, body=body)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (_status_error(openai.AuthenticationError, 401, "invalid_api_key"), "check OPENAI_API_KEY"),
        (_status_error(openai.PermissionDeniedError, 403), "permission denied (403)"),
        (_status_error(openai.NotFoundError, 404, "model_not_found"), "check OPENAI_MODEL"),
        (
            _status_error(openai.RateLimitError, 429, "insufficient_quota"),
            "out of credit (429 insufficient_quota)",
        ),
        (_status_error(openai.RateLimitError, 429, "rate_limit_exceeded"), "rate limited (429)"),
        (
            openai.APIConnectionError(request=httpx.Request("POST", "https://x")),
            "cannot reach OpenAI",
        ),
        (_status_error(openai.InternalServerError, 500), "unexpected OpenAI error"),
    ],
)
async def test_openai_failures_log_an_operator_hint_never_the_key(
    db: Session,
    pending: Roast,
    respx_mock: respx.MockRouter,
    fake_openai: FakeOpenAI,
    caplog: pytest.LogCaptureFixture,
    error: openai.OpenAIError,
    expected: str,
) -> None:
    mock_github_repo(respx_mock)
    fake_openai.queue(error)
    with caplog.at_level("ERROR"):
        await roast_pipeline.run_roast(pending.id)
    assert expected in caplog.text
    assert f"OpenAI {type(error).__name__}" in caplog.text
    assert "LEAKME" not in caplog.text and "sk-proj" not in caplog.text
    # Users still only ever see the generic message.
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.failed
    assert roast.error_message == MSG_LLM_UNAVAILABLE


async def test_unexpected_error_is_caught(
    db: Session, pending: Roast, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(*args: Any, **kwargs: Any) -> None:
        raise KeyError("internal detail that must not leak")

    monkeypatch.setattr(github_service, "get_repo_meta", _boom)
    await roast_pipeline.run_roast(pending.id)
    roast = _reload(db, pending.id)
    assert roast.status == RoastStatus.failed
    assert roast.error_message == MSG_UNEXPECTED
    assert "internal detail" not in (roast.error_message or "")


async def test_run_roast_skips_missing_and_non_pending(
    db: Session, make_roast: Callable[..., Roast], user: User
) -> None:
    await roast_pipeline.run_roast(987654)  # no exception
    done = make_roast(user)  # completed
    await roast_pipeline.run_roast(done.id)
    assert _reload(db, done.id).status == RoastStatus.completed


async def test_run_roast_never_raises_when_session_breaks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Broken:
        def get(self, *args: Any) -> None:
            raise RuntimeError("db down")

        def close(self) -> None:
            pass

    monkeypatch.setattr(roast_pipeline, "session_factory", _Broken)
    await roast_pipeline.run_roast(1)


def test_mark_failed_handles_vanished_roast(db: Session) -> None:
    roast_pipeline._mark_failed(db, 424242, "msg")  # no exception


def test_mark_stale_roasts_failed(
    db: Session, make_roast: Callable[..., Roast], user: User
) -> None:
    old = datetime.now(UTC) - timedelta(minutes=30)
    stale_ids = [
        make_roast(user, status=s).id
        for s in (RoastStatus.pending, RoastStatus.fetching, RoastStatus.analyzing)
    ]
    fresh = make_roast(user, status=RoastStatus.pending)
    done = make_roast(user)
    db.execute(update(Roast).where(Roast.id.in_([*stale_ids, done.id])).values(created_at=old))
    db.commit()

    assert roast_pipeline.mark_stale_roasts_failed(db) == 3
    for roast_id in stale_ids:
        roast = _reload(db, roast_id)
        assert roast.status == RoastStatus.failed and roast.error_message == MSG_STALE
    assert _reload(db, fresh.id).status == RoastStatus.pending
    assert _reload(db, done.id).status == RoastStatus.completed

    # older_than=0 (startup): every active roast fails regardless of age.
    assert roast_pipeline.mark_stale_roasts_failed(db, older_than=timedelta(0)) == 1
    assert _reload(db, fresh.id).status == RoastStatus.failed
    assert _reload(db, done.id).status == RoastStatus.completed


def test_startup_sweep_fails_all_active_roasts(
    db: Session,
    make_roast: Callable[..., Roast],
    user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main

    stuck = make_roast(user, status=RoastStatus.fetching)
    db.execute(
        update(Roast)
        .where(Roast.id == stuck.id)
        .values(created_at=datetime.now(UTC) - timedelta(hours=1))
    )
    db.commit()
    just_created = make_roast(user, status=RoastStatus.pending)
    analyzing = make_roast(user, status=RoastStatus.analyzing)
    done = make_roast(user)
    monkeypatch.setattr(main.settings, "ENVIRONMENT", "development")
    main._fail_stale_roasts()
    for roast_id in (stuck.id, just_created.id, analyzing.id):
        roast = _reload(db, roast_id)
        assert roast.status == RoastStatus.failed and roast.error_message == MSG_STALE
    assert _reload(db, done.id).status == RoastStatus.completed

    def _explode() -> Session:
        raise RuntimeError("db unavailable")

    monkeypatch.setattr(roast_pipeline, "session_factory", _explode)
    main._fail_stale_roasts()  # logged, never raised


def test_claim_is_compare_and_set(session_factory: sessionmaker[Session], pending: Roast) -> None:
    first, second = session_factory(), session_factory()
    try:
        # Both sessions have seen the roast as pending; only one claim may succeed.
        assert first.get(Roast, pending.id).status == RoastStatus.pending  # type: ignore[union-attr]
        assert second.get(Roast, pending.id).status == RoastStatus.pending  # type: ignore[union-attr]
        assert roast_pipeline._claim(first, pending.id) is True
        assert roast_pipeline._claim(second, pending.id) is False
        second.expire_all()
        assert second.get(Roast, pending.id).status == RoastStatus.fetching  # type: ignore[union-attr]
    finally:
        first.close()
        second.close()
