# Items CRUD + Reorder — Implementation Plan

Planning doc for the second slice of Phase 2 ([NEXT_STEPS.md](NEXT_STEPS.md)): CRUD and
reorder for the ranked items *within* a list, up to 50 per list. Mirrors the structure
of [LISTS_CRUD_PLAN.md](LISTS_CRUD_PLAN.md), which built list CRUD itself and
explicitly deferred item management to this doc.

## Scope

### In scope

- Add / edit / delete an item on a list you own (text, optional note, optional image
  URL)
- Reorder items by moving one item to a new rank
- Backend: fully built this slice (API + tests)
- Frontend: designed in this doc, **built as the next slice** — see §Frontend design
  below for what to build then

### Out of scope (future features)

- Tags, description editing, publish/unpublish — unrelated to items, tracked
  separately in `NEXT_STEPS.md`
- Image *uploads* — URLs only for now, per [DECISIONS.md](DECISIONS.md) §Product data
  model
- Soft-delete for items (see §Why items don't get soft-delete below)

## Foundation already in place

- **`list_items` table and `ListItem` model already exist**, unchanged by this
  feature — initial schema migration `ab1a1d72af10`,
  `backend/app/models/list_item.py`: UUID primary key, `list_id` FK
  (`ondelete="CASCADE"`), `position` (int), `text` (`String(500)`, required), `note`
  (nullable `Text`), `image_url` (nullable `String(2048)`), plus
  `UniqueConstraint(list_id, position)`. **No new Alembic migration was needed for
  this feature.**
- **Lists CRUD** (`backend/app/services/list_service.py`,
  `backend/app/api/routes/lists.py`): `list_service.get_owned_list` is reused as-is
  to resolve the parent list (ownership + soft-delete filtering) before any item
  operation runs.
- **Auth dependency**: `get_current_user` (`backend/app/api/deps.py`), same as every
  other feature.
- **Two-identity test fixture**: `second_user_client` (`backend/tests/conftest.py`),
  already built for Lists CRUD's ownership-isolation tests, reused here unchanged.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/lists/{list_id}/items` | Items for a list, in rank order |
| `POST` | `/api/lists/{list_id}/items` | Append an item (`{ text, note?, image_url? }`) |
| `PATCH` | `/api/lists/{list_id}/items/{item_id}` | Edit text/note/image (full replace) |
| `DELETE` | `/api/lists/{list_id}/items/{item_id}` | Remove an item (hard delete) |
| `PATCH` | `/api/lists/{list_id}/items/{item_id}/position` | Move to a new rank (`{ position }`) |

Kept as a separate sub-resource endpoint (`GET .../items`) rather than nesting items
inside `ListRead` — the lists index (`GET /api/lists`) shouldn't eagerly load every
list's items, and this keeps `list_service.py`/`ListRead` untouched by this feature.

New router `backend/app/api/routes/list_items.py`, registered in `main.py` alongside
`lists`. New `backend/app/services/list_item_service.py` (mirrors the shape of
`list_service.py`: plain functions taking a `Session`, unit-testable without HTTP).
New `backend/app/schemas/list_item.py`: `ItemRead`, `ItemCreate`, `ItemUpdate`,
`ItemReorder` (Pydantic v2, `from_attributes=True` like `ListRead`).

## Design decision: a "move one item" reorder endpoint

Considered two shapes for reordering: replace-the-whole-array (`PUT` a full ordered
list of item ids) vs. move-one-item (`PATCH` a single item's new rank, server shifts
the rest). **Chose move-one-item** — it matches a single drag-and-drop drop event
directly (the frontend doesn't have to reconstruct and send the whole array on every
drop), and it's easier to test in isolation (each test asserts one move's effect, not
a full-array diff). The response is still the **full** re-ordered item list, so the
frontend redraws everything in one shot without a second `GET`.

## Design decision: dedup and the 50-item cap live in the service, not the schema

Pydantic field validators (`schemas/list_item.py`, mirroring `_validated_title` in
`schemas/list.py`) only ever see one field's own value — they can enforce `text`
length/emptiness, `note` length, and `image_url` shape, but not "is this text already
used elsewhere in the list" or "does the list already have 50 items," both of which
need a DB query scoped to the list. Those two checks live in
`list_item_service.create_item`/`update_item`, raising `DuplicateItemTextError` /
`ListFullError` (both `409 Conflict` — a state conflict, not a malformed payload).
This closes the gap `LISTS_CRUD_PLAN.md` §Validation explicitly deferred: "the same
[uniqueness] rule for item names within a single list once items exist" — items get
the same case-insensitive, per-scope uniqueness list titles still lack.

## Validation

