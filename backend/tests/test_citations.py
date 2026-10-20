"""Cited-file validation helpers."""

import pytest

from app.services.citations import (
    extract_cited_paths,
    is_conventional,
    normalize_path,
    unknown_paths,
)

KNOWN = ["app.py", "src/main.py", "tests/test_a.py", "docs/guide.md"]


def test_extract_only_backticked_file_like_tokens() -> None:
    text = (
        "See `app.py:12`, `utils/helpers.py`, `os.environ`, `pass`, `README.md`, "
        "`./src/main.py()`, `.py`, **bold.py** and `tests/test_a.py#L4`."
    )
    assert extract_cited_paths(text) == [
        "app.py",
        "utils/helpers.py",
        "README.md",
        "src/main.py",
        "tests/test_a.py",
    ]


def test_extract_deduplicates_and_handles_empty() -> None:
    assert extract_cited_paths("`a.py` and `a.py` again") == ["a.py"]
    assert extract_cited_paths("") == []


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("./a.py", "a.py"), ("  a.py:10-20 ", "a.py"), ("f.py()", "f.py"), ("x.py#L9", "x.py")],
)
def test_normalize_path(raw: str, expected: str) -> None:
    assert normalize_path(raw) == expected


def test_unknown_paths_matching_rules() -> None:
    cited = ["app.py", "main.py", "src/main.py", "main/ghost.py", "utils/helpers.py", "guide.md"]
    # exact, bare file name, exact path and path-suffix matches pass; ghosts are returned once.
    assert unknown_paths(cited + ["utils/helpers.py"], KNOWN) == [
        "main/ghost.py",
        "utils/helpers.py",
    ]


def test_path_suffix_match() -> None:
    assert unknown_paths(["backend/src/main.py"], KNOWN) == ["backend/src/main.py"]
    assert unknown_paths(["main.py"], KNOWN) == []
    assert unknown_paths(["tests/test_a.py"], ["backend/tests/test_a.py"]) == []


@pytest.mark.parametrize(
    "path",
    ["README.md", "readme.rst", "LICENSE", ".gitignore", ".env", ".env.example", "Dockerfile",
     "requirements-dev.txt", "pyproject.toml", ".github/workflows/ci.yml", "docker-compose.yml"],
)  # fmt: skip
def test_conventional_files_are_never_flagged(path: str) -> None:
    assert is_conventional(path)
    assert unknown_paths([path], []) == []


def test_non_conventional_missing_file_is_flagged() -> None:
    assert not is_conventional("utils/helpers.py")
    assert unknown_paths(["utils/helpers.py"], []) == ["utils/helpers.py"]
