"""GitHub access: URL parsing, repo metadata, tree listing, file selection and fetching.

Security: only `api.github.com` and `raw.githubusercontent.com` may ever be contacted
(SSRF guard). This is enforced both per request (`_get`) and by an httpx request hook
on the client returned by `create_github_client()` (which also covers redirects).
"""

import asyncio
import json
import logging
import posixpath
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"
GITHUB_RAW_BASE = "https://raw.githubusercontent.com"
ALLOWED_HOSTS: frozenset[str] = frozenset({"api.github.com", "raw.githubusercontent.com"})

HTTP_TIMEOUT_SECONDS = 10.0
FETCH_CONCURRENCY = 8
MAX_FILE_BYTES = 100 * 1024
# Notebooks carry outputs (plots, tables) that are stripped before analysis, so the raw
# file may be far larger than the code it contains.
MAX_NOTEBOOK_BYTES = 5 * 1024 * 1024
MAX_READMES = 3
MAX_DEPENDENCY_FILES = 8
TRUNCATION_MARKER = "\n... [truncated by Code Roaster]\n"

REPO_URL_RE = re.compile(r"^https://github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9._-]+?)/?$")

# --- User-safe error messages ---------------------------------------------
MSG_REPO_NOT_FOUND = "Repo not found. Check that it exists and is public."
MSG_REPO_TRUNCATED = "This repo is very large, so only the top files were analysed."
MSG_REPO_EMPTY = "This repo is empty!"
MSG_GITHUB_RATE_LIMIT = "GitHub is busy right now (rate limit). Please try again in a little while."
MSG_GITHUB_ERROR = "Could not fetch the repo from GitHub. Please try again in a little while."
MSG_INVALID_URL = (
    "Invalid GitHub repo URL. Use the format https://github.com/<owner>/<repo> "
    "(public repos only, no /tree/... or /blob/... paths)."
)


# --- Errors ---------------------------------------------------------------------------
class RoastPipelineError(Exception):
    """Base error carrying a user-safe message for `Roast.error_message`."""

    user_message: str = "Something went wrong. Please try again in a little while."

    def __init__(self, user_message: str | None = None, *, log_detail: str | None = None) -> None:
        if user_message:
            self.user_message = user_message
        self.log_detail = log_detail or self.user_message
        super().__init__(self.log_detail)


class InvalidRepoUrlError(ValueError):
    """The submitted URL is not a valid public GitHub repo URL."""

    def __init__(self, message: str = MSG_INVALID_URL) -> None:
        super().__init__(message)
        self.message = message


class RepoNotAccessibleError(RoastPipelineError):
    """Repo does not exist or is private."""

    user_message = MSG_REPO_NOT_FOUND


class GitHubRateLimitError(RoastPipelineError):
    """GitHub API rate limit exhausted."""

    user_message = MSG_GITHUB_RATE_LIMIT


class EmptyRepoError(RoastPipelineError):
    """Repo has no commits or no analysable code files."""

    user_message = MSG_REPO_EMPTY


class GitHubError(RoastPipelineError):
    """Any other unexpected GitHub failure."""

    user_message = MSG_GITHUB_ERROR


class DisallowedHostError(RuntimeError):
    """Raised when code attempts to contact a host outside the allow-list."""


# --- Data containers ------------------------------------------------------------------
@dataclass(frozen=True)
class TreeEntry:
    """One entry of a recursive git tree."""

    path: str
    type: str = "blob"
    size: int | None = None


@dataclass
class RepoMeta:
    """Repository metadata needed by the pipeline."""

    owner: str
    name: str
    default_branch: str
    language_breakdown: dict[str, float] = field(default_factory=dict)


@dataclass
class RepoTree:
    """Recursive tree for a commit."""

    commit_sha: str
    entries: list[TreeEntry]
    truncated: bool = False


@dataclass(frozen=True)
class RepoFile:
    """A fetched (and possibly truncated) repository file."""

    path: str
    content: str


@dataclass
class FetchResult:
    """Result of `fetch_files`."""

    files: list[RepoFile]
    truncated: bool = False


