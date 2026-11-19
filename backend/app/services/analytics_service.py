"""First-party analytics events: what's accepted, stored, rolled up and shown.

docs/ARCHITECTURE.md §Analytics. The rules that keep this small and
private live here, in one place:

* **An allowlist.** Only the event names in ``EVENT_PROPS`` are stored, and each
  only with its listed properties, each property only with one of its listed
  values. Anything else is dropped quietly: no free text (search queries, titles)
  can reach the table, whatever a client sends.
* **No IP addresses**, and the user id comes from the session, never the body.
* **Timestamps are clamped**: a client clock more than a day behind or a few
  minutes ahead is replaced by the arrival time, so one bad clock can't write
  into a day that's already been rolled up long ago, or into the future.
* **Rollup.** ``rollup_day`` turns one UTC day of raw events into
  ``analytics_daily`` rows. It recomputes from scratch, so running it twice (or
  again after late events) is safe. The dashboard reads the rollup for past days
  and computes today live, so it's current without waiting for the nightly job.
"""

import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import delete, distinct, func, select
from sqlalchemy.orm import Session

from app.models.analytics import AnalyticsDaily, AnalyticsEvent
from app.schemas.events import EventBatch, EventIn

# Event name → its allowed properties → each property's allowed values. Add a name
# here (and to the clients' list) to start counting it. Order is display order.
EVENT_PROPS: dict[str, dict[str, frozenset[str]]] = {
    "session_start": {},
    "list_created": {},
    "item_added": {},
    "catalog_search": {},
    "catalog_pick": {},
    "export_file": {},
    # target: where the lists went. "claim" = the on-device lists offered at sign-in.
    "import_started": {"target": frozenset({"device", "account", "claim"})},
    "import_succeeded": {"target": frozenset({"device", "account", "claim"})},
    "sign_in_started": {"provider": frozenset({"google", "dev"})},
    "sign_in_succeeded": {"provider": frozenset({"google", "dev"})},
}

SESSION_START = "session_start"

RETENTION_DAYS = 90
# How far a client's clock may be from ours before its timestamp is ignored. A day
# back covers a batch queued on a phone that went to sleep; the rollup re-runs the
# last ``ROLLUP_LOOKBACK_DAYS`` days to pick such stragglers up.
MAX_CLOCK_BEHIND = timedelta(days=1)
MAX_CLOCK_AHEAD = timedelta(minutes=5)
ROLLUP_LOOKBACK_DAYS = 2

DASHBOARD_WINDOW_DAYS = 30


def clean_event(event: EventIn) -> tuple[str, dict[str, str]] | None:
    """The event's name and allowlisted props, or ``None`` if the name isn't known."""
    allowed = EVENT_PROPS.get(event.name)
    if allowed is None:
        return None
    props = {
        key: value for key, value in event.props.items() if key in allowed and value in allowed[key]
    }
    return event.name, props


def occurred_at(reported: datetime | None, now: datetime) -> datetime:
    """The client's time if it's plausible, else ``now``."""
    if reported is None:
        return now
    if reported.tzinfo is None:
        reported = reported.replace(tzinfo=UTC)
    if now - MAX_CLOCK_BEHIND <= reported <= now + MAX_CLOCK_AHEAD:
        return reported
    return now


def record_batch(db: Session, batch: EventBatch, user_id: uuid.UUID | None, now: datetime) -> int:
    """Store the batch's allowlisted events; returns how many were kept."""
    rows = []
    for event in batch.events:
        cleaned = clean_event(event)
        if cleaned is None:
            continue
        name, props = cleaned
        rows.append(
            AnalyticsEvent(
                occurred_at=occurred_at(event.at, now),
                name=name,
                session_id=batch.session_id,
                user_id=user_id,
                platform=batch.platform,
                app_version=batch.app_version,
                props=props,
            )
        )
    if rows:
        db.add_all(rows)
        db.commit()
    return len(rows)


# ─── Rollup and retention (python -m app.cli daily-jobs) ────────────────────────


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time(), UTC)
    return start, start + timedelta(days=1)


