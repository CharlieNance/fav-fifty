# Lists CRUD — Implementation Plan

Planning doc for the first slice of Phase 2 ([NEXT_STEPS.md](NEXT_STEPS.md)): a logged-in
user can create, view, rename, and delete their own lists. No code yet — this is the
process we'll follow, broken down by user interaction, with backend/frontend/database
and tests called out for each. Adding/reordering **items within** a list is a separate,
later feature (the details page below is a stub for it).

## Scope

**In scope**
- List-of-lists page (read/index)
- Create a list (title only), as a modal
- Rename a list, as a modal
- Delete a list (soft delete), from the index and from the details page
- A details page as a placeholder destination — no item management yet

**Out of scope (future features)**
- Adding, editing, reordering, or removing items inside a list
- Tags, description editing, publish/unpublish (draft vs public)
- Sharing / public visibility, comments, voting
- The batch job that hard-deletes old soft-deleted rows (this plan lays the groundwork
  for it but doesn't build it)

## Foundation already in place

This feature is additive on top of things that already exist — worth naming so it's
clear what's *new* work vs. what we're wiring up:

- **`lists` table already exists** (migration `ab1a1d72af10_initial_schema`, models in
  `backend/app/models/list.py`): UUID primary key, `user_id` FK (`ondelete="CASCADE"`),
  `title` (`String(200)`, required), `description` (nullable), `status`
  (`draft`/`published`, defaults to `draft`), `created_at`/`updated_at`. This feature
  adds one new column to it — `deleted_at` — via a new Alembic migration (see
  §Soft delete below); everything else about the table is unchanged.
- **Auth dependency**: `get_current_user` (`backend/app/api/deps.py`) resolves the
  signed-in user from the session cookie or raises `401`. Every list endpoint depends
  on it.
- **Frontend auth plumbing**: `useAuthStore` (`isAuthenticated`), the router's
  `beforeEach` guard (redirects unauthenticated users to `/login` with `redirect`
  preserved for routes marked `meta: { requiresAuth: true }`), and `apiFetch`/`ApiError`
  (`frontend/src/api/client.ts`) as the one seam for talking to the backend.
- **`/lists/new` route exists today** as a placeholder page (`CreateListView.vue`).
  It's being **removed** as a route — see §Modals below — since create is now an
  overlay, not a page.

## Naming: `title`

Settled: we keep the existing `lists.title` column (not a new `name` field) — "name"
in the original request and `title` in the schema are the same thing.

## Modals, not pages, for create and edit

Create and edit should never navigate the user away from whatever page they're on —
they're both an overlay: fill in the title, **Save** or **Cancel**, and you're right
back where you started.

- **No dedicated routes for create/edit.** `/lists/new` and `/lists/:id/edit` go away.
  Only two routes exist for this feature: `/lists` (index) and `/lists/:id` (details
  stub).
- **`CreateListModal.vue` and `EditListModal.vue`** (new, `features/lists/`) are plain
  overlay components, opened/closed via a small piece of shared state (e.g. a
  `useListModals` composable or a tiny Pinia store holding `isCreateOpen` and
  `editingListId`) rather than route params. That's what makes them reachable from
  *multiple* places without route gymnastics:
  - **Create** is triggered from the index page ("New list" button) — and also from
    the existing header/homepage **"Start a list"** CTA
    (`useStartList`/`CREATE_LIST_PATH`), which currently does `router.push('/lists/new')`.
    Since there's no `/lists/new` page anymore, that composable changes to *open the
    modal* instead of navigating — meaning "Start a list" can pop the modal up on top
    of the homepage itself, no detour through `/lists` first. This is arguably a nicer
    version of the existing intent than the page it's replacing.
  - **Edit** is triggered from an edit affordance on the index row *and* from the
    details page — same modal, two entry points, no navigation either way.
  - On successful **create**, the modal closes and the app navigates to the new list's
    details page (`/lists/:id`) — the one real navigation in this flow, and it's a
    result of the save, not a precondition for opening the form.
  - On successful **edit**, the modal closes and the underlying page (index row, or
    details page) just reflects the updated title — no navigation at all.
  - **Cancel**, either modal: closes with no API call, no state change.
- **Preserving login intent:** today, an unauthenticated "Start a list" click sends the
  user to `/login?redirect=/lists/new`, and login lands them back on that page. With no
  `/lists/new` page to land on, `redirect` instead points at `/lists`, plus a flag (e.g.
  `?openCreate=1`) that tells `ListsView` to open the create modal itself right after
  the redirect resolves — same "pick up where you left off" behavior, just modal-shaped
  instead of page-shaped.
- **Delete stays a confirmation dialog**, not a full modal form — `ConfirmDialog.vue`
  (new, shared), triggered from the same two places (index row, details page).

## Routes

| Path | Route name | View | Purpose |
|---|---|---|---|
| `/lists` | `lists` | `ListsView.vue` | Index — all of *my* lists; hosts the create modal |
| `/lists/:id` | `list-detail` | `ListDetailView.vue` | Details stub; hosts the edit modal + delete |

Both get `meta: { requiresAuth: true }`, same as the existing `/lists/new` route today.

## API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/lists` | Current user's *non-deleted* lists |
| `POST` | `/api/lists` | Create a list (`{ title }`) |
| `GET` | `/api/lists/{list_id}` | One list — used by the index (for edit prefill) and the detail page |
| `PATCH` | `/api/lists/{list_id}` | Rename (`{ title }`) |
| `DELETE` | `/api/lists/{list_id}` | Soft delete |

No change to this surface from the previous draft — soft delete changes what `DELETE`
and the `GET`s do internally, not the routes or verbs.

New router `backend/app/api/routes/lists.py`, registered in `main.py` alongside
`health`, `auth`, `me`. New `backend/app/services/list_service.py` (mirrors the shape
of `user_service.py`: plain functions taking a `Session`, unit-testable without HTTP).
New `backend/app/schemas/list.py`: `ListRead`, `ListCreate`, `ListUpdate` (Pydantic v2,
`from_attributes=True` like `UserRead`).

## Cross-cutting: soft delete

- **New column: `deleted_at` (nullable `DateTime(timezone=True)`, indexed) on `lists`.**
  A row is soft-deleted iff `deleted_at IS NOT NULL`. This is a single-column pattern
  (no separate boolean) — a boolean-plus-timestamp pair can drift out of sync
  (flag set, timestamp not, or vice versa); one nullable column can't.
- **Not reusing `updated_at` for this.** `updated_at` already means "last content
  edit" (it's bumped by `onupdate=func.now()` on every rename) — overloading it as the
  delete marker too would make "how long has this been deleted" and "when was it last
  actually edited" the same unrecoverable number, which is exactly the distinction the
  future hard-delete-after-N-days job needs. A dedicated `deleted_at` keeps those two
  facts separate for the cost of one column.
- **New Alembic migration** adds the column (nullable, no backfill needed — existing
  rows are all "not deleted").
- **Every `GET` filters it out.** `list_service.list_for_user` adds
  `WHERE deleted_at IS NULL`; the single-list lookup (`get_owned_list`, used by
  `GET`/`PATCH`/`DELETE`) does the same. A soft-deleted list is **`404`, indistinguishable
  from never having existed** — same principle as the ownership check below: deleted
  lists don't get a different error code that reveals they once existed.
- **`DELETE /api/lists/{list_id}` becomes `UPDATE ... SET deleted_at = now()`**, not a
  row delete. Still `204`. A second `DELETE` on the same (now-invisible) row is still
  `404`, same as before — nothing here weakens the "not idempotent-200" test.
- **The existing `ondelete="CASCADE"` / `cascade="all, delete-orphan"` config on
  `list_items`/`list_tags` doesn't fire for this feature** (nothing issues a real `DELETE`
  row here) — but it's exactly what makes the *future* hard-delete batch job simple:
  when that job eventually does `DELETE FROM lists WHERE deleted_at < now() - interval`,
  the cascade takes care of orphaned items/tags for free. Nothing to build now, just
  worth knowing the plumbing is already correct for later.
