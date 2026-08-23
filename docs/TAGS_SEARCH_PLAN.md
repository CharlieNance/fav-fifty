# Tags & Search — Implementation Plan

Planning doc for the last Phase 2 feature slice ([NEXT_STEPS.md](NEXT_STEPS.md)): a
logged-in user can tag their own lists with free-form labels, manage those tags from
the list UI, and search *their own* lists by title and tag. No code yet — this is the
process we'll follow, broken down into small, shippable steps, with
backend/frontend/database and tests called out for each, following the same shape as
[LISTS_CRUD_PLAN.md](LISTS_CRUD_PLAN.md) and [ITEMS_CRUD_PLAN.md](ITEMS_CRUD_PLAN.md).

## Scope

### In scope

- Add/remove free-form tags on a list, multiple per list (details page)
- Tags shown on the list index (`/lists`) rows
- Search box on `/lists` that filters the current user's lists by title **or** tag,
  case-insensitive substring match
- Tag storage is shared/normalized (`tags.name` unique), so the same tag text used by
  two different lists is one row, not two

### Out of scope (future features)

- Cross-user / public search (Phase 3 sharing — search only ever covers lists the
  signed-in user owns, same ownership model as everything else today)
- Autocomplete/typeahead suggesting existing tag names while typing
- Promoting popular tags into a curated category system (explicitly deferred in
  [DECISIONS.md](DECISIONS.md) §Product data model — "tags first")
- Tag rename/merge tooling, tag usage counts, or a standalone "browse by tag" page
- Ranking/relevance-scored search — this is a filter, not a search engine

## Foundation already in place

Worth naming so it's clear what's *new* work vs. what's already wired up:

- **The schema already exists.** `tags` (id, `name` unique/indexed,
  `String(50)`) and `list_tags` (many-to-many, `list_id`/`tag_id`, both
  `ondelete="CASCADE"`) were created in the initial migration
  (`ab1a1d72af10_initial_schema`) — see `backend/app/models/tag.py`. `List.tags`
  and `Tag.lists` relationships already exist on the ORM models
  (`backend/app/models/list.py`). **No new migration needed for storage** — this
  feature is entirely service/API/UI work on top of an existing table.
- **Normalization is already decided, not yet implemented.** The model docstring
  says tags are "stored normalized (lower-cased, trimmed) by the service layer" —
  that service-layer normalization doesn't exist yet; this feature adds it.
- **Auth + ownership pattern**: `get_current_user` (`backend/app/api/deps.py`) and the
  `get_owned_list` dependency (`backend/app/api/routes/lists.py`) already resolve a
  list scoped to its owner or 404 — every new tag endpoint reuses that dependency, the
  same way `list_items` routes do.
- **Frontend plumbing**: `apiFetch`/`ApiError` (`frontend/src/api/client.ts`),
  `useLists`/`ListsView.vue` (index page + row rendering), `useListDetail`
  (`frontend/src/features/lists/useListDetail.ts`) for the details page fetch, and the
  `ListSummary`/`ListItem` type pattern (`frontend/src/features/lists/types.ts`) this
  feature's new types will follow.

## Data model additions

- **No new tables or columns.** `tags`/`list_tags` already exist (see above).
- **`ListRead` gains a `tags: list[str]` field** (`backend/app/schemas/list.py`) —
  tag *names*, not IDs or objects. The frontend never needs a tag's UUID; it only
  ever adds/removes by name. Keeping the wire shape as `string[]` (not
  `{id, name}[]`) matches "tags are free-form text" and avoids exposing an
  implementation detail (the shared `tags` row) that doesn't matter to the client.
- **Normalization rule** (service layer, one place, shared by create and search):
  trim, collapse internal whitespace, lower-case. `"  Sci-Fi  "` and `"sci-fi"` are
  the same tag. Empty-after-trim is rejected. A max length (50, matching the column)
  is enforced the same way `title` is today.
- **Tag reuse, not duplication**: adding a tag to a list looks up
  `Tag.name == normalized` first; reuses the row if found, creates it if not — so
  `tags.name`'s existing unique constraint is never violated and two lists that both
  say "board games" share one `Tag` row (this is *why* `list_tags` is a many-to-many
  table and not a free-text column on `lists`).
- **Orphaned tags are left as-is, on purpose.** Removing the last list that
  references a tag does not delete the `Tag` row. Not fixing now, but noted so it's
  not lost: a future cleanup job (or an on-write check) could prune tags with zero
  lists — low priority at ≤10 users, and premature to build before there's any
  evidence it matters.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `PUT` | `/api/lists/{list_id}/tags` | Replace a list's full tag set (`{ tags: string[] }`) |
