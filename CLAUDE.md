# CLAUDE.md

Guidance for Claude (and other AI assistants) working in the **Fav Fifty** repository.

## What this project is

A web app where users sign in with a social account and build ranked lists of their
50 favorite things in any category (bands, desserts, video games, …). Future phases
add sharing, comments, suggestions/questions, and voting. See [README.md](README.md)
for the vision and [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) for the plan.

**Owner:** solo developer. **Audience:** small (≤10 concurrent users, mostly a Discord community).
**Priorities, in order:** rock-solid foundation → security → testability → low cost → extensibility → scalability.

## Working principles

- **Build incrementally.** Small, reviewable changes. Get a thin slice working end-to-end before adding breadth.
- **Foundation over features.** Prefer clear structure, types, and tests now over speed that creates rework later.
- **Ask before assuming on architecture.** Big decisions (DB, hosting, auth model) live in [docs/QUESTIONS.md](docs/QUESTIONS.md). Don't silently lock one in — confirm with the owner.
- **Security first — the repo is PUBLIC.** Never commit secrets. Validate all input. Treat user-supplied list/comment content as untrusted.
- **Cheap by default.** This makes no money. Favor scale-to-zero / free-tier / pay-per-use AWS services. Flag anything with a recurring fixed cost.
- **Keep docs current.** When a decision in QUESTIONS.md is resolved, move it into the relevant doc and update this file or the README.

## Stack (decided — see [docs/DECISIONS.md](docs/DECISIONS.md))

- **Frontend:** Vue 3 + Vite + TypeScript, Pinia, Vue Router, Tailwind CSS. Vitest for unit tests. ESLint + Prettier.
- **Backend:** Python + FastAPI, Pydantic v2 models. pytest for tests. Ruff for lint/format.
- **Database:** PostgreSQL on Aurora Serverless v2 (scales to zero). Alembic for migrations.
- **Auth:** Social-only login via AWS Cognito. **Google at launch**; Facebook/Apple possible later. No email/password.
- **Backend hosting:** FastAPI in Docker on AWS Lightsail Containers.
- **Infra:** AWS, defined as code with Terraform. DNS via Route 53 (domain registered at Squarespace).

## Conventions

- **Layout:** `frontend/` (Vue), `backend/` (FastAPI), `infra/` (IaC), `docs/` (planning), `tools/` (dev scripts).
- **Secrets:** local config via `.env` (git-ignored). Update [`.env.example`](.env.example) whenever a new variable is introduced. In AWS, use Secrets Manager / SSM Parameter Store, not env files.
- **Commits:** small and focused. Imperative subject lines (e.g. "Add list creation endpoint").
- **Tests:** new backend behavior ships with pytest coverage; new frontend logic with Vitest. Don't merge red.
- **Types:** TypeScript on the frontend, type hints + Pydantic on the backend. Avoid `any`.
- **Helper scripts:** Reusable, multi-step, or fiddly-to-retype commands live in `tools/` as small bash scripts (`set -euo pipefail`, a top comment saying what/why, path-independent via `REPO_ROOT`). **When you (Claude) run a command the owner may want to rerun, offer to save it to `tools/`** and add a row to [`tools/README.md`](tools/README.md). Keep each script short and readable.

## Things to never do

- Commit `.env` or any real credential, token, or key.
- Add a service with meaningful fixed monthly cost without flagging it first.
- Introduce email/password auth (explicitly out of scope — social login only).
- Make schema or API changes without considering migration and backward compatibility.

## Useful files

- [docs/NEXT_STEPS.md](docs/NEXT_STEPS.md) — phased roadmap and immediate next actions.
- [docs/QUESTIONS.md](docs/QUESTIONS.md) — open decisions awaiting the owner's call.
- [docs/CONSIDERATIONS.md](docs/CONSIDERATIONS.md) — security, cost, scaling, and legal notes.

## Commands

**Frontend** (from `frontend/`):

```bash
npm install         # install deps
npm run dev         # dev server at http://localhost:5173 (proxies /api -> :8000)
npm run build       # type-check (vue-tsc) + production build
npm run test        # Vitest (once); npm run test:watch for watch mode
npm run lint        # ESLint  (lint:fix to autofix)
npm run format      # Prettier write  (format:check for CI)
```

**Backend** (from `backend/`, using [uv](https://docs.astral.sh/uv/)):

```bash
uv sync --extra dev                   # create venv + install deps
uv run uvicorn app.main:app --reload  # serve at http://localhost:8000 (/docs for Swagger)
uv run pytest                         # tests
uv run ruff check . && uv run ruff format .   # lint + format
uv run alembic upgrade head           # apply DB migrations
```

**Local database** (from repo root):

```bash
docker compose up -d db     # start Postgres   (down to stop, down -v to wipe)
```

**Helper scripts** (`tools/`, run from anywhere — see [`tools/README.md`](tools/README.md)):

```bash
./tools/db_up.sh            # start Postgres and wait until healthy
./tools/verify_alembic.sh   # read-only: show DB migration + tables
./tools/db_reset.sh         # wipe local DB and rebuild from migrations (destructive)
./tools/check.sh            # run CI checks locally (ruff+pytest, lint+vitest)
```

> No deploy commands yet — added when `infra/` and the deploy pipeline land.
