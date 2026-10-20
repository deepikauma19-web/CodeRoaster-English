"""Cheap static checks on a repo (README, .gitignore, tests, committed .env, secrets).

Detected secrets are only ever stored/returned in masked form (e.g. `sk-...abcd`).
`redact_secrets` is also used to scrub file contents before they go to the LLM and to
scrub LLM output before it is stored.
"""

import posixpath
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from pydantic import BaseModel, Field

from app.services.github_service import RepoFile

MAX_SECRETS_REPORTED = 20

PLACEHOLDER_HINTS = (
    "your",
    "xxx",
    "example",
    "placeholder",
    "changeme",
    "change-me",
    "change_me",
    "dummy",
    "sample",
    "replace",
    "<",
    "${",
    "{{",
    "...",
    "****",
)


class MaskedSecret(BaseModel):
    """A detected secret, masked, with the file it was found in."""

    kind: str
    masked: str
    file_path: str


class RepoSignals(BaseModel):
    """Static signals passed to the LLM alongside the files."""

    has_readme: bool = False
    readme_length: int = 0
    has_gitignore: bool = False
    has_requirements: bool = False
    has_tests: bool = False
    env_file_committed: bool = False
    secrets_found: list[MaskedSecret] = Field(default_factory=list)
    notebook_only: bool = False


@dataclass(frozen=True)
class _SecretPattern:
    kind: str
    regex: re.Pattern[str]
    group: int = 0  # capture group holding the secret value
    heuristic: bool = False  # key=value style match: apply code-vs-secret heuristics


SECRET_PATTERNS: tuple[_SecretPattern, ...] = (
    _SecretPattern(
        "openai_api_key", re.compile(r"\bsk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{20,}")
    ),
    _SecretPattern("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}")),
    _SecretPattern(
        "github_token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})")
    ),
    _SecretPattern("huggingface_token", re.compile(r"\bhf_[A-Za-z0-9]{30,}")),
    _SecretPattern("aws_access_key_id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    _SecretPattern(
        "aws_secret_access_key",
        re.compile(
            r"(?i)aws_secret_access_key\s*[=:]\s*[\"']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])"
        ),
        group=1,
    ),
    _SecretPattern(
        "generic_secret",
        re.compile(
            r"(?i)\b[A-Za-z0-9_]*(?:api[_-]?key|secret|token|passw(?:or)?d)[A-Za-z0-9_]*"
            r"[\"']?\s*[=:]\s*[\"']([^\"'\s]{8,})[\"']"
        ),
        group=1,
        heuristic=True,
    ),
    _SecretPattern(
        "env_secret",
        re.compile(
            r"(?im)^\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*"
            r"\s*=\s*[\"']?([^\s\"'#]{8,})"
        ),
        group=1,
        heuristic=True,
    ),
)


def mask_secret(value: str) -> str:
    """Mask a secret, revealing at most a short prefix and suffix (`sk-...abcd`)."""
    if len(value) >= 20:
        return f"{value[:3]}...{value[-4:]}"
    if len(value) >= 12:
        return f"{value[:2]}...{value[-2:]}"
    return "***"


def _looks_like_placeholder(value: str, *, heuristic: bool = False) -> bool:
    """True if `value` is a placeholder, or (for key=value matches) looks like code."""
    lowered = value.lower()
    if any(hint in lowered for hint in PLACEHOLDER_HINTS):
        return True
    if not heuristic:
        return False
    # ALL_CAPS identifiers are env var *names*, not values (e.g. "OPENAI_API_KEY").
    if re.fullmatch(r"[A-Z0-9_]+", value) and "_" in value:
        return True
    # Attribute access / function calls / subscripts (`os.environ["KEY"]`,
    # `config['SECRET']`) / pure numbers are not secrets.
    if re.fullmatch(r"[\w.]+[(\[].*", value) or value.isdigit():
        return True
    # Version specifiers ("^1.2.3", ">=0.15.0") and plain identifiers / dotted attribute
    # paths ("settings.SECRET_KEY", "input_password") are code, not secrets.
    if re.fullmatch(r"[\^~>=<!]*\d+(?:\.\d+)+[\w.+-]*", value):
        return True
    if not value.startswith("eyJ") and re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+", value):
        return True
    if re.fullmatch(r"[a-z_]+", value):
        return True
    return len(set(value)) <= 3