# --- URL parsing ----------------------------------------------------------------------
def parse_repo_url(url: str) -> tuple[str, str]:
    """
    Parse a GitHub repo URL into `(owner, repo)`.

    Accepts only `https://github.com/{owner}/{repo}` with an optional trailing slash and
    optional `.git` suffix (which is stripped).

    Raises:
        InvalidRepoUrlError: If the URL does not match the strict pattern.
    """
    candidate = (url or "").strip()
    match = REPO_URL_RE.match(candidate)
    if not match:
        raise InvalidRepoUrlError()
    owner, repo = match.group(1), match.group(2)
    if repo.lower().endswith(".git"):
        repo = repo[:-4]
    if not repo or repo in {".", ".."} or len(owner) > 100 or len(repo) > 100:
        raise InvalidRepoUrlError()
    return owner, repo


def normalize_repo_url(owner: str, repo: str) -> str:
    """Canonical repo URL stored on the Roast."""
    return f"https://github.com/{owner}/{repo}"


# --- HTTP helpers ---------------------------------------------------------------------
def _assert_allowed_url(url: httpx.URL) -> None:
    if url.scheme != "https" or url.host not in ALLOWED_HOSTS:
        raise DisallowedHostError(f"Blocked request to disallowed host: {url.host!r}")


async def _enforce_allowed_host(request: httpx.Request) -> None:
    """httpx request hook: block any request (including redirects) to other hosts."""
    _assert_allowed_url(request.url)


def create_github_client() -> httpx.AsyncClient:
    """Factory for the HTTP client used to talk to GitHub (patch this in tests)."""
    return httpx.AsyncClient(
        timeout=httpx.Timeout(HTTP_TIMEOUT_SECONDS),
        follow_redirects=True,
        headers={"User-Agent": "code-roaster/2.0"},
        event_hooks={"request": [_enforce_allowed_host]},
    )


def _api_headers() -> dict[str, str]:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {settings.GITHUB_TOKEN}"
    return headers


def _is_rate_limited(response: httpx.Response) -> bool:
    if response.status_code == 429:
        return True
    if response.status_code == 403:
        if response.headers.get("x-ratelimit-remaining") == "0":
            return True
        return "rate limit" in response.text[:500].lower()
    return False


async def _get(client: httpx.AsyncClient, url: str, *, api: bool = True) -> httpx.Response:
    """GET `url` after asserting its host is allow-listed. Network errors → GitHubError."""
    _assert_allowed_url(httpx.URL(url))
    try:
        return await client.get(url, headers=_api_headers() if api else None)
    except DisallowedHostError:
        raise
    except httpx.HTTPError as exc:
        raise GitHubError(log_detail=f"GitHub request failed: {type(exc).__name__}") from exc


def _repo_path(owner: str, repo: str) -> str:
    return f"{GITHUB_API_BASE}/repos/{quote(owner, safe='')}/{quote(repo, safe='')}"


def _raise_for_api_status(response: httpx.Response, *, context: str) -> None:
    if response.status_code < 400:
        return
    if _is_rate_limited(response):
        raise GitHubRateLimitError(log_detail=f"GitHub rate limit hit ({context})")
    if response.status_code in (401, 403, 404, 451):
        raise RepoNotAccessibleError(log_detail=f"GitHub {response.status_code} ({context})")
    if response.status_code == 409:
        raise EmptyRepoError(log_detail=f"GitHub 409 empty repo ({context})")
    raise GitHubError(log_detail=f"GitHub {response.status_code} ({context})")


def compute_language_breakdown(language_bytes: Mapping[str, Any]) -> dict[str, float]:
    """Convert GitHub `/languages` byte counts into percentages (1 decimal, desc order)."""
    counts = {
        str(name): int(value)
        for name, value in language_bytes.items()
        if isinstance(value, int | float) and value > 0
    }
    total = sum(counts.values())
    if total == 0:
        return {}
    ordered = sorted(counts.items(), key=lambda item: item[1], reverse=True)
    return {name: round(value * 100 / total, 1) for name, value in ordered}