- `text`: required, trimmed, 1–500 chars (matches the column) — same shape as
  `title`'s validation.
- `note`: optional; trimmed; blank-after-trim becomes `None`; capped at 2000 chars — a
  sane application-level limit (the column itself is unbounded `Text`).
- `image_url`: optional; trimmed; blank-after-trim becomes `None`; must start with
  `http://` or `https://`, capped at 2048 chars (matches the column). Restricting the
  scheme is a cheap guard against a `javascript:`/`data:` URL ever reaching an
  `<img src>` on the frontend.
- `position` (reorder only): must be a valid 1-based rank for the list's *current*
  item count — this is stateful (needs the count), so it's checked in
  `list_item_service.reorder_item`, not the schema; out of range → `422`.
- **`ItemUpdate` is a full-replace PATCH**, not a partial/merge patch — like
  `ListUpdate`, all three fields (`text`, `note`, `image_url`) are sent together from
  one edit form every time, not just the ones that changed.

## Cross-cutting: ownership & security

Same posture as Lists CRUD (see [LISTS_CRUD_PLAN.md](LISTS_CRUD_PLAN.md)
§Ownership & security for the full rationale) — not repeated here, just the one new
wrinkle:

- Every item endpoint requires auth (`401` otherwise) and resolves through
  `list_item_service.get_owned_item`, which checks **both** that the caller owns the
  parent list (via `list_service.get_owned_list` — `404` for wrong owner or
  soft-deleted list) **and** that the requested item actually belongs to *that*
  `list_id`. An item id that's real but lives in a different list — even one the same
  user owns — is `404`, not treated as a lookup-by-id-alone. This matters because
  `item_id` and `list_id` are independent path params; without the second check, a
  user could edit/delete/reorder any item they own regardless of which list URL they
  used, which isn't a security hole (still their own data) but would make the
  ownership model inconsistent with how every other endpoint scopes things.

## Why items don't get soft-delete

Lists get `deleted_at` (see `LISTS_CRUD_PLAN.md` §Soft delete) because losing a whole
list — and everything in it — is the kind of accidental, hard-to-notice loss worth a
retention safety net. A single item is different: deleting one is a small, deliberate,
easily-reversible action (re-add it, same text/note/image, thirty seconds of typing),
and the list's own soft-delete plus the existing `cascade="all, delete-orphan"` /
`ondelete="CASCADE"` already protect items when the *list* is deleted or restored.
Adding a second soft-delete mechanism one level down would be complexity without a
matching problem — deferred, not forgotten (this was flagged as an open question in
`LISTS_CRUD_PLAN.md` §Soft delete; the answer for items is "no, not needed").

## Implementation note: reordering vs. the unique constraint

`(list_id, position)` is a normal (non-deferrable) unique constraint. Postgres checks
uniqueness per-row as each row is written, and row-processing order within a single
multi-row `UPDATE` is unspecified — so naively shifting a whole range of positions in
one bulk statement can spuriously violate the constraint if two rows momentarily
collide, depending on internal processing order (the classic "swap two unique values"
Postgres gotcha). `list_item_service.py` avoids this by never issuing a bulk
multi-row position `UPDATE`: every shift is a sequence of individually-ordered,
single-row `UPDATE` statements, each landing in a slot the previous one just vacated:

- **Delete + repack**: the row is hard-deleted first (freeing its slot for real), then
  items ranked below it shift up by one, processed in ascending order (closest to the
  freed slot first).
- **Move (`reorder_item`)**: the moved item is parked at a sentinel position outside
  `1..50` first (freeing its old slot), the affected range shifts by one — descending
  order if moving earlier, ascending if moving later — and finally the moved item
  lands on the target position.

Both keep `1..N` contiguous at all times and need no schema change (no deferrable
constraint). See the code comments in `list_item_service.py` for the full walkthrough
— worth reading before "simplifying" this to a bulk `UPDATE`, which is exactly the
kind of change that looks safe and isn't.

## Interaction 1 — Add an item

**Backend:** `POST /api/lists/{list_id}/items` → `list_item_service.create_item` →
`409` if the list already has 50 items or the text collides (case-insensitive) with
an existing item; otherwise inserts at `position = current_count + 1` → `201`.
**Tests:** appends at the correct position; 50th item succeeds, 51st `409`s;
duplicate text `409`s; invalid `text`/`note`/`image_url` → `422`; wrong-owner/
soft-deleted-list/nonexistent-list → `404`; unauthenticated → `401`.
**Backend: done.** Frontend (not yet built): an "Add item" modal on the list details
page (`ListDetailView.vue`), same shape as `CreateListModal.vue` — text/note/
image-url fields, client-side checks mirror the backend's but the backend stays the
source of truth, a `409` (duplicate/full) surfaces as an inline error without closing
the modal.

