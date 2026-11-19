# Architecture

How the built parts of Fav Fifty work, and **why** they're shaped the way they are.
Read this before changing lists, items, tags, on-device storage or the admin area. For *what's decided*
see [DECISIONS.md](DECISIONS.md); for *what's next* see [NEXT_STEPS.md](NEXT_STEPS.md).

The code is the source of truth for details. This doc keeps the reasons and the traps
that the code alone doesn't make obvious.

## Contents

- [Layers](#layers)
- [Lists](#lists)
- [Items](#items)
- [Tags and search](#tags-and-search)
- [Frontend patterns](#frontend-patterns)
- [Anonymous lists (on-device storage)](#anonymous-lists-on-device-storage)
- [Admin and analytics](#admin-and-analytics)
- [Testing notes](#testing-notes)

## Layers

**Backend** (`backend/app/`): `api/routes/*` validate input with `schemas/*` and call
`services/*`, which hold the business rules and talk to `models/*`. Routers stay thin;
services are plain functions taking a `Session`, so they're testable without HTTP.

**Frontend** (`frontend/src/features/lists/`):

| Layer | File | Role |
| --- | --- | --- |
| Composables and modals | `useDeleteList.ts`, `CreateListModal.vue`, … | One per operation, so each dialog has its own state. They say *what* to do and which copy to show. No try/catch. |
| Service | `useListAction.ts` | `run(repo => …)` owns `pending` / `error` / `errorKind`, the try/catch, and picking the message. |
| Factory | `useListRepository.ts` | Picks the repository **per call**: the API when signed in, the device otherwise. `setListRepository()` is the test seam. |
| Repository | `listRepository.ts`, `localListRepository.ts` | The `ListRepository` interface and its two implementations. Both throw `ListError`, never a storage-specific error. |
| Domain error | `listErrors.ts` | `ListError` with a `kind` (`not-found`, `conflict`, `invalid`, `storage`, `unauthenticated`, `unknown`) and an optional user-facing `detail`. |
| API client | `api/client.ts` | `apiFetch` / `ApiError`. Only the API repository uses it. |

**Limits** live once, in `backend/app/core/limits.py` (fixed: 50 items, title 200,
item text 500, note 2,000, image URL 2,048, tag 50) and `runtime_settings.py` (tunable:
`max_tags_per_list` 25, `max_lists_per_import` 100, `max_import_bytes` 5 MiB).
`GET /api/v1/config/client` serves both. The frontend's `clientConfig` store starts
from bundled copies of the same numbers and loads the server's in the background, so
anonymous use works even when the API is down.

## Lists

- **Ownership is checked in the query, every time.** `list_service.get_owned_list`
  scopes by `user_id == current_user.id` and `deleted_at IS NULL`. Someone else's list,
  a deleted list and a made-up id are **all `404`, never `403`**: a 403 would confirm
  the id exists. `user_id` is never taken from the client. Ids are UUIDs, so they
  can't be enumerated either.
- **Soft delete with one nullable `deleted_at` column**, not a boolean, which could
  drift out of sync with a timestamp. It's not `updated_at` either, which means "last
  edited". A future hard-delete job needs both facts. `DELETE` sets the column and
  returns `204`; a second `DELETE` is `404`. The `ON DELETE CASCADE` on items and tags
  is what will make that future job a one-liner.
- **`updated_at` changes only on a rename**, not on item or tag edits, so the lists
  page order doesn't jump around. The device storage copies this rule.
- **Known gap:** two of a user's lists can have the same title. Item text is already
  deduplicated per list (see below); title dedup is still open in
  [NEXT_STEPS.md](NEXT_STEPS.md).

## Items

- **Rank is `position`, 1..N, contiguous**, with `UNIQUE(list_id, position)`. An item
  is looked up by **both** its list and its id, so an item from another list is `404`
  even if you own it.
- **Reorder moves one item** (`PATCH …/items/{id}/position`) rather than replacing the
  whole order. That matches one drag-drop, and each move tests on its own. The response
  is the **full** reordered list, so the client swaps it in one go.
- **The reorder code avoids a Postgres trap.** A unique constraint is checked row by
  row, in no set order, so one bulk `UPDATE` that shifts a range of positions can
  collide with itself. `list_item_service.py` instead parks the moved item at a
  sentinel position, shifts the others one row at a time in a safe order, then lands
  it. Read the comments there before "simplifying" it to a bulk update.
- **The 50-item cap and case-insensitive duplicate text are checked in the service**,
  not the schema, because both need a query. Both are `409` with a `detail` the UI
  shows as it is.
- **Items are hard-deleted** (then the rest repack). Losing one item is small and easy
  to redo; the list's own soft delete covers the big loss.
- **`PATCH` on an item is a full replace** of text, note and image URL, sent together
  from one form. `image_url` must be `http(s)://`, so a `javascript:` or `data:` URL
  never reaches an `<img src>`.

## Tags and search

- **Tags are normalized in one place** (`tag_service.py`): trim, collapse internal
  whitespace, lower-case. Duplicates in one request are merged, not rejected.
- **`tags` rows are shared.** Two lists that both say "board games" use one row, which
  is why `list_tags` is many-to-many. A tag no list uses any more is **left in place**
  on purpose; pruning can come later if it ever matters.
- **`PUT /lists/{id}/tags` replaces the whole set**, matching the one-form modal. The
  wire shape is `string[]`, because the client never needs a tag's id.
- **Tags have their own service** rather than living in `list_service`, so they can
  grow (suggestions, categories) without bloating it.
- **Search is a filter, not a search engine.** `GET /lists?q=` matches a
  case-insensitive substring of the title **or** any tag (an `EXISTS`, so a list with
  two matching tags comes back once). A blank `q` means no filter. It only ever narrows
  the user's own lists.
- **`%` and `_` in `q` are escaped** (`escape="\\"` on every `ilike()`), so they match
  as the literal characters the user typed, not SQL wildcards.
- The frontend filters as you type, debounced in `useListSearch.ts`. That's the place
  to plug in autocomplete or fuzzy matching later.

## Frontend patterns

- **Modals, not pages, for create and edit.** Creating or renaming a list never
  navigates you away. `useListModalsStore` holds which modal is open, so "Start a list"
  in the header or on the homepage and "New list" on the index all open the same
  `CreateListModal` (mounted once in `App.vue`). The only navigation is *after* a
  create succeeds, to the new list.
- **`ConfirmDialog.vue` is generic.** Title, message and labels are props, and it never
  calls an API: the `useDelete*` composable that opens it does. Every destructive
  action goes through a confirm step.
- **One `ItemFormModal.vue`** handles add and edit (it's edit mode when an `item` prop
  is passed). Item modal state is local to the details page, since nothing else opens
  it.
- **Tags are edited in a modal with Save/Cancel**, like titles, as chips. `TagChip.vue`
  is styled unlike anything else, so a tag never reads as a list item or a button.
- **Drag-to-reorder uses `vue-draggable-plus`** (SortableJS underneath). Don't switch to
  `vuedraggable`: it's unmaintained and crashes mid-drag on Vue 3.5. Sortable runs with
  `forceFallback` + `fallbackOnBody`, so the dragged row is our own styled clone, desktop
  takes the same code path as touch, and Playwright can drive it. `vite.config.ts`
  excludes it from `optimizeDeps`, or the dev server loads a second copy of Vue. The
  up/down buttons call the same endpoint, so reordering never depends on dragging. On a
  failed move, rows snap back to the server's order.
- **Error copy:** a `409`/`422` (and a `storage` error) shows the backend's own
  `detail`; anything else shows a generic "try again".

## Anonymous lists (on-device storage)

Visitors can use everything above without signing in. Their lists live **only in their
browser**, and nothing about them reaches our server unless they choose to import.
Server-side guest accounts were considered and rejected: every drive-by visitor would
write rows, and we'd hold data from people who never agreed to the terms. The
repository split leaves room to add them later if Safari's storage wipe bites real
users.

### Choosing storage

`useListRepository()` returns the API repository when `isAuthenticated`, otherwise the
local one, resolved on every call, so signing in or out switches storage for the next
request without remounting anything. `useListsRefresh.ts` reloads what's on screen when
`isAuthenticated` changes, when a claim finishes, and on another tab's `storage` event.
Data from one storage never shows in the other. A device list's URL while signed in (or
the reverse) is simply "not found".

`/lists` and `/lists/:id` need no sign-in. "Start a list" opens the create modal for
everyone.

### The device document

One versioned JSON document under `localStorage["favfifty:v1"]`
(`localListDocument.ts`):

```jsonc
{
  "schema_version": 1,
  "device_id": "uuid",        // random, made once; the import's idempotency key
  "lists": [{
    "local_id": "uuid", "title": "…", "tags": ["…"],
    "created_at": "…", "updated_at": "…",
    "items": [{ "local_id": "uuid", "text": "…", "note": null, "image_url": null,
                "created_at": "…", "updated_at": "…" }]   // array order = rank
  }],
  "claimed_at": null
}
```

- **snake_case, the same field names as the API**, so it's uploaded with no mapping.
  v1 holds only fields the API has today. New fields (`kind`, `catalog_ref`) arrive as
  a `v1→v2` migration, and old documents and exported files are upgraded step by step
  on read.
- **Rank is array order.** The views get `id = local_id`, `position = index + 1`,
  `status = "draft"`, `item_count = items.length`.
- **Everything read from storage is untrusted** (the user or an extension can edit it).
  A hand-written guard (no Zod dependency) repairs structure (missing or duplicate ids,
  bad or non-ISO-8601 timestamps, non-http(s) image URLs) but **not limits**: an
  over-long list stays the user's, and the import rejects it with a reason. Timestamps
  must be ISO 8601 with an offset, as the server accepts; `11/14/2026` becomes now. A
  repair is written back on the read that made it, so a regenerated `device_id` sticks.
- **An unreadable document is set aside**, copied to `favfifty:v1:unreadable:<time>`,
  never overwritten. A document from a **newer** app version is left alone, and every
  call says "reload the page".
- **No in-memory cache.** Every call reads, changes and writes back in one synchronous
  step, so a second tab can't overwrite fresher data with a stale copy.
- **Blocked storage, a full quota or a newer document** is `ListError('storage')`, with
  user-facing copy.
- `listRules.ts` copies the backend's validators, messages included, and reads limits
  from `clientConfig`. Lengths count code points, as Python and Postgres do.

### Keeping device lists safe

Clearing browser data deletes device lists, and Safari deletes script-written storage
after 7 days without a visit. So:

- The lists page says **"Saved on this device only"**, with a "Sign in to keep them
  safe" link.
- The first list created (and every successful import) calls
  `navigator.storage.persist()`, on the click, because Firefox prompts for it.
- `BackupReminder.vue` shows a "Keep your lists safe" banner once the device has **2+
  lists or 20+ items**, with "Sign in" and "Export a backup". Dismissing it hides it for
  14 days (`favfifty:backup-reminder-dismissed`). These thresholds are constants, not
  runtime settings: they're UI decisions, not limits.
- Sign-in links go to a plain `/login`, never back to the current page. Sign-in lands
  on `/lists`, where the claim dialog opens.

### Export and import a file

Rules in `localListTransfer.ts`, I/O in `useListTransfer.ts`. Both work signed in or not.

- **Export** reads through the active repository and saves
  `fav-fifty-lists-YYYY-MM-DD.json` in the device document format, with **fresh ids and
  a fresh `device_id`**, so an account's server ids never end up in a shared file.
- **Import adds, never replaces.** It goes through the same parser as storage
  (migrations included) and skips unreadable entries, saying how many. **One invalid
  list rejects the whole file**, naming the list ("'Top Albums' has 51 items; the limit
  is 50."). Title clashes are renamed `"Title (2)"` (`uniqueTitle`, which keeps the
  same rule as the server's `unique_title`). Files over `max_import_bytes` (from
  `/config/client`) are refused unread.
- **Signed in, an import is one `POST /lists/import`** with a fresh `device_id` and
  fresh list ids (the file's may be longer than the server accepts), so importing the
  same file twice adds it twice rather than looking like a retry. The trade-off: if the
  response is lost and the user clicks Import again, the lists are added twice.

### Claim on sign-in

`ClaimListsDialog.vue` (mounted in `App.vue`) and its store, `useListClaim.ts`.

- When a user id appears in the auth store and the device has lists, it offers **"Bring
  your lists with you?"**, every list checked, newest first. "Not now" is remembered
  for the browser session (`sessionStorage["favfifty:claim-dismissed"]`); signing out
  clears it.
- It sends the device's own `device_id` and the stored lists in **one request**. A
  `422`/`413` keeps the dialog open with the server's message so the user can uncheck
  the list it names (or a generic "couldn't be uploaded" if the `detail` isn't one
  sentence); a `401` says to sign in again; other errors show "try again". Nothing on the device changes on
  failure.
- **On success** the uploaded lists are removed from the device and `claimed_at` is
  set, a toast reports the count and any renames, and the user lands on `/lists`.
  Unchecked lists stay and are offered again next time. If clearing them fails they're
  offered again too, which is safe because the import is idempotent.
- After the claim the server is the source of truth. **Signing out never shows the
  account's lists on the device**; that would leak them on a shared computer.

### `POST /api/v1/lists/import`

`list_import_service.py`, tested in `test_list_import.py`.

- **Body:** `{ device_id, lists: [{ local_id, title, tags, created_at, updated_at,
  items: [...] }] }`. Unknown fields are ignored, so the client sends the stored
  document as it is.
- **Same rules as a normal create**, using the same validator functions, but run in the
  service, so a `422`'s `detail` is one sentence naming the list, worded exactly like
  the file import's.
- **Atomic:** one transaction, everything or nothing.
- **Idempotent:** each list stores `import_key = "<device_id>:<local_id>"`, unique per
  account (not globally, so the same device can be claimed by different accounts). A
  retry returns `already_imported` with the existing list (or `null` if it's since been
  deleted; a deleted import stays deleted). A concurrent double-click trips the
  constraint, and the import retries once.
- **Title clashes** with the account's lists (exact, case-insensitive) are renamed
  `"Title (2)"` and reported in `renamed_from`.
- **Timestamps from the device are kept** (future ones clamped to now), so the lists
  page sorts the same after the claim.
- Over `max_lists_per_import` or `max_import_bytes` is a `413`. The byte check runs
  after the body is read, so the body-size limit planned in
  [ABUSE_PROTECTION_PLAN.md](ABUSE_PROTECTION_PLAN.md) §Request hygiene is still needed.
- Returns `200` (a retry creates nothing): `{ lists: [{ local_id, outcome, list,
  renamed_from }] }`.

## Admin and analytics

The owner's tools for **seeing what's happening** and **acting on it** without a
database shell or a redeploy, plus the numbers behind them. Decided as Q14 and
Q23–Q25 in [DECISIONS.md](DECISIONS.md); built 2026-10-14 to 2026-11-18. The admin
area is web-only, at `/admin` (its own lazy chunk), for one admin: the owner.

What still lands later, and where it's tracked:

- the deploy-time wiring (WAF IP sets, CloudWatch dashboard, cron, IAM, Cloudflare
  token and CSP): [DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md)
  §Sequencing;
- the breaker and its reset button: [COST_GUARDRAILS_PLAN.md](COST_GUARDRAILS_PLAN.md);
- the switches each future feature brings (`maintenance_mode`, `signups_enabled`,
  catalog and per-provider toggles, `showcase_enabled`, `import_enabled`): with that
  feature, in `runtime_settings.py`;
- deleting a user and their data: with account deletion
  ([MOBILE_READINESS.md](MOBILE_READINESS.md));
- a report queue for public content: ABUSE_PROTECTION_PLAN.md §Phase 3 hooks.

### Access control

- **Nothing in the app can make anyone an admin.** `users.role` (`user` | `admin`)
  is set only by `python -m app.cli grant-admin | revoke-admin` on the box
  (`tools/grant_admin.sh` locally), audit-logged with no admin id. No API accepts
  `role` as input; `tests/test_admin_access.py` checks every schema. There's no
  dev-login admin either: that would be an API path that grants admin.
- **`require_admin` sits on the admin router**, so a new route can't forget it; a
  test walks every `/admin` route. It builds on `get_current_user` (a locked admin is
  locked out) and also needs a **recent sign-in**: the session cookie's signed
  timestamp must be under 12 h old (`ADMIN_RECENT_LOGIN_SECONDS`, kept out of
  runtime settings so an SSM write can't weaken it).
- The router also adds the admin rate limit (60/min) and `Cache-Control: no-store`.
  The frontend's `/admin` guard is UX only.
- The owner's Google account has 2-step verification: it *is* the admin credential.

### Audit log

`admin_audit_log` gets one row for **every mutating admin action and every read of
someone's lists**, staged in the action's own transaction (`audit_service.record`
never commits), so an action and its row land or roll back together. When the action
writes outside Postgres (SSM, the `.env` file, the WAF), the row is flushed first and
committed only after that write succeeds: no record of a change that never happened.
Append-only: nothing updates or deletes rows.

- `target_id` is text (a UUID, a setting key, a CIDR), not a foreign key.
  `admin_user_id` is null for CLI actions.
- **A list is named by its owner, never its title** (`details.owner_id`), so reading
  the log doesn't leak content. The audit page (`/admin/audit`) shows "a list of
  <owner>", and opening the list is itself a logged read.
- `GET /admin/audit-log` adds `admin_display_name` and `subject_user_id`/`_name` (the
  target user, or a list's owner) and filters by `subject_user_id`, so a user's page
  can link to everything about them, their lists included.

### Runtime settings

One mechanism for everything the owner changes without a deploy: feature switches,
limits, provider toggles, and later the breaker. `app/core/runtime_settings.py` holds
typed, bounded models with code defaults.

- **SSM Parameter Store in AWS, not Postgres,** so the breaker Lambda can flip a
  switch without reaching the box, and the box and Lambda read the same values.
  Locally they're `RUNTIME_<GROUP>__<NAME>` lines in `backend/.env`, which the
  Settings page writes (409 for a key pinned by a real env var).
- **Fail safe:** a missing or invalid value uses the code default, and unreachable
  SSM means optional features **off** and limits at their defaults. So every new
  switch defaults to off (e.g. `features.events_enabled`).
- A ~30 s in-process cache is an optimization only; a write drops this process's
  copy, so it applies here at once and elsewhere within ~30 s.
- `GET /config/client` serves the user-facing subset, so web and mobile validate and
  degrade the same way.

### Content

The owner may read any user's lists (Q24), and the privacy policy says so plainly.

- The user page loads their lists only on "Show lists": opening a profile never reads
  content implicitly. Item image URLs show as text, never loaded.
- **Remove** reuses the owner's soft delete and needs a reason. **Restore** undoes
  only an admin removal (the latest `remove_list`/`restore_list` row decides), so the
  admin can't resurrect a list its owner deleted (409). It ignores the owner's list
  quota, since it puts back a list they already had.
- **Lock** also ends the user's sessions, so a later unlock doesn't revive an old
  cookie. You can't lock yourself.

### Dashboards

`GET /admin/dashboard` returns aggregates only, cached 5 minutes (`?refresh=true`
skips the cache). Charts are a hand-rolled SVG `BarChart.vue`, each with a table
view; no chart library.

- **Product:** totals and 30-day daily counts from the existing tables.
- **Health:** `RequestCountMiddleware`, the outermost layer (so it also counts what
  the guards refuse), upserts `request_counts` per minute × route class × status
  class (2xx/3xx/4xx/429/5xx; `/health` isn't counted). The write runs before the
  response returns (no background work) and never fails a request. It's off on Lambda
  (no DB) and in memory under pytest. Edge, Lambda and box metrics belong in the
  CloudWatch dashboard, which the page links to.
- **Cost:** `python -m app.cli daily-jobs` (cron, once a day) makes **one** Cost
  Explorer call ($0.01) into `cost_snapshots`. The forecast is a free straight-line
  projection, not the paid forecast API.
- `daily-jobs` is the only housekeeping: it prunes request counts (35 days) and
  per-IP counts (7 days), re-rolls 2 days of analytics, and prunes raw events (90
  days).

### Analytics

Two sources, neither using cookies:

- **Traffic: Cloudflare Web Analytics.** `src/analytics/cloudflare.ts` adds the
  beacon in production builds when `VITE_CF_BEACON_TOKEN` is set.
- **Product events: first-party `POST /events`.** Anonymous visitors' lists live on
  their device, so the server only learns what they do through these.
  - Behind `features.events_enabled` (default off). The endpoint is public, rate
    limited per IP, capped at 16 KiB and 50 events, and always answers `204`.
  - **No free text can be stored:** the allowlist in `analytics_service.py` fixes
    each event's props *and their values* (e.g. `import_started.target` is device,
    account or claim). Unknown names and props are dropped, not rejected, so a newer
    mobile app doesn't break against an older server. Keep the frontend's
    `EVENT_NAMES` in step.
  - The user id comes **only** from the session cookie; no IP is stored with events.
    Client timestamps outside [now − 1 day, now + 5 min] are replaced.
  - `analytics_events` keeps 90 days; `analytics_daily` (day × name × platform ×
    signed in) keeps the totals. The dashboard reads the rollup for past days and
    computes today live.
  - The client (`src/analytics/events.ts`) queues from page load, sends only once
    `/config/client` says it's on, and drops the queue if it's off. It flushes 5 s
    after the first event, at 50, and on page hide, with `fetch(…, { keepalive:
    true })`: `sendBeacon` can't send `application/json` reliably. A Google sign-in's
    success is counted after the redirect, from a `sessionStorage` flag.
- **Errors:** logs on the box plus the 5xx counter. Sentry stays an option.

### Abuse view

`/admin/abuse`: who's being rate limited, the busiest addresses, and the block list.

- **Counts:** the same middleware upsert also writes `ip_request_counts` (IP × hour
  → requests, 429s). These are **the only IP addresses the app keeps**, for 7 days,
  as the privacy policy says. The page ranks the 25 busiest IPs, most 429s first.
- **The block list is the WAF's** (decided 2026-11-18). The WAF is the single source
  of truth and the only enforcer, so a blocked visitor never reaches the app, the
  Lambda routes included. `app/core/ip_blocklist.py` edits two WAFv2 IP sets (WAF
  keeps one address family per set), scope `CLOUDFRONT`, so the API is in us-east-1,
  and retries on `WAFOptimisticLockException`. Locally (`IP_BLOCKLIST_SOURCE=local`)
  it's a git-ignored `.ip_blocklist.local.json` that **nothing enforces**, and the
  page says so.
- Who blocked what, and why (a reason is required), lives in the audit log
  (`block_ip`/`unblock_ip`, target type `ip`), not in the IP set.
- Refused: ranges wider than a /24 (IPv4) or /48 (IPv6), your own current address,
  duplicates, and more than 1,000 entries.

## Testing notes

- **Backend tests run against the real Dockerized Postgres** with per-test rollback.
  `second_user_client` gives a second identity for "user A can't touch B's list" tests.
- **The local DB is shared** by pytest, Playwright and manual testing. pytest and manual
  testing use the fixed dev-login user, so a pytest test that asserts "exactly these
  rows for this user" must use `fresh_user` / `fresh_user_client`, not the dev user.
  Each Playwright test signs in as its own fresh dev user (`?user=<key>` on dev-login,
  added by `frontend/e2e/fixtures.ts`), so e2e specs need no cleanup.
- **Frontend specs that mock `apiFetch`** must pin the API repository with
  `pinApiRepository()` (`repositoryTestUtils.ts`), or they'd run against device
  storage as an anonymous visitor.
- **Playwright** (`frontend/e2e/`) covers items with a real drag, tags and search,
  anonymous use, and the claim. A Sortable drag needs press → small move → stepped
  glide → release; `dragTo()` is too abrupt. Specs import `test`/`expect` from
  `e2e/fixtures.ts`, not `@playwright/test`. Every spec runs three times: desktop
  light (`chromium`), desktop dark (`chromium-dark`) and phone-sized (`mobile`,
  Pixel 7), all Chromium. `accessibility.spec.ts` runs axe on every page and dialog;
  use `expectAccessible(page, '<screen>')` from `fixtures.ts` on new screens. CI runs
  them too (`e2e` job, retries
  and an uploaded report + traces on failure).
- **Admin e2e** (`e2e/admin.spec.ts`) makes its dev user an admin with the real
  grant-admin CLI, the way the owner does. Anything it changes outside its own rows
  (the local block-list file) it undoes in a `finally`.
