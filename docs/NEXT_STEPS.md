# Next Steps & Roadmap

This is the living plan for building Fav Fifty. Work top-to-bottom; each step is
meant to be small and shippable. Resolve the relevant items in
[QUESTIONS.md](QUESTIONS.md) before starting the steps that depend on them.

---

## Phase 0 — Foundation (done)

Goal: a clean repo and clear decisions before any app code.

- [x] Create `README.md`, `.gitignore`, `.claudeignore`, `CLAUDE.md`, per-app `.env.example` templates
- [x] Create planning docs (`NEXT_STEPS.md`, `QUESTIONS.md`, `CONSIDERATIONS.md`)
- [x] Answer the open decisions → recorded in [DECISIONS.md](DECISIONS.md)
- [x] Choose a license and add `LICENSE` (MIT)
- [x] Make the initial git commit and push to GitHub (verify no secrets are tracked)
- [x] **External setup** — follow [SETUP.md](SETUP.md):
  - [x] Create Google OAuth Web Application client ID + secret
  - [x] Set up AWS account (root MFA, IAM user/group, MFA) + billing budget/alarm
  - [x] Create Route 53 hosted zone; copy Google email MX/SPF records; point Squarespace nameservers at it
  - [x] Cognito user pool + Google IdP + hosted domain + app client — set up and verified end-to-end (2026-07-31)

## Phase 1 — Walking skeleton (thin end-to-end slice) (done)

Goal: prove the whole stack connects, with auth, before building features.

- [x] Scaffold `backend/` — FastAPI app, health check endpoint, config from env, pytest set up
- [x] Scaffold `frontend/` — Vue 3 + Vite + TS app, Pinia, Vue Router, Tailwind, Vitest, ESLint/Prettier set up (2026-07-09)
- [x] Local dev: docker-compose Postgres for the backend to run against (`docker compose up -d db`)
- [x] Database schema v1 + migrations tool (Alembic): `users`, `lists`, `list_items`, `tags`, `list_tags` (see [DECISIONS.md](DECISIONS.md) §Data model)
- [x] Auth seam (backend): claims contract + dev-login stub + session cookie + get-or-create + revocation, with tests (`feat/auth-seam`).
- [x] Real Google→Cognito login (backend, `feat/auth-page`): `CognitoIdentityProvider` (JWT/JWKS verification) + `/auth/login` & `/auth/callback` (authorization-code + PKCE + state + nonce), with tests. **Live** — Cognito console setup done and "Continue with Google" verified working end-to-end (2026-07-31).
- [x] Protected `GET /me` endpoint + frontend logged-in state: login page (real Google button + dev-login stub), header logout, session-aware store/guard (`feat/auth-page`).
- [x] CI: backend (ruff + pytest against a real Postgres) and frontend (eslint + prettier + vue-tsc/build + vitest) on every PR and push to main (`.github/workflows/ci.yml`)
- [x] Add `email` column to `users` (Alembic migration) — safety net for relinking
      accounts if the Cognito user pool is ever recreated; see [DECISIONS.md](DECISIONS.md)
      §Product data model. `get_or_create_user` and the privacy policy updated (2026-08-01).

## Phase 2 — Core feature: personal lists (MVP)

Goal: the actual product. A user manages their own lists, signed in or (since the
2026-10 scope expansion) anonymously on-device.

- [x] CRUD API for lists (create, read, update, delete) — scoped to the owner (2026-08-08)
- [x] CRUD/reorder API for the items within a list (up to 50, ranked/ordered; each item has text + optional note + optional image URL) (2026-08-08)
- [x] Free-form tags on lists (multiple per list), plus search by title/tag — see
      [TAGS_SEARCH_PLAN.md](TAGS_SEARCH_PLAN.md); (2026-08-23)
- [ ] publish/unpublish (draft vs public)
- [x] Frontend: create a list, add/edit/remove/reorder items, delete a list — done
      (2026-08-08, items UI per [ITEMS_CRUD_PLAN.md](ITEMS_CRUD_PLAN.md) §Frontend
      implementation notes); manage-tags UI shipped with the tags slice (2026-08-23)
- [ ] Validation & limits (title length, item count cap of 50, tag handling, no
      duplicate list titles per user or duplicate item names within a list — see
      [LISTS_CRUD_PLAN.md](LISTS_CRUD_PLAN.md) §Validation) — done for items
      (cap + dedup enforced backend and surfaced in the UI); list-title dedup still open
- [x] Tests for all of the above — backend pytest, frontend Vitest, plus a Playwright
      end-to-end journey (`frontend/e2e/list-items.spec.ts`) covering the full
      add/edit/reorder(drag)/delete flow in a real browser
- [ ] **Light/dark toggle** — required before go-live ([DESIGN.md](DESIGN.md))
- [ ] First deploy to AWS, behind `favfifty.com`, per
      [DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md): one Lightsail box
      (Docker Compose: FastAPI + Postgres 16 + TLS proxy), the SPA on S3, and one
      CloudFront distribution (flat-rate Free plan) serving the SPA *and* `/api/v1/*`.
      Includes: upgrading the AWS account to Paid, the Cognito callback URL →
      `https://favfifty.com/api/v1/auth/callback`, nightly `pg_dump` + snapshots + one
      test restore.