- **Out of scope for this feature:** the batch job itself (cron/Lambda, retention
  window, etc.) and whether `list_items`/`tags` ever need their own soft-delete — both
  are future-feature questions, noted here so they're not forgotten, not solved now.

## Cross-cutting: ownership & security

This is the part the original request called out explicitly, so it applies uniformly to
every endpoint and page below, not just once:

- **Every list endpoint requires auth.** All five depend on `get_current_user`; no
  endpoint accepts an anonymous request. `401` if there's no valid session.
- **Ownership is enforced server-side, on every request, at the query level** — never
  by trusting the client. `GET/PATCH/DELETE /api/lists/{list_id}` all resolve the row
  scoped by `user_id == current_user.id` **and** `deleted_at IS NULL` (e.g. via a shared
  `get_owned_list` dependency that does the lookup once). If the row doesn't exist,
  belongs to someone else, or is soft-deleted, the response is **`404` in all three
  cases** — never `403`. A `403` would confirm to an attacker that a given ID exists and
  just isn't theirs; `404` gives no signal either way.
- **`user_id` is never client-supplied.** `POST /api/lists` takes only `{ title }` in
  the body — the owner is always `current_user.id` from the session, never a field the
  caller can set or override.
- **IDs are already UUIDs** (`UUIDPrimaryKeyMixin`, DB-generated via
  `gen_random_uuid()`), not sequential integers. This is defense-in-depth on top of the
  ownership check above (the real control) — it also means sequential enumeration
  (`/lists/1`, `/lists/2`, ...) isn't even a viable probing strategy.