| `GET` | `/api/lists?q=<text>` | Existing index endpoint, extended with an optional search query param |

**Why `PUT` (replace-the-set) instead of `POST`/`DELETE` per-tag:** the details-page
UI (see Interaction 1 below) edits tags as a single free-form list in one form — the
whole "chip list" is submitted together, same shape as `ListUpdate`'s title-replace.
This also sidesteps needing a per-tag identifier in the URL. If a future UI wants
add/remove-one interactions (e.g. optimistic single-chip removal), a per-tag `DELETE
/api/lists/{list_id}/tags/{tag_name}` can be added later without touching this
endpoint — noted here, not built now, since nothing in this feature's UI needs it.

**Why extending `GET /api/lists` instead of a new `/api/lists/search` endpoint:**
search is a filter over the same result set (the user's own non-deleted lists), not a
different resource — an optional `q` query param keeps one source of truth for "what
lists can this user see" (`list_service.list_for_user`) instead of two endpoints that
could drift apart on ownership/soft-delete filtering. Omitting `q` (or passing an
empty string) returns exactly what it returns today — fully backward compatible with
the existing frontend call.

New `backend/app/schemas/tag.py`: `TagsUpdate` (`{ tags: list[str] }`, validates each
entry with the same trim/normalize/length rules). `ListRead` (existing file) gets the
new `tags` field. New functions in `list_service.py` (or a new `tag_service.py` — see
open question 3 below): `set_list_tags(db, list_row, names) -> List` and
`list_for_user(db, user_id, q=None)` extended with the search filter.

## Search semantics

- **Case-insensitive substring match** against `lists.title` **or** any of the list's
  tag names — a list matches if the query text appears anywhere in the title, or
  matches (substring) any one of its tags. This is a simple `ILIKE '%q%'` on title OR
  `EXISTS` against `list_tags`/`tags` — no full-text search engine, no ranking,
  matching the "not a search engine" scope note above.
- **Empty/whitespace query** is treated as "no filter" (same as omitting `q`) —
  matches the existing empty-title-rejection convention (trim first, then check) used
  by `ListCreate`/`ListUpdate`.
- **Still owner-scoped and soft-delete-filtered** — search never widens what a user
  can see, it only narrows `list_for_user`'s existing result set. No new information
  disclosure surface.

## Cross-cutting: ownership & security

Same posture as [LISTS_CRUD_PLAN.md](LISTS_CRUD_PLAN.md) §Cross-cutting — applies
uniformly here:

- `PUT /api/lists/{list_id}/tags` requires auth and reuses `get_owned_list` — 404 (not
  403) for someone else's list, a soft-deleted list, or a nonexistent id, identical to
  every other single-list route.
- Search (`GET /api/lists?q=`) only ever queries rows already scoped to
  `user_id == current_user.id`; the `q` param can't be used to probe another user's
  list titles or tags — there's no code path where it touches rows outside that
  filter.
- **`q` is user input reflected into a `LIKE` pattern** — SQLAlchemy's parameterized
  `ilike()` (not raw string interpolation) is required so `%`/`_` in a user's query
  are treated as literal characters a curious user typed, not SQL wildcards they
  control beyond the substring match itself. No raw SQL anywhere in this feature.
- Tag text is untrusted user content like list titles already are (per CLAUDE.md
  "treat user-supplied list/comment content as untrusted") — trimmed/length-capped
  server-side regardless of what the frontend sends; rendered as plain text in the UI
  (Vue's default `{{ }}` interpolation escapes it), never `v-html`.

## Validation

- Each tag: required (non-empty after trim), trimmed, whitespace-collapsed,
  lower-cased, 1–50 chars after normalization (matches `tags.name` `String(50)`).
- **Per-list tag count cap.** Recommend capping at a small number (e.g. 10) so tag
  chips can't grow unbounded on one list — mirrors the existing "cap of 50" pattern
  for items ([ITEMS_CRUD_PLAN.md](ITEMS_CRUD_PLAN.md)), enforced in the service layer
  the same way. **Open question 1 below** — needs an owner call on the exact number.
- **Duplicate tags within one list's submitted set** are silently de-duplicated
  (case-insensitive) rather than rejected — `["Games", "games"]` in one `PUT` becomes
  one tag, not a `422`. Simpler for the frontend (no client-side dedup needed) and
  there's no real "error" here, just redundant input.
- `q`: no length cap needed beyond the existing query-param size limits FastAPI
  already applies; trimmed before use, empty-after-trim treated as "no filter" (see
  above).

## Interaction 1 — Manage tags on a list (details page)

**Flow:** On `/lists/:id`, the details page shows the list's current tags as chips
(reusing the existing chip-ish visual language, if any exists, or a small new
`TagChip.vue`) with a way to add a new tag (text input + Enter/Add) and remove an
existing one (× on the chip). Each change is a full replace of the tag set via `PUT`
— consistent with the endpoint design above, this can be either "edit tags inline,
autosave on each add/remove" or "edit tags in a small modal with Save/Cancel," to be
decided (**open question 2** below) before building the component.

- **Backend:** `PUT /api/lists/{list_id}/tags`, body `TagsUpdate { tags }` → normalize
  → `list_service.set_list_tags` (reuse-or-create each `Tag`, replace the
  `list_row.tags` collection) → returns updated `ListRead` (200).
- **Frontend:** new `useListTags.ts` composable (mirrors `useDeleteList.ts`'s
  pending/error shape) wrapping the `PUT` call; a small presentational
  `TagChip.vue`; the add/remove UI lives in `ListDetailView.vue` (or a new
  `ManageListTags.vue` sub-component if the details page is getting crowded — favors
  "well contained Vue components" per CLAUDE.md).
- **Tests:**
  - Backend: owner can add tags to a list with none; owner can remove a tag (submit a
    smaller set); adding the same normalized tag twice in one request de-dupes to one;
    two different lists (including two different users') sharing a tag name reuse one
    `Tag` row (assert via a DB count, not just API responses); a tag over 50 chars (or
    empty-after-trim) → `422`; over the per-list cap → `422`; a different user's list
    id → `404`; unauthenticated → `401`.
  - Frontend: renders existing tags as chips; adding a tag calls the API with the full
    new set and re-renders; removing a chip calls the API with the reduced set;
    a `422` (e.g. over the cap) surfaces inline without losing the user's in-progress
    edit; empty-tags submission (removing the last tag) is allowed and clears the
    list's chips.

## Interaction 2 — See tags on the list index

**Flow:** Each row on `/lists` shows its list's tags as small chips alongside the
title (read-only here — editing happens on the details page, per Interaction 1, not
inline on the index — consistent with how title editing already works via a modal
rather than inline).

- **Backend:** none — `GET /api/lists` already returns `ListRead`, which now includes
  `tags` (see §Data model additions).
- **Frontend:** `ListsView.vue`'s row template renders `list.tags` via the same
  `TagChip.vue` used on the details page (no new component, reused read-only).
  `ListSummary` type (`frontend/src/features/lists/types.ts`) gains `tags: string[]`.
- **Tests:**
  - Frontend: a row with tags renders a chip per tag; a row with an empty `tags`
    array renders no chips and doesn't break the layout.

## Interaction 3 — Search my lists

**Flow:** A search box at the top of `/lists` (above the list rows, near "New list").
Typing filters the visible rows to lists whose title or any tag matches, live as the
user types (debounced) or on Enter — **open question 4** below on live-filter vs.
explicit-submit. Clearing the box shows all lists again. No results shows a distinct
"no lists match" empty state, different from the existing "you have no lists yet"
empty state.

- **Backend:** `GET /api/lists?q=<text>` extends `list_service.list_for_user` with the
  optional `q` filter (see §Search semantics).
- **Frontend:** `useLists.ts`'s `load()` gains an optional query param; a new
  `useListSearch.ts` (or state inline in `ListsView.vue`, TBD by how much logic there
  is once written) holds the current query text and debounces re-fetching. Debounce
  avoids a network round-trip per keystroke — matches "extensibility and
  testability" by keeping the debounce logic in one small, independently-testable
  unit rather than inline in the view.
- **Tests:**
  - Backend: query matching a title substring returns that list; query matching a tag
    (not the title) returns that list; query matching neither returns an empty list;
    match is case-insensitive; query only matches the current user's own lists (seed
    a second user with a matching title, assert it's excluded); empty/whitespace `q`
    behaves identically to omitting it; soft-deleted lists never match regardless of
    `q`.
  - Frontend: typing a query that matches filters the rendered rows; a query with no
    matches renders the "no matches" empty state (not the "no lists at all" one);
    clearing the box restores the full list; the debounce means `apiFetch` isn't
    called on every single keystroke (fake timers).

## Testing strategy notes

- **Backend** follows the existing pattern: route-level tests in
  `backend/tests/test_lists.py` (extending it, since tags/search extend existing
  endpoints/routes rather than introducing a new router) and/or a new
  `test_list_service.py` addition for `set_list_tags`/search-filter logic in
  isolation. Cross-user isolation tests reuse the second-identity fixture already
  established for Lists CRUD (`docs/LISTS_CRUD_PLAN.md` §Testing strategy notes).
- **Frontend** follows the colocated-`.spec.ts` pattern, mocking `apiFetch` via
  `vi.mock('@/api/client')` — new specs for `TagChip.vue`, `useListTags.ts`, and
  whatever owns the search box, plus extending `ListsView.spec.ts` and
  `ListDetailView.spec.ts` for the new rendering.
- **E2E**: consider extending `frontend/e2e/list-items.spec.ts`'s pattern (or a new
  `frontend/e2e/tags-search.spec.ts`) with one real-browser journey — add a tag, see
  it on the index, search by it, see the list — once the unit/integration layers are
  solid. Not required for every step below, but worth one pass at the end covering
  the full flow, same spirit as the items E2E test.

## Open questions (resolve before/while coding)

1. **Per-list tag cap** — how many tags can one list have? Suggest 10 as a reasonable
   default (chips shouldn't overwhelm a row), but this is a product call.
   **Decision:** Could we set this as a config value? Since we have such a low user
   base I'm inclined to leave it high, default to 100, and if we start running into issues
   I can lower it. Unless there is a reason I'm not thinking of it should be lower.
2. **Tag editing UX on the details page** — inline autosave-per-change (add a tag,
   it's saved immediately; remove a chip, it's saved immediately) vs. a small
   edit-tags modal with explicit Save/Cancel (consistent with how title editing
   already works via `EditListModal`)? Inline autosave is fewer clicks; a modal is
   more consistent with the rest of the app's edit pattern and gives a clear
   Cancel-discards-changes story. Leaning modal for consistency, but flagging since
   it changes the component shape.
   **Decision:** Let's stick with the modal approach for consistency.
3. **Where tag logic lives** — new `backend/app/services/tag_service.py`, or add
   `set_list_tags` alongside the existing functions in `list_service.py`? Leaning
   toward keeping it in `list_service.py` since there's no tag operation that isn't
   "as part of a list" (no standalone tag CRUD in scope) — but flagging in case the
   file is getting large.
   **Decision:** I get the argument that it could be a part of list_service, since
   they aren't independent. But I want to keep things small and modular, if later we
   want to make tags more robust or relate to something else, I would like them to be
   a contained service.
4. **Live-filter vs. explicit search** — filter as-you-type (debounced) or only on
   Enter/a Search button? Live-filter feels better at this list size (≤50 lists per
   user, ≤10 users total) but is a small UX call worth confirming.
   **Decision:** I like the filter as-you-type approach, that does seem like a better
   user experience. I want to stay extensible though, in the future we might add suggested
   tags, or maybe some sort of auto-complete, or a fuzzy search of options. Anything we can
   do now to make plugging stuff like that in easier later, without overengeneering now would
   be great.
5. **Tag input UX** — free-text field with Enter-to-add (chip-style, like many tag
   pickers), or a comma-separated single text field parsed on submit? Chip-style is
   more familiar but is more component work; comma-separated is simpler to build
   first and can be upgraded later without an API change (the wire format is already
   `string[]` either way).
   **Decision:** I like the chip style, I think it looks better and is a better user experience.
   I do want it to be styled distincly though, a user shouldn't mistake a tag for a list item, or get
   confused as to which interface they are in, so we should use a different background or outline to make
   sure that they know what they are working with at a glance.

## Suggested build order

Small, reviewable, each slice shippable on its own (per CLAUDE.md "build
incrementally"):

1. **Backend:** tag normalization + `set_list_tags` in `list_service.py` (or
   `tag_service.py`, per open question 3), `schemas/tag.py` (`TagsUpdate`), `tags`
   field added to `ListRead`, `PUT /api/lists/{list_id}/tags` route. Tests. **Complete**
2. **Frontend:** `TagChip.vue`, `useListTags.ts`, tag management UI on
   `ListDetailView.vue` (per the UX call in open question 2), `ListSummary`/
   `ListItem` types gain `tags`. Tests. **Complete**
3. **Frontend:** render read-only tag chips on `ListsView.vue` rows (Interaction 2 —
   no backend change, `tags` is already on `ListRead` from step 1). Tests. **Complete**
4. **Backend:** `q` search param on `GET /api/lists`, extending
   `list_service.list_for_user`. Tests.
5. **Frontend:** search box on `ListsView.vue`, wired to the extended endpoint, debounce,
   "no matches" empty state. Tests.
6. **E2E:** one end-to-end journey covering add-tag → see-on-index → search-finds-it,
   once 1–5 are solid.
