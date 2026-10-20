# INITIAL.md - Code Roaster Product Definition

> Paste a public GitHub repo, get your code analysed and roasted in funny, human-sounding English, with a score and tips to improve.

---

## PRODUCT

### Name
Code Roaster

### Description
Code Roaster is a fun but useful code review tool for people learning AI development. A user signs in with their Gmail account and pastes the URL of a public GitHub repository, usually a course assignment or side project. The app fetches the repo, analyses the code with OpenAI GPT, and returns:

- A **funny English roast**: a witty, human-sounding roast in plain English. It roasts the code, never the person.
- A **score out of 100**, broken down by category: code quality, project structure, documentation, AI/LLM best practices, and security.
- **Actionable tips** that tell the learner exactly what to fix next.

Users choose the roast intensity (Mild, Medium, or Extra Spicy). They can also share a roast as a public card on LinkedIn, WhatsApp, or X.

### Target User
People learning AI development (students, bootcamp learners, self-taught developers) who want honest, entertaining feedback on their assignments and projects.

### Type
- [x] SaaS (Software as a Service)

---

## TECH STACK

### Backend
- [x] FastAPI + Python 3.11+

### Frontend
- [x] React + Vite + TypeScript

### Database
- [x] PostgreSQL + SQLAlchemy + Alembic

### Authentication
- [x] Google OAuth only (Gmail sign-in) + JWT session tokens

### UI Framework
- [x] Chakra UI + Framer Motion

### AI / LLM
- [x] OpenAI GPT (via the official `openai` Python SDK, model configured through an env var)

### External APIs
- [x] GitHub REST API (public repos; optional token for higher rate limits)

### Payments
- [ ] None (free product)

---

## MODULES

### Module 1: Authentication (Required)

**Description:** Google-only sign-in. There are no passwords. The first login creates the user automatically.

**Models:**
- User: id, email (unique), full_name, avatar_url, google_id (unique), is_active, is_admin, created_at, last_login_at
- RefreshToken: id, user_id, token_hash, expires_at, revoked, created_at

**API Endpoints:**
- GET /api/v1/auth/google/login - Redirect to Google consent screen (with `state` for CSRF protection)
- GET /api/v1/auth/google/callback - Handle the OAuth callback, upsert the user, issue JWT access and refresh tokens
- POST /api/v1/auth/refresh - Refresh the access token
- POST /api/v1/auth/logout - Revoke the refresh token
- GET /api/v1/auth/me - Get the current user's profile

**Frontend Pages:**
- /login - Landing and login page with a "Sign in with Google" button
- /auth/callback - Handles the OAuth redirect and stores tokens
- /profile - User profile (protected)

---

### Module 2: Roast (Core)

**Description:** Submit a public GitHub repo, then fetch and analyse its code with GPT. Returns an English roast, a score, and improvement tips.

**Models:**
- Roast:
  - id, user_id (FK → users)
  - repo_url, repo_owner, repo_name, default_branch, commit_sha
  - intensity: `mild` | `medium` | `extra_spicy`
  - status: `pending` | `fetching` | `analyzing` | `completed` | `failed`
  - overall_score (0–100)
  - score_breakdown (JSON): code_quality, structure, documentation, ai_best_practices, security (each 0–20)
  - roast_text (English roast, markdown)
  - summary (short English summary of what the repo does)
  - tips (JSON list of `{title, description, priority: high|medium|low, file_path?}`)
  - files_analyzed (int), language_breakdown (JSON)
  - model_used, prompt_tokens, completion_tokens
  - error_message (nullable)
  - created_at, completed_at

**Processing Pipeline (background task):**
1. Validate the URL (`https://github.com/{owner}/{repo}` only) and confirm the repo is public through the GitHub API.
2. Fetch the repo tree and select relevant files: README, dependency files (`requirements.txt`, `package.json`, `pyproject.toml`), notebooks, and source files. Skip binaries, `node_modules`, `venv`, lockfiles, and data files. Enforce caps on file count and total characters.
3. Detect quick signals before calling the LLM: hardcoded API keys or secrets, a missing README, a missing `.gitignore`, a missing requirements file, and committed `.env` files.
4. Send the selected code and signals to OpenAI GPT with an intensity-specific system prompt. Request structured JSON output (roast, scores, tips, summary).
5. Validate the response with Pydantic, save the result, and set the status to `completed`. On any error, set the status to `failed` with a message.

