# Next Steps & Roadmap

This is the living plan for building Fav Fifty. Work top-to-bottom; each step is
meant to be small and shippable. Resolve the relevant items in
[QUESTIONS.md](QUESTIONS.md) before starting the steps that depend on them.

---

## Phase 0 — Foundation (current)

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

## Phase 1 — Walking skeleton (thin end-to-end slice)

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

Goal: the actual product — a logged-in user manages their own lists.

- [x] CRUD API for lists (create, read, update, delete) — scoped to the owner (2026-08-08)
- [x] CRUD/reorder API for the items within a list (up to 50, ranked/ordered; each item has text + optional note + optional image URL) (2026-08-08)
- [x] Free-form tags on lists (multiple per list), plus search by title/tag — see
      [TAGS_SEARCH_PLAN.md](TAGS_SEARCH_PLAN.md); (2026-08-23)
- [ ] publish/unpublish (draft vs public)
- [x] Frontend: create a list, add/edit/remove/reorder items, delete a list — done
      (2026-08-08, items UI per [ITEMS_CRUD_PLAN.md](ITEMS_CRUD_PLAN.md) §Frontend
      implementation notes); *manage tags* still pending with the tags feature above
- [ ] Validation & limits (title length, item count cap of 50, tag handling, no
      duplicate list titles per user or duplicate item names within a list — see
      [LISTS_CRUD_PLAN.md](LISTS_CRUD_PLAN.md) §Validation) — done for items
      (cap + dedup enforced backend and surfaced in the UI); list-title dedup still open
- [x] Tests for all of the above — backend pytest, frontend Vitest, plus a Playwright
      end-to-end journey (`frontend/e2e/list-items.spec.ts`) covering the full
      add/edit/reorder(drag)/delete flow in a real browser
- [ ] First deploy to AWS (frontend static hosting + backend + DB), behind `favfifty.com`

**🎯 "Phase one complete" target.** Everything below is incremental.

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

## Later / backlog

- Search across lists and items — title/tag search for a user's own lists is being
  pulled into the Phase 2 tags slice above ([TAGS_SEARCH_PLAN.md](TAGS_SEARCH_PLAN.md));
  searching *within* a list's items, or cross-user search, stays here
- Notifications (someone commented on / voted for your list)
- Reporting & moderation tools
- Rate limiting and anti-abuse hardening
- Analytics (privacy-respecting)

---

## Immediate next actions (do these first)

**Auth is done — real Google login via Cognito works end to end (2026-07-31).** CI is
already in place (`.github/workflows/ci.yml`). Remaining Phase 1 items, in order:

1. ~~**`email` column on `users`**~~ — done (2026-08-01), see [DECISIONS.md](DECISIONS.md)
   §Product data model.
2. **Route 53 migration** ([SETUP.md](SETUP.md) §4): deferred, no urgency since it doesn't
   block app work — do it whenever there's a lull. Done (2026-08-15)
3. ~~**CRUD API for lists**~~ — done (2026-08-08).
4. ~~**CRUD/reorder API for list items**~~ — done (2026-08-08), backend only, see
   [ITEMS_CRUD_PLAN.md](ITEMS_CRUD_PLAN.md).
5. ~~**Frontend for item management**~~ — done (2026-08-08): add/edit/remove/reorder
   (drag + buttons) on the list details page, with unit + e2e tests, plus a
   site-wide interaction-feedback pass (see [DESIGN.md](DESIGN.md) §Motion).
6. Now: **tags + search** ([TAGS_SEARCH_PLAN.md](TAGS_SEARCH_PLAN.md)) + publish/unpublish
   (the last Phase 2 feature slice), then the done (2026-08-23)
   **first AWS deploy**. The **light/dark toggle** (DESIGN.md) must land before
   go-live but doesn't block feature work.
