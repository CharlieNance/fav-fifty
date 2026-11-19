"""Admin API schemas.

Nothing here, or anywhere in the API, accepts ``role`` as input: admin is granted
only by the CLI on the box (tests/test_admin_access.py enforces it). ``role`` is
returned, read-only, so the owner can see who's an admin.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
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


class DailyProduct(BaseModel):
    day: date
    users_created: int
    lists_created: int
    lists_imported: int
    items_created: int


class ProductNumbers(BaseModel):
    users_total: int
    users_new_7d: int
    users_new_30d: int
    # Signed in during the last 7 days (anonymous use is in AnalyticsNumbers).
    users_signed_in_7d: int
    users_locked: int
    lists_live: int
    items_live: int
    daily: list[DailyProduct]


class RequestCounts(BaseModel):
    requests: int
    # 4xx other than 429.
    client_errors: int
    server_errors: int
    rate_limited: int


class RouteCounts(RequestCounts):
    route_class: str


class HourlyCounts(RequestCounts):
    hour: datetime


class HealthNumbers(BaseModel):
    window_hours: int
    totals: RequestCounts
    by_route: list[RouteCounts]
    hourly: list[HourlyCounts]


class CostRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    taken_at: datetime
    month: date
    month_to_date: Decimal
    forecast: Decimal | None
    currency: str
    by_service: dict[str, str]


class DailySessions(BaseModel):
    day: date
    anonymous_sessions: int
    signed_in_sessions: int


class EventTotals(BaseModel):
    name: str
    anonymous: int
    signed_in: int


class AnalyticsNumbers(BaseModel):
    # features.events_enabled: off means nothing new is being recorded.
    enabled: bool
    window_days: int
    daily: list[DailySessions]
    # Every allowlisted event, in a fixed order, zeros included.
    by_name: list[EventTotals]


class Dashboard(BaseModel):
    generated_at: datetime
    product: ProductNumbers
    analytics: AnalyticsNumbers
    health: HealthNumbers
    # None until the daily job has taken a snapshot.
    cost: CostRead | None
    cloudwatch_dashboard_url: str | None