- **Private by default, for real, because there's no other path yet.** The request
  mentions lists can later be made public — that's the Phase 3 sharing feature
  ([NEXT_STEPS.md](NEXT_STEPS.md) Phase 3), which will add an explicit `is_public`
  flag/slug and a *separate*, unauthenticated read endpoint. Until that exists, every
  endpoint in this feature is owner-only with no public path at all.
- **The frontend never receives another user's data to accidentally render.** Because
  the backend filters at the query level, there's no client-side "hide it if it's not
  mine" logic that could be bypassed — the data simply isn't in the response.

## Validation

- `title`: required, trimmed, 1–200 chars after trimming (matches the `String(200)`
  column) — reject empty or whitespace-only strings. Enforced in the Pydantic schema
  (`ListCreate`/`ListUpdate`) so bad input never reaches the service layer.
- No other fields are settable through this feature's endpoints yet (`description`,
  `status` stay at their DB defaults — untouched until the description/publish work
  lands).

## Interaction 1 — View my lists (index)

**Flow:** Signed-in user opens `/lists`, sees every non-deleted list they own as a row.
**Row layout:** the title is a link to the list's details page (`/lists/:id`); an edit
icon and a delete icon sit on the right side of the row. The edit icon opens
`EditListModal` right there on the index (Interaction 3); the delete icon opens
`ConfirmDialog` right there on the index (Interaction 4) — neither navigates away from
`/lists`. Empty state for a brand-new user with zero lists (or whose only lists are
soft-deleted), with a call to action to create one.

- **Backend:** `GET /api/lists` → `list_service.list_for_user(db, current_user.id)` →
  `SELECT * FROM lists WHERE user_id = :id AND deleted_at IS NULL ORDER BY updated_at DESC`.
  Returns `list[ListRead]`.
- **Frontend:** `ListsView.vue` (new, `features/lists/`) fetches on mount via
  `apiFetch<ListRead[]>('/lists')`; renders loading / empty / populated / error states;
  hosts the "New list" button that opens `CreateListModal`. Each row: title as a
  `RouterLink` to `/lists/:id`, plus edit/delete icon buttons that don't act as links
  themselves (clicking an icon opens its modal/dialog, not the details page — so the
  icons need their own click handlers, not just nested inside the `RouterLink`).
- **Tests:**
  - Backend: owner sees only their own, non-deleted lists (seed two users plus a
    soft-deleted list, assert isolation and that the deleted one is absent); empty list
    for a fresh user; `401` when unauthenticated.
  - Frontend: renders items from a mocked `apiFetch`; renders the empty state when the
    array is empty; renders an error state when the call rejects; each row's title links
    to `/lists/:id`; the edit icon opens `EditListModal` without navigating; the delete
    icon opens `ConfirmDialog` without navigating; "New list" opens the create modal
    without navigating.
** Completed and Verified 2026-08-01 7:20 PM **

## Interaction 2 — Create a list (modal)

**Flow:** From `/lists` (or from any page, via the header/homepage "Start a list" CTA),
opening the create modal shows a form with a single required `title` field. **Save**
posts, closes the modal, and navigates to the new list's details page (`/lists/:id`).
**Cancel** closes the modal with no API call, leaving the user exactly where they were.

- **Backend:** `POST /api/lists`, body `ListCreate { title }` → validates → `INSERT`
  with `user_id = current_user.id` → returns `ListRead` (`201`).
- **Frontend:** `CreateListModal.vue` (new); client-side required-field check mirrors
  the backend's (empty title disables Save / shows inline error) but the backend
  remains the source of truth.
- **Tests:**
  - Backend: valid title creates a row owned by the caller (with `deleted_at` null);
    empty/whitespace-only title → `422`; title over 200 chars → `422`; unauthenticated
    → `401`.
  - Frontend: Save with a valid title calls the API, closes the modal, and navigates to
    `/lists/:id`; Save with an empty title is blocked client-side; Cancel closes the
    modal without calling `apiFetch` and without navigating; a `422`/`ApiError` from the
    backend surfaces as an inline error inside the still-open modal, not a crash.

## Interaction 3 — Rename a list (modal)

