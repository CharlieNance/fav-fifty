# Anonymous Use + Local Lists — Implementation Plan

Planning doc for letting people **use Fav Fifty without signing in**: build lists that
are saved on their own device as JSON, then **upload them to an account** if they sign
up later. Part of the 2026-10 scope expansion (see [NEXT_STEPS.md](NEXT_STEPS.md)
§Phase 2.5). Nothing here is built yet. **Decided in [QUESTIONS.md](QUESTIONS.md)
(2026-10-13):**

- **Q11:** device-only storage.
- **Q12:** rename `"Title (2)"` on a conflict; reject the whole import if any list is
  invalid; clear the local copy after a successful import.
- **Q25:** limits are runtime-configurable.

## Why

The current funnel asks for a Google sign-in before someone has made anything. Most of
the audience arrives from a Discord link on a phone, and many will leave at a login
wall. Letting people build first and sign in later (only to save across devices,
publish or share) gets them to the fun part sooner. It also gives the mobile apps an
offline mode almost for free (see [MOBILE_READINESS.md](MOBILE_READINESS.md)).

## Scope

### In scope

- Anonymous visitors can create, edit, reorder, tag and delete lists, with the same
  rules as signed-in users (50-item cap, no duplicate items, same length limits).
- Anonymous lists are stored **only on the device** (browser storage), as versioned
  JSON. Nothing is written to our database for an anonymous visitor.
- Anonymous visitors can use type-ahead lookup
  ([CATALOG_SEARCH_PLAN.md](CATALOG_SEARCH_PLAN.md)). That makes this the first
  backend feature that can be called **without a session**, which brings in rate
  limiting (see §Security).
- **Claim on sign-in:** after signing in, the user is offered to upload their local
  lists to the account. The upload is one validated, idempotent bulk import.
- **Export/import a file:** download your local lists as a `.json` file, and load
  one back in. This is cheap to add once the format exists, and it's the only backup
  an anonymous user has.

### Out of scope (for now)

- **Server-side guest accounts** (an anonymous user row with a device token). See
  §Alternative considered. We can add it later without breaking the local format.
- **Publishing or sharing an anonymous list.** Public URLs need a server copy, and
  publishing is the natural moment to ask someone to sign in.
- **Ongoing two-way sync** between local and server copies after the claim. Once
  claimed, the server is the source of truth for that user (see §After claim).
- Sync between two devices without an account.

## Key design: one list repository, two storage backends

Today every list composable (`useLists`, `useListDetail`, `useCreateItem`,
`useReorderItem`, `useListTags`, …) calls `apiFetch` directly. The core refactor
puts a **repository interface** in between:

```text
features/lists/*  ──►  ListRepository (interface)
                          ├── ApiListRepository     (signed in → REST API, today's behaviour)
                          └── LocalListRepository   (anonymous → device storage)
```

- The interface uses the **same TypeScript types** the views already use
  (`ListSummary`, `ListItem`, …). Views shouldn't know which storage they're using.
- The auth store chooses the implementation: logged in → API, logged out → local.
- `LocalListRepository` applies **the same rules as the backend**: 50-item cap,
  case-insensitive item dedup, title/text/note length limits, tag normalization.
  To keep the two in step, put the limits in one shared constants module, and
  later serve them from the public `GET /api/v1/config/client` endpoint (or generate them
  from OpenAPI). Client-side rules are only a convenience; the server re-validates
  everything at import time (see §Claim).
- Doing this refactor **first**, behind the existing API behaviour and with no
  user-visible change, is the safe first PR. The existing Vitest specs should pass
  unchanged against the API implementation.

This interface is also what the mobile apps' offline storage will implement
(SQLite or Capacitor Preferences instead of `localStorage`).

## Local storage format (versioned JSON)

One document per device, under a single key (e.g. `favfifty:v1`):

```jsonc
{
  "schema_version": 1,
  "device_id": "uuid",            // random, generated once; used for import idempotency
  "lists": [
    {
      "local_id": "uuid",         // client-generated; never sent as a server id
      "title": "Top 50 Albums",
      "description": null,
      "tags": ["music", "albums"],
      "kind": "album",       // optional, see CATALOG_SEARCH_PLAN.md §List kind
      "created_at": "2026-10-13T18:00:00Z",
      "updated_at": "2026-10-13T18:05:00Z",
      "items": [                 // array order = rank; no stored position field
        {
          "local_id": "uuid",
          "text": "In Rainbows",
          "note": null,
          "image_url": "https://…",
          "catalog_ref": { "source": "musicbrainz", "external_id": "…", "kind": "album" }
        }
      ]
    }
  ],
  "claimed_at": null              // set after a successful upload (see §After claim)
}
```

Decisions inside the format:

- **`schema_version` + a migration function per version.** On read, older documents
  are upgraded step by step (`v1→v2→…`) before use. Files exported months ago must
  still import.
- **Rank is array order.** That avoids the unique-position bookkeeping the server
  needs (`UniqueConstraint(list_id, position)`), and the import endpoint assigns
  `position = index + 1`.
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
  read and write in `try/catch` (private mode and blocked storage throw).
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

## Claim on sign-in (upload local lists)

Flow:

1. An anonymous user with local lists signs in (the Google round-trip, then a
   redirect back).
2. The app sees unclaimed local lists and shows a **"Bring your lists with you?"**
   dialog that lists them, with all checked by default.
