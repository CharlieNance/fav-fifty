"""The admin dashboard's numbers (docs/ADMIN_AND_ANALYTICS_PLAN.md §Dashboards).

Aggregates only, never content. Product numbers come from the existing tables;
health from ``request_counts``; cost from the latest ``cost_snapshots`` row. The
route caches the result for a few minutes (an optimization only).

Anonymous visitors' activity and catalog numbers arrive with the ``/events``
stream (build-order step 6); "active" here means *signed in* in the window.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.orm import Session

from app.models.list import List
from app.models.list_item import ListItem
from app.models.metrics import RequestCount
from app.models.user import User
from app.services import cost_service

DAILY_WINDOW_DAYS = 30
HEALTH_WINDOW_HOURS = 24


def _utc_day(column: Any) -> Any:
    return cast(func.timezone("UTC", column), Date)


def _daily(db: Session, column: Any, since: datetime, *where: Any) -> dict[date, int]:
    day = _utc_day(column)
    rows = db.execute(select(day, func.count()).where(column >= since, *where).group_by(day)).all()
    return {row[0]: row[1] for row in rows}


def product(db: Session, now: datetime) -> dict[str, Any]:
    def count(statement: Any) -> int:
        return db.scalar(statement) or 0

    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)
    live = List.deleted_at.is_(None)

    first_day = (now - timedelta(days=DAILY_WINDOW_DAYS - 1)).date()
    since = datetime(first_day.year, first_day.month, first_day.day, tzinfo=UTC)
    users = _daily(db, User.created_at, since)
    lists = _daily(db, List.created_at, since)
    imported = _daily(db, List.created_at, since, List.import_key.is_not(None))
    items = _daily(db, ListItem.created_at, since)
    days = [first_day + timedelta(days=offset) for offset in range(DAILY_WINDOW_DAYS)]

    return {
        "users_total": count(select(func.count(User.id))),
        "users_new_7d": count(select(func.count(User.id)).where(User.created_at >= week_ago)),
        "users_new_30d": count(select(func.count(User.id)).where(User.created_at >= month_ago)),
        "users_signed_in_7d": count(
            select(func.count(User.id)).where(User.last_login_at >= week_ago)
        ),
        "users_locked": count(select(func.count(User.id)).where(User.is_active.is_(False))),
        "lists_live": count(select(func.count(List.id)).where(live)),
        "items_live": count(
            select(func.count(ListItem.id)).join(List, ListItem.list_id == List.id).where(live)
        ),
        "daily": [
            {
                "day": day,
                "users_created": users.get(day, 0),
                "lists_created": lists.get(day, 0),
                "lists_imported": imported.get(day, 0),
                "items_created": items.get(day, 0),
            }
            for day in days
        ],
    }


def _status_sum(status: str) -> Any:
    return func.coalesce(
        func.sum(case((RequestCount.status_class == status, RequestCount.count), else_=0)), 0
    )


def health(db: Session, now: datetime) -> dict[str, Any]:
    this_hour = now.replace(minute=0, second=0, microsecond=0)
    since = this_hour - timedelta(hours=HEALTH_WINDOW_HOURS - 1)
    in_window = RequestCount.minute >= since
    columns = (
        func.coalesce(func.sum(RequestCount.count), 0),
        _status_sum("4xx"),
        _status_sum("5xx"),
        _status_sum("429"),
    )

    def counts(row: Any) -> dict[str, int]:
        return {
            "requests": int(row[0]),
            "client_errors": int(row[1]),
            "server_errors": int(row[2]),
            "rate_limited": int(row[3]),
        }

    totals = db.execute(select(*columns).where(in_window)).one()
    by_route = db.execute(
        select(RequestCount.route_class, *columns)
        .where(in_window)
        .group_by(RequestCount.route_class)
        .order_by(func.sum(RequestCount.count).desc())
    ).all()
    # The 3-argument form buckets in UTC whatever the session time zone is.
    hour = func.date_trunc("hour", RequestCount.minute, "UTC")
    hourly = {
        row[0]: counts(row[1:])
        for row in db.execute(select(hour, *columns).where(in_window).group_by(hour)).all()
    }
    empty = counts((0, 0, 0, 0))

    return {
        "window_hours": HEALTH_WINDOW_HOURS,
        "totals": counts(totals),
        "by_route": [{"route_class": row[0], **counts(row[1:])} for row in by_route],
        "hourly": [
            {"hour": at, **hourly.get(at, empty)}
            for at in (since + timedelta(hours=offset) for offset in range(HEALTH_WINDOW_HOURS))
        ],
    }


def dashboard(db: Session, now: datetime, cloudwatch_dashboard_url: str) -> dict[str, Any]:
    return {
        "generated_at": now,
        "product": product(db, now),
        "health": health(db, now),
        "cost": cost_service.latest_snapshot(db),
        "cloudwatch_dashboard_url": cloudwatch_dashboard_url or None,
    }
