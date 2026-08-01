# Decisions

The resolved choices that shape the build. This is the quick-reference summary; the
full deliberation and trade-offs live in [QUESTIONS.md](QUESTIONS.md).

_Last updated: 2026-07-31_

## Stack & infrastructure

| Area | Decision | Notes |
|------|----------|-------|
| **Database** | PostgreSQL on **Aurora Serverless v2** | Relational fits the social roadmap; scales to zero when idle. |
| **Backend compute** | **Docker container on AWS Lightsail** | Owner wants Docker/Lightsail experience; FastAPI runs unchanged. |
| **Auth** | **AWS Cognito**, social login only | **Google at launch.** Facebook/Apple possible later. Twitter/X dropped. No email/password. |
| **IaC** | **Terraform** | Portable, declarative. |
| **Frontend language** | **TypeScript** | Plus ESLint + a frontend test runner (Vitest). |
| **Styling** | **Tailwind CSS v4** | Configured CSS-first via semantic design tokens (`@theme`). Site should look fun and distinctive — custom theme/layout, not generic. **Dark-first** (light theme a later flip). Color/type/layout tracked in [DESIGN.md](DESIGN.md). |
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

### Google OAuth consent screen: Testing now, Production later (decided 2026-07-31)

- **Today (local dev, personal testing):** the consent screen stays in **Testing** mode.
  Add your own Google account (and any other early testers) under **Audience → Test
  users** — up to 100 accounts, no verification needed, and the App domain / Privacy
  Policy / ToS links aren't checked while in Testing.
- **Plan:** move to **Production** once ready for open sign-up (not gated behind manual
  test-user allowlisting). Since Fav Fifty only requests non-sensitive scopes (`openid`,
  `email`, `profile`), this shouldn't require Google's full verification review — just a
  live Privacy Policy URL and authorized-domain ownership verification.
- **Legal docs:** drafted in [docs/legal/PRIVACY_POLICY.md](legal/PRIVACY_POLICY.md) and
  [docs/legal/TERMS_OF_SERVICE.md](legal/TERMS_OF_SERVICE.md). They describe what the app
  actually stores today: the Cognito `sub`, display name, and avatar URL land in our own
  Postgres `users` table (see schema below); **email does not** — it's retained by AWS
  Cognito as part of the Google attribute mapping (§Step B in [SETUP.md](SETUP.md)), but
  our application database never persists it. Still TODO before Production: fill in a
  real contact email and host both docs at public URLs.

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

Status: **implemented** (backend) on `feat/auth-seam`. What shipped:

- **Identity contract** (`app/auth/claims.py`): a `Claims` model (`sub`, `email`,
  `name`, `picture`) + an `IdentityProvider` Protocol. Nothing downstream knows
  where claims came from.
- **Providers** (`app/auth/providers.py`): a `DevIdentityProvider` returning fixed
  claims that **hard-fails if `APP_ENV != development`**; `get_identity_provider()`
  is the factory where `CognitoIdentityProvider` slots in later.
- **Session** (`app/auth/session.py`): a signed, timed, **HttpOnly** cookie
  (`itsdangerous`) carrying only `{uid, tv}`. Stateless — no server-side session
  store, so we scale out, not up. `SameSite=Lax`; `Secure` outside dev.
- **User service** (`app/services/user_service.py`): `get_or_create_user`,
  `get_user_by_id`, and the revocation levers `deactivate_user` (instant per-user
  disable) + `revoke_all_sessions` (bump `session_token_version` to invalidate all
  outstanding cookies without rotating `SECRET_KEY`).
- **Auth dependency** (`app/api/deps.py`): `get_current_user` re-loads the user
  each request and enforces `is_active` + token-version match → revocation is
  immediate.
- **Routes**: dev-only `POST /auth/dev-login`, `POST /auth/logout`, protected
  `GET /me`.
- **Schema**: `users` gained `is_active`, `session_token_version`, `last_login_at`
  (migration `c3fb686e27a4`). `last_login_at` is the first usage-trend signal; a
  full `auth_events` table can follow.
- **Tests** run against Dockerized Postgres with **per-test transactional
  rollback** (`tests/conftest.py`), and include the required "dev stub hard-fails
  outside development" case.

Update (`feat/auth-page`): the two remaining code pieces are done —

- **Frontend logged-in state**: login page with a real "Continue with Google" button
  (hands off to the backend) and a dev-only stub-login button; header logout wired to
  `POST /auth/logout`; the Pinia store gained `devLogin`/`loginWithGoogle`/`logout`.
- **Real Cognito provider + OAuth flow**: `CognitoIdentityProvider` verifies the id
  token (signature via JWKS, plus issuer/audience/expiry/`token_use`/nonce);
  `GET /auth/login` → Cognito hosted UI and `GET /auth/callback` → verify → session,
  using **authorization-code + PKCE (S256)** with a signed, short-lived state cookie
  carrying the CSRF token, nonce, PKCE verifier, and a validated (open-redirect-safe)
  post-login path. The callback lives on the backend (confidential client; only it can
  set the HttpOnly cookie). All of this is gated on `settings.cognito_configured`, so it
  stays dormant in local dev (stub) and activates once the `COGNITO_*` env vars are set.

**Update (2026-07-31):** the AWS/Google console setup (see [SETUP.md](SETUP.md) §3) is
done — Cognito user pool, Google IdP, hosted domain, and app client are all live, and
"Continue with Google" has been verified working end-to-end. Still to do at deploy time:
a shared cookie domain across the API and site origins.

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
  - **Planned addition: `email`** (decided 2026-07-31, not yet migrated). Rationale:
    Cognito's `sub` is per-pool — if the user pool is ever recreated (e.g. schema
    change that requires a new pool), every user gets a new `sub` even though it's
    the same Google account, breaking the `cognito_sub` foreign key. Storing email
    directly turns a pool migration into "match by email, relink `cognito_sub`"
    instead of losing the linkage. Cheap now, saves a much worse migration later.
    **TODO when this ships:** add the Alembic migration, populate `email` in
    `get_or_create_user` from `Claims.email`, and update
    [docs/legal/PRIVACY_POLICY.md](legal/PRIVACY_POLICY.md) — it currently says our
    own database doesn't store email, which will no longer be true.
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

- Exact color theme, branding, type, and layout for the frontend (owner to design) — tracked in [DESIGN.md](DESIGN.md).
- Whether/when to add a staging environment.
- Image storage (S3) — deferred until after MVP.
- Category system — deferred; tags first.
- Formal production DB rollback process (snapshot-first, tested downgrades) — defined at launch.
- Auth — **fully implemented and live** (see §Auth detail): dev stub, real Cognito provider, frontend login state, OAuth callback, all verified working end-to-end (2026-07-31).
