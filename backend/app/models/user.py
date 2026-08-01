"""User model — one row per signed-in account (linked to a Cognito identity)."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.list import List


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "users"

    # Cognito's stable subject identifier — how a social login maps to this user.
    cognito_sub: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(100))
    avatar_url: Mapped[str | None] = mapped_column(String(1024), default=None)

    # Safety net for relinking accounts if the Cognito user pool is ever recreated
    # (which mints a new `cognito_sub` for the same Google account). Nullable because
    # rows created before this column existed won't have it until their next login.
    email: Mapped[str | None] = mapped_column(String(255), index=True, default=None)

    # Access revocation, checked on every authenticated request:
    #   is_active=False           → instant per-user disable.
    #   session_token_version     → embedded in each session cookie; bump to
    #                               invalidate ALL of a user's outstanding sessions
    #                               ("log out everywhere") without rotating SECRET_KEY.
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true", default=True)
    session_token_version: Mapped[int] = mapped_column(Integer, server_default="0", default=0)

    # Cheapest durable signal for usage trends; a full event log can follow later.
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)

    lists: Mapped[list[List]] = relationship(back_populates="owner", cascade="all, delete-orphan")