**Flow:** From an edit affordance on the index row, or from the details page, opening
the edit modal pre-fills the current title. **Save** submits the change, closes the
modal, and the underlying page (index row or details page) shows the new title —
no navigation. **Cancel** closes the modal, discarding the edit.

- **Backend:** `GET /api/lists/{list_id}` to load the form (owner-scoped,
  non-deleted-only, `404` otherwise) + `PATCH /api/lists/{list_id}` with
  `ListUpdate { title }` to save. Same validation as create.
- **Frontend:** `EditListModal.vue` (new) takes the list (already in hand from the
  index row, or the details page's fetch) so it doesn't necessarily need its own `GET`
  round-trip to open; Save calls `PATCH` and emits the updated list back up to whichever
  page opened it, Cancel just closes.
- **Tests:**
  - Backend: owner can fetch and update; a *different* authenticated user gets `404` on
    both `GET` and `PATCH` for someone else's list ID (the key ownership-isolation
    test); a soft-deleted list ID → `404` on both; nonexistent ID → `404`; invalid title
    → `422`; unauthenticated → `401`.
  - Frontend: modal pre-fills from the list it's given; Save calls `PATCH` with the
    edited title, closes the modal, and the page reflects the new title without a route
    change; Cancel closes without calling `apiFetch` and without changing the displayed
    title; a `404`/`422` surfaces as an inline error inside the still-open modal.

## Interaction 4 — Delete a list (soft delete)