**API Endpoints:**
- POST /api/v1/roasts - Submit `{repo_url, intensity}` → 202 with roast id (starts the background analysis)
- GET /api/v1/roasts/{id} - Get the roast result (owner only)
- GET /api/v1/roasts/{id}/status - Lightweight status for frontend polling
- POST /api/v1/roasts/{id}/retry - Retry a failed roast
- DELETE /api/v1/roasts/{id} - Delete a roast

**Frontend Pages:**
- /roast/new - Repo URL input, intensity selector, and "Roast Me" button (protected)
- /roasts/:id - Roast result page: animated loading states ("Code-a padikkuren da…"), score gauge, category breakdown, roast text, and tips checklist (protected)

---

### Module 3: Roast Intensity

**Description:** Users choose how spicy the roast should be. Intensity changes only the tone. Scoring and tips are identical for every level.

**Levels:**
- 🌶️ **Mild**: Friendly senior mentor. Gentle teasing, mostly encouragement.
- 🌶️🌶️ **Medium**: Classic college-friend roast. Funny and direct.
- 🌶️🌶️🌶️ **Extra Spicy**: Full stand-up comic roast. Savage, but still roasting the code, never the person.

**Implementation:**
- `intensity` enum on Roast (see Module 2)
- One system prompt template per intensity in `backend/app/services/prompts/`
- Intensity selector component (Chakra `RadioGroup` styled as chili cards) on /roast/new

---

### Module 4: Shareable Roast Cards

**Description:** The owner can make a roast public. Anyone with the link can view it without logging in.

**Model additions (on Roast):**
- is_public (bool, default false)
- share_slug (unique, random, URL-safe, generated when first shared)

**API Endpoints:**
- PATCH /api/v1/roasts/{id}/share - Toggle `is_public` (owner only), returns share URL
- GET /api/v1/public/roasts/{share_slug} - Public roast view (no auth). Returns only safe fields: repo name, score, breakdown, roast text, and the user's first name. Never returns the email.
- GET /api/v1/public/roasts/{share_slug}/card.png - Generated OG image card (score, repo name, top roast line) for social previews

**Frontend Pages:**
- /r/:shareSlug - Public roast page with Open Graph meta tags and a "Roast your own repo" CTA
- Share buttons on /roasts/:id: Copy link, WhatsApp, LinkedIn, X

---

### Module 5: Admin Panel

**Description:** Admin-only management interface. Admins are users with `is_admin = true`, seeded through `ADMIN_EMAILS`.

**API Endpoints:**
- GET /api/v1/admin/users - List all users (paginated, searchable)
- PUT /api/v1/admin/users/{id} - Activate or deactivate a user, or toggle admin
- GET /api/v1/admin/roasts - List all roasts (filter by status, user, date)
- DELETE /api/v1/admin/roasts/{id} - Remove an inappropriate or abusive roast
- GET /api/v1/admin/stats - Platform stats: total users, roasts today/total, avg score, failure rate, token usage

**Frontend Pages:**
- /admin - Admin dashboard with stat cards (protected, admin only)
- /admin/users - User management table
- /admin/roasts - Roast moderation table

---

### Module 6: Roast History / Dashboard (Post-MVP)

**Description:** A personal dashboard of past roasts and progress over time.

**API Endpoints:**
- GET /api/v1/roasts - List the current user's roasts (paginated, newest first)
- GET /api/v1/roasts/stats - User stats: total roasts, best score, average score, score trend
- POST /api/v1/roasts/{id}/reroast - Re-roast the same repo (latest commit) to compare progress

**Frontend Pages:**
- /dashboard - Score trend chart, recent roasts, best score badge
- /roasts - Full roast history list
- /settings - User preferences (default intensity)

---

## MVP SCOPE

### Must Have (MVP)
- [x] Sign in with Google (Gmail)
- [x] Submit a public GitHub repo URL and get it analysed
- [x] English roast + overall score (0–100) + category breakdown + improvement tips
- [x] Roast intensity selector (Mild / Medium / Extra Spicy)
- [x] Shareable public roast link + OG image card
- [x] Admin panel (users, roasts moderation, stats)

