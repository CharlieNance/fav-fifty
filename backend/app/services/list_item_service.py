"""List item service — the one place that owns the ``list_items`` table's business rules.

Functions take a ``Session`` argument (not a global), so they unit-test without the
HTTP app. Routes delegate here; the DB rows are queried/mutated here and nowhere else.

Position management: within one list, ``position`` is always a contiguous ``1..N``
ranking with no gaps and no duplicates (enforced by the ``(list_id, position)`` unique
constraint). Every function that changes membership or order is responsible for
keeping that invariant true when it returns.
"""

import uuid

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.list import List
from app.models.list_item import ListItem
from app.services import list_service

# A position outside the valid 1..50 range — used as a temporary parking spot for the
# item being moved so its old slot is free before anything else writes into it. See
# reorder_item for why this two-step dance is necessary.
_SENTINEL_POSITION = -1


class ListFullError(Exception):
    """Raised when a list already has the maximum of 50 items."""


class DuplicateItemTextError(Exception):
    """Raised when an item's text case-insensitively collides with another item in the same list."""


class InvalidPositionError(Exception):
    """Raised when a requested reorder position is out of range for the list."""


def list_items_for_list(db: Session, list_id: uuid.UUID) -> list[ListItem]:
    """Return ``list_id``'s items in rank order."""
    return list(
        db.scalars(select(ListItem).where(ListItem.list_id == list_id).order_by(ListItem.position))
    )


def get_owned_item(
    db: Session, list_id: uuid.UUID, item_id: uuid.UUID, user_id: uuid.UUID
) -> ListItem | None:
    """Look up one item scoped to a list owned by ``user_id``, or ``None``.

    Backs every ``{item_id}`` route. Resolves the parent list first via
    ``list_service.get_owned_list`` (same 404-not-403 posture as Lists CRUD), then
    requires the item to actually belong to *that* list — an item id that's real but
    lives in a different list of the caller's is indistinguishable from a nonexistent
    one, same as a wrong owner or a soft-deleted list.
    """
    list_row = list_service.get_owned_list(db, list_id, user_id)
    if list_row is None:
        return None
    return db.scalar(
        select(ListItem).where(ListItem.id == item_id, ListItem.list_id == list_row.id)
    )


def _item_count(db: Session, list_id: uuid.UUID) -> int:
    count = db.scalar(select(func.count()).select_from(ListItem).where(ListItem.list_id == list_id))
    assert count is not None  # COUNT(*) always returns exactly one non-null row
    return count


def _text_collides(
    db: Session, list_id: uuid.UUID, text: str, *, exclude_item_id: uuid.UUID | None = None
) -> bool:
    query = select(ListItem.id).where(
        ListItem.list_id == list_id, func.lower(ListItem.text) == text.lower()
    )
    if exclude_item_id is not None:
        query = query.where(ListItem.id != exclude_item_id)
    return db.scalar(query) is not None


def create_item(
    db: Session, list_row: List, text: str, note: str | None, image_url: str | None
) -> ListItem:
    """Append a new item to the end of ``list_row``. ``text``/``note``/``image_url`` are
    already validated/trimmed.
    """
    count = _item_count(db, list_row.id)
    if count >= 50:
        raise ListFullError
    if _text_collides(db, list_row.id, text):
        raise DuplicateItemTextError

    row = ListItem(
        list_id=list_row.id, position=count + 1, text=text, note=note, image_url=image_url
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_item(
    db: Session, item_row: ListItem, text: str, note: str | None, image_url: str | None
) -> ListItem:
    """Edit an already-resolved, owned item's content (not its position)."""
    if _text_collides(db, item_row.list_id, text, exclude_item_id=item_row.id):
        raise DuplicateItemTextError

    item_row.text = text
    item_row.note = note
    item_row.image_url = image_url
    db.commit()
    db.refresh(item_row)
    return item_row


def delete_item(db: Session, item_row: ListItem) -> None:
    """Hard-delete an already-resolved, owned item and repack the remaining ranks.

    Items are never soft-deleted (unlike lists) — removing one is fully reversible by
    re-adding it, so there's no retention need. After the delete, every item that was
    ranked below the removed one shifts up by one so ``1..N`` stays contiguous.

    The shift is done as individually-ordered ``UPDATE`` statements (ascending, closest
    to the freed slot first) rather than one bulk ``UPDATE ... WHERE position > :p`` —
    Postgres checks the ``(list_id, position)`` unique constraint per row as it writes,
    and the row-processing order within a single multi-row ``UPDATE`` is unspecified,
    so a bulk shift can spuriously collide. Doing it as separate statements in a known
    order guarantees each write lands in a slot already vacated by the previous one.
    """
    list_id = item_row.list_id
    removed_position = item_row.position

    db.delete(item_row)
    db.flush()

    shifted = db.scalars(
        select(ListItem)
        .where(ListItem.list_id == list_id, ListItem.position > removed_position)
        .order_by(ListItem.position)
    )
    for row in shifted:
        db.execute(update(ListItem).where(ListItem.id == row.id).values(position=row.position - 1))

    db.commit()


def reorder_item(db: Session, item_row: ListItem, new_position: int) -> list[ListItem]:
    """Move ``item_row`` to ``new_position`` (1-based) within its list, shifting the rest.

    See ``delete_item`` for why this can't be a single bulk ``UPDATE``. The moved item
    is parked at a sentinel position first (freeing its old slot), the affected range is
    then shifted one at a time in the direction that always writes into the slot the
    previous step just vacated, and finally the moved item lands on ``new_position``.
    """
    list_id = item_row.list_id
    old_position = item_row.position
    count = _item_count(db, list_id)

    if new_position < 1 or new_position > count:
        raise InvalidPositionError
    if new_position == old_position:
        return list_items_for_list(db, list_id)

    db.execute(
        update(ListItem).where(ListItem.id == item_row.id).values(position=_SENTINEL_POSITION)
    )
    db.flush()

    if new_position < old_position:
        # Moving earlier: [new_position, old_position) shifts up by one. Process from
        # the slot closest to the freed gap (old_position - 1) outward, so each write
        # lands where the previous one just vacated.
        affected = db.scalars(
            select(ListItem)
            .where(
                ListItem.list_id == list_id,
                ListItem.position >= new_position,
                ListItem.position < old_position,
            )
            .order_by(ListItem.position.desc())
        )
        for row in affected:
            db.execute(
                update(ListItem).where(ListItem.id == row.id).values(position=row.position + 1)
            )
    else:
        # Moving later: (old_position, new_position] shifts down by one, processed from
        # the freed gap outward in the opposite direction.
        affected = db.scalars(
            select(ListItem)
            .where(
                ListItem.list_id == list_id,
                ListItem.position > old_position,
                ListItem.position <= new_position,
            )
            .order_by(ListItem.position.asc())
        )
        for row in affected:
            db.execute(
                update(ListItem).where(ListItem.id == row.id).values(position=row.position - 1)
            )

    db.execute(update(ListItem).where(ListItem.id == item_row.id).values(position=new_position))
    db.commit()

    return list_items_for_list(db, list_id)
