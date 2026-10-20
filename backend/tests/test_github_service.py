"""GitHub service: URL parsing, file selection, notebook extraction, budget, HTTP errors,
and the SSRF host allow-list."""

import json
from collections.abc import AsyncIterator

import httpx
import pytest
import respx

from app.services import github_service as gh
from app.services.github_service import (
    MSG_GITHUB_RATE_LIMIT,
    MSG_REPO_EMPTY,
    MSG_REPO_NOT_FOUND,
    DisallowedHostError,
    EmptyRepoError,
    GitHubError,
    GitHubRateLimitError,
    InvalidRepoUrlError,
    RepoFile,
    RepoNotAccessibleError,
    TreeEntry,
)
from tests.conftest import DEFAULT_SHA, GH_API, GH_RAW, mock_github_repo

# --------------------------------------------------------------------------- URL parsing


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://github.com/octo/hello", ("octo", "hello")),
        ("https://github.com/octo/hello/", ("octo", "hello")),
        ("https://github.com/octo/hello.git", ("octo", "hello")),
        ("  https://github.com/Octo-Cat/my.repo_v2  ", ("Octo-Cat", "my.repo_v2")),
    ],
)
def test_parse_repo_url_valid(url: str, expected: tuple[str, str]) -> None:
    assert gh.parse_repo_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "",
        "github.com/octo/hello",
        "http://github.com/octo/hello",
        "https://gitlab.com/octo/hello",
        "https://github.com/octo",
        "https://github.com/octo/hello/tree/main",
        "https://github.com/octo/hello/blob/main/x.py",
        "https://github.com/octo/hello?tab=readme",
        "https://github.com/octo/hello#readme",
        "https://github.com/octo/.git",
        "https://github.com/octo/..",
        "https://evil.com/github.com/octo/hello",
        "https://github.com.evil.com/octo/hello",
        "https://user@github.com/octo/hello",
        f"https://github.com/{'a' * 101}/hello",
    ],
)
def test_parse_repo_url_invalid(url: str) -> None:
    with pytest.raises(InvalidRepoUrlError) as info:
        gh.parse_repo_url(url)
    assert "https://github.com/<owner>/<repo>" in info.value.message


def test_normalize_repo_url() -> None:
    assert gh.normalize_repo_url("o", "r") == "https://github.com/o/r"


# --------------------------------------------------------------------------- selection


@pytest.mark.parametrize(
    "path",
    [
        "node_modules/lib/index.js",
        "venv/lib/x.py",
        ".venv/x.py",
        "src/__pycache__/a.py",
        "dist/bundle.js",
        "build/a.py",
        "package-lock.json",
        "poetry.lock",
        "Cargo.lock",
        "data/train.csv",
        "models/weights.pt",
        "assets/logo.png",
        "static/app.min.js",
        "static/app.js.map",
        "docs/report.pdf",
    ],
)
def test_is_excluded(path: str) -> None:
    assert gh.is_excluded(path)


def test_is_excluded_large_file_and_allowed() -> None:
    assert gh.is_excluded("main.py", size=gh.MAX_FILE_BYTES + 1)
    assert not gh.is_excluded("main.py", size=100)
    assert not gh.is_excluded("src/app/main.py")


def test_notebooks_have_their_own_size_cap() -> None:
    assert not gh.is_excluded("eda.ipynb", size=300 * 1024)
    assert not gh.is_excluded("eda.ipynb", size=gh.MAX_NOTEBOOK_BYTES)
    assert gh.is_excluded("eda.ipynb", size=gh.MAX_NOTEBOOK_BYTES + 1)
    assert gh.is_excluded("eda.py", size=300 * 1024)
    tree = [{"path": "eda.ipynb", "type": "blob", "size": 300 * 1024}]
    assert gh.select_files(tree) == ["eda.ipynb"]


def test_count_selectable_ignores_unpicked_blobs_and_caps() -> None:
    tree = [
        {"path": "LICENSE", "type": "blob", "size": 10},
        {"path": "docs/guide.md", "type": "blob", "size": 10},
        {"path": "ci.yml", "type": "blob", "size": 10},
        {"path": "main.py", "type": "blob", "size": 10},
        *({"path": f"README{i}.md", "type": "blob", "size": 10} for i in range(5)),
    ]
    assert gh.count_selectable(tree) == 6  # 5 READMEs (uncapped) + main.py
    assert len(gh.select_files(tree)) == 4  # MAX_READMES=3 + main.py


