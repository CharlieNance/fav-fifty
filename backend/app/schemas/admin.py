"""Admin API schemas.

Nothing here, or anywhere in the API, accepts ``role`` as input: admin is granted
only by the CLI on the box (tests/test_admin_access.py enforces it). ``role`` is
returned, read-only, so the owner can see who's an admin.
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.list import ListRead
from app.schemas.list_item import ItemRead

MAX_REASON_LENGTH = 500


class AuditLogEntryRead(BaseModel):
    """One admin audit-log row."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    admin_user_id: uuid.UUID | None
    action: str
    target_type: str
    target_id: str
    reason: str | None
    details: dict[str, Any]
    created_at: datetime


class AdminAction(BaseModel):
    """Body of a mutating admin action: an optional note for the audit log."""

    reason: str | None = Field(default=None, max_length=MAX_REASON_LENGTH)


class AdminReasonRequired(BaseModel):
    """Body of an action that must say why (removing someone's content)."""

    reason: str = Field(max_length=MAX_REASON_LENGTH)

    @field_validator("reason")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("A reason is required.")
        return trimmed


class AdminUserSummary(BaseModel):
    """A user as the admin sees them in search results."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    email: str | None
    avatar_url: str | None
    role: str
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None
    list_count: int


class AdminUserDetail(AdminUserSummary):
    item_count: int
    recent_actions: list[AuditLogEntryRead]


class SettingRead(BaseModel):
    """One runtime setting on the admin Settings page."""

    key: str
    kind: Literal["int", "bool"]
    description: str
    default: int | bool
    minimum: int | None
    maximum: int | None
    # What the app is using right now (the override if valid, else the default).
    value: int | bool
    # The stored text, or None when the setting is on its code default.
    override: str | None
    override_invalid: bool
    last_change: AuditLogEntryRead | None


class SettingUpdate(BaseModel):
    """Checked against the setting's own type and bounds, strictly (no ``1`` for true)."""

    value: int | bool
    reason: str | None = Field(default=None, max_length=MAX_REASON_LENGTH)


class AdminListSummary(ListRead):
    """A list as the admin sees it: deleted ones included, and who deleted them."""

    deleted_at: datetime | None
    # Deleted by an admin (restorable here), not by its owner.
    removed_by_admin: bool


class AdminListDetail(AdminListSummary):
    user_id: uuid.UUID
    owner_display_name: str
    items: list[ItemRead]
    recent_actions: list[AuditLogEntryRead]