# --- GitHub API calls -----------------------------------------------------------------
async def get_repo_meta(client: httpx.AsyncClient, owner: str, repo: str) -> RepoMeta:
    """
    Fetch repo metadata (`GET /repos/{o}/{r}`) and languages (`GET /repos/{o}/{r}/languages`).

    Raises:
        RepoNotAccessibleError: 404 / private repo
        GitHubRateLimitError: rate limit exhausted
        GitHubError: other failures
    """
    response = await _get(client, _repo_path(owner, repo))
    _raise_for_api_status(response, context="repo meta")
    data = response.json()
    if not isinstance(data, dict) or data.get("private") is True:
        raise RepoNotAccessibleError(log_detail="Repo is private or malformed response")
    default_branch = str(data.get("default_branch") or "main")

    languages: dict[str, float] = {}
    lang_response = await _get(client, f"{_repo_path(owner, repo)}/languages")
    if lang_response.status_code < 400:
        payload = lang_response.json()
        if isinstance(payload, dict):
            languages = compute_language_breakdown(payload)
    elif _is_rate_limited(lang_response):
        raise GitHubRateLimitError(log_detail="GitHub rate limit hit (languages)")
    else:
        logger.warning("Languages lookup failed with HTTP %s", lang_response.status_code)

    return RepoMeta(
        owner=str(data.get("owner", {}).get("login") or owner),
        name=str(data.get("name") or repo),
        default_branch=default_branch,
        language_breakdown=languages,
    )


async def get_tree(client: httpx.AsyncClient, owner: str, repo: str, branch: str) -> RepoTree:
    """
    Resolve `branch` to a commit SHA (`GET /repos/{o}/{r}/branches/{branch}`), then list the
    recursive tree for that commit (`GET /repos/{o}/{r}/git/trees/{sha}?recursive=1`).

    Raises:
        EmptyRepoError: repo has no commits
        RepoNotAccessibleError / GitHubRateLimitError / GitHubError
    """
    branch_response = await _get(client, f"{_repo_path(owner, repo)}/branches/{quote(branch)}")
    if branch_response.status_code == 404:
        # Repo meta succeeded, so a missing default branch means there are no commits.
        raise EmptyRepoError(log_detail="Default branch not found (empty repo)")
    _raise_for_api_status(branch_response, context="branch")
    commit_sha = str(branch_response.json().get("commit", {}).get("sha") or "")
    if not re.fullmatch(r"[0-9a-f]{40}", commit_sha):
        raise GitHubError(log_detail="Branch response had no valid commit sha")

    tree_response = await _get(
        client, f"{_repo_path(owner, repo)}/git/trees/{commit_sha}?recursive=1"
    )
    _raise_for_api_status(tree_response, context="tree")
    payload = tree_response.json()
    raw_entries = payload.get("tree") if isinstance(payload, dict) else None
    entries = [
        TreeEntry(
            path=str(item["path"]),
            type=str(item.get("type", "blob")),
            size=item.get("size") if isinstance(item.get("size"), int) else None,
        )
        for item in (raw_entries or [])
        if isinstance(item, dict) and isinstance(item.get("path"), str)
    ]
    return RepoTree(
        commit_sha=commit_sha, entries=entries, truncated=bool(payload.get("truncated"))
    )