**Flow:** A delete action is available both as the delete icon on an index row and as a
Delete button on the details page. Neither one deletes immediately — clicking it always
opens a confirmation dialog first ("Delete '<title>'? This can't be undone." with
**Delete**/**Cancel** buttons) and the API call only happens if the user confirms. This
is deliberate and applies everywhere delete is offered in this feature, not an
incidental detail: destructive + irreversible-from-the-user's-view actions always get a
confirm step, even though the row survives server-side for now as a soft-delete.

- **Backend:** `DELETE /api/lists/{list_id}` (owner-scoped, non-deleted-only like the
  rest) → sets `deleted_at = now()` → `204`. See §Soft delete above for the column and
  query-filtering details. The backend has no notion of "confirmation" — that's purely a
  frontend gate before the request is ever sent; the endpoint itself just deletes
  whatever it's asked to delete (once), which is exactly why the frontend must not call
  it without confirming first.
- **Frontend:** `ConfirmDialog.vue` (new, shared — first use of a
  confirm-before-destructive-action pattern in this codebase, reusable later for
  deleting items/comments) used from both the index row's delete icon and the details
  page's Delete button. Only the **Delete** button inside the dialog triggers the API
  call; the icon/button that opened it never calls the API directly. Confirming calls
  `DELETE` and removes the row from the index / redirects `/lists/:id` → `/lists` (since
  the details page you were looking at no longer resolves); cancelling (or dismissing,
  e.g. clicking outside or pressing Escape) closes the dialog with no API call and no
  state change.
- **Tests:**
  - Backend: owner delete sets `deleted_at` and the row stops appearing in `GET`s (index
    and single); a second delete of the same ID → `404` (it's already invisible, not
    "already gone" in a special way); a different user's delete attempt → `404`;
    unauthenticated → `401`.
  - Frontend: clicking delete (icon or button) opens the dialog but does **not** call
    `apiFetch` yet; confirming calls `DELETE` and updates the view (row removed from
    index, or redirect away from a now-gone details page); cancelling/dismissing closes
    the dialog and never calls `apiFetch`; the dialog is reachable from both entry
    points.

## Interaction 5 — List details page (stub)

**Flow:** Clicking a list from the index lands here. Shows the title (and, later, its
items) plus Edit and Delete affordances. For this feature, it's intentionally minimal:
title + an empty-state message for items — same "under construction" spirit as the
existing `CreateListView.vue` placeholder, just now backed by a real fetch instead of
being fully static.

- **Backend:** reuses `GET /api/lists/{list_id}` — no new endpoint.
- **Frontend:** `ListDetailView.vue` fetches by route param `id`, owner-scoped and
  non-deleted (a `404` here — from guessing a stranger's ID, a deleted list, or a stale
  bookmark — renders a friendly "not found" state, not a stack trace); hosts the edit
  affordance (opens `EditListModal`) and the delete affordance (opens `ConfirmDialog`).
- **Tests:**
  - Frontend: renders the fetched title; renders a "not found" state on `404`; Edit
    opens the modal without navigating; Delete opens the confirm dialog.
  - (Backend coverage for the `GET` itself is already exercised by Interaction 3's
    tests, since it's the same endpoint.)

## Testing strategy notes

- **Backend** runs against the real Dockerized Postgres via the existing
  `db_session`/`client`/`auth_client` fixtures (`backend/tests/conftest.py`) — per-test
  transactional rollback, no mocking the DB. New tests live in
  `backend/tests/test_lists.py` (route-level, via `client`/`auth_client`) and optionally
  `backend/tests/test_list_service.py` (service-level, matching the
  `test_user_service.py` pattern) for logic that's easier to exercise without HTTP.
- **The one gap to solve first:** ownership-isolation tests need *two* distinct
  authenticated identities, but `auth_client`'s `/auth/dev-login` always logs in as the
  same fixed `DEV_CLAIMS` user. Before writing "user A can't touch user B's list" tests,
  add a small test helper — e.g. a second fixture that creates a second `User` row
  directly and mints a session cookie for it (reusing `app.auth.session`'s signing, the
  same way `read_session`/`auth_client` already do) — so route-level cross-user tests
  are possible, not just service-level ones with two `db_session` rows and no HTTP.
- **Frontend** follows the existing colocated-`.spec.ts` pattern (`Vue Test Utils` +
  Vitest, e.g. `BaseButton.spec.ts`). New components get `ListsView.spec.ts`,
  `CreateListModal.spec.ts`, `EditListModal.spec.ts`, `ListDetailView.spec.ts`, and
  `ConfirmDialog.spec.ts`, each mocking `apiFetch` (via `vi.mock('@/api/client')`) rather
  than hitting a real backend — consistent with there being no MSW/network-mocking
  layer in the project yet. Modal tests in particular should cover "opened from
  page A, still on page A after cancel/save" — that's the whole point of the change.

## Parking lot: stateless auth (not part of this feature)

Raised as a "might not be worth pursuing" thought, so: not deciding this now, not
touching auth as part of Lists CRUD, just capturing the analysis so it's not lost.

The session model this app already has (`docs/DECISIONS.md` §Auth seam) is closer to
"stateless" than it might look: there's **no server-side session store** — no session
table, no Redis. The cookie is a signed, self-contained `{uid, tv}` blob
(`itsdangerous`), and each request re-verifies the signature and reloads the `User` row
to check `is_active`/`session_token_version`. The "state" is just the `users` table,
which the app needs to query anyway. That's a different (and much cheaper) thing than
the kind of session infrastructure that tends to hurt at larger scale — sticky sessions,
a replicated session cache, session affinity in a load balancer.

A fully stateless alternative (e.g. a bearer JWT the client holds, verified by signature
alone, no DB hit per request) would drop that per-request DB read, but at a real cost:
**this app's revocation model depends on it.** `deactivate_user` (instant ban) and
`revoke_all_sessions` (bump `session_token_version` to invalidate every outstanding
cookie at once) both work *because* every request re-checks the DB. A no-DB-check JWT
can't be instantly revoked without either short-lived tokens + refresh rotation (real
added complexity) or a server-side blocklist (which is server-side state again, just
renamed).

**Recommendation:** keep the current approach for now — it's already free of the
"massive, painful" session infrastructure this is presumably reacting to, and at
≤10 users the per-request DB lookup costs nothing measurable. If this is worth revisiting
later (e.g. once there's an API consumed by something other than the browser, where
cookies stop being the natural fit), it's a standalone architectural decision — belongs
in [docs/QUESTIONS.md](QUESTIONS.md), not folded into the Lists CRUD feature.

## Suggested build order

Small, reviewable, each slice shippable on its own (per CLAUDE.md "build
incrementally"):

1. Backend: soft-delete migration (`deleted_at` nullable/indexed on `lists`), then
   `list_service.py` + `schemas/list.py` + `routes/lists.py` for `GET`/`POST /api/lists`
   (index + create only, already filtering `deleted_at IS NULL`), with tests.
2. Frontend: `ListsView.vue` (`/lists` route) + `CreateListModal.vue`, wired to the real
   endpoint; retire the `/lists/new` route/stub; update `useStartList`/the header CTA to
   open the modal instead of navigating (including the login-intent change described
   above). Tests.
3. Backend: `GET`/`PATCH`/`DELETE /api/lists/{list_id}` — delete is a soft delete, the
   ownership dependency excludes soft-deleted rows, plus the two-identity test helper.
   Tests.
4. Frontend: `EditListModal.vue` + `ConfirmDialog.vue`, wired from the index row, with
   tests.
5. Frontend: `ListDetailView.vue` (`/lists/:id` route) stub with its own Edit/Delete
   affordances, with tests.
