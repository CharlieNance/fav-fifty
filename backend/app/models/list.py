"""List model — a user's ranked collection of up to 50 favorite things.

The "up to 50" cap is enforced in the service layer, not the database, so the
limit is easy to reason about and change.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.tag import list_tags

if TYPE_CHECKING:
    from app.models.list_item import ListItem
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
