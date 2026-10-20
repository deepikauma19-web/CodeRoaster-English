"""Secret detection/masking, false-positive heuristics and repo signals."""

import pytest

from app.services.github_service import RepoFile
from app.services.signals_service import (
    compute_signals,
    find_secrets,
    is_env_file,
    mask_secret,
    redact_secrets,
)

OPENAI_KEY = "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789wxyz"
GITHUB_PAT = "ghp_" + "A1b2C3d4E5" * 4
AWS_ID = "AKIA" + "IOSFODNN7EXAMPLF"


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        (f'client = OpenAI(api_key="{OPENAI_KEY}")', "openai_api_key"),
        (f"token = '{GITHUB_PAT}'", "github_token"),
        ("GOOGLE = 'AIza" + "B" * 35 + "'", "google_api_key"),
        ("HF = 'hf_" + "q" * 34 + "'", "huggingface_token"),
        (f"key_id = {AWS_ID}", "aws_access_key_id"),
        (
            "aws_secret_access_key = " + "wJalrXUtnFEMI/K7MDENG/" + "bPxRfiCY" + "z" * 10,
            "aws_secret_access_key",
        ),
        ('db_password = "Tr0ub4dor&3xyz"', "generic_secret"),
        ("DB_PASSWORD=s3cr3tPassw0rd!", "env_secret"),
    ],
)
def test_detects_secrets(text: str, kind: str) -> None:
    found = find_secrets(text, "app.py")
    assert [s.kind for s in found] == [kind]
    assert found[0].file_path == "app.py"
    # The raw secret is never present in the masked result.
    assert found[0].masked not in text or found[0].masked == "***"


def test_openai_key_masked_format() -> None:
    [secret] = find_secrets(f"KEY = '{OPENAI_KEY}'", "config.py")
    assert secret.masked == "sk-...wxyz"
    assert OPENAI_KEY not in secret.model_dump_json()


@pytest.mark.parametrize(
    "text",
    [
        "api_key = settings.OPENAI_API_KEY",
        'api_key = os.getenv("OPENAI_API_KEY")',
        "SECRET_KEY=settings.SECRET_KEY",
        'password = "your-password-here"',
        "OPENAI_API_KEY=sk-...",
        "OPENAI_API_KEY=<your-key>",
        "API_KEY=${API_KEY}",
        'token = "xxxxxxxxxxxx"',
        'secret_version: "^1.2.3"',
        'token_type = "input_password"',
        "MAX_TOKENS=4096000",
        'password_field = "OPENAI_API_KEY"',
        "def get_token(self): return self.token",
    ],
)
def test_false_positives_ignored(text: str) -> None:
    assert find_secrets(text, "x.py") == []
    assert redact_secrets(text) == text


@pytest.mark.parametrize(
    ("value", "masked"),
    [("a" * 25 + "WXYZ", "aaa...WXYZ"), ("abcdefghijkl", "ab...kl"), ("short", "***")],
)
def test_mask_secret(value: str, masked: str) -> None:
    assert mask_secret(value) == masked


def test_redact_secrets_replaces_every_occurrence() -> None:
    text = f"a = '{OPENAI_KEY}'\nb = '{GITHUB_PAT}'\n"
    redacted = redact_secrets(text)
    assert OPENAI_KEY not in redacted and GITHUB_PAT not in redacted
    assert "sk-...wxyz" in redacted
    assert redacted.startswith("a = '") and redacted.endswith("'\n")


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        (".env", True),
        ("backend/.env", True),
        (".env.local", True),
        (".env.production", True),
        (".env.example", False),
        (".env.sample", False),
        ("config/.env.template", False),
        ("env.py", False),
        ("environment.yml", False),
    ],
)
def test_is_env_file(path: str, expected: bool) -> None:
    assert is_env_file(path) is expected


def test_compute_signals() -> None:
    paths = [
        "README.md",
        ".gitignore",
        "requirements.txt",
        ".env",
        "tests/test_app.py",
        "app.py",
    ]
    files = [
        RepoFile("README.md", "# Title\nhello"),
        RepoFile(".env", f"OPENAI_API_KEY={OPENAI_KEY}\n"),
        RepoFile("app.py", f"KEY = '{OPENAI_KEY}'\nKEY2 = '{OPENAI_KEY}'"),
    ]
    signals = compute_signals(paths, files)
    assert signals.has_readme and signals.readme_length == len("# Title\nhello")
    assert signals.has_gitignore and signals.has_requirements and signals.has_tests
    assert signals.env_file_committed is True
    assert signals.notebook_only is False
    # Deduplicated per (masked, file): one in .env, one in app.py.
    assert sorted(s.file_path for s in signals.secrets_found) == [".env", "app.py"]
    assert OPENAI_KEY not in signals.model_dump_json()


def test_compute_signals_bare_notebook_repo() -> None:
    signals = compute_signals(["analysis.ipynb", "docs/readme.txt"], [])
    assert signals.notebook_only is True
    assert signals.has_readme is True and signals.readme_length == 0
    assert not (signals.has_gitignore or signals.has_requirements or signals.has_tests)
    assert signals.env_file_committed is False


@pytest.mark.parametrize(
    "path", ["src/__tests__/a.js", "foo_test.py", "web/app.spec.ts", "test/x.py", "test_x.py"]
)
def test_test_detection(path: str) -> None:
    assert compute_signals([path], []).has_tests is True


@pytest.mark.parametrize(
    "text",
    [
        'OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]',
        "SECRET_KEY=app_config['SECRET_KEY']",
    ],
)
def test_env_subscript_is_not_a_secret(text: str) -> None:
    assert find_secrets(text, "config.py") == []