3. The client sends the selected lists to a new endpoint in **one request**.
4. On success the device document gets `claimed_at` set and the local lists are
   cleared (or kept read-only for a while, see §After claim). The user lands on
   `/lists` with the imported lists.

### New endpoint: `POST /lists/import`

- **Body:** `{ device_id, lists: [...] }`, the same shape as the local document
  without `schema_version` or `claimed_at`. The client upgrades to the current schema
  before sending.
- **Validation:** every list and item goes through the **same Pydantic validators
  and service rules** as normal creates (title length, 50-item cap, item dedup, tag
  normalization). The client's validation isn't trusted.
- **Request limits:** cap the number of lists per import (e.g. 100) and the body
  size, both enforced in the app *and* at the edge (see
  [DEPLOYMENT_TOPOLOGY_PLAN.md](DEPLOYMENT_TOPOLOGY_PLAN.md)).
- **Atomic:** one DB transaction, so it imports everything or nothing.
- **Idempotent:** store an import record `(user_id, device_id, local_list_id)`, or
  add a nullable `import_key` column on `lists` with a unique `(user_id, import_key)`
  index. A retry after a dropped response must not create duplicate lists. This
  **requires an Alembic migration**: additive and nullable, so backward compatible.
- **Title conflicts:** if the account already has a list with the same title (once
  list-title dedup ships, see [NEXT_STEPS.md](NEXT_STEPS.md) Phase 2), apply a
  predictable rename such as `"Top 50 Albums (2)"` and report it in the response so
  the UI can say so. **Decided (Q12).**
- **Response:** the created `ListRead`s plus any renames or skipped items, so the UI
  can show a summary toast.
- **Invalid content rejects the whole import (Q12)** with a message saying which list
  failed and why (e.g. "'Top Albums' has 51 items; the limit is 50"). Nothing is
  imported and the local copy is untouched, so the user can fix it and retry.
- **Tests:** a happy path; a retry being idempotent; a 51-item list rejecting the
  whole import with a clear message; title-collision rename; an
  oversized payload giving a 413; unauthenticated giving a 401; ownership (imports
  always go to the caller).

### After claim

- The server becomes the source of truth for that user. While signed in, the app
  uses `ApiListRepository` only.
- **Signing out** returns to an empty local space, not the claimed lists. Showing a
  signed-out user their account's data on a shared device would be a privacy leak.
- **Signing in on a device whose local lists were already claimed by another
  account:** the idempotency key is per user, so the lists would be imported again
  into the second account. That's acceptable. The dialog makes the import explicit,
  so nothing moves without a click.

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

- **Router:** `/lists` and `/lists/:id` stop being `requiresAuth`. They render from
  whichever repository is active. Local list ids are the `local_id` UUIDs; the routes
  can stay the same, or local lists can get a `/local/...` prefix so a stale
  bookmark can't be confused with a server id. Recommendation: one route, and the
  repository decides.
- **"Start a list" CTA:** no longer routes to login. This **supersedes** the
  2026-07-14 logged-out CTA decision in [DESIGN.md](DESIGN.md), which is marked
  there.
- **UI states for anonymous users:** a "Saved on this device" badge on the lists
  page; Export/Import buttons; a non-blocking sign-in prompt for publish/share
  ("Sign in to share this list"); the claim dialog after sign-in.
- **Header:** a "Sign in" button instead of an avatar when anonymous. That already
  exists in some form, so check `AppHeader.vue`.
- **Tests:** a Vitest suite for `LocalListRepository` (CRUD, cap, dedup, schema
  migration, corrupt-storage recovery, quota-exceeded error), and Playwright e2e
  for anonymous create → sign in (dev stub) → claim → lists visible from the server.

## Backend changes (summary)

- `POST /lists/import` plus its service function and tests (above).
- Migration for the import idempotency key.
- `GET /api/v1/config/client` (public, briefly cacheable) returns the current limits
  (and switches), so web and mobile share one source. The limits are
  runtime-configurable (Q25, [ADMIN_AND_ANALYTICS_PLAN.md](ADMIN_AND_ANALYTICS_PLAN.md)
  §Runtime settings).
- No change to existing endpoints. They stay auth-required, because anonymous users
  never touch them.

## Docs and legal to update when this ships

- [Privacy policy](legal/PRIVACY_POLICY.md): anonymous lists stay on the device and
  are never sent to us unless you import them; type-ahead queries go through our
  server to third-party catalogs (see CATALOG_SEARCH_PLAN.md).
- [DESIGN.md](DESIGN.md): anonymous states and the claim dialog.
- *(Future, owner idea from Q12)*: keep data on the device even when signed in, with
  periodic bulk uploads/sync. That would be a separate design; the device-only +
  claim model here doesn't block it.

## Build order (small, shippable PRs)

1. **Repository refactor**, API-only, with no behaviour change.
2. **Shared limits module** (served by `GET /api/v1/config/client`).
3. **`LocalListRepository`** plus the storage format, schema validation and
   migrations, with unit tests.
4. **Unlock the routes for anonymous users**, the anonymous UI states, and the
   "Saved on this device" copy.
5. **Export/import a file.**
6. **`POST /lists/import`**, its migration and tests (backend).
7. **Claim dialog** wired to the import, plus Playwright e2e.
8. Privacy policy and docs updates.
