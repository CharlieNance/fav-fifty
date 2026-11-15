# Anonymous Use + Local Lists — Implementation Plan

Planning doc for letting people **use Fav Fifty without signing in**: build lists that
are saved on their own device as JSON, then **upload them to an account** if they sign
up later. This is **Track 1** in [NEXT_STEPS.md](NEXT_STEPS.md). **Decided in
[QUESTIONS.md](QUESTIONS.md) (2026-10-13):**

- **Q11:** device-only storage.
- **Q12:** rename `"Title (2)"` on a conflict; reject the whole import if any list is
  invalid; clear the local copy after a successful import.
- **Q25:** limits are runtime-configurable.

## Status and where to start

*Last checked against the code: 2026-11-14 (after PR 7).*

- **PR 1 (repository refactor) is done** on `feat/track1_anon_local_list`. All 11
  call sites go through the layers described in [§Layers](#layers-as-built-in-pr-1).
  The repository is resolved **per request**, so PR 4 can switch implementations on
  sign-in/out without remounting anything.
- **PR 2 (shared limits) is done** on the same branch. The fixed limits live in
  [limits.py](../backend/app/core/limits.py) and are served by `GET /api/v1/config/client`.
  The frontend reads them from the `clientConfig` store
  ([clientConfig.ts](../frontend/src/stores/clientConfig.ts)), which starts with bundled
  defaults and loads the server's values in the background from `main.ts`.
- **PR 3 (`LocalListRepository`) is done** on the same branch, with unit tests. It's
  split into three modules:
  - [listRules.ts](../frontend/src/features/lists/listRules.ts): the backend's
    validators, error copy included, reading the limits from the `clientConfig`
    store. Lengths count code points, as Python and Postgres do.
  - [localListDocument.ts](../frontend/src/features/lists/localListDocument.ts):
    the format, the migrations, the untrusted-data parser and `localStorage` I/O.
  - [localListRepository.ts](../frontend/src/features/lists/localListRepository.ts):
    `createLocalListRepository()`.
- **PR 4 (anonymous visitors) is done** on the same branch:
  - `/lists` and `/lists/:id` are open to everyone. `useListRepository()` returns the
    API when signed in and the local repository otherwise, resolved per call.
  - "Start a list" opens the create modal for everyone. `START_LIST_REDIRECT` and the
    `?openCreate=1` handling are gone (the login page never used them).
  - [useListsRefresh.ts](../frontend/src/features/lists/useListsRefresh.ts) reloads the
    lists page, the detail page and the home CTA when `isAuthenticated` changes, and
    on another tab's `storage` event while anonymous.
  - The header shows "My lists" to everyone. The lists page tells anonymous visitors
    "Saved on this device only".
  - `useListAction` always shows a `storage` error's own copy, and both pages show it
    in place of the generic load error.
  - The first list created on the device calls `navigator.storage.persist()`, on the
    click rather than on page load, because Firefox prompts for it.
  - Specs that mock `apiFetch` pin the API repository with `pinApiRepository()`
    ([repositoryTestUtils.ts](../frontend/src/features/lists/repositoryTestUtils.ts)).
    New Playwright spec: [anonymous-lists.spec.ts](../frontend/e2e/anonymous-lists.spec.ts).
- **PR 5 (export/import a file) is done** on the same branch. Everyone gets Export on
  the lists page; Import is for anonymous visitors until the server import exists. The rules are in
  [localListTransfer.ts](../frontend/src/features/lists/localListTransfer.ts), and
  [useListTransfer.ts](../frontend/src/features/lists/useListTransfer.ts) does the
  file and storage I/O. See [§Export/import a file](#exportimport-a-file-pr-5).
- **PR 6 (`POST /api/v1/lists/import`) is done** on the same branch, in
  [list_import_service.py](../backend/app/services/list_import_service.py), with tests
  in [test_list_import.py](../backend/tests/test_list_import.py). See
  [§New endpoint](#new-endpoint-post-apiv1listsimport) for what was built.
- **PR 7 (the claim dialog) is done** on the same branch. See
  [§Claim on sign-in](#claim-on-sign-in-upload-local-lists) for what was built:
  - [ClaimListsDialog.vue](../frontend/src/features/lists/ClaimListsDialog.vue)
    (mounted in `App.vue`) and its store,
    [useListClaim.ts](../frontend/src/features/lists/useListClaim.ts).
  - `apiListRepository.importLists` calls `POST /lists/import`. It's on the API
    repository only (`AccountImport`), not on `ListRepository`, because device
    storage has nothing to upload to.
  - `max_lists_per_import` is in the frontend's `ClientLimits` (default 100).
  - **File Import works for signed-in users** and goes through the same endpoint.
  - A 413 is now `ListError('invalid')`, so its `detail` is shown.
  - Playwright covers anonymous create → sign in → claim → lists in the account,
    and a signed-in file import.
- **Next: PR 8 (privacy policy and docs).**
- **The reminder banner and the sign-in prompt are done too**, on the same branch:
  - [BackupReminder.vue](../frontend/src/features/lists/BackupReminder.vue)
    shows anonymous visitors a "Keep your lists safe" banner on the lists page and
    each list's page, once the device has **2+ lists or 20+ items**. It has two
    actions, "Sign in to keep them" and "Export a backup". Dismissing it hides it for
    **14 days** (`favfifty:backup-reminder-dismissed` in `localStorage`). The rules
    are in [useBackupReminder.ts](../frontend/src/features/lists/useBackupReminder.ts),
    as constants rather than runtime settings, because they're UI copy decisions,
    not limits.
  - The lists page's "Saved on this device only" note always ends with a **"Sign in
    to keep them safe"** link for anonymous visitors.
  - Both go to a plain `/login`, never back to the current page. Sign-in then lands
    on `/lists`, where the claim dialog opens. A device list's own URL would be
    "not found" in the account.
  - The banner updates as soon as this tab saves: `localListsRevision` in
    `localListDocument.ts` goes up on every save. It also updates on other tabs'
    `storage` events.
- **Decisions made while building PR 3:**
  - **A new `ListErrorKind`, `storage`,** for blocked storage, a full quota, or a
    document saved by a newer app version. Its `detail` is always user-facing copy,
    so PR 4 can show the "can't save here" state from it.
  - **No in-memory cache:** every call reads storage, changes it and writes it back
    in one synchronous step. A second tab can't overwrite fresher data with a stale
    copy, so PR 4's `storage` listener only has to refresh what's on screen.
  - **An unreadable document is set aside, not overwritten.** It's copied to
    `favfifty:v1:unreadable:<time>` and removed. A **newer-version** document is left
    alone, and every call says "reload the page".
  - **The parser repairs structure but not limits.** Missing ids, duplicate ids, bad
    timestamps, and non-http(s) image URLs are dropped or fixed. A 60-item or
    over-long list is kept as it is, since the user's data stays theirs, and the
    import rejects it with a reason (Q12).
  - **`updated_at` matches the server:** only a rename bumps a list's `updated_at`.
    Item changes and tag changes don't, so the order of the lists page is the same
    whether you're signed in or not.
  - **No Zod:** the parser is a hand-written guard, so there's no new dependency.
- **Already in place:**
  - `GET /api/v1/config/client` ([config.py](../backend/app/api/routes/config.py))
    serves every content limit (PR 2).
  - The auth store exposes `isAuthenticated`
    ([auth.ts](../frontend/src/stores/auth.ts)). The repository will be chosen from it.
  - The frontend types (`ListSummary`, `ListItem`, `ListItemDraft` in
    [types.ts](../frontend/src/features/lists/types.ts)) already mirror the API in
    snake_case. The repository interface uses them as they are.
- **Changes to this plan since it was first written:**
  - The v1 local format now stores **only the fields the API has today**. The earlier
    draft also had `description`, `kind` and `catalog_ref`, which don't exist yet
    (`kind` and `catalog_ref` arrive with Track 2). Each will be added later as a
    schema-version migration (see [§Local storage format](#local-storage-format-versioned-json)).
  - **Type-ahead lookup for anonymous visitors is moved to Track 2.** Catalog search
    isn't built, so Track 1 adds no backend route that works without a session.
  - **After a successful claim the local copy is cleared**, as Q12 decided. The earlier
    "keep it read-only for a while" option is dropped.
  - **Title conflicts on import:** list-title dedup hasn't shipped (it's still open in
    Phase 2). The import renames on an exact, case-insensitive match against the
    account's existing titles anyway, so it doesn't depend on that work.

## Why

The current funnel asks for a Google sign-in before someone has made anything. Most of
the audience arrives from a Discord link on a phone, and many will leave at a login
wall. Letting people build first and sign in later (only to save across devices,
publish or share) gets them to the fun part sooner. It also gives the mobile apps an
offline mode almost for free (see [MOBILE_READINESS.md](MOBILE_READINESS.md)).

## Scope

### In scope

- Anonymous visitors can create, rename, delete and tag lists, and add, edit, reorder
  and delete items, with the same rules as signed-in users (50-item cap, no duplicate
  items, same length limits).
- Anonymous lists are stored **only on the device** (browser storage), as versioned
  JSON. Nothing is written to our database for an anonymous visitor.
- **Claim on sign-in:** after signing in, the user is offered to upload their local
  lists to the account. The upload is one validated, idempotent bulk import.
- **Export/import a file:** download your local lists as a `.json` file, and load
  one back in. This is cheap to add once the format exists, and it's the only backup
  an anonymous user has.

### Out of scope (for now)

- **Type-ahead lookup for anonymous visitors.** It comes with Track 2
  ([CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md)), which also brings the rate
  limiting a sessionless route needs.
- **Server-side guest accounts** (an anonymous user row with a device token). See
  §Alternative considered. We can add it later without breaking the local format.
- **Publishing or sharing an anonymous list.** Public URLs need a server copy, and
  publishing is the natural moment to ask someone to sign in.
- **Ongoing two-way sync** between local and server copies after the claim. Once
  claimed, the server is the source of truth for that user (see §After claim).
- Sync between two devices without an account.

## Key design: one list repository, two storage backends

Today every list composable and two modals call `apiFetch` directly. The core refactor
puts a **repository interface** in between:

```text
features/lists/*  ──►  useListAction ──►  ListRepository (interface)
                                            ├── ApiListRepository     (signed in → REST API, today's behaviour)
                                            └── LocalListRepository   (anonymous → device storage)
```

### Layers (as built in PR 1)

| Layer | File | Role |
| --- | --- | --- |
| Composables and modals | `useDeleteList.ts`, `CreateListModal.vue`, … | One per operation, so each dialog has its own state. Say *what* to do and which copy to show. No try/catch, no `ApiError`. |
| Service | [useListAction.ts](../frontend/src/features/lists/useListAction.ts) | `run(repo => …)` owns `pending` / `error` / `errorKind`, the try/catch, and picking the message (storage copy for kinds in `showDetailFor`, otherwise the fallback). |
| Factory | [useListRepository.ts](../frontend/src/features/lists/useListRepository.ts) | Picks the repository; `setListRepository()` is the test seam. |
| Repository | [listRepository.ts](../frontend/src/features/lists/listRepository.ts) | The `ListRepository` interface and `apiListRepository`. Translates failures into `ListError` at the boundary. |
| Domain error | [listErrors.ts](../frontend/src/features/lists/listErrors.ts) | `ListError` with a `kind` (`not-found`, `conflict`, `invalid`, `storage` (on-device only, added in PR 3), `unknown`) and optional user-facing `detail`. |
| API client | [client.ts](../frontend/src/api/client.ts) | `apiFetch` / `ApiError`. Only the API repository uses it. |

- The interface uses the **same TypeScript types** the views already use
  (`ListSummary`, `ListItem`, `ListItemDraft`). Views shouldn't know which storage
  they're using.
- The auth store chooses the implementation: logged in → API, logged out → local.
  Expose it through a small `useListRepository()` composable, so tests can inject a
  fake.
- **Errors look the same from both.** Both throw `ListError`, never a
  storage-specific error: `not-found` for a missing list or item, `conflict` for the
  50-item cap or a duplicate item, `invalid` for validation, with the same `detail`
  copy the API writes. `ApiListRepository` translates `ApiError` at its boundary;
  `LocalListRepository` throws `ListError` directly (no faked HTTP status codes).
- `LocalListRepository` applies **the same rules as the backend**: 50-item cap,
  case-insensitive item dedup, title/text/note/URL length limits, tag normalization.
  These rules are only a convenience, because the server checks everything again at
  import time (see §Claim).
- Doing this refactor **first**, behind the existing API behaviour and with no
  user-visible change, is the safe first PR. The existing Vitest specs should pass
  against the API implementation (they mock `apiFetch` today; mocking may move to the
  repository, but the behaviour they check must not change).

This interface is also what the mobile apps' offline storage will implement
(SQLite or Capacitor Preferences instead of `localStorage`).

### Proposed interface

```ts
interface ListRepository {
  // lists
  getLists(q?: string): Promise<ListSummary[]>
  getList(id: string): Promise<ListSummary>
  createList(title: string): Promise<ListSummary>
  renameList(id: string, title: string): Promise<ListSummary>
  deleteList(id: string): Promise<void>
  setTags(id: string, tags: string[]): Promise<ListSummary>
  // items
  getItems(listId: string): Promise<ListItem[]>
  createItem(listId: string, draft: ListItemDraft): Promise<ListItem>
  updateItem(listId: string, itemId: string, draft: ListItemDraft): Promise<ListItem>
  deleteItem(listId: string, itemId: string): Promise<void>
  moveItem(listId: string, itemId: string, position: number): Promise<ListItem[]>
}
```

Method names are a suggestion. Match each one to what the existing endpoint returns,
so `ApiListRepository` is a thin wrapper around `apiFetch`.

### Call-site inventory (PR 1)

Every place in `frontend/src/features/lists/` that calls `apiFetch` today. Each moves
behind the repository:

| File | Call | Repository method |
| --- | --- | --- |
| `useLists.ts` | `GET /lists?q=` | `getLists` |
| `useListDetail.ts` | `GET /lists/:id` | `getList` |
| `CreateListModal.vue` | `POST /lists` | `createList` |
| `EditListModal.vue` | `PATCH /lists/:id` | `renameList` |
| `useDeleteList.ts` | `DELETE /lists/:id` | `deleteList` |
| `useListTags.ts` | `PUT /lists/:id/tags` | `setTags` |
| `useListItems.ts` | `GET /lists/:id/items` | `getItems` |
| `useCreateItem.ts` | `POST /lists/:id/items` | `createItem` |
| `useUpdateItem.ts` | `PATCH /lists/:id/items/:itemId` | `updateItem` |
| `useDeleteItem.ts` | `DELETE /lists/:id/items/:itemId` | `deleteItem` |
| `useReorderItem.ts` | `…/items/:itemId/position` | `moveItem` |

Check each file's HTTP method and body against the code when you move it; the table
lists what each call does, not its exact arguments. The two modals are the odd ones
out: they call the API from the component instead of a composable. Move those calls
into the repository (or a small `useCreateList` / `useRenameList` composable) as part
of PR 1.

`useStartList.ts` doesn't call the API, but it sends logged-out users to the login
page. PR 4 changes that (see §Frontend changes).

## Local storage format (versioned JSON)

One document per device, under a single key (`favfifty:v1`). **v1 holds only the
fields the API has today:**

```jsonc
{
  "schema_version": 1,
  "device_id": "uuid",            // random, generated once; used for import idempotency
  "lists": [
    {
      "local_id": "uuid",         // client-generated; never sent as a server id
      "title": "Top 50 Albums",
      "tags": ["music", "albums"],
      "created_at": "2026-10-13T18:00:00Z",
      "updated_at": "2026-10-13T18:05:00Z",
      "items": [                 // array order = rank; no stored position field
        {
          "local_id": "uuid",
          "text": "In Rainbows",
          "note": null,
          "image_url": "https://…",
          "created_at": "2026-10-13T18:01:00Z",
          "updated_at": "2026-10-13T18:01:00Z"
        }
      ]
    }
  ],
  "claimed_at": null              // set after a successful upload (see §After claim)
}
```

**Later versions** add fields as they ship: `kind` on lists and `catalog_ref` on items
(Track 2, see [CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md)), and `description` if
lists ever get one. Each is a `v1→v2` migration that fills in `null`.

Decisions inside the format:

- **`schema_version` + a migration function per version.** On read, older documents
  are upgraded step by step (`v1→v2→…`) before use. Files exported months ago must
  still import.
- **Rank is array order.** That avoids the unique-position bookkeeping the server
  needs (`UniqueConstraint(list_id, position)`), and the import endpoint assigns
  `position = index + 1`.
- **Mapping to the API types.** `LocalListRepository` derives the fields the views
  expect, rather than storing them:
  - `ListSummary.id` = `local_id`
  - `ListSummary.status` = `"draft"`
  - `ListSummary.item_count` = `items.length`
  - `ListItem.id` = `local_id`
  - `ListItem.list_id` = the parent's `local_id`
  - `ListItem.position` = index + 1
- **The import endpoint uses the same field names as the API.** The wire format is
  **snake_case** (settled when the avatar casing bug was fixed, commit `3f98dcd`), so
  the stored document uses snake_case keys too, and is sent with no mapping.
- **Everything read from storage is untrusted.** A user (or a browser extension) can
  edit it. Parse it with a schema validator (Zod or a hand-written guard; either
  must be MIT-licensed) and drop or repair bad entries rather than crashing. Vue
  escapes text on render already, and we still never use `v-html` on it.

### Where it's stored, and its limits

- **`localStorage`** is enough to start: synchronous and simple. A full 50-item list
  is roughly 10–20 KB, so even 100 lists fit well within the ~5 MB quota. Wrap every
  read and write in `try/catch` (private mode and blocked storage throw). If storage
  is unavailable, show a clear "Your browser isn't letting us save here" state rather
  than losing edits silently.
- **Safari deletes script-written storage after 7 days without a visit**
  (Intelligent Tracking Prevention). That's the biggest risk to anonymous data. The
  mitigations, all of them worth doing:
  - Clear UI copy: "Saved on this device only."
  - Call `navigator.storage.persist()` (a best-effort request to protect the data).
  - Offer **Export** prominently, and offer sign-in as "keep your lists safe".
  - A gentle reminder banner once someone has, say, 2+ lists or 20+ items.
- **Move to IndexedDB** only if we outgrow `localStorage` (e.g. if we ever store
  image blobs locally). Not needed for text plus URLs.
- **Multiple tabs:** listen for the `storage` event so a second tab reloads instead
  of overwriting with stale data. Last write wins, which is acceptable for one
  person on one device.

## Export/import a file (PR 5)

As built.

- **Export is for everyone.** It reads through the active repository, so a signed-in
  user exports their account's lists (one request per list, made one at a time) and
  an anonymous visitor the device's. That covers taking an account's lists to a
  machine you can't sign in on, or sending them to a friend.
- **Import is for everyone (since PR 7).** Signed in, the file goes to the account
  through `POST /lists/import` in one all-or-nothing request, never one list at a
  time, which could leave half a file imported (Q12). The file is checked on the
  client first with the same rules and messages, including `max_lists_per_import`.
  Each import sends a **fresh `device_id`**, so importing the same file twice adds
  it twice, as on a device, instead of being treated as a retry.
- **The file uses the on-device document format** (pretty-printed,
  `fav-fifty-lists-YYYY-MM-DD.json`), with **fresh ids and a fresh `device_id`**, so
  an account's server ids never end up in a file that gets shared. An import goes
  through the same `parseDocument` as storage, migrations included, so old exports
  keep working. Export with no lists shows a toast instead of saving an empty file.
- **Import adds to the device's lists; it never replaces them.** Nothing is
  overwritten, so it needs no confirmation.
- **Unreadable entries are skipped, and the visitor is told.** `parseDocument`
  counts the lists and items it drops (no id, no title or text, a repeated id). The
  import toast says how many and turns into a warning. A file with no readable lists
  at all is rejected.
- **One bad list rejects the whole file (Q12's rule),** with a message naming the list,
  e.g. "'Top Albums' has 51 items; the limit is 50." Every list is checked with the
  same rules as a normal create (title, tags, item fields, the item cap, duplicate
  items). That keeps data the server would refuse at claim time off the device.
  Nothing is written on a failure.
- **Title clashes are renamed `"Title (2)"`** (Q12), against the device's lists and
  earlier lists in the same file. `uniqueTitle` shortens the base if the suffix would
  go over the title limit. PR 6 must do the same.
- **Imported lists and items get fresh `local_id`s.** Re-importing a backup while the
  originals are still here then can't collide, and each list keeps a unique
  `device_id:local_id` key for the claim. Timestamps from the file are kept, and the
  device keeps its own `device_id`.
- **Files over 5 MB are refused without being read.** That's about a whole
  `localStorage` quota, far above any real export.
- A successful import also calls `navigator.storage.persist()`, as creating a list does.

## Shared limits (PR 2)

Today the limits live in three places that can drift apart:

- **Backend validators:** title ≤ 200 in [list.py](../backend/app/schemas/list.py);
  text, note and image URL limits in [list_item.py](../backend/app/schemas/list_item.py);
  the 50-item cap in [list_item_service.py](../backend/app/services/list_item_service.py);
  tag length ≤ 50 in [tag_service.py](../backend/app/services/tag_service.py).
- **Runtime settings:** `max_tags_per_list` in
  [runtime_settings.py](../backend/app/core/runtime_settings.py), the only limit
  served by `GET /api/v1/config/client` today.
- **Frontend:** `MAX_ITEMS = 50` in `itemCountTier.ts`, and `maxlength` attributes in
  the create, edit and item-form modals.

**Recommended approach:**

1. **Backend:** move the fixed limits into one constants module (e.g.
   `app/core/limits.py`) that the validators and services import. Add them to
   `ClientLimits` as **new fields**: `max_items_per_list`, `max_title_length`,
   `max_item_text_length`, `max_note_length`, `max_image_url_length`,
   `max_tag_length`. This is an additive change, so it's fine within v1. Regenerate
   `openapi.json` with `./tools/openapi_snapshot.sh`.
   - Length limits that match a DB column size stay **constants**, not runtime
     settings. Changing them needs a migration anyway.
   - The 50-item cap is the product's identity, so it stays a constant too. It's
     served so clients don't hard-code it, not so it can be tuned.
2. **Frontend:** a `useClientConfig` store fetches `/config/client` once at startup.
   It falls back to **bundled defaults** (the same numbers) if the request fails, so
   anonymous use still works offline or when the API is down. The modals,
   `itemCountTier.ts` and `LocalListRepository` read from it.

## Claim on sign-in (upload local lists)

Flow:

1. An anonymous user with local lists signs in (the Google round-trip, then a
   redirect back).
2. The app sees unclaimed local lists and shows a **"Bring your lists with you?"**
   dialog that lists them, with all checked by default.
3. The client sends the selected lists to a new endpoint in **one request**.
4. On success the device document gets `claimed_at` set and the imported local lists
   are cleared (Q12). The user lands on `/lists` with the imported lists.

**As built (PR 7):**

- **When it's offered:** whenever a user id appears in the auth store (a sign-in,
  or a page loaded while signed in) and this device has lists. Every list is
  checked to start with, newest first, with its item count.
- **"Not now"** is remembered in `sessionStorage` (`favfifty:claim-dismissed`,
  the user's id), so reloading the page doesn't ask again. Signing out clears it, so
  the next sign-in asks again. So does a new browser session.
- **The upload** sends the device's own `device_id` and the stored lists as they
  are. Over `max_lists_per_import` checked, the Add button is disabled with a note.
- **A rejection** (422, or the 413s) keeps the dialog open with the server's
  message, so the user can uncheck the list it names. A network or server error
  shows generic "try again" copy. Nothing on the device changes.
- **On success** the uploaded lists are removed from the device and `claimed_at`
  is set. If that write fails, the lists stay on the device and are offered again.
  The import is idempotent, so offering them again can't duplicate them. Then the
  user lands on `/lists`, a toast says how many were added and any renames, and
  pages already showing lists reload (`useListsRefresh` watches `claimCount`).

### New endpoint: `POST /api/v1/lists/import`

**As built (PR 6).** Where this differs from the plan below, the code wins:

- **Body:** `{ device_id, lists: [{ local_id, title, tags, created_at, updated_at,
  items: [{ text, note, image_url, created_at, updated_at }] }] }`. Unknown fields
  (`schema_version`, `claimed_at`, item `local_id`s, a later schema's `kind`) are
  ignored, so the client can send the stored document as it is. `device_id` and
  `local_id` are 1–64 characters, and `device_id` can't contain `:`.
- **Rules run in the service, not the schema,** so a 422's `detail` is one
  sentence naming the list, worded exactly as the frontend's file import words it
  (e.g. `'Top Albums' has 51 items; the limit is 50.`). The validators are the same
  functions the normal routes use (`validated_title`, `validated_text`, …).
- **Response:** `{ lists: [{ local_id, outcome, list, renamed_from }] }`, one entry
  per uploaded list, in order. `outcome` is `created` or `already_imported`.
  `list` is the `ListRead`, or `null` if it was already imported and has since been
  deleted (a deleted import stays deleted). `renamed_from` is the requested title
  when it was renamed, and is always `null` for `already_imported`.
- **Timestamps from the device are kept,** so the lists page sorts the same after
  the claim. A timestamp in the future is clamped to now, `updated_at` is never
  earlier than `created_at`, and one without an offset is read as UTC.
- **Idempotency:** `import_key` is unique per account, not globally, so the same
  device's lists can go to whichever account claims them. A concurrent duplicate
  (double-click) trips the unique constraint, and the import retries once and
  returns the winner's lists.
- **Limits:** two runtime settings, `max_lists_per_import` (100, also served by
  `GET /config/client`) and `max_import_bytes` (5 MiB, the same as the frontend's
  file cap). Going over either is a 413. The byte check runs after FastAPI has read
  the body, so it saves validation and DB work but not memory. The edge cap from
  [DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md) is still needed.
- **Status code 200**, not 201, because a retry creates nothing.

The original plan:

- **Body:** `{ device_id, lists: [...] }`, the same shape as the local document
  without `schema_version` or `claimed_at`. The client upgrades to the current schema
  before sending.
- **Validation:** every list and item goes through the **same Pydantic validators
  and service rules** as normal creates (title length, 50-item cap, item dedup, tag
  normalization, `max_tags_per_list`). The client's validation isn't trusted.
- **Request limits:** cap the number of lists per import (a runtime setting, e.g.
  `max_lists_per_import = 100`) and the body size, both enforced in the app *and* at
  the edge (see [DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md)).
- **Atomic:** one DB transaction, so it imports everything or nothing.
- **Idempotent:** add a nullable `import_key` column on `lists` (`"<device_id>:<local_id>"`)
  with a unique `(user_id, import_key)` index. A retry after a dropped response returns
  the already-created lists instead of duplicating them. This **requires an Alembic
  migration**: additive and nullable, so backward compatible.
- **Title conflicts:** if the account already has a list with the same title
  (case-insensitive), apply a predictable rename such as `"Top 50 Albums (2)"` and
  report it in the response so the UI can say so. **Decided (Q12).** This doesn't
  wait for the general list-title dedup work in Phase 2.
- **Response:** the created `ListRead`s plus any renames, so the UI can show a summary
  toast.
- **Invalid content rejects the whole import (Q12)** with a message saying which list
  failed and why (e.g. "'Top Albums' has 51 items; the limit is 50"). Nothing is
  imported and the local copy is untouched, so the user can fix it and retry.
- **Tests:** a happy path; a retry being idempotent; a 51-item list rejecting the
  whole import with a clear message; title-collision rename; too many lists or an
  oversized payload giving a 413; unauthenticated giving a 401; ownership (imports
  always go to the caller).

### After claim

- The server becomes the source of truth for that user. While signed in, the app
  uses `ApiListRepository` only.
- **Lists the user unchecked in the dialog stay on the device**, and the dialog offers
  them again on the next sign-in. `claimed_at` records that an import happened; it
  doesn't hide what's left.
- **Signing out** returns to the local space, which holds only unclaimed lists (if
  any), never the account's lists. Showing a signed-out user their account's data on a
  shared device would be a privacy leak.
- **Signing in on a device whose local lists were already claimed by another
  account:** they were cleared on that claim, so there's nothing to import. Lists
  that were left unchecked would be offered to the new account. That's acceptable,
  because the dialog makes the import explicit and nothing moves without a click.

## Alternative considered: server-side guest accounts

Create a real `users` row for each anonymous visitor, keyed by a random device
token, and store their lists in Postgres from the start. Converting to an account
would link the guest row to the Cognito identity.

- **Pros:** one storage path (no repository split), cross-tab and survives Safari's
  7-day wipe, and could allow sharing anonymous lists.
- **Cons:** every drive-by visitor writes rows (abuse and storage growth, cleanup
  jobs); the server is **holding data from people who never agreed to the Terms**
  (privacy policy scope grows); it needs a second auth mechanism (device tokens);
  and "anonymous" becomes less anonymous.

**Recommendation: local-only.** It's cheaper, more private, and matches how the user
described it. The repository interface leaves room to add guest accounts later as a
third implementation if the Safari wipe turns out to bite real users.

## Frontend changes (summary)

- **Router:** `/lists` and `/lists/:id` drop `requiresAuth`
  ([router/index.ts](../frontend/src/router/index.ts)). They render from whichever
  repository is active. Local list ids are the `local_id` UUIDs. Recommendation:
  one set of routes, and the repository decides. A stale bookmark to a local id
  while signed in (or the reverse) simply shows the existing "list not found" state.
- **"Start a list" CTA:** `useStartList.ts` opens the create modal for everyone
  instead of routing logged-out users to login. `START_LIST_REDIRECT` and its
  `?openCreate=1` handling can then go, unless the login page still uses them. This
  **supersedes** the 2026-07-14 logged-out CTA decision in [DESIGN.md](DESIGN.md),
  which is marked there.
- **Switching repository on sign-in/out:** when `isAuthenticated` changes, the lists
  views reload from the new repository. Don't let data from one show in the other.
- **UI states for anonymous users:** a "Saved on this device" badge on the lists
  page; Export/Import buttons; a non-blocking sign-in prompt for publish/share
  ("Sign in to share this list"); the claim dialog after sign-in.
- **Header:** a "Sign in" button instead of an avatar when anonymous. That already
  exists in some form, so check `AppHeader.vue`.
- **Tests:** a Vitest suite for `LocalListRepository` (CRUD, cap, dedup, reorder,
  `ListError` kinds and `detail` copy matching the API's, schema migration, corrupt-storage recovery,
  quota-exceeded error), and Playwright e2e for anonymous create → sign in (dev
  stub) → claim → lists visible from the server.

## Backend changes (summary)

- Shared limits module, and the new fields on `GET /api/v1/config/client` (PR 2).
- `POST /api/v1/lists/import` plus its service function and tests (above).
- Migration for the `import_key` column and its unique index.
- A `max_lists_per_import` runtime setting.
- No change to existing endpoints. They stay auth-required, because anonymous users
  never touch them.
- Regenerate and review `backend/openapi.json` in each PR that changes the API.

## Docs and legal to update when this ships

- [Privacy policy](legal/PRIVACY_POLICY.md): anonymous lists stay on the device and
  are never sent to us unless you import them.
- [DESIGN.md](DESIGN.md): anonymous states and the claim dialog.
- [NEXT_STEPS.md](NEXT_STEPS.md): tick off Track 1.
- *(Future, owner idea from Q12)*: keep data on the device even when signed in, with
  periodic bulk uploads/sync. That would be a separate design; the device-only +
  claim model here doesn't block it.

## Build order (small, shippable PRs)

| # | PR | Side | User-visible? | Status |
| --- | --- | --- | --- | --- |
| 1 | **Repository refactor**: `ListRepository`, `ApiListRepository`, `useListRepository()`; move all 11 call sites | Frontend | No | Done |
| 2 | **Shared limits**: backend constants module, new `ClientLimits` fields, frontend config store with bundled defaults | Both | No | Done |
| 3 | **`LocalListRepository`** plus the storage format, schema validation and migrations, with unit tests (not wired up yet) | Frontend | No | Done |
| 4 | **Unlock the routes for anonymous users**, `useStartList` change, repository switching, "Saved on this device" copy | Frontend | Yes | Done |
| 5 | **Export/import a file** | Frontend | Yes | Done |
| 6 | **`POST /api/v1/lists/import`**, its migration, runtime setting and tests | Backend | No | Done |
| 7 | **Claim dialog** wired to the import, file Import for signed-in users, plus Playwright e2e | Frontend | Yes | Done |
| 8 | Privacy policy and docs updates | Docs | — | Not started |

PRs 2, 3 and 6 don't depend on each other once PR 1 is in, so they can be done in any
order. **PR 4 is the one that changes the site for real visitors**: ship it only once
PR 3's tests are solid, and ideally with PR 5 close behind, since export is the only
backup an anonymous user has.
