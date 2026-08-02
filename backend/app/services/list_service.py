"""List service — the one place that owns the ``lists`` table's business rules.

Functions take a ``Session`` argument (not a global), so they unit-test without the
HTTP app. Routes delegate here; the DB row is queried/mutated here and nowhere else.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.list import List


def list_for_user(db: Session, user_id: uuid.UUID) -> list[List]:
    """Return ``user_id``'s non-deleted lists, most recently updated first."""
    return list(
        db.scalars(
            select(List)
            .where(List.user_id == user_id, List.deleted_at.is_(None))
            .order_by(List.updated_at.desc())
        )
    )


def create_list(db: Session, user_id: uuid.UUID, title: str) -> List:
    """Create a new list owned by ``user_id``. ``title`` is already validated/trimmed."""
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