def test_select_files_priority_order() -> None:
    tree = [
        {"path": "src/deep/module.py", "type": "blob", "size": 10},
        {"path": "app.py", "type": "blob", "size": 10},
        {"path": "notebooks/eda.ipynb", "type": "blob", "size": 10},
        {"path": "requirements.txt", "type": "blob", "size": 10},
        {"path": "README.md", "type": "blob", "size": 10},
        {"path": "src", "type": "tree"},
        {"path": "node_modules/x.js", "type": "blob", "size": 10},
        {"path": "LICENSE", "type": "blob", "size": 10},
        {"path": ".env", "type": "blob", "size": 10},
        {"path": "web/App.tsx", "type": "blob", "size": 10},
    ]
    selected = gh.select_files(tree, max_files=40)
    assert selected == [
        "README.md",
        ".env",
        "requirements.txt",
        "notebooks/eda.ipynb",
        "app.py",
        "web/App.tsx",
        "src/deep/module.py",
    ]


def test_select_files_caps_and_bucket_limits() -> None:
    tree = [TreeEntry(path=f"pkg/mod_{i:03d}.py", size=10) for i in range(100)]
    tree += [TreeEntry(path=f"d{i}/README.md") for i in range(5)]
    tree += [TreeEntry(path=f"r{i}/requirements.txt") for i in range(10)]
    selected = gh.select_files(tree, max_files=20)
    assert len(selected) == 20
    assert sum(p.endswith("README.md") for p in selected) == gh.MAX_READMES
    assert sum(p.endswith("requirements.txt") for p in selected) == gh.MAX_DEPENDENCY_FILES
    # Default cap comes from settings.
    assert len(gh.select_files(tree)) == 40


def test_is_code_file() -> None:
    assert gh.is_code_file("a/b.py")
    assert gh.is_code_file("x.ipynb")
    assert not gh.is_code_file("README.md")


def test_compute_language_breakdown() -> None:
    assert gh.compute_language_breakdown({"Python": 750, "Shell": 250, "Bad": "x", "Z": 0}) == {
        "Python": 75.0,
        "Shell": 25.0,
    }
    assert gh.compute_language_breakdown({}) == {}


# --------------------------------------------------------------------------- notebooks


def test_extract_notebook_text_keeps_sources_drops_outputs() -> None:
    nb = {
        "cells": [
            {"cell_type": "markdown", "source": ["# Title\n", "intro"]},
            {
                "cell_type": "code",
                "source": "print('hi')",
                "outputs": [{"text": "SECRET OUTPUT"}],
            },
            {"cell_type": "raw", "source": "ignored raw"},
            {"cell_type": "code", "source": "   "},
            "not-a-cell",
        ]
    }
    text = gh.extract_notebook_text(json.dumps(nb))
    assert "# %% [markdown cell 1]\n# Title\nintro" in text
    assert "# %% [code cell 2]\nprint('hi')" in text
    assert "SECRET OUTPUT" not in text
    assert "ignored raw" not in text


@pytest.mark.parametrize("raw", ["not json", "[]", '{"cells": "nope"}'])
def test_extract_notebook_text_invalid(raw: str) -> None:
    assert gh.extract_notebook_text(raw) == ""


# --------------------------------------------------------------------------- budget


def test_apply_char_budget_per_file_cap_and_total() -> None:
    files = [RepoFile(path=f"f{i}.py", content="x" * 5000) for i in range(10)]
    kept, truncated = gh.apply_char_budget(files, max_total_chars=8000)
    assert truncated is True
    # Per-file cap = max(2000, 8000 // 4) = 2000 chars (+ marker).
    assert kept[0].content.startswith("x" * 2000)
    assert kept[0].content.endswith(gh.TRUNCATION_MARKER)
    total = sum(len(f.content) for f in kept)
    assert total <= 8000 + len(kept) * len(gh.TRUNCATION_MARKER)
    assert len(kept) < len(files)


def test_apply_char_budget_untouched_when_small() -> None:
    files = [RepoFile(path="a.py", content="print(1)")]
    kept, truncated = gh.apply_char_budget(files, 120_000)
    assert kept == files and truncated is False


# --------------------------------------------------------------------------- HTTP


async def test_get_repo_meta_and_tree(respx_mock: respx.MockRouter) -> None:
    mock_github_repo(respx_mock, languages={"Python": 3, "HTML": 1})
    async with gh.create_github_client() as client:
        meta = await gh.get_repo_meta(client, "octo", "hello")
        tree = await gh.get_tree(client, "octo", "hello", meta.default_branch)
    assert meta.default_branch == "main"
    assert meta.language_breakdown == {"Python": 75.0, "HTML": 25.0}
    assert tree.commit_sha == DEFAULT_SHA
    assert {e.path for e in tree.entries} >= {"README.md", "main.py"}
    assert tree.truncated is False