### Pre-launch hardening (pulled forward from the backlog, owner call 2026-10-13)

Anonymous access means strangers can reach the backend, and this project can never
absorb a surprise bill, so these **block launch**. All decided (QUESTIONS.md Q16,
Q21–Q25).

- [ ] **Cost guardrails** ([COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md)):
  - services capped by construction (CloudFront flat-rate plans, the fixed-price box,
    Lambda reserved concurrency, logs on the box);
  - usage tripwires → the breaker (degrade at $50 → maintenance at $100, manual
    revive);
  - $25 notify with repeat reminders and phone push.

  **Launch blocks on a passing game day.**
- [ ] **Abuse protection** ([ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md)):
  - WAF rules;
  - app rate limits for signed-in writes + 429 UX;
  - quotas (100 lists, 25 tags, …, runtime-configurable);
  - body-size limits, DB statement timeout, Origin-check CSRF, security headers;
  - supply-chain checks.
- [ ] **Runtime settings + admin portal**
      ([ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md)):
  - SSM-backed switches, limits and provider toggles;
  - `users.role` + a CLI-only admin grant;
  - the audit log;
  - lock/unlock/revoke, read/remove lists;
  - the Settings page with breaker reset.
- [ ] **Dashboards + analytics** (same plan):
  - product numbers from Postgres;
  - request/429 counters;
  - a CloudWatch health dashboard and a daily cost snapshot;
  - Cloudflare Web Analytics and the `/events` stream.

**🎯 "Phase one complete" target.** Everything below is incremental.

## Phase 2.5 — Scope expansion (pre-launch, decided 2026-10-13)

