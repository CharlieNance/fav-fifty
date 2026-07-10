"""ListItem model — a single ranked entry within a list."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.list import List


class ListItem(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "list_items"
    # No two items in the same list share a rank.
    __table_args__ = (UniqueConstraint("list_id", "position", name="uq_list_items_list_position"),)

    list_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lists.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)  # rank within the list (1..50)
    text: Mapped[str] = mapped_column(String(500))
    note: Mapped[str | None] = mapped_column(Text, default=None)
    image_url: Mapped[str | None] = mapped_column(String(2048), default=None)

    list_: Mapped[List] = relationship(back_populates="items")