async def test_github_token_sent_when_configured(
    respx_mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(gh.settings, "GITHUB_TOKEN", "ghp_testtoken")
    routes = mock_github_repo(respx_mock)
    async with gh.create_github_client() as client:
        await gh.get_repo_meta(client, "octo", "hello")
    assert routes["meta"].calls.last.request.headers["authorization"] == "Bearer ghp_testtoken"


@pytest.mark.parametrize(
    ("response", "exc", "message"),
    [
        (
            httpx.Response(404, json={"message": "Not Found"}),
            RepoNotAccessibleError,
            MSG_REPO_NOT_FOUND,
        ),
        (
            httpx.Response(403, json={"message": "API rate limit exceeded"}),
            GitHubRateLimitError,
            MSG_GITHUB_RATE_LIMIT,
        ),
        (
            httpx.Response(403, headers={"x-ratelimit-remaining": "0"}, json={}),
            GitHubRateLimitError,
            MSG_GITHUB_RATE_LIMIT,
        ),
        (httpx.Response(429, json={}), GitHubRateLimitError, MSG_GITHUB_RATE_LIMIT),
        (
            httpx.Response(403, json={"message": "Forbidden"}),
            RepoNotAccessibleError,
            MSG_REPO_NOT_FOUND,
        ),
        (httpx.Response(409, json={}), EmptyRepoError, MSG_REPO_EMPTY),
        (httpx.Response(500, json={}), GitHubError, gh.MSG_GITHUB_ERROR),
        (
            httpx.Response(200, json={"private": True, "default_branch": "main"}),
            RepoNotAccessibleError,
            MSG_REPO_NOT_FOUND,
        ),
    ],
)
async def test_get_repo_meta_errors(
    respx_mock: respx.MockRouter,
    response: httpx.Response,
    exc: type[Exception],
    message: str,
) -> None:
    respx_mock.get(f"{GH_API}/repos/o/r").mock(return_value=response)
    async with gh.create_github_client() as client:
        with pytest.raises(exc) as info:
            await gh.get_repo_meta(client, "o", "r")
    assert info.value.user_message == message  # type: ignore[attr-defined]


async def test_get_repo_meta_network_error(respx_mock: respx.MockRouter) -> None:
    respx_mock.get(f"{GH_API}/repos/o/r").mock(side_effect=httpx.ConnectTimeout("t"))
    async with gh.create_github_client() as client:
        with pytest.raises(GitHubError):
            await gh.get_repo_meta(client, "o", "r")


async def test_languages_failure_is_tolerated_but_rate_limit_is_not(
    respx_mock: respx.MockRouter,
) -> None:
    respx_mock.get(f"{GH_API}/repos/o/r").respond(200, json={"default_branch": "dev"})
    lang = respx_mock.get(f"{GH_API}/repos/o/r/languages")
    lang.respond(500)
    async with gh.create_github_client() as client:
        meta = await gh.get_repo_meta(client, "o", "r")
        assert meta.language_breakdown == {} and meta.default_branch == "dev"
        lang.respond(429)
        with pytest.raises(GitHubRateLimitError):
            await gh.get_repo_meta(client, "o", "r")


async def test_get_tree_empty_repo_and_bad_sha(respx_mock: respx.MockRouter) -> None:
    branch = respx_mock.get(f"{GH_API}/repos/o/r/branches/main")
    branch.respond(404)
    async with gh.create_github_client() as client:
        with pytest.raises(EmptyRepoError) as info:
            await gh.get_tree(client, "o", "r", "main")
        assert info.value.user_message == MSG_REPO_EMPTY
        branch.respond(200, json={"commit": {"sha": "not-a-sha"}})
        with pytest.raises(GitHubError):
            await gh.get_tree(client, "o", "r", "main")


async def test_fetch_files_notebooks_binary_errors_and_budget(
    respx_mock: respx.MockRouter,
) -> None:
    nb = json.dumps({"cells": [{"cell_type": "code", "source": "x = 1"}]})
    base = f"{GH_RAW}/o/r/{DEFAULT_SHA}"
    respx_mock.get(f"{base}/nb.ipynb").respond(200, content=nb.encode())
    respx_mock.get(f"{base}/main.py").respond(200, content=b"print('ok')")
    respx_mock.get(f"{base}/blob.py").respond(200, content=b"\x00\x01binary")
    respx_mock.get(f"{base}/missing.py").respond(404)
    respx_mock.get(f"{base}/empty.py").respond(200, content=b"   ")
    respx_mock.get(f"{base}/flaky.py").mock(side_effect=httpx.ReadTimeout("t"))
    async with gh.create_github_client() as client:
        result = await gh.fetch_files(
            client,
            "o",
            "r",
            DEFAULT_SHA,
            ["nb.ipynb", "main.py", "blob.py", "missing.py", "empty.py", "flaky.py"],
        )
    assert [f.path for f in result.files] == ["nb.ipynb", "main.py"]
    assert result.files[0].content == "# %% [code cell 1]\nx = 1"
    assert result.truncated is False


async def test_fetch_files_raw_rate_limit(respx_mock: respx.MockRouter) -> None:
    respx_mock.get(f"{GH_RAW}/o/r/{DEFAULT_SHA}/a.py").respond(429)
    async with gh.create_github_client() as client:
        with pytest.raises(GitHubRateLimitError):
            await gh.fetch_files(client, "o", "r", DEFAULT_SHA, ["a.py"])


# --------------------------------------------------------------------------- SSRF guard


async def test_disallowed_host_blocked_before_request(respx_mock: respx.MockRouter) -> None:
    evil = respx_mock.get("https://evil.example.com/x").respond(200)
    async with gh.create_github_client() as client:
        with pytest.raises(DisallowedHostError):
            await gh._get(client, "https://evil.example.com/x")
        with pytest.raises(DisallowedHostError):
            await gh._get(client, "http://api.github.com/repos/o/r")
    assert not evil.called


async def test_redirect_to_disallowed_host_blocked(respx_mock: respx.MockRouter) -> None:
    respx_mock.get(f"{GH_API}/repos/o/r").respond(
        302, headers={"Location": "http://169.254.169.254/latest/meta-data"}
    )
    metadata = respx_mock.get("http://169.254.169.254/latest/meta-data").respond(200)
    async with gh.create_github_client() as client:
        with pytest.raises(DisallowedHostError):
            await gh.get_repo_meta(client, "o", "r")
    assert not metadata.called


def test_raw_file_url_quotes_path() -> None:
    url = gh.raw_file_url("o", "r", DEFAULT_SHA, "dir/my file#1.py")
    assert url == f"{GH_RAW}/o/r/{DEFAULT_SHA}/dir/my%20file%231.py"


async def test_fetch_notebook_over_byte_limit_is_skipped(respx_mock: respx.MockRouter) -> None:
    base = f"{GH_RAW}/o/r/{DEFAULT_SHA}"
    cells = [{"cell_type": "code", "source": "x = 1", "outputs": [{"text": "y" * 100}]}]
    big = json.dumps({"cells": cells, "pad": "z" * gh.MAX_NOTEBOOK_BYTES}).encode()
    ok_nb = json.dumps({"cells": cells}).encode()
    # Tree sizes can lie / be missing: the streamed byte count is what's enforced.
    respx_mock.get(f"{base}/big.ipynb").respond(200, content=big)
    respx_mock.get(f"{base}/ok.ipynb").respond(200, content=ok_nb)
    respx_mock.get(f"{base}/big.py").respond(200, content=b"x" * (gh.MAX_FILE_BYTES * 2 + 1))
    async with gh.create_github_client() as client:
        result = await gh.fetch_files(
            client, "o", "r", DEFAULT_SHA, ["big.ipynb", "ok.ipynb", "big.py"]
        )
    assert [f.path for f in result.files] == ["ok.ipynb"]
    assert result.files[0].content == "# %% [code cell 1]\nx = 1"


class _ChunkedStream(httpx.AsyncByteStream):
    """Response body with no Content-Length: forces the streamed byte counter to act."""

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for _ in range(3):
            yield b"a" * gh.MAX_FILE_BYTES


async def test_fetch_stream_limit_without_content_length(respx_mock: respx.MockRouter) -> None:
    respx_mock.get(f"{GH_RAW}/o/r/{DEFAULT_SHA}/huge.py").respond(200, stream=_ChunkedStream())
    async with gh.create_github_client() as client:
        result = await gh.fetch_files(client, "o", "r", DEFAULT_SHA, ["huge.py"])
    assert result.files == []


def test_notebook_extracted_text_still_gets_char_budget() -> None:
    long_cell = "x = 1\n" * 10_000
    files = [
        gh.RepoFile(
            "nb.ipynb",
            gh.extract_notebook_text(
                json.dumps({"cells": [{"cell_type": "code", "source": long_cell}]})
            ),
        )
    ]
    kept, truncated = gh.apply_char_budget(files, 8000)
    assert truncated and len(kept[0].content) <= 2000 + len(gh.TRUNCATION_MARKER)
