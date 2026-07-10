"""Tag model and the list⇄tag association table.

Tags are free-form text. A future phase may promote popular tags into a curated
category system (see docs/DECISIONS.md).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Column, ForeignKey, String, Table
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.list import List

# Many-to-many: a list can have many tags, a tag can belong to many lists.
list_tags = Table(
    "list_tags",
    Base.metadata,
    Column("list_id", ForeignKey("lists.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class Tag(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "tags"

    # Stored normalized (lower-cased, trimmed) by the service layer.
    name: Mapped[str] = mapped_column(String(50), unique=True, index=True)

    lists: Mapped[list[List]] = relationship(secondary=list_tags, back_populates="tags")
