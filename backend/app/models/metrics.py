"""Operational numbers the admin dashboard reads (docs/ADMIN_AND_ANALYTICS_PLAN.md
§Dashboards): per-minute request counts and daily cost snapshots.

Both are small by construction: request counts are one row per minute × route
class × status class that actually occurred (pruned after 35 days by
``python -m app.cli daily-jobs``), and there's one cost row per day.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Date, DateTime, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDPrimaryKeyMixin


class RequestCount(Base):
    """How many requests one route class answered with one status class in one minute."""

    __tablename__ = "request_counts"

    minute: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    # lists | auth | config | me | admin | events | other (app/core/request_counts.py).
    route_class: Mapped[str] = mapped_column(String(16), primary_key=True)
    # 2xx | 3xx | 4xx | 429 | 5xx: 429 is split out of 4xx because it's the one
    # the abuse and cost tripwires watch.
    status_class: Mapped[str] = mapped_column(String(8), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)


class CostSnapshot(Base, UUIDPrimaryKeyMixin):
    """Month-to-date AWS cost, taken once a day from Cost Explorer."""

    __tablename__ = "cost_snapshots"

    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # The first day of the month the numbers are for.
    month: Mapped[date] = mapped_column(Date)
    month_to_date: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    # A straight-line projection of month_to_date to the month's end (computed here,
    # not by the Cost Explorer forecast API, which would be a second paid call).
    forecast: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), default=None)
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    # {"Amazon Lightsail": "3.50", ...}, the services with a non-zero cost.
    by_service: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}", default=dict)