def _iter_secret_spans(text: str) -> list[tuple[int, int, str, str]]:
    """Find non-overlapping secret spans → (start, end, kind, value)."""
    spans: list[tuple[int, int, str, str]] = []
    for pattern in SECRET_PATTERNS:
        for match in pattern.regex.finditer(text):
            value = match.group(pattern.group)
            if not value or _looks_like_placeholder(value, heuristic=pattern.heuristic):
                continue
            start, end = match.span(pattern.group)
            if any(start < s_end and s_start < end for s_start, s_end, _, _ in spans):
                continue
            spans.append((start, end, pattern.kind, value))
    spans.sort(key=lambda span: span[0])
    return spans


def find_secrets(text: str, file_path: str) -> list[MaskedSecret]:
    """Detect secrets in `text`; returns masked results only."""
    return [
        MaskedSecret(kind=kind, masked=mask_secret(value), file_path=file_path)
        for _, _, kind, value in _iter_secret_spans(text)
    ]


def redact_secrets(text: str, masker: Callable[[str], str] = mask_secret) -> str:
    """Replace every secret-looking value in `text` with its masked form."""
    spans = _iter_secret_spans(text)
    if not spans:
        return text
    parts: list[str] = []
    cursor = 0
    for start, end, _, value in spans:
        parts.append(text[cursor:start])
        parts.append(masker(value))
        cursor = end
    parts.append(text[cursor:])
    return "".join(parts)


# --- Path-based signals ---------------------------------------------------------------
_TEST_PATH_RE = re.compile(
    r"(?:^|/)(?:tests?|__tests__|spec)/|(?:^|/)test_[^/]+\.py$|_test\.py$|\.(?:test|spec)\.[jt]sx?$"
)
_ENV_SAFE_SUFFIXES = (".example", ".sample", ".template", ".dist", ".defaults")


def _basename(path: str) -> str:
    return posixpath.basename(path).lower()


def is_env_file(path: str) -> bool:
    """True for committed env files (`.env`, `.env.local`, …) but not `.env.example`."""
    name = _basename(path)
    if name != ".env" and not name.startswith(".env."):
        return False
    return not name.endswith(_ENV_SAFE_SUFFIXES)


def _is_readme(path: str) -> bool:
    return _basename(path).startswith("readme")


def _is_requirements(path: str) -> bool:
    name = _basename(path)
    return (name.startswith("requirements") and name.endswith(".txt")) or name in {
        "pyproject.toml",
        "pipfile",
        "setup.py",
        "setup.cfg",
        "environment.yml",
        "package.json",
    }


def compute_signals(tree_paths: Sequence[str], files: Sequence[RepoFile]) -> RepoSignals:
    """
    Compute repo signals.

    Args:
        tree_paths: every blob path in the repo tree (used for presence checks)
        files: the fetched files (used for README length and secret scanning)
    """
    paths = list(tree_paths)
    root_readmes = [p for p in paths if "/" not in p and _is_readme(p)]
    readme_file = next(
        (f for f in files if "/" not in f.path and _is_readme(f.path)),
        next((f for f in files if _is_readme(f.path)), None),
    )

    has_py = any(p.lower().endswith(".py") for p in paths)
    has_notebook = any(p.lower().endswith(".ipynb") for p in paths)

    secrets: list[MaskedSecret] = []
    seen: set[tuple[str, str]] = set()
    for repo_file in files:
        for secret in find_secrets(repo_file.content, repo_file.path):
            key = (secret.masked, secret.file_path)
            if key in seen:
                continue
            seen.add(key)
            secrets.append(secret)
    return RepoSignals(
        has_readme=bool(root_readmes) or any(_is_readme(p) for p in paths),
        readme_length=len(readme_file.content) if readme_file else 0,
        has_gitignore=any(_basename(p) == ".gitignore" for p in paths),
        has_requirements=any(_is_requirements(p) for p in paths),
        has_tests=any(_TEST_PATH_RE.search(p.lower()) for p in paths),
        env_file_committed=any(is_env_file(p) for p in paths),
        secrets_found=secrets[:MAX_SECRETS_REPORTED],
        notebook_only=has_notebook and not has_py,
    )
