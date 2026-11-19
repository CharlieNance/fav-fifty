"""POST /events: the switch, the allowlist, the guards; the rollup, retention and dashboard.

The local database also holds events from manual testing, so every test scopes its
queries to a session id (or a far-off day) only it uses.
"""

import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli
from app.core.request_counts import MemoryRequestCounter
from app.core.runtime_settings import Features, RateLimits, RuntimeSettings
from app.models.analytics import AnalyticsDaily, AnalyticsEvent
from app.schemas.events import EventIn
from app.services import analytics_service

ON = RuntimeSettings(features=Features(events_enabled=True))


def _batch(session_id: uuid.UUID, *events: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        "session_id": str(session_id),
        "platform": "web",
        "app_version": "1.2.3",
        "events": list(events),
        **extra,
    }


def _stored(db: Session, session_id: uuid.UUID) -> list[AnalyticsEvent]:
    return list(
        db.scalars(
            select(AnalyticsEvent)
            .where(AnalyticsEvent.session_id == session_id)
            .order_by(AnalyticsEvent.occurred_at)
        )
    )


@pytest.fixture
def events_on(set_runtime_settings: Callable[[RuntimeSettings], None]) -> None:
    set_runtime_settings(ON)


# ─── The endpoint ───────────────────────────────────────────────────────────────


def test_off_by_default_answers_204_and_drops_everything(
    client: TestClient, db_session: Session
) -> None:
    session_id = uuid.uuid4()
    response = client.post("/events", json=_batch(session_id, {"name": "session_start"}))
    assert response.status_code == 204
    assert _stored(db_session, session_id) == []


@pytest.mark.usefixtures("events_on")
def test_anonymous_events_are_stored_without_a_user(
    client: TestClient, db_session: Session
) -> None:
    session_id = uuid.uuid4()
    response = client.post(
        "/events",
        json=_batch(session_id, {"name": "session_start"}, {"name": "list_created"}),
    )
    assert response.status_code == 204

    stored = _stored(db_session, session_id)
    assert sorted(event.name for event in stored) == ["list_created", "session_start"]
    assert all(event.user_id is None for event in stored)
    assert all((e.platform, e.app_version) == ("web", "1.2.3") for e in stored)


@pytest.mark.usefixtures("events_on")
def test_signed_in_events_carry_the_session_user_not_the_body(
    auth_client: TestClient, db_session: Session
) -> None:
    me = auth_client.get("/me").json()["id"]
    session_id = uuid.uuid4()
    auth_client.post(
        "/events",
        json=_batch(
            session_id,
            {"name": "item_added", "user_id": str(uuid.uuid4())},
            user_id=str(uuid.uuid4()),  # ignored: only the cookie says who you are
        ),
    )
    [event] = _stored(db_session, session_id)
    assert str(event.user_id) == me


@pytest.mark.usefixtures("events_on")
def test_unknown_names_props_and_values_are_dropped(
    client: TestClient, db_session: Session
) -> None:
    session_id = uuid.uuid4()
    client.post(
        "/events",
        json=_batch(
            session_id,
            {"name": "not_an_event"},
            {"name": "import_started", "props": {"target": "claim", "query": "my secret search"}},
            {"name": "sign_in_started", "props": {"provider": "free text here"}},
        ),
    )
    stored = {event.name: event.props for event in _stored(db_session, session_id)}
    assert stored == {"import_started": {"target": "claim"}, "sign_in_started": {}}


@pytest.mark.parametrize(
    "body",
    [
        _batch(uuid.uuid4(), *[{"name": "item_added"}] * 51),  # over the batch cap
        _batch(uuid.uuid4(), {"name": "x" * 41}),  # name too long
        _batch(uuid.uuid4(), {"name": "item_added"}, platform="desktop"),
        _batch(uuid.uuid4(), {"name": "item_added"}, app_version="1.0 beta"),
        {**_batch(uuid.uuid4()), "session_id": "not-a-uuid"},
    ],
)
@pytest.mark.usefixtures("events_on")
def test_malformed_batches_are_422(client: TestClient, body: dict[str, Any]) -> None:
    assert client.post("/events", json=body).status_code == 422


@pytest.mark.usefixtures("events_on")
def test_bodies_over_the_events_cap_are_413(client: TestClient) -> None:
    padding = "x" * (17 * 1024)
    body = _batch(uuid.uuid4(), {"name": "item_added"}, padding=padding)
    assert client.post("/events", json=body).status_code == 413


def test_batches_are_rate_limited_per_ip(
    client: TestClient, set_runtime_settings: Callable[[RuntimeSettings], None]
) -> None:
    set_runtime_settings(
        RuntimeSettings(
            features=Features(events_enabled=True), rate_limits=RateLimits(events_per_minute=2)
        )
    )
    body = _batch(uuid.uuid4(), {"name": "item_added"})
    statuses = [client.post("/events", json=body).status_code for _ in range(3)]
    assert statuses == [204, 204, 429]


def test_events_get_their_own_request_count_class(client: TestClient) -> None:
    counter: MemoryRequestCounter = client.app.state.request_counter  # type: ignore[attr-defined]
    client.post("/events", json=_batch(uuid.uuid4()))
    assert counter.counts == {("events", "2xx"): 1}


def test_client_config_says_whether_to_send(
    client: TestClient, set_runtime_settings: Callable[[RuntimeSettings], None]
) -> None:
    assert client.get("/config/client").json()["features"] == {"events_enabled": False}
    set_runtime_settings(ON)
    assert client.get("/config/client").json()["features"] == {"events_enabled": True}