Owner pivot before launch: **anonymous use** with **on-device lists that upload on
sign-in**, **find-as-you-type catalog lookup** through the Python backend, a
**scrolling-art margin showcase**, an API ready for **iOS/Android**, and **Lambda for
stateless routes**. All sub-decisions are made
([QUESTIONS.md §Round 2](QUESTIONS.md#round-2--scope-expansion-2026-10-13), summarized
in [DECISIONS.md](DECISIONS.md) §Scope expansion).

**Track 0 — API groundwork** (first: it changes paths every later track touches; see
[MOBILE_READINESS.md](MOBILE_READINESS.md) §4 and DEPLOYMENT_TOPOLOGY_PLAN.md §One public URL):

- [ ] Serve the API at `/api/v1/...` from the app itself; the Vite proxy stops stripping
      `/api`; `VITE_API_BASE_URL` default becomes `/api/v1`. Update `frontend/.env.example`,
      `frontend/README.md`, `backend/.env.example` (`COGNITO_REDIRECT_URI` comment), and
      [SETUP.md](SETUP.md) §3 together.
- [x] ~~Fix the snake_case/camelCase wire mismatch~~ — done: wire casing is **snake_case**
      (commit `3f98dcd`)
- [ ] Commit the OpenAPI schema; CI fails on unreviewed contract changes
- [ ] Health endpoint reports `deploy_target` + git SHA
- [ ] **Runtime settings module** (SSM + env fallback, typed/validated, ~30 s cache) +
      public `GET /api/v1/config/client`; move `max_tags_per_list` under it with the new
      default of 25 ([ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md) §Runtime
      settings). Quotas, provider toggles, and the breaker all build on this.

**Track 1 — anonymous + local lists** ([ANONYMOUS_AND_LOCAL_LISTS_PLAN.md](ANONYMOUS_AND_LOCAL_LISTS_PLAN.md)):

- [ ] List-repository refactor (API-only, no behavior change)
- [ ] Shared validation limits (served by `GET /api/v1/config/client`)
- [ ] `LocalListRepository` + versioned JSON storage format (snake_case) + migrations
- [ ] Unlock list routes for anonymous visitors; "saved on this device" UI; export/import file
- [ ] `POST /lists/import` (idempotent, atomic, reject-all on invalid, rename on title
      conflict) + migration; claim dialog after sign-in; clear local copy on success
- [ ] Privacy policy update (on-device storage)

**Track 2 — catalog lookup** ([CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md)):

- [ ] Catalog seam: contract, modular provider registry (runtime enable/disable), fake
      provider, `GET /catalog/search`
- [ ] Migration: nullable `catalog_*` refs on `list_items`, `kind` enum on `lists`
- [ ] Item-form type-ahead combobox + list-kind picker
- [ ] First-wave providers: Wikipedia → Deezer/iTunes → TMDB (+ attribution) → Photon,
      with the per-provider circuit breaker
- [ ] AWS protections: catalog on Lambda (reserved concurrency ~3), WAF rule, edge
      caching, `img.favfifty.com` image proxy
- [ ] Second-wave providers: IGDB, BoardGameGeek, AniList, podcasts, books

**Track 3 — margin showcase** ([MARGIN_SHOWCASE_PLAN.md](MARGIN_SHOWCASE_PLAN.md)):

- [ ] `GET /showcase` with fake source; static-tile mock to settle the look
- [ ] Animation, reduced-motion, visibility pause, user off-toggle
- [ ] Real sources (TMDB trending, album charts) via the image proxy, after Track 2's
      TMDB key lands; route to Lambda with the catalog

Tracks 1–3 are independent of each other once Track 0 is in.

## Phase 3 — Sharing & comments

- [ ] Public/private visibility flag on lists; shareable public URL (slug)
- [ ] Read-only public list view (no login required to view a shared list)
- [ ] Comments on lists (auth required to comment)
- [ ] Basic moderation hooks (delete own comment; owner can remove comments on their list)

## Phase 4 — Community

- [ ] Suggestions / questions on a list (distinct from comments)
- [ ] Voting on lists (one vote per user; prevent abuse)
- [ ] Browse / discovery page (recent, top-voted)
- [ ] User profiles (public lists, avatar from social provider)

## Phase 5 — Mobile apps (iOS + Android)

See [MOBILE_READINESS.md](MOBILE_READINESS.md). Prerequisites are mostly Track 0 above.

- [ ] Choose app technology (QUESTIONS.md Q18: deferred; try Capacitor first)
- [ ] Bearer-token auth alongside the cookie (system-browser OAuth → one-time code → token)
- [ ] Android first; **iOS last**, with **Sign in with Apple** (App Store guideline
      4.8). Apple Developer Program, $99/yr (accepted)
- [ ] **In-app account deletion** (App Store 5.1.1(v), Google Play) incl. Apple token revocation
- [ ] Deep-link files (`apple-app-site-association`, `assetlinks.json`); Capacitor CORS origins
- [ ] Minimum-supported-version endpoint; on-device storage via the list repository

## Later / backlog

- Search across lists and items — title/tag search for a user's own lists is being
  pulled into the Phase 2 tags slice above ([TAGS_SEARCH_PLAN.md](TAGS_SEARCH_PLAN.md));
  searching *within* a list's items, or cross-user search, stays here
- Notifications (someone commented on / voted for your list)
- Reporting & moderation tools for *public* content (report button, review queue) —
  arrives with Phase 3; the admin portal and account locking moved pre-launch (Phase 2
  §Pre-launch hardening)
- Image storage in S3: copy catalog images from redirecting sources and user-pasted image
  URLs into our own bucket (privacy), before public lists ship
- Full Lambda (DB-backed routes off the box) — deferred; needs a managed DB
  ([DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md) §Future)
- Keep data on-device even when signed in, with bulk sync (owner idea, QUESTIONS.md Q12)
- ~~Rate limiting and anti-abuse hardening~~ — moved pre-launch (2026-10-13),
  [ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md)
- ~~Analytics (privacy-respecting)~~ — moved pre-launch (2026-10-13),
  [ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md)

---

## Where to start next (updated 2026-10-13)

Phases 0–1 and the Phase 2 list/item/tag features are done (history in git and the plan
docs). All of QUESTIONS.md Round 2 is decided. **Suggested order:**

1. **⏰ Time-sensitive, AWS console only (no code):** the AWS account is ~4 months into
   the credit-based **Free account plan**, which ends after 6 months (around
   **December 2026**) or when credits run out. If it lapses, **the account closes**,
   taking the Cognito pool and the **Route 53 zone (including Google Workspace email
   DNS)** with it. Before then:
   - set up Budgets ($25/$50/$100), Cost Anomaly Detection, and notifications
     (email + AWS Console app push + Discord webhook);
   - then **upgrade to Paid**.

   See [COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md) §Account timeline.
2. **Next feature: Track 0 (API groundwork).** Small, touches every path, and every
   later track builds on it:
   - the `/api/v1` prefix + same-origin config;
   - the OpenAPI snapshot in CI;
   - `deploy_target` in health;
   - **the runtime settings module + `GET /api/v1/config/client`**.
3. **Track 1 (anonymous + local lists)**, starting with the list-repository refactor.
   It changes the first-visit experience, so launch waits on it.
4. **Pre-launch hardening, app layer:** quotas + rate limits + request hygiene + CSRF
   (ABUSE_PROTECTION_PLAN.md); `users.role`, the audit log and the admin Users/Settings
   pages (ADMIN_AND_ANALYTICS_PLAN.md).
5. **Remaining Phase 2:** publish/unpublish, list-title dedup, the light/dark toggle.
6. **First deploy** (Terraform: box, S3, CloudFront + WAF on the flat-rate plan,
   backups) → **breaker + game day**.
7. **Tracks 2–3** (catalog lookup, margin showcase) and dashboards/analytics, just before
   or just after launch (owner's call). Catalog moves to Lambda with its AWS
   protections when it ships.
8. **Launch** = steps 1–6 done, plus at least the admin lock/unlock and Settings pages.
