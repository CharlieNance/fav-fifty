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