def day_rows(db: Session, day: date) -> list[dict[str, Any]]:
    """One UTC day of raw events, counted as ``analytics_daily`` rows (not stored)."""
    start, end = _day_bounds(day)
    signed_in = AnalyticsEvent.user_id.is_not(None)
    result = db.execute(
        select(
            AnalyticsEvent.name,
            AnalyticsEvent.platform,
            signed_in,
            func.count(),
            func.count(distinct(AnalyticsEvent.session_id)),
        )
        .where(AnalyticsEvent.occurred_at >= start, AnalyticsEvent.occurred_at < end)
        .group_by(AnalyticsEvent.name, AnalyticsEvent.platform, signed_in)
    ).all()
    return [
        {
            "day": day,
            "name": row[0],
            "platform": row[1],
            "signed_in": bool(row[2]),
            "events": row[3],
            "sessions": row[4],
        }
        for row in result
    ]


def rollup_day(db: Session, day: date) -> int:
    """(Re)compute ``analytics_daily`` for ``day``; returns the number of rows."""
    rows = day_rows(db, day)
    db.execute(delete(AnalyticsDaily).where(AnalyticsDaily.day == day))
    db.add_all(AnalyticsDaily(**row) for row in rows)
    db.commit()
    return len(rows)


def prune(db: Session, today: date) -> int:
    """Delete raw events older than ``RETENTION_DAYS``; the rollup keeps their counts."""
    cutoff = datetime.combine(today - timedelta(days=RETENTION_DAYS), time(), UTC)
    pruned = db.execute(delete(AnalyticsEvent).where(AnalyticsEvent.occurred_at < cutoff))
    db.commit()
    return pruned.rowcount


def daily_jobs(db: Session, today: date) -> list[str]:
    """Roll up the last few complete days, then prune. Rollup first, so nothing is
    deleted before it's been counted."""
    days = [today - timedelta(days=back) for back in range(ROLLUP_LOOKBACK_DAYS, 0, -1)]
    rolled = sum(rollup_day(db, day) for day in days)
    pruned = prune(db, today)
    return [
        f"Rolled up analytics for {days[0]}..{days[-1]} ({rolled} rows).",
        f"Pruned {pruned} analytics events older than {RETENTION_DAYS} days.",
    ]


# ─── The admin dashboard ────────────────────────────────────────────────────────


def dashboard(db: Session, now: datetime, enabled: bool) -> dict[str, Any]:
    """Sessions per day and totals per event, anonymous vs signed in, last 30 days.

    Past days come from the rollup; today is computed live from the raw events.
    """
    today = now.date()
    first_day = today - timedelta(days=DASHBOARD_WINDOW_DAYS - 1)
    stored = db.scalars(
        select(AnalyticsDaily).where(AnalyticsDaily.day >= first_day, AnalyticsDaily.day < today)
    ).all()
    rows = [
        {"day": r.day, "name": r.name, "signed_in": r.signed_in, "events": r.events} for r in stored
    ] + day_rows(db, today)

    sessions: dict[date, dict[bool, int]] = defaultdict(lambda: {False: 0, True: 0})
    totals: dict[str, dict[bool, int]] = {name: {False: 0, True: 0} for name in EVENT_PROPS}
    for row in rows:
        if row["name"] == SESSION_START:
            sessions[row["day"]][row["signed_in"]] += row["events"]
        if row["name"] in totals:
            totals[row["name"]][row["signed_in"]] += row["events"]

    days = [first_day + timedelta(days=offset) for offset in range(DASHBOARD_WINDOW_DAYS)]
    return {
        "enabled": enabled,
        "window_days": DASHBOARD_WINDOW_DAYS,
        "daily": [
            {
                "day": day,
                "anonymous_sessions": sessions[day][False],
                "signed_in_sessions": sessions[day][True],
            }
            for day in days
        ],
        "by_name": [
            {"name": name, "anonymous": counts[False], "signed_in": counts[True]}
            for name, counts in totals.items()
        ],
    }
