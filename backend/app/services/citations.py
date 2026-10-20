"""Check that file paths cited by the LLM really exist in the repository.

A roast that cites `utils/helpers.py` when there is no such file kills the joke and the
credibility. Only backticked, file-looking tokens are checked, and conventional files that a
roast may legitimately point out as *missing* (README, .gitignore, requirements, ...) are
never flagged.
"""

import posixpath
import re
from collections.abc import Iterable

_BACKTICK_RE = re.compile(r"`([^`\n]{1,200})`")
_LINE_SUFFIX_RE = re.compile(r"[:#].*$")

CITABLE_EXTENSIONS: frozenset[str] = frozenset(
    {
        ".py", ".ipynb", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".yml",
        ".yaml", ".toml", ".cfg", ".ini", ".md", ".txt", ".sh", ".html", ".css", ".scss",
        ".java", ".kt", ".go", ".rs", ".rb", ".php", ".c", ".cc", ".cpp", ".h", ".hpp",
        ".cs", ".swift", ".sql", ".lock", ".env",
    }
)  # fmt: skip

_CONVENTIONAL_PREFIXES = ("readme", "license", "licence", ".env", "docker-compose", "requirements")
_CONVENTIONAL_NAMES = frozenset(
    {
        ".gitignore", ".dockerignore", "dockerfile", "makefile", "pyproject.toml", "package.json",
        "setup.py", "setup.cfg", "tox.ini", "contributing.md", "changelog.md",
        ".pre-commit-config.yaml",
    }
)  # fmt: skip


def normalize_path(token: str) -> str:
    """Strip whitespace, a leading `./`, trailing `()` and any `:line` / `#L12` suffix."""
    text = token.strip().removesuffix("()")
    text = _LINE_SUFFIX_RE.sub("", text).strip()
    return text.removeprefix("./")


def looks_like_path(text: str) -> bool:
    """True for a single token whose file name has a well-known source/doc extension."""
    if not text or any(ch.isspace() for ch in text):
        return False
    return posixpath.splitext(posixpath.basename(text))[1].lower() in CITABLE_EXTENSIONS


def is_conventional(path: str) -> bool:
    """Conventional files (README, .gitignore, ...) may be cited as missing, so never flag."""
    base = posixpath.basename(path).lower()
    return (
        base in _CONVENTIONAL_NAMES
        or base.startswith(_CONVENTIONAL_PREFIXES)
        or path.startswith(".github/")
    )


def extract_cited_paths(text: str) -> list[str]:
    """Unique, ordered file-looking paths found in backticks in `text`."""
    found: list[str] = []
    for match in _BACKTICK_RE.finditer(text):
        candidate = normalize_path(match.group(1))
        if looks_like_path(candidate) and candidate not in found:
            found.append(candidate)
    return found


def unknown_paths(cited: Iterable[str], known_paths: Iterable[str]) -> list[str]:
    """Cited paths that match no known repo path (exact, or as a path suffix / bare file
    name), ignoring conventional files. Order is preserved."""
    known = {normalize_path(p) for p in known_paths}
    basenames = {posixpath.basename(p) for p in known}
    missing: list[str] = []
    for raw in cited:
        path = normalize_path(raw)
        if not path or is_conventional(path) or path in known:
            continue
        if "/" not in path and path in basenames:
            continue
        if "/" in path and any(k.endswith("/" + path) for k in known):
            continue
        if path not in missing:
            missing.append(path)
    return missing
