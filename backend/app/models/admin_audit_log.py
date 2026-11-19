"""Admin audit log: one append-only row per admin action.

Every mutating admin action, and every read of a user's private content, writes a
row in the same transaction as the action (docs/ARCHITECTURE.md §Audit
log). Nothing updates or deletes these rows.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin


class AdminAuditLog(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "admin_audit_log"
    __table_args__ = (
        Index("ix_admin_audit_log_target", "target_type", "target_id"),
        Index("ix_admin_audit_log_created_at", "created_at"),
    )

    # Who did it. NULL for actions run from the CLI on the box (e.g. grant-admin),
    # and kept (SET NULL) if that account is ever deleted, so the history survives.
    admin_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), default=None
    )
    action: Mapped[str] = mapped_column(String(64))
    target_type: Mapped[str] = mapped_column(String(32))
    # A UUID for users/lists, a setting key for settings: so text, not a FK.
    target_id: Mapped[str] = mapped_column(String(255))
    reason: Mapped[str | None] = mapped_column(Text, default=None)
    # Small structured context (old/new value, counts). Named ``details`` because
    # ``metadata`` is reserved on SQLAlchemy declarative models.
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}", default=dict)
    # Stamped in Python (wall clock), not by now(), which is fixed for a whole
    # transaction: several actions in one transaction still sort in order.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), default=lambda: datetime.now(UTC)
    )
