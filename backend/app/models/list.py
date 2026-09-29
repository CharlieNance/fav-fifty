"""List model — a user's ranked collection of up to 50 favorite things.

The "up to 50" cap is enforced in the service layer, not the database, so the
limit is easy to reason about and change.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func, select
from sqlalchemy.orm import Mapped, column_property, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.list_item import ListItem
from app.models.tag import list_tags

if TYPE_CHECKING:
    from app.models.tag import Tag
    from app.models.user import User


class List(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "lists"
    __table_args__ = (CheckConstraint("status in ('draft', 'published')", name="ck_lists_status"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, default=None)
    # 'draft' until the user publishes the list; then 'published'.
    status: Mapped[str] = mapped_column(String(20), server_default="draft")
    # Soft delete: NULL means active. A dedicated column (not a bool) can't drift
    # out of sync with itself, and keeps "deleted" distinct from `updated_at`.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None, index=True
    )

    owner: Mapped[User] = relationship(back_populates="lists")
    items: Mapped[list[ListItem]] = relationship(
        back_populates="list_",
        cascade="all, delete-orphan",
        order_by="ListItem.position",
    )
    tags: Mapped[list[Tag]] = relationship(secondary=list_tags, back_populates="lists")


# How many items the list holds, computed by the database as a correlated
# COUNT subquery every time a list row is loaded — so it's always current, needs
# no column/migration, and costs one extra index lookup (list_items.list_id) per
# row rather than loading the items themselves. Assigned after the class body
# because the subquery has to reference `List.id`, which only exists once the
# class is mapped.
List.item_count = column_property(  # type: ignore[attr-defined]
    select(func.count(ListItem.id))
    .where(ListItem.list_id == List.id)
    .correlate_except(ListItem)
    .scalar_subquery()
)
