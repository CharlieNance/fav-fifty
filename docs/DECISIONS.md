# Decisions

The resolved choices that shape the build. This is the quick-reference summary; the
full deliberation and trade-offs live in [QUESTIONS.md](QUESTIONS.md).

_Last updated: 2026-06-28_

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

### Sketch of the initial schema

> Indicative only — finalized when we write the Alembic migration.

- `users` — id, cognito_sub, display_name, avatar_url, created_at
- `lists` — id, user_id (FK), title, description, status (`draft` | `published`), created_at, updated_at
- `list_items` — id, list_id (FK), position (rank), text, note (nullable), image_url (nullable)
- `tags` — id, name (unique, normalized)
- `list_tags` — list_id (FK), tag_id (FK) — many-to-many

Later phases add: `comments`, `votes`, `suggestions`/`questions`, and possibly `categories`.

## Still open / deferred

- Exact color theme, branding, and layout for the frontend (owner to design).
- Whether/when to add a staging environment.
- Image storage (S3) — deferred until after MVP.
- Category system — deferred; tags first.