# --- File selection -------------------------------------------------------------------
EXCLUDED_DIRS: frozenset[str] = frozenset(
    {
        "node_modules",
        "venv",
        ".venv",
        "env",
        "__pycache__",
        "dist",
        "build",
        ".git",
        ".next",
        ".nuxt",
        ".tox",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".ipynb_checkpoints",
        "site-packages",
        "coverage",
        "htmlcov",
        "vendor",
        "out",
        ".idea",
        ".vscode",
    }
)
LOCKFILES: frozenset[str] = frozenset(
    {
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "poetry.lock",
        "pipfile.lock",
        "uv.lock",
        "pdm.lock",
        "composer.lock",
        "gemfile.lock",
        "cargo.lock",
        "bun.lockb",
    }
)
DATA_EXTENSIONS: frozenset[str] = frozenset(
    {
        ".csv",
        ".tsv",
        ".parquet",
        ".pkl",
        ".pickle",
        ".pt",
        ".pth",
        ".h5",
        ".hdf5",
        ".npy",
        ".npz",
        ".onnx",
        ".safetensors",
        ".joblib",
        ".feather",
        ".arrow",
        ".xlsx",
        ".xls",
        ".db",
        ".sqlite",
        ".sqlite3",
        ".jsonl",
        ".ckpt",
        ".bin",
        ".model",
    }
)
BINARY_EXTENSIONS: frozenset[str] = frozenset(
    {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".bmp",
        ".ico",
        ".svg",
        ".webp",
        ".pdf",
        ".zip",
        ".tar",
        ".gz",
        ".tgz",
        ".rar",
        ".7z",
        ".exe",
        ".dll",
        ".so",
        ".dylib",
        ".whl",
        ".egg",
        ".jar",
        ".class",
        ".pyc",
        ".pyo",
        ".mp3",
        ".mp4",
        ".wav",
        ".mov",
        ".avi",
        ".ttf",
        ".otf",
        ".woff",
        ".woff2",
        ".eot",
        ".lockb",
        ".docx",
        ".pptx",
    }
)
CODE_EXTENSIONS: frozenset[str] = frozenset({".py", ".ts", ".tsx", ".js", ".jsx"})
DEPENDENCY_FILES: frozenset[str] = frozenset(
    {
        "requirements.txt",
        "requirements-dev.txt",
        "pyproject.toml",
        "package.json",
        "dockerfile",
        ".gitignore",
        "setup.cfg",
        "pipfile",
        "environment.yml",
        "docker-compose.yml",
        ".env",
        ".env.example",
    }
)


def _basename(path: str) -> str:
    return posixpath.basename(path)


def _extension(path: str) -> str:
    return posixpath.splitext(_basename(path).lower())[1]


def _depth(path: str) -> int:
    return path.count("/")


def max_bytes_for(path: str) -> int:
    """Raw size cap for a file: 5 MB for notebooks (outputs are stripped), else 100 KB."""
    return MAX_NOTEBOOK_BYTES if _is_notebook(path) else MAX_FILE_BYTES


def is_excluded(path: str, size: int | None = None) -> bool:
    """True if a tree path must never be analysed (vendored dirs, lockfiles, binaries, data,
    files over 100 KB / notebooks over 5 MB)."""
    parts = path.split("/")
    if any(part in EXCLUDED_DIRS for part in parts[:-1]):
        return True
    name = parts[-1].lower()
    if name in LOCKFILES or name.endswith(".lock"):
        return True
    ext = _extension(path)
    if ext in DATA_EXTENSIONS or ext in BINARY_EXTENSIONS:
        return True
    if name.endswith((".min.js", ".map", ".bundle.js")):
        return True
    return size is not None and size > max_bytes_for(path)


def _is_readme(path: str) -> bool:
    return _basename(path).lower().startswith("readme")


def _is_dependency_file(path: str) -> bool:
    name = _basename(path).lower()
    if name in DEPENDENCY_FILES or name.startswith(".env"):
        return True
    return name.startswith("requirements") and name.endswith(".txt")


def _is_notebook(path: str) -> bool:
    return _extension(path) == ".ipynb"


def is_code_file(path: str) -> bool:
    """True for code files that count as 'real' content (.py/.ts/.tsx/.js/.jsx/.ipynb)."""
    return _extension(path) in CODE_EXTENSIONS or _is_notebook(path)


def _as_entry(item: TreeEntry | Mapping[str, Any]) -> TreeEntry:
    if isinstance(item, TreeEntry):
        return item
    size = item.get("size")
    return TreeEntry(
        path=str(item.get("path", "")),
        type=str(item.get("type", "blob")),
        size=size if isinstance(size, int) else None,
    )


