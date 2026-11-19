"""First-party product events (docs/ARCHITECTURE.md §Analytics).

Anonymous visitors keep their lists on the device, so the server never sees what
they do unless the client says so. ``POST /events`` records what it's told, from an
allowlist (app/services/analytics_service.py), into ``analytics_events``:

* **No IP address and no free text** are ever stored. Event properties are short
  values from a fixed set per event.
* ``user_id`` comes from the session cookie, never from the request body, and is
  ``NULL`` for anonymous visitors. Deleting a user deletes their events.
* Raw events are kept 90 days. ``python -m app.cli daily-jobs`` rolls each day up
  into ``analytics_daily`` first, which keeps the counts for good.
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin


class AnalyticsEvent(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "analytics_events"

    # When it happened by the client's clock, clamped near the time it arrived.
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    name: Mapped[str] = mapped_column(String(32))
    # A random id the client keeps for one browser tab session (or app launch).
    session_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), default=None
    )
    # web | ios | android
    platform: Mapped[str] = mapped_column(String(8))
    app_version: Mapped[str] = mapped_column(String(32))
    props: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}", default=dict)


class AnalyticsDaily(Base):
    """One day's count of one event, per platform, for anonymous vs signed-in callers."""

    __tablename__ = "analytics_daily"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    name: Mapped[str] = mapped_column(String(32), primary_key=True)
    platform: Mapped[str] = mapped_column(String(8), primary_key=True)
    signed_in: Mapped[bool] = mapped_column(Boolean, primary_key=True)
    events: Mapped[int] = mapped_column(Integer)
    # Distinct sessions that sent this event that day.
    sessions: Mapped[int] = mapped_column(Integer)