## Interaction 2 — Edit an item

**Backend:** `PATCH /api/lists/{list_id}/items/{item_id}` →
`list_item_service.update_item` → `409` on a text collision with a *different* item
(keeping your own current text is never a collision) → `200`.
**Tests:** edits all three fields; self-collision allowed, cross-item collision
`409`s; wrong-list/wrong-owner/nonexistent item → `404`; invalid fields → `422`.
**Backend: done.** Frontend (not yet built): an "Edit item" modal, same shape as
`EditListModal.vue` — prefilled from the item already in hand from the page's item
list (no extra `GET` needed, matching how `EditListModal` avoids one for lists).

## Interaction 3 — Delete an item

**Backend:** `DELETE /api/lists/{list_id}/items/{item_id}` →
`list_item_service.delete_item` (hard delete + repack, see §Why items don't get
soft-delete and §Implementation note above) → `204`.
**Tests:** item removed; remaining items repack to a contiguous `1..N` in their
original relative order; deleting twice → `404` the second time; wrong-list/
wrong-owner → `404`; unauthenticated → `401`.
**Backend: done.** Frontend (not yet built): reuses `ConfirmDialog.vue` exactly as-is
(it's already list-agnostic — see `LISTS_CRUD_PLAN.md` §Interaction 4) from a delete
icon on each item row.

## Interaction 4 — Reorder items

**Backend:** `PATCH /api/lists/{list_id}/items/{item_id}/position` →
`list_item_service.reorder_item` → `422` if the position is out of range for the
list's current item count; a no-op (same position) returns the unchanged order;
otherwise shifts the range and returns the **full** re-ordered `list[ItemRead]`.
**Tests:** move earlier and move later, asserting the full resulting order for both
directions; no-op on same position; out-of-range position (`0`, negative, `>
count`) → `422`; wrong-list item → `404`.
**Backend: done.** Frontend (not yet built, design captured now so the next slice
doesn't re-derive it):

- Drag-to-reorder via [`vuedraggable`](https://github.com/SortableJS/vue.draggable.next)
  (thin Vue 3 wrapper over SortableJS) — **no drag/sort library exists in the repo
  today**, this would be a new `frontend/` dependency (free, no recurring cost).
  On drop, call the `PATCH .../position` endpoint with the item's new 1-based index
  and replace the local item list with the response.
- Up/down move buttons on each row as a keyboard-accessible affordance, calling the
  exact same endpoint — not dependent on the drag library working, so reordering
  isn't drag-only.
- New composables, one concern each (matching the Lists feature's shape — see
  `LISTS_CRUD_PLAN.md` §Testing strategy notes): `useListItems` (fetch, mirrors
  `useListDetail`), `useCreateItem`, `useUpdateItem`, `useDeleteItem` (pairs with the
  existing `ConfirmDialog.vue`), `useReorderItem`.

## Testing strategy notes

- **Backend**: same fixtures as Lists CRUD (`client`/`auth_client`/
  `second_user_client`/`db_session`, `backend/tests/conftest.py`), no new fixtures
  needed. Route-level tests in `backend/tests/test_list_items.py`
  (`test_lists.py`'s sibling); service-level tests in
  `backend/tests/test_list_item_service.py` for the dedup/cap rules and — especially
  — the reorder/repack algorithm, since a bug there surfaces as a DB
  `IntegrityError`, not just a wrong-looking HTTP response, and is worth catching
  without the HTTP layer in the way.
- **Frontend** (next slice): follows the existing colocated-`.spec.ts` pattern (Vue
  Test Utils + Vitest), mocking `apiFetch` per `LISTS_CRUD_PLAN.md`'s conventions. The
  reorder tests in particular should cover: a drag/button move triggers the `PATCH`
  with the right position, the item list re-renders in the response's order, and a
  failed reorder request doesn't silently leave the UI showing a different order than
  the server has.

## Suggested build order

1. ~~Backend: `schemas/list_item.py` + `services/list_item_service.py` +
   `routes/list_items.py` for all five endpoints, with `test_list_items.py` +
   `test_list_item_service.py`.~~ **Done.**
2. Frontend: `useListItems` + rendering the item list on `ListDetailView.vue`
   (replacing the "🚧 Items are coming soon" placeholder), with tests.
3. Frontend: `AddItemModal.vue` + `useCreateItem`, with tests.
4. Frontend: `EditItemModal.vue` + `useUpdateItem`, and delete via the existing
   `ConfirmDialog.vue` + `useDeleteItem`, with tests.
5. Frontend: add `vuedraggable`, wire up drag-to-reorder + up/down buttons +
   `useReorderItem`, with tests.
