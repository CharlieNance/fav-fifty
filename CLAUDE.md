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

- **Layout:** `frontend/` (Vue), `backend/` (FastAPI), `infra/` (IaC), `docs/` (planning).
- **Secrets:** local config via `.env` (git-ignored). Update [`.env.example`](.env.example) whenever a new variable is introduced. In AWS, use Secrets Manager / SSM Parameter Store, not env files.
- **Commits:** small and focused. Imperative subject lines (e.g. "Add list creation endpoint").
- **Tests:** new backend behavior ships with pytest coverage; new frontend logic with Vitest. Don't merge red.
- **Types:** TypeScript on the frontend, type hints + Pydantic on the backend. Avoid `any`.

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

> None yet — no app code. This section will list dev/test/build/deploy commands once `frontend/` and `backend/` exist.
