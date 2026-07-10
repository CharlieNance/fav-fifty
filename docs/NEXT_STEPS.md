# Next Steps & Roadmap

This is the living plan for building Fav Fifty. Work top-to-bottom; each step is
meant to be small and shippable. Resolve the relevant items in
[QUESTIONS.md](QUESTIONS.md) before starting the steps that depend on them.

---

## Phase 0 — Foundation (current)

Goal: a clean repo and clear decisions before any app code.

- [x] Create `README.md`, `.gitignore`, `.claudeignore`, `CLAUDE.md`, `.env.example`
- [x] Create planning docs (`NEXT_STEPS.md`, `QUESTIONS.md`, `CONSIDERATIONS.md`)
- [x] Answer the open decisions → recorded in [DECISIONS.md](DECISIONS.md)
- [x] Choose a license and add `LICENSE` (MIT)
- [ ] Make the initial git commit and push to GitHub (verify no secrets are tracked)
- [ ] **External setup** — follow [SETUP.md](SETUP.md):
  - [x] Create Google OAuth Web Application client ID + secret
  - [x] Set up AWS account (root MFA, IAM user/group, MFA) + billing budget/alarm
  - [ ] Create Route 53 hosted zone; copy Google email MX/SPF records; point Squarespace nameservers at it
  - [ ] Cognito user pool + Google IdP (Phase 1)

## Phase 1 — Walking skeleton (thin end-to-end slice)

Goal: prove the whole stack connects, with aPuth, before building features.

- [ ] Scaffold `backend/` — FastAPI app, health check endpoint, config from env, pytest set up
- [x] Scaffold `frontend/` — Vue 3 + Vite + TS app, Pinia, Vue Router, Tailwind, Vitest, ESLint/Prettier set up (2026-07-09)
- [ ] Local dev: docker-compose with Postgres so the stack runs end-to-end on one command
- [ ] Database schema v1 + migrations tool (Alembic): `users`, `lists`, `list_items`, `tags`, `list_tags` (see [DECISIONS.md](DECISIONS.md) §Data model)
- [ ] Auth: social login working end-to-end (login → callback → session) for at least Google
- [ ] Protected `GET /me` endpoint returning the current user; frontend shows logged-in state
- [ ] CI: run backend + frontend tests on every push (GitHub Actions)

## Phase 2 — Core feature: personal lists (MVP)

Goal: the actual product — a logged-in user manages their own lists.

- [ ] CRUD API for lists (create, read, update, delete) — scoped to the owner
- [ ] CRUD/reorder API for the items within a list (up to 50, ranked/ordered; each item has text + optional note + optional image URL)
- [ ] Free-form tags on lists (multiple per list); publish/unpublish (draft vs public)
- [ ] Frontend: create a list, add/edit/remove/reorder items, manage tags, delete a list
- [ ] Validation & limits (title length, item count cap of 50, tag handling)
- [ ] Tests for all of the above
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

- Search across lists and items
- Notifications (someone commented on / voted for your list)
- Reporting & moderation tools
- Tags / multiple categories per list
- Rate limiting and anti-abuse hardening
- Analytics (privacy-respecting)

---

## Immediate next actions (do these first)

1. **Owner:** read and answer [QUESTIONS.md](QUESTIONS.md).
2. Pick a license; add `LICENSE`.
3. Make the first commit and push to GitHub — confirm `.env` is **not** tracked.
4. Once the DB/hosting/auth decisions are made, start Phase 1 with the backend skeleton.
