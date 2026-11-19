"""Admin dashboard: request counters, product/health numbers, the cost snapshot.

The local database also holds rows from e2e runs and manual testing, so the
dashboard tests compare numbers before and after adding their own rows (deltas),
never absolute totals.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli
from app.api.router import API_V1_PREFIX
from app.auth.claims import Claims
from app.auth.session import issue_session
from app.core.config import settings
from app.core.request_counts import (
    MemoryRequestCounter,
    PostgresRequestCounter,
    route_class,
    status_class,
)
from app.models.list import List
from app.models.list_item import ListItem
from app.models.metrics import CostSnapshot, IpRequestCount, RequestCount
from app.models.user import ROLE_ADMIN, User
from app.services import cost_service, dashboard_service, user_service
from tests.conftest import API_BASE_URL, BROWSER_HEADERS

# ─── Request counters ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/v1/lists/abc/items", "lists"),
        ("/api/v1/auth/login", "auth"),
        ("/api/v1/me", "me"),
        ("/api/v1/admin/users", "admin"),
        ("/api/v1/docs", "other"),
        ("/favicon.ico", "other"),
        ("/api/v1/health", None),  # the uptime probe isn't counted
    ],
)
def test_route_class(path: str, expected: str | None) -> None:
    assert route_class(path, API_V1_PREFIX) == expected


@pytest.mark.parametrize(
    ("status", "expected"), [(200, "2xx"), (302, "3xx"), (404, "4xx"), (429, "429"), (503, "5xx")]
)
def test_status_class(status: int, expected: str) -> None:
    assert status_class(status) == expected


def test_the_middleware_counts_answers_including_refusals(client: TestClient) -> None:
    counter: MemoryRequestCounter = client.app.state.request_counter  # type: ignore[attr-defined]

    client.get("/health")
    client.get("/me")  # 401: no session
    client.post("/lists", json={"title": "x"}, headers={"Origin": "https://evil.example"})  # 403
    client.get("/config/client")

    assert counter.counts == {("me", "4xx"): 1, ("lists", "4xx"): 1, ("config", "2xx"): 1}


def test_the_postgres_counter_upserts_one_row_per_minute(db_session: Session) -> None:
    connection = db_session.connection()
    counter = PostgresRequestCounter(
        lambda: Session(bind=connection, join_transaction_mode="create_savepoint")
    )
    minute = datetime(2001, 1, 1, 12, 0, tzinfo=UTC)  # far from any real traffic

    for _ in range(3):
        counter.record("lists", "2xx", minute, "192.0.2.10")
    counter.record("lists", "5xx", minute, "192.0.2.10")
    counter.record("auth", "429", minute.replace(minute=30), "192.0.2.10")

    rows = db_session.scalars(select(RequestCount).where(RequestCount.minute == minute)).all()
    assert sorted((row.status_class, row.count) for row in rows) == [("2xx", 3), ("5xx", 1)]
    # The same IP, bucketed by hour: 5 requests, 1 of them a 429.
    by_ip = db_session.scalars(
        select(IpRequestCount).where(
            IpRequestCount.hour == minute, IpRequestCount.ip == "192.0.2.10"
        )
    ).one()
    assert (by_ip.requests, by_ip.rate_limited) == (5, 1)


# ─── Dashboard numbers ──────────────────────────────────────────────────────────


def _new_user(db: Session) -> User:
    return user_service.get_or_create_user(
        db, Claims(sub=f"dash-{uuid.uuid4()}", email="dash@example.com", name="Dash")
    )


def test_product_numbers_count_new_rows(db_session: Session) -> None:
    now = datetime.now(UTC)
    before = dashboard_service.product(db_session, now)

    user = _new_user(db_session)
    live = List(user_id=user.id, title="Live")
    imported = List(user_id=user.id, title="Imported", import_key="device:1")
    gone = List(user_id=user.id, title="Gone", deleted_at=now)
    db_session.add_all([live, imported, gone])
    db_session.flush()
    db_session.add_all([ListItem(list_id=live.id, position=1, text="a")])
    db_session.commit()

    after = dashboard_service.product(db_session, datetime.now(UTC))

    def delta(key: str) -> int:
        return after[key] - before[key]

    assert delta("users_total") == delta("users_new_7d") == delta("users_signed_in_7d") == 1
    assert delta("lists_live") == 2  # the deleted one doesn't count
    assert delta("items_live") == 1

    today_before, today_after = before["daily"][-1], after["daily"][-1]
    assert today_after["day"] == now.date()
    assert today_after["lists_created"] - today_before["lists_created"] == 3
    assert today_after["lists_imported"] - today_before["lists_imported"] == 1
    assert len(after["daily"]) == dashboard_service.DAILY_WINDOW_DAYS


def test_health_numbers_sum_the_last_24_hours(db_session: Session) -> None:
    now = datetime.now(UTC)
    before = dashboard_service.health(db_session, now)
    this_minute = now.replace(second=0, microsecond=0)
    route = f"t{uuid.uuid4().hex[:8]}"  # a route class no real traffic uses
    db_session.add_all(
        [
            RequestCount(minute=this_minute, route_class=route, status_class="2xx", count=10),
            RequestCount(minute=this_minute, route_class=route, status_class="4xx", count=3),
            RequestCount(minute=this_minute, route_class=route, status_class="429", count=2),
            RequestCount(minute=this_minute, route_class=route, status_class="5xx", count=1),
            # Outside the window: not counted.
            RequestCount(
                minute=this_minute - timedelta(days=2),
                route_class=route,
                status_class="2xx",
                count=100,
            ),
        ]
    )
    db_session.commit()

    after = dashboard_service.health(db_session, now)

    [mine] = [row for row in after["by_route"] if row["route_class"] == route]
    assert mine == {
        "route_class": route,
        "requests": 16,
        "client_errors": 3,
        "server_errors": 1,
        "rate_limited": 2,
    }
    assert after["totals"]["requests"] - before["totals"]["requests"] == 16
    assert len(after["hourly"]) == 24
    last_hour_delta = after["hourly"][-1]["requests"] - before["hourly"][-1]["requests"]
    assert last_hour_delta == 16


@pytest.fixture
def admin_client(client: TestClient, db_session: Session) -> Iterator[TestClient]:
    admin = _new_user(db_session)
    admin.role = ROLE_ADMIN
    db_session.commit()
    with TestClient(client.app, base_url=API_BASE_URL, headers=BROWSER_HEADERS) as admin_client:
        admin_client.cookies.set(settings.session_cookie_name, issue_session(admin))
        yield admin_client


def test_the_dashboard_route_is_cached_until_refreshed(
    admin_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "cloudwatch_dashboard_url", "https://console.aws/x")
    first = admin_client.get("/admin/dashboard").json()
    assert first["cloudwatch_dashboard_url"] == "https://console.aws/x"
    assert set(first) == {
        "generated_at",
        "product",
        "analytics",
        "health",
        "cost",
        "cloudwatch_dashboard_url",
    }

    _new_user(db_session)
    cached = admin_client.get("/admin/dashboard").json()
    assert cached["product"]["users_total"] == first["product"]["users_total"]

    fresh = admin_client.get("/admin/dashboard", params={"refresh": True}).json()
    assert fresh["product"]["users_total"] == first["product"]["users_total"] + 1


# ─── Cost snapshot ──────────────────────────────────────────────────────────────


class FakeCostExplorer:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def get_cost_and_usage(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)

        def group(service: str, amount: str) -> dict[str, Any]:
            return {
                "Keys": [service],
                "Metrics": {"UnblendedCost": {"Amount": amount, "Unit": "USD"}},
            }

        return {
            "ResultsByTime": [
                {
                    "Groups": [
                        group("Amazon Lightsail", "3.5012"),
                        group("Amazon Route 53", "0.5"),
                        group("AWS Lambda", "0.0000001"),
                    ]
                }
            ]
        }


def test_snapshot_makes_one_call_and_projects_the_month(db_session: Session) -> None:
    client = FakeCostExplorer()
    snapshot = cost_service.take_snapshot(db_session, client, date(2026, 11, 11))

    assert len(client.calls) == 1
    assert client.calls[0]["TimePeriod"] == {"Start": "2026-11-01", "End": "2026-11-11"}
    assert snapshot.month == date(2026, 11, 1)
    assert snapshot.month_to_date == Decimal("4.00")
    # 4.00 over 10 full days, scaled to November's 30.
    assert snapshot.forecast == Decimal("12.00")
    assert snapshot.by_service == {"Amazon Lightsail": "3.50", "Amazon Route 53": "0.50"}


def test_no_paid_call_on_the_first_of_the_month(db_session: Session) -> None:
    client = FakeCostExplorer()
    snapshot = cost_service.take_snapshot(db_session, client, date(2026, 12, 1))
    assert client.calls == []
    assert (snapshot.month_to_date, snapshot.forecast) == (Decimal("0.00"), None)


def test_daily_jobs_prune_old_counts_and_take_a_snapshot(db_session: Session) -> None:
    today = date(2026, 11, 11)
    old = datetime(2026, 10, 1, tzinfo=UTC)
    recent = datetime(2026, 11, 10, tzinfo=UTC)
    route = f"t{uuid.uuid4().hex[:8]}"
    db_session.add_all(
        [
            RequestCount(minute=old, route_class=route, status_class="2xx", count=1),
            RequestCount(minute=recent, route_class=route, status_class="2xx", count=1),
        ]
    )
    db_session.commit()

    report = cli.daily_jobs(db_session, today=today, cost_client=FakeCostExplorer())

    left = db_session.scalars(select(RequestCount.minute).where(RequestCount.route_class == route))
    assert list(left) == [recent]
    assert "4.00 USD" in report[-1]
    latest = cost_service.latest_snapshot(db_session)
    assert isinstance(latest, CostSnapshot) and latest.month_to_date == Decimal("4.00")


def test_daily_jobs_skip_the_paid_call_unless_enabled(db_session: Session) -> None:
    report = cli.daily_jobs(db_session, today=date(2026, 11, 11))
    assert report[-1] == "Cost snapshot skipped (COST_SNAPSHOT_ENABLED is off)."
