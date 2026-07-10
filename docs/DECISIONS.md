# Decisions

The resolved choices that shape the build. This is the quick-reference summary; the
full deliberation and trade-offs live in [QUESTIONS.md](QUESTIONS.md).

_Last updated: 2026-07-09_

## Stack & infrastructure

| Area | Decision | Notes |
|------|----------|-------|
| **Database** | PostgreSQL on **Aurora Serverless v2** | Relational fits the social roadmap; scales to zero when idle. |
| **Backend compute** | **Docker container on AWS Lightsail** | Owner wants Docker/Lightsail experience; FastAPI runs unchanged. |
| **Auth** | **AWS Cognito**, social login only | **Google at launch.** Facebook/Apple possible later. Twitter/X dropped. No email/password. |
| **IaC** | **Terraform** | Portable, declarative. |
| **Frontend language** | **TypeScript** | Plus ESLint + a frontend test runner (Vitest). |
| **Styling** | **Tailwind CSS** | Site should look fun and distinctive — custom theme/layout, not generic. (Color/theme design TBD.) |
| **Repo structure** | **Monorepo** | `frontend/` + `backend/` (+ `infra/`) in one repo. |
| **Domain / DNS** | Registered at **Squarespace**; DNS managed in **Route 53** | See [SETUP.md](SETUP.md) for migration steps. Keep Google Workspace email (preserve MX/SPF). |
| **Email sending** | Not needed yet | Revisit (AWS SES) when notifications arrive. |
| **Environments** | **local + production** to start | Add **staging** later when warranted. |
| **License** | **MIT** | In repo root. |

## Auth detail

- Launch supports **Google sign-in only**, brokered by Cognito.
- For the OAuth client we only need a **Google OAuth Web Application client ID** for now.
- Facebook and Apple are nice-to-haves for later (both are native Cognito IdPs).
- Twitter/X is explicitly **not** supported.

### Auth seam — build against a claims contract, stub locally (decided 2026-07-09)

We build the backend against a **standard OIDC claims contract**, not against Cognito
directly, so feature work is never blocked on cloud auth. Two layers:

- **Token layer** (environment-specific): in `development`, a **dev stub** returns fixed
  claims (`sub`, `name`, `email`, `picture`) with no network/JWT. In production, the same
  layer verifies the Cognito JWT (signature via Cognito JWKS, issuer/audience/expiry) and
  extracts the same claims.
- **Get-or-create-user layer** (shared/real in both modes): given a `sub`, find or create
  the `users` row and return it. Exercised by the stub, so it's real code we can test now.

The rest of the app only ever sees the resulting `User` — it never knows whether the
identity came from the stub or Cognito.

**Why this works without Cognito existing yet:** the app needs only standard OIDC claims
(`sub` → `cognito_sub`, `name` → `display_name`, `picture` → `avatar_url`, `email`), and
Cognito is *configured to match* that contract later (via Google→Cognito attribute mapping).
Only config values wait for Cognito — issuer URL, JWKS endpoint, audience (app-client ID) —
none of which change the app's internals.

Gotchas to remember when wiring Cognito:
- Cognito's `sub` is **Cognito's own per-pool user UUID**, not Google's ID — that's what we
  store in `cognito_sub` (stable per user in our pool).
- Whether `name`/`picture` arrive depends on **Cognito attribute mapping** — a config step
  done when setting up the Google IdP.

Status: **planned**, to be built as the lead-in to the first feature slice.

## Product data model (Phase 1–2)

Decisions from QUESTIONS.md §10, to guide the schema:

- **Lists**
  - A user can have **multiple lists**.
  - Lists hold **up to 50 items** (not necessarily full) — can be **saved as a draft and returned to**.
  - Lists can be **published / unpublished** (draft vs publicly visible).
- **Items**
  - **Ranked/ordered** within a list.
  - Have **text**, an optional **note**, and an optional **image link (URL)**.
  - Image *uploads/storage* (e.g. S3) are a later enhancement — start with URLs only.
- **Tags (instead of fixed categories, for now)**
  - A list can have **multiple tags**.
  - Tags are **free-form** text entered by users.
  - **Future:** popular user tags may be promoted into a curated **category** system; we can mine existing tags to seed categories.

### Initial schema

> **Implemented** as of 2026-07-09 — SQLAlchemy models in `backend/app/models/` and the
> Alembic migration `ab1a1d72af10_initial_schema`. Applied and verified against local Postgres.

- `users` — id, cognito_sub, display_name, avatar_url, created_at
- `lists` — id, user_id (FK), title, description, status (`draft` | `published`), created_at, updated_at
- `list_items` — id, list_id (FK), position (rank), text, note (nullable), image_url (nullable)
- `tags` — id, name (unique, normalized)
- `list_tags` — list_id (FK), tag_id (FK) — many-to-many

Later phases add: `comments`, `votes`, `suggestions`/`questions`, and possibly `categories`.

## Development workflow & testing (decided 2026-07-09)

- **Local database:** Postgres via the root `docker-compose.yml`. During development the DB
  is **disposable** — no data is worth preserving until launch. Rebuild anytime with
  `docker compose down -v` then `alembic upgrade head`.
- **Schema changes:** always via **Alembic migrations**, never by hand. Each migration's
  `downgrade()` is our migration-rollback mechanism; a formal production rollback process
  (snapshot-first, tested downgrades) gets defined **at launch**, not now.
- **Tests run against Postgres, not SQLite.** The schema depends on Postgres-only features
  (`gen_random_uuid()`, `now()`, native `UUID`, check constraints); SQLite would diverge and
  give false confidence. First feature slice adds a disposable test database (or
  transactional-rollback-per-test) pointed at the same Dockerized Postgres.

## Still open / deferred

- Exact color theme, branding, and layout for the frontend (owner to design).
- Whether/when to add a staging environment.
- Image storage (S3) — deferred until after MVP.
- Category system — deferred; tags first.
- Formal production DB rollback process (snapshot-first, tested downgrades) — defined at launch.
- Auth seam implementation + Cognito wiring — planned; built as lead-in to the first feature slice.