def candidate_files(tree: Iterable[TreeEntry | Mapping[str, Any]]) -> list[TreeEntry]:
    """All blob entries that survive the exclusion rules."""
    entries = (_as_entry(item) for item in tree)
    return [e for e in entries if e.type == "blob" and e.path and not is_excluded(e.path, e.size)]


def _sort_key(entry: TreeEntry) -> tuple[int, int, str]:
    return (_depth(entry.path), len(entry.path), entry.path)


def select_files(
    tree: Iterable[TreeEntry | Mapping[str, Any]], max_files: int | None = None
) -> list[str]:
    """
    Choose which files to send to the LLM, in priority order:
    README* → dependency/config files → *.ipynb → *.py/*.ts/*.tsx/*.js/*.jsx
    (each bucket: shallowest, then shortest paths first). Capped at `max_files`
    (default `settings.MAX_FILES_ANALYZED`).

    Accepts `TreeEntry` objects or GitHub tree dicts (`{"path", "type", "size"}`).
    """
    limit = settings.MAX_FILES_ANALYZED if max_files is None else max_files
    selected: list[str] = []
    for path in _prioritised_paths(candidate_files(tree), capped=True):
        selected.append(path)
        if len(selected) >= limit:
            break
    return selected


def _prioritised_paths(candidates: Sequence[TreeEntry], *, capped: bool) -> list[str]:
    """Selectable candidate paths in priority order (deduplicated). With `capped`, the
    README / dependency-file per-category caps are applied."""
    readmes = sorted((e for e in candidates if _is_readme(e.path)), key=_sort_key)
    deps = sorted((e for e in candidates if _is_dependency_file(e.path)), key=_sort_key)
    if capped:
        readmes = readmes[:MAX_READMES]
        deps = deps[:MAX_DEPENDENCY_FILES]
    notebooks = sorted((e for e in candidates if _is_notebook(e.path)), key=_sort_key)
    code = sorted((e for e in candidates if _extension(e.path) in CODE_EXTENSIONS), key=_sort_key)

    paths: list[str] = []
    seen: set[str] = set()
    for entry in [*readmes, *deps, *notebooks, *code]:
        if entry.path not in seen:
            seen.add(entry.path)
            paths.append(entry.path)
    return paths


def count_selectable(tree: Iterable[TreeEntry | Mapping[str, Any]]) -> int:
    """
    Number of files `select_files` would pick if no caps applied (README / dependency /
    notebook / code files). Non-selectable blobs (LICENSE, docs, YAML, ...) are not counted,
    so `count_selectable(tree) > len(select_files(tree))` means a cap really dropped files.
    """
    return len(_prioritised_paths(candidate_files(tree), capped=False))


# --- Fetching -------------------------------------------------------------------------
def extract_notebook_text(raw: str) -> str:
    """
    Reduce a Jupyter notebook to its code and markdown cell sources (outputs dropped).
    Returns an empty string if the notebook cannot be parsed.
    """
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return ""
    cells = data.get("cells") if isinstance(data, dict) else None
    if not isinstance(cells, list):
        return ""
    chunks: list[str] = []
    for index, cell in enumerate(cells, start=1):
        if not isinstance(cell, dict):
            continue
        cell_type = cell.get("cell_type")
        if cell_type not in ("code", "markdown"):
            continue
        source = cell.get("source", "")
        text = "".join(str(s) for s in source) if isinstance(source, list) else str(source)
        if not text.strip():
            continue
        chunks.append(f"# %% [{cell_type} cell {index}]\n{text.rstrip()}")
    return "\n\n".join(chunks)


def raw_file_url(owner: str, repo: str, ref: str, path: str) -> str:
    """raw.githubusercontent.com URL for a file at `ref`."""
    return (
        f"{GITHUB_RAW_BASE}/{quote(owner, safe='')}/{quote(repo, safe='')}/"
        f"{quote(ref, safe='')}/{quote(path, safe='/')}"
    )


class _FileTooLargeError(Exception):
    """A raw file exceeded its byte limit while streaming."""