### Nice to Have (Post-MVP)
- [ ] Roast history and personal dashboard with score trend
- [ ] Re-roast and compare scores between commits
- [ ] Daily roast quota per user (LLM cost control)
- [ ] Email notifications ("Your roast is ready")
- [ ] Public leaderboard
- [ ] Private repo support (GitHub OAuth)

---

## ACCEPTANCE CRITERIA

### Authentication
- [ ] User can sign in with Google and lands on /roast/new
- [ ] First-time Google login creates a User record. Returning login updates `last_login_at`.
- [ ] OAuth `state` parameter is verified (CSRF protection)
- [ ] JWT access tokens expire, and refresh works correctly
- [ ] Protected routes redirect to /login. Admin routes return 403 for non-admins.
- [ ] Deactivated users cannot log in or create roasts

### Roast
- [ ] Only `https://github.com/{owner}/{repo}` URLs are accepted. Invalid URLs return 400 with a helpful message.
- [ ] Private or non-existent repos fail with a clear error (with a clear English explanation)
- [ ] Large repos are truncated to the file and character caps without crashing
- [ ] Roast completes and shows: overall score, 5-category breakdown, English roast, 3–7 tips
- [ ] Frontend polls status and shows fun loading messages until the roast completes or fails
- [ ] Failed roasts show the error and a Retry button
- [ ] Users can only view, retry, or delete their own roasts

### Roast Intensity
- [ ] All three intensities produce noticeably different tones
- [ ] The same repo gets a similar score regardless of intensity
- [ ] No intensity produces slurs or attacks on caste, religion, gender, appearance, or other personal traits

### Shareable Roast Cards
- [ ] Roasts are private by default
- [ ] Owner can toggle sharing on or off, and the link stops working when it is turned off
- [ ] Public page loads without login and never exposes the email or user id
- [ ] OG card image renders and shows a preview when pasted into WhatsApp, LinkedIn, or X

### Admin Panel
- [ ] Only `is_admin` users can access /admin and /api/v1/admin/*
- [ ] Admin can deactivate users and delete roasts
- [ ] Stats page shows accurate counts and token usage

### Quality
- [ ] All API endpoints documented in OpenAPI
- [ ] Backend test coverage 80%+ (GitHub and OpenAI calls mocked)
- [ ] Frontend TypeScript strict mode passes
- [ ] Docker builds and runs successfully

---

## SPECIAL REQUIREMENTS

### Security
- [x] Rate limiting on auth endpoints and on POST /roasts
- [x] Input validation on all endpoints (strict GitHub URL regex, enum intensity)
- [x] SQL injection prevention (SQLAlchemy ORM only)
- [x] XSS prevention (roast markdown rendered with sanitization)
- [x] CSRF protection through the OAuth `state` parameter
- [x] **Prompt-injection defence:** repo contents are untrusted data. They are wrapped in delimiters, and the system prompt tells the model to ignore any instructions found inside the code.
- [x] Never echo detected secrets back in full. Mask them (e.g. `sk-...abcd`) in tips and roasts.
- [x] Fetch only from `api.github.com` / `raw.githubusercontent.com` (no arbitrary URL fetching, to prevent SSRF)

### Content Safety
- [x] Roast the code, never the person
- [x] No slurs or content about caste, religion, gender, body, or region
- [x] Roast written in clear, natural English

### Integrations
- [ ] Email service for notifications (post-MVP)
- [ ] Payments (none)
- [x] OpenAI API for analysis and roast generation
- [x] GitHub REST API for repo fetching
- [x] OG image generation (Pillow on the backend)

---

## AGENTS

> These 6 agents will build your product in parallel:

| Agent | Role | Works On |
|-------|------|----------|
| DATABASE-AGENT | Creates all models and migrations | User, RefreshToken, Roast |
| BACKEND-AGENT | Builds API endpoints and services | Auth, GitHub fetcher, OpenAI roast service, share, admin |
| FRONTEND-AGENT | Creates UI pages and components | Login, roast form, result page, public share page, admin |
| DEVOPS-AGENT | Sets up Docker, CI/CD, environments | Infrastructure |
| TEST-AGENT | Writes unit and integration tests | All code (mocked GitHub/OpenAI) |
| REVIEW-AGENT | Security and code quality audit | All code, especially prompt-injection and secret handling |

---

# READY?

```bash
/generate-prp INITIAL.md
```

Then:

```bash
/execute-prp PRPs/code-roaster-prp.md
```