# ─── Timestamps ─────────────────────────────────────────────────────────────────

NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    ("reported", "expected"),
    [
        (None, NOW),
        (NOW - timedelta(hours=3), NOW - timedelta(hours=3)),
        (NOW - timedelta(days=2), NOW),  # too far back
        (NOW + timedelta(hours=1), NOW),  # in the future
        (datetime(2026, 11, 18, 11, 0), datetime(2026, 11, 18, 11, 0, tzinfo=UTC)),  # naive = UTC
    ],
)
def test_client_clocks_are_trusted_only_when_plausible(
    reported: datetime | None, expected: datetime
) -> None:
    assert analytics_service.occurred_at(reported, NOW) == expected


def test_every_allowlisted_prop_value_is_short_and_plain() -> None:
    for props in analytics_service.EVENT_PROPS.values():
        for values in props.values():
            assert all(value.isidentifier() and len(value) <= 16 for value in values)
    assert analytics_service.clean_event(EventIn(name="nope")) is None


# ─── Rollup, retention, dashboard ───────────────────────────────────────────────


def _add(
    db: Session,
    at: datetime,
    name: str,
    session_id: uuid.UUID,
    user_id: uuid.UUID | None = None,
    platform: str = "web",
) -> None:
    db.add(
        AnalyticsEvent(
            occurred_at=at,
            name=name,
            session_id=session_id,
            user_id=user_id,
            platform=platform,
            app_version="t",
        )
    )


def _daily(db: Session, day: date) -> dict[tuple[str, str, bool], tuple[int, int]]:
    rows = db.scalars(select(AnalyticsDaily).where(AnalyticsDaily.day == day))
    return {(r.name, r.platform, r.signed_in): (r.events, r.sessions) for r in rows}


def test_rollup_counts_events_and_sessions_and_can_rerun(
    db_session: Session, fresh_user: Any
) -> None:
    day = date(2001, 2, 3)  # far from any real traffic
    noon = datetime(2001, 2, 3, 12, tzinfo=UTC)
    one, two = uuid.uuid4(), uuid.uuid4()
    _add(db_session, noon, "item_added", one)
    _add(db_session, noon, "item_added", one)
    _add(db_session, noon, "item_added", two)
    _add(db_session, noon, "item_added", uuid.uuid4(), fresh_user.id)
    _add(db_session, noon, "item_added", uuid.uuid4(), platform="ios")
    _add(db_session, noon + timedelta(days=1), "item_added", one)  # the next day
    db_session.commit()

    expected = {
        ("item_added", "web", False): (3, 2),
        ("item_added", "web", True): (1, 1),
        ("item_added", "ios", False): (1, 1),
    }
    assert analytics_service.rollup_day(db_session, day) == 3
    assert _daily(db_session, day) == expected

    _add(db_session, noon, "item_added", two)  # a straggler
    db_session.commit()
    analytics_service.rollup_day(db_session, day)
    assert _daily(db_session, day)[("item_added", "web", False)] == (4, 2)


def test_daily_jobs_roll_up_before_pruning(db_session: Session) -> None:
    today = date(2001, 6, 1)
    session_id = uuid.uuid4()
    old = datetime.combine(today - timedelta(days=91), datetime.min.time(), UTC)
    yesterday = datetime.combine(today - timedelta(days=1), datetime.min.time(), UTC)
    _add(db_session, old, "list_created", session_id)
    _add(db_session, yesterday, "list_created", session_id)
    db_session.commit()

    report = cli.daily_jobs(db_session, today=today)

    assert [e.occurred_at for e in _stored(db_session, session_id)] == [yesterday]
    assert _daily(db_session, yesterday.date()) == {("list_created", "web", False): (1, 1)}
    assert any("Rolled up analytics" in line for line in report)


def test_dashboard_reads_the_rollup_and_today_live(db_session: Session, fresh_user: Any) -> None:
    now = datetime.now(UTC)
    before = analytics_service.dashboard(db_session, now, enabled=True)

    yesterday = (now - timedelta(days=1)).date()
    db_session.add(
        AnalyticsDaily(
            day=yesterday,
            name="session_start",
            platform=f"t{uuid.uuid4().hex[:6]}",  # a platform no real row uses
            signed_in=False,
            events=5,
            sessions=5,
        )
    )
    _add(db_session, now, "session_start", uuid.uuid4())
    _add(db_session, now, "session_start", uuid.uuid4(), fresh_user.id)
    _add(db_session, now, "export_file", uuid.uuid4(), fresh_user.id)
    db_session.commit()

    after = analytics_service.dashboard(db_session, now, enabled=True)

    def day_delta(index: int, key: str) -> int:
        return after["daily"][index][key] - before["daily"][index][key]

    assert after["enabled"] is True
    assert len(after["daily"]) == analytics_service.DASHBOARD_WINDOW_DAYS
    assert after["daily"][-1]["day"] == now.date()
    assert (day_delta(-1, "anonymous_sessions"), day_delta(-1, "signed_in_sessions")) == (1, 1)
    assert day_delta(-2, "anonymous_sessions") == 5

    totals = {row["name"]: row for row in after["by_name"]}
    before_totals = {row["name"]: row for row in before["by_name"]}
    assert list(totals) == list(analytics_service.EVENT_PROPS)
    assert totals["export_file"]["signed_in"] - before_totals["export_file"]["signed_in"] == 1