async def _get_limited(
    client: httpx.AsyncClient, url: str, max_bytes: int
) -> tuple[int, bytes | None]:
    """
    Stream a raw (non-API) GET, aborting once more than `max_bytes` have been read.

    Returns:
        (status code, body) — body is None for error statuses.

    Raises:
        _FileTooLargeError: the body (or its declared Content-Length) exceeds `max_bytes`
        GitHubError: network failures
    """
    _assert_allowed_url(httpx.URL(url))
    try:
        async with client.stream("GET", url) as response:
            if response.status_code >= 400:
                return response.status_code, None
            declared = response.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > max_bytes:
                raise _FileTooLargeError()
            chunks: list[bytes] = []
            received = 0
            async for chunk in response.aiter_bytes():
                received += len(chunk)
                if received > max_bytes:
                    raise _FileTooLargeError()
                chunks.append(chunk)
            return response.status_code, b"".join(chunks)
    except DisallowedHostError:
        raise
    except httpx.HTTPError as exc:
        raise GitHubError(log_detail=f"GitHub request failed: {type(exc).__name__}") from exc


async def _fetch_one(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    owner: str,
    repo: str,
    ref: str,
    path: str,
) -> str | None:
    notebook = _is_notebook(path)
    # Non-notebooks keep the historical 2x slack over the tree-reported size cap.
    max_bytes = MAX_NOTEBOOK_BYTES if notebook else MAX_FILE_BYTES * 2
    async with semaphore:
        try:
            status, body = await _get_limited(
                client, raw_file_url(owner, repo, ref, path), max_bytes
            )
        except GitHubError:
            logger.warning("Fetching a repo file failed (network error); skipping it")
            return None
        except _FileTooLargeError:
            logger.warning("Repo file exceeded %d bytes while fetching; skipping it", max_bytes)
            return None
    if status == 429:
        raise GitHubRateLimitError(log_detail="raw.githubusercontent.com rate limit")
    if body is None:
        logger.warning("Fetching a repo file failed with HTTP %s; skipping it", status)
        return None
    if b"\x00" in body[:8000]:
        return None  # binary
    text = body.decode("utf-8", errors="replace")
    if notebook:
        text = extract_notebook_text(text)
    return text


def apply_char_budget(
    files: Sequence[RepoFile], max_total_chars: int
) -> tuple[list[RepoFile], bool]:
    """
    Enforce the overall character budget in priority order. A single file may use at most a
    quarter of the budget (min 2,000 chars) so README/config/code all get a look.

    Returns:
        (files kept, whether anything was truncated or dropped)
    """
    per_file_cap = max(2000, max_total_chars // 4)
    kept: list[RepoFile] = []
    used = 0
    truncated = False
    for repo_file in files:
        remaining = max_total_chars - used
        if remaining <= 200:
            truncated = True
            break
        content = repo_file.content
        cap = min(per_file_cap, remaining)
        if len(content) > cap:
            content = content[:cap] + TRUNCATION_MARKER
            truncated = True
        kept.append(RepoFile(path=repo_file.path, content=content))
        used += len(content)
    return kept, truncated


async def fetch_files(
    client: httpx.AsyncClient,
    owner: str,
    repo: str,
    ref: str,
    paths: Sequence[str],
    max_total_chars: int | None = None,
) -> FetchResult:
    """
    Fetch `paths` from raw.githubusercontent.com concurrently (semaphore of 8), extract
    notebook sources, drop empty/binary files and apply the `MAX_TOTAL_CHARS` budget.

    Raises:
        GitHubRateLimitError: if raw.githubusercontent.com returns 429
    """
    budget = settings.MAX_TOTAL_CHARS if max_total_chars is None else max_total_chars
    semaphore = asyncio.Semaphore(FETCH_CONCURRENCY)
    contents = await asyncio.gather(
        *(_fetch_one(client, semaphore, owner, repo, ref, path) for path in paths)
    )
    fetched = [
        RepoFile(path=path, content=content)
        for path, content in zip(paths, contents, strict=True)
        if content is not None and content.strip()
    ]
    kept, truncated = apply_char_budget(fetched, budget)
    return FetchResult(files=kept, truncated=truncated)
