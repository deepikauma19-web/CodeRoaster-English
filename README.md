<div align="center">

<img src="docs/banner.png" alt="Code Roaster: paste a GitHub repo, get roasted in English" width="100%" />

# 🔥 Code Roaster

**We roast your code, you improve it!**
Paste a public GitHub repo. Get an honest (and spicy) **funny English** roast, a **score out of 100** and **tips to improve**.

<a href="https://roaster.getvibed.tech"><img src="https://img.shields.io/badge/%F0%9F%94%A5%20Try%20it%20live-roaster.getvibed.tech-f9620f?style=for-the-badge" alt="Try it live" /></a>

<img src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white" alt="React" />
<img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
<img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite" />
<img src="https://img.shields.io/badge/Chakra_UI-2-319795?logo=chakraui&logoColor=white" alt="Chakra UI" />
<img src="https://img.shields.io/badge/FastAPI-0.143-009688?logo=fastapi&logoColor=white" alt="FastAPI" />
<img src="https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white" alt="Python" />
<img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL" />
<img src="https://img.shields.io/badge/OpenAI-GPT-412991?logo=openai&logoColor=white" alt="OpenAI" />
<img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" alt="Docker" />

[Features](#-features) · [How it works](#-how-it-works) · [Architecture](#-architecture) · [Tech stack](#-tech-stack) · [Run locally](#-run-locally) · [Deploy](#-deployment)

</div>

---

## ✨ Features

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>🌶️ Three spice levels</h3>
      Mild, Medium or Extra Spicy. Only the <b>tone</b> changes. The score and tips stay the same.
    </td>
    <td width="33%" valign="top">
      <h3>📊 Score out of 100</h3>
      Five categories worth 20 each: code quality, structure, docs, AI best practices and security.
    </td>
    <td width="33%" valign="top">
      <h3>✅ Actionable tips</h3>
      3–7 prioritized tips in clear English, with a little humour.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h3>🔐 Secret checks</h3>
      Finds leaked API keys (always masked), a missing README and committed <code>.env</code> files.
    </td>
    <td valign="top">
      <h3>🔗 Shareable roasts</h3>
      Private by default. Share a public link with a social preview card.
    </td>
    <td valign="top">
      <h3>🛡️ Admin panel</h3>
      Users, roast moderation and platform stats, behind an admin-only guard.
    </td>
  </tr>
</table>

> Roasts target the **code, never the person**. Sign-in is **Google only**, so there are no passwords to forget.

---

## 🔄 How it works

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant FE as React app
    participant API as FastAPI
    participant GH as GitHub API
    participant AI as OpenAI
    participant DB as PostgreSQL

    U->>FE: Paste repo URL + pick spice level
    FE->>API: POST /roasts
    API->>DB: Save roast (pending)
    API-->>FE: 202 Accepted
    Note over API: Analysis runs in a background task
    API->>GH: Fetch repo tree + files
    API->>API: Pick files (caps), scan for secrets
    API->>AI: Delimited repo + prompt-injection guard
    AI-->>API: JSON roast, score, tips
    API->>API: Validate against Pydantic schema
    API->>DB: Save results (completed)
    loop Until completed or failed
        FE->>API: GET /roasts/id/status
    end
    FE-->>U: Roast, score gauge and tips
```

### Roast status

```mermaid
stateDiagram-v2
    [*] --> pending: POST /roasts
    pending --> fetching
    fetching --> analyzing
    analyzing --> completed
    fetching --> failed
    analyzing --> failed
    failed --> pending: Retry
    completed --> [*]
```

---

## 🏗️ Architecture

```mermaid
flowchart LR
    B["🌐 Browser"] -->|HTTPS| T["Traefik<br/>Let's Encrypt TLS"]
    T -->|"/"| F["Frontend<br/>React SPA on nginx"]
    T -->|"/api, /health"| A["Backend<br/>FastAPI"]
    A --> D[("PostgreSQL 16")]
    A -->|repo contents| G["GitHub REST API"]
    A -->|roast generation| O["OpenAI API"]
    A -->|sign-in| Go["Google OAuth"]

    classDef edge fill:#fff1e6,stroke:#f9620f,color:#701f12;
    classDef app fill:#e8f7f2,stroke:#319795,color:#1a4d4d;
    classDef ext fill:#eef0ff,stroke:#646cff,color:#2d2f6b;
    class T edge;
    class F,A,D app;
    class G,O,Go ext;
```

### Data model

```mermaid
erDiagram
    USERS ||--o{ ROASTS : owns
    USERS ||--o{ REFRESH_TOKENS : has

    USERS {
        int id PK
        string email
        string full_name
        string google_id
        bool is_active
        bool is_admin
    }
    ROASTS {
        int id PK
        int user_id FK
        string repo_url
        enum intensity
        enum status
        int overall_score
        json score_breakdown
        text roast_text
        json tips
        bool is_public
        string share_slug
        string model_used
    }
    REFRESH_TOKENS {
        int id PK
        int user_id FK
        string token_hash
        datetime expires_at
        bool revoked
    }
```

---

## 🧰 Tech stack

| Layer | Technology |
|:------|:-----------|
| **Frontend** | React 18 · TypeScript (strict) · Vite 8 · Chakra UI 2 · Framer Motion 14 · React Router 6 · Axios · react-markdown (sanitized) |
| **Backend** | FastAPI 0.143 · Uvicorn · Python 3.11+ · Pydantic 2 · slowapi (rate limits) · `httpx` · Pillow (share cards) |
| **Database** | PostgreSQL 16 · SQLAlchemy 2.1 · Alembic migrations · `psycopg` 3 |
| **Auth** | Google OAuth 2.0 · JWT (HS256) · refresh tokens stored hashed |
| **AI** | OpenAI Python SDK (`gpt-4o-mini` by default), output validated by Pydantic |
| **Infra** | Docker Compose · nginx · Traefik + Let's Encrypt · Ubuntu 24.04 VPS · `rsync` deploys |
| **Quality** | pytest · respx · ruff · mypy · Vitest · Testing Library · oxlint · GitHub Actions CI |

<details>
<summary><b>📈 Quality numbers</b></summary>

- Backend: **261 tests**, about **98% coverage** (CI gate is 80%).
- Frontend: **167 tests**, strict TypeScript with no `any`.
- GitHub and OpenAI are always mocked in tests.

</details>

<details>
<summary><b>🛡️ Security design</b></summary>

- The repo URL must match `^https://github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/?$`, and the backend only talks to `api.github.com` and `raw.githubusercontent.com`.
- Repo contents go to the model between `<repo>` tags, and the system prompt says to treat them as untrusted data.
- The model's output is never trusted. It is validated, and the score must equal the sum of the five categories.
- Detected secrets are masked (`sk-...abcd`) and never logged or repeated in full.
- Public endpoints never return an email or user ID. Share slugs are random, not derived from the roast ID.

</details>

---

## 🚀 Run locally

```bash
cp .env.example .env     # fill in Google, OpenAI and secret values
docker compose up -d --build
```

Open **http://localhost:3000** · API docs at **http://localhost:8000/docs**

<details>
<summary><b>🔧 Hot reload and running without Docker</b></summary>

```bash
# Hot reload (http://localhost:5173)
docker compose -f docker-compose.dev.yml up --build

# Backend without Docker
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload

# Frontend (new terminal)
cd frontend && npm install && npm run dev
```

</details>

<details>
<summary><b>⚙️ Configuration</b></summary>

| Variable | Purpose |
|:---------|:--------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SECRET_KEY` | JWT signing key (use a long random value) |
| `ADMIN_EMAILS` | Comma-separated emails that get the admin role |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `GOOGLE_REDIRECT_URI` | Must be an authorized redirect URI in your Google OAuth client |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | OpenAI access and model |
| `GITHUB_TOKEN` | Optional. Raises the GitHub rate limit from 60 to 5000 requests/hour |
| `MAX_FILES_ANALYZED` / `MAX_TOTAL_CHARS` | Caps on what is sent to the model |
| `DAILY_ROAST_LIMIT` | Roasts per user per rolling 24 hours (default 10, `0` = unlimited, admins exempt) |

**Never commit a real `.env`.** See `.env.example` and `.env.production.example`.

</details>

<details>
<summary><b>🧪 Tests and checks</b></summary>

```bash
cd backend  && ruff check . && mypy app && pytest --cov=app --cov-fail-under=80
cd frontend && npm run lint && npm run type-check && npm test && npm run build
```

</details>

---

## 📦 Deployment

Runs on a single VPS with Docker Compose. Full guide: [`deploy/README.md`](deploy/README.md).

```bash
# VPS already running Traefik (no host nginx)
PROXY=traefik DEPLOY_HOST=<VPS_IP> ./deploy/deploy.sh
```

---

## 🧱 Built with Claude Code

This app was generated from the MicroSaaS Template: **Clone → Define → Build.**

```mermaid
flowchart LR
    I["INITIAL.md<br/>product definition"] --> G["/generate-prp"]
    G --> P["PRP blueprint"]
    P --> E["/execute-prp"]
    E --> A["Phase 1 · parallel<br/>DB · Backend · Frontend · DevOps"]
    A --> B["Phase 2 · per module<br/>endpoints + pages"]
    B --> C["Phase 3 · parallel<br/>Tests · Security review"]
```

| File / folder | Purpose |
|:--------------|:--------|
| `INITIAL.md` | Product definition |
| `PRPs/code-roaster-prp.md` | Implementation blueprint |
| `CLAUDE.md` | Project rules |
| `skills/` · `agents/` · `.claude/commands/` | Code patterns, agent definitions and custom commands |

---

<div align="center">

Made with 🔥 and a lot of humour.

</div>
