"""List service — the one place that owns the ``lists`` table's business rules.

Functions take a ``Session`` argument (not a global), so they unit-test without the
HTTP app. Routes delegate here; the DB row is queried/mutated here and nowhere else.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.models.list import List
from app.models.tag import Tag
from app.models.user import User


class TooManyListsError(Exception):
    """The account is at its ``max_lists_per_user`` quota."""

    def __init__(self, max_lists: int):
        super().__init__(f"at most {max_lists} lists")
        self.max_lists = max_lists


# Escapes LIKE metacharacters (and the escape character itself) in user-supplied
# search text, paired with `escape="\\"` on every `ilike()` call below — without
# this, a literal `%`/`_` in `q` is interpreted as a SQL wildcard instead of the
# literal character a user typed (see docs/ARCHITECTURE.md §Tags and search).
_LIKE_ESCAPE_CHAR = "\\"


def _escape_like(value: str) -> str:
    return (
        value.replace(_LIKE_ESCAPE_CHAR, _LIKE_ESCAPE_CHAR * 2)
        .replace("%", f"{_LIKE_ESCAPE_CHAR}%")
        .replace("_", f"{_LIKE_ESCAPE_CHAR}_")
    )


def list_for_user(db: Session, user_id: uuid.UUID, q: str | None = None) -> list[List]:
    """Return ``user_id``'s non-deleted lists, most recently updated first.

    ``q``, if given, filters to lists whose title or any tag name contains it
    (case-insensitive substring). Whitespace-only or omitted ``q`` means "no filter" —
    same result as calling this without the argument at all (see
    docs/ARCHITECTURE.md §Tags and search). Matching a tag uses an ``EXISTS``
    subquery (``List.tags.any(...)``) rather than a join, so a list with multiple
    matching tags is still returned once. Tags are eager-loaded (``selectinload``)
    since every result renders its ``tags`` in ``ListRead`` — otherwise each row
    would trigger its own lazy-load query.
    """
    stmt = (
        select(List)
        .where(List.user_id == user_id, List.deleted_at.is_(None))
        .options(selectinload(List.tags))
    )
    query = q.strip() if q else None
    if query:
        pattern = f"%{_escape_like(query)}%"
        stmt = stmt.where(
            or_(
                List.title.ilike(pattern, escape=_LIKE_ESCAPE_CHAR),
                List.tags.any(Tag.name.ilike(pattern, escape=_LIKE_ESCAPE_CHAR)),
            )
        )
    return list(db.scalars(stmt.order_by(List.updated_at.desc())))


def lock_user_and_count_lists(db: Session, user_id: uuid.UUID) -> int:
    """Lock ``user_id``'s row for this transaction and count their live lists.

    The lock serializes list-creating requests per account (a double-click, or a
    create racing an import), so two of them can't both see room under the quota
    and together go past it. Other users are unaffected.
    """
    db.execute(select(User.id).where(User.id == user_id).with_for_update())
    return (
        db.scalar(
            select(func.count(List.id)).where(List.user_id == user_id, List.deleted_at.is_(None))
        )
        or 0
    )


def create_list(db: Session, user_id: uuid.UUID, title: str, max_lists: int) -> List:
    """Create a new list owned by ``user_id``. ``title`` is already validated/trimmed.

    Raises ``TooManyListsError`` if the account already has ``max_lists`` live lists
    (deleted ones don't count).
    """
    if lock_user_and_count_lists(db, user_id) >= max_lists:
        db.rollback()  # Releases the row lock.
        raise TooManyListsError(max_lists)
    row = List(user_id=user_id, title=title)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_owned_list(db: Session, list_id: uuid.UUID, user_id: uuid.UUID) -> List | None:
    """Look up one non-deleted list scoped to its owner, or ``None``.

    Backs ``GET``/``PATCH``/``DELETE /api/lists/{list_id}``. A wrong owner, a
    soft-deleted row, and a nonexistent id are all indistinguishable here on
    purpose — the route turns ``None`` into a 404, never a 403.
    """
    return db.scalar(
        select(List).where(
            List.id == list_id,
            List.user_id == user_id,
            List.deleted_at.is_(None),
        )
    )


def rename_list(db: Session, row: List, title: str) -> List:
    """Rename an already-resolved, owned list. ``title`` is already validated/trimmed."""
    row.title = title
    db.commit()
    db.refresh(row)
    return row


def soft_delete_list(db: Session, row: List) -> None:
    """Soft-delete an already-resolved, owned list by stamping ``deleted_at``.

    Never issues a real ``DELETE`` — see docs/ARCHITECTURE.md §Lists. Callers resolve
    ``row`` via ``get_owned_list`` first, so ownership/soft-delete filtering has
    already happened once here.
    """
    row.deleted_at = datetime.now(UTC)
    db.commit()
