"""The admin abuse view: rate-limit numbers, busiest IPs, and the IP block list.

The dev DB is shared with e2e and manual runs (which count real 127.0.0.1 traffic),
so seeded rows use TEST-NET addresses, sit an hour in the future (no clash with
real rows), and carry counts large enough to rank first.
"""

import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.auth.session import issue_session
from app.core.config import settings
from app.core.ip_blocklist import (
    BlockListError,
    LocalFileBlockList,
    MemoryBlockList,
    WafBlockList,
    parse_network,
)
from app.core.request_counts import MemoryRequestCounter
from app.models.admin_audit_log import AdminAuditLog
from app.models.metrics import IpRequestCount, RequestCount
from app.models.user import ROLE_ADMIN, User
from app.services import abuse_service, user_service
from tests.conftest import API_BASE_URL, BROWSER_HEADERS

BIG = 10**8


@pytest.fixture
def admin(db_session: Session) -> User:
    user = user_service.get_or_create_user(
        db_session, Claims(sub=f"abuse-{uuid.uuid4()}", email="abuse@x.com", name="Owner")
    )
    user.role = ROLE_ADMIN
    db_session.commit()
    return user


@pytest.fixture
def admin_client(client: TestClient, admin: User) -> Iterator[TestClient]:
    with TestClient(client.app, base_url=API_BASE_URL, headers=BROWSER_HEADERS) as admin_client:
        admin_client.cookies.set(settings.session_cookie_name, issue_session(admin))
        yield admin_client


@pytest.fixture
def blocklist(client: TestClient) -> MemoryBlockList:
    blocklist = MemoryBlockList()
    cast(FastAPI, client.app).state.ip_blocklist = blocklist
    return blocklist


def _future_hour() -> datetime:
    return (datetime.now(UTC) + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)


def _seed_ip(db: Session, ip: str, requests: int, limited: int, hour: datetime) -> None:
    db.add(IpRequestCount(hour=hour, ip=ip, requests=requests, rate_limited=limited))
    db.commit()


def _audit(db: Session, target: str) -> list[str]:
    query = select(AdminAuditLog.action).where(
        AdminAuditLog.target_type == "ip", AdminAuditLog.target_id == target
    )
    return list(db.scalars(query.order_by(AdminAuditLog.created_at)))


# ─── Counting ───────────────────────────────────────────────────────────────────


def test_every_request_is_counted_against_its_ip(client: TestClient) -> None:
    client.get("/config/client")
    counter = cast(MemoryRequestCounter, cast(FastAPI, client.app).state.request_counter)
    assert counter.by_ip[("testclient", "2xx")] >= 1


def test_old_ip_counts_are_pruned_after_a_week(db_session: Session) -> None:
    today = date(2001, 6, 15)  # far from any real rows
    old = datetime(2001, 6, 7, 23, tzinfo=UTC)
    kept = datetime(2001, 6, 8, 0, tzinfo=UTC)
    _seed_ip(db_session, "192.0.2.1", 1, 0, old)
    _seed_ip(db_session, "192.0.2.1", 1, 0, kept)

    assert abuse_service.prune(db_session, today) >= 1

    hours = db_session.scalars(select(IpRequestCount.hour).where(IpRequestCount.ip == "192.0.2.1"))
    assert list(hours) == [kept]


# ─── Overview ───────────────────────────────────────────────────────────────────


def test_overview_ranks_ips_by_429s_and_marks_blocked_ones(
    admin_client: TestClient, db_session: Session, blocklist: MemoryBlockList
) -> None:
    hour = _future_hour()
    _seed_ip(db_session, "198.51.100.7", BIG, BIG - 1, hour)
    _seed_ip(db_session, "198.51.100.8", BIG + 5, BIG - 2, hour)
    db_session.add(RequestCount(minute=hour, route_class="events", status_class="429", count=BIG))
    db_session.commit()
    blocklist.networks = ["198.51.100.0/24"]

    body = admin_client.get("/admin/abuse").json()

    assert body["window_hours"] == 24
    assert body["your_ip"] == "testclient"
    first, second = body["top_ips"][:2]
    assert (first["ip"], first["rate_limited"]) == ("198.51.100.7", BIG - 1)
    assert second["ip"] == "198.51.100.8"
    assert first["blocked_by"] == "198.51.100.0/24"
    assert body["by_route"][0]["route_class"] == "events"
    assert body["rate_limited_total"] >= BIG


def test_overview_only_counts_the_window(admin_client: TestClient, db_session: Session) -> None:
    two_days_ago = _future_hour() - timedelta(hours=49)
    _seed_ip(db_session, "198.51.100.9", BIG, BIG, two_days_ago)

    def top(hours: int) -> list[str]:
        response = admin_client.get("/admin/abuse", params={"hours": hours})
        return [row["ip"] for row in response.json()["top_ips"]]

    assert "198.51.100.9" not in top(24)
    assert top(72)[0] == "198.51.100.9"
    # The window can't reach past what's kept.
    assert admin_client.get("/admin/abuse", params={"hours": 169}).status_code == 422


# ─── Block list ─────────────────────────────────────────────────────────────────


def test_block_then_unblock_an_address(
    admin_client: TestClient, db_session: Session, blocklist: MemoryBlockList
) -> None:
    response = admin_client.post(
        "/admin/blocked-ips", json={"network": " 203.0.113.7 ", "reason": " scraping "}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "memory"
    assert body["enforced"] is False
    [entry] = body["entries"]
    assert entry["network"] == "203.0.113.7/32"
    assert (entry["reason"], entry["blocked_by"]) == ("scraping", "Owner")
    assert blocklist.networks == ["203.0.113.7/32"]

    response = admin_client.post("/admin/blocked-ips/remove", json={"network": "203.0.113.7/32"})
    assert response.status_code == 200
    assert response.json()["entries"] == []
    assert _audit(db_session, "203.0.113.7/32") == ["block_ip", "unblock_ip"]


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"network": "not-an-ip", "reason": "x"}, 422),
        ({"network": "10.0.0.0/8", "reason": "x"}, 422),  # too wide
        ({"network": "2001:db8::/32", "reason": "x"}, 422),  # too wide
        ({"network": "203.0.113.9", "reason": "   "}, 422),  # a reason is required
        ({"network": "203.0.113.9"}, 422),
    ],
)
def test_bad_blocks_are_refused(
    admin_client: TestClient, blocklist: MemoryBlockList, body: dict[str, Any], status: int
) -> None:
    assert admin_client.post("/admin/blocked-ips", json=body).status_code == status
    assert blocklist.networks == []


def test_blocking_twice_is_a_conflict(admin_client: TestClient, blocklist: MemoryBlockList) -> None:
    blocklist.networks = ["203.0.113.0/24"]
    response = admin_client.post(
        "/admin/blocked-ips", json={"network": "203.0.113.0/24", "reason": "again"}
    )
    assert response.status_code == 409


def test_unblocking_something_not_blocked_is_404(
    admin_client: TestClient, blocklist: MemoryBlockList
) -> None:
    response = admin_client.post("/admin/blocked-ips/remove", json={"network": "203.0.113.1"})
    assert response.status_code == 404


def test_you_cant_block_yourself(db_session: Session, admin: User) -> None:
    blocklist = MemoryBlockList()
    with pytest.raises(abuse_service.BlockRefusedError, match="would block you"):
        abuse_service.block(db_session, blocklist, admin, "203.0.113.0/24", "oops", "203.0.113.50")
    assert blocklist.networks == []
    assert _audit(db_session, "203.0.113.0/24") == []


class _BrokenBlockList(MemoryBlockList):
    def add(self, network: Any) -> None:
        raise BlockListError("AWS said no")


def test_a_failed_block_leaves_no_audit_row(
    admin_client: TestClient, client: TestClient, db_session: Session
) -> None:
    cast(FastAPI, client.app).state.ip_blocklist = _BrokenBlockList()
    response = admin_client.post(
        "/admin/blocked-ips", json={"network": "203.0.113.20", "reason": "spam"}
    )
    assert response.status_code == 502
    assert "AWS said no" in response.json()["detail"]
    assert _audit(db_session, "203.0.113.20/32") == []


def test_an_unconfigured_waf_says_so(admin_client: TestClient, client: TestClient) -> None:
    cast(FastAPI, client.app).state.ip_blocklist = WafBlockList("", "")
    response = admin_client.get("/admin/blocked-ips")
    assert response.status_code == 503
    assert "isn't configured" in response.json()["detail"]
    # The numbers still load without the list.
    assert admin_client.get("/admin/abuse").status_code == 200


# ─── Stores ─────────────────────────────────────────────────────────────────────


class _LockError(Exception):
    response = {"Error": {"Code": "WAFOptimisticLockException"}}


class _FakeWaf:
    """Two IP sets, and one lost race on the first update."""

    def __init__(self) -> None:
        self.sets: dict[str, list[str]] = {"v4": ["192.0.2.1/32"], "v6": []}
        self.token = 0
        self.race_once = True

    def get_ip_set(self, *, Name: str, Scope: str, Id: str) -> dict[str, Any]:  # noqa: N803
        assert Scope == "CLOUDFRONT"
        return {"IPSet": {"Addresses": list(self.sets[Name])}, "LockToken": str(self.token)}

    def update_ip_set(self, *, Name: str, Addresses: list[str], LockToken: str, **_: Any) -> None:  # noqa: N803
        if self.race_once:
            self.race_once = False
            self.token += 1
            raise _LockError()
        assert LockToken == str(self.token)
        self.sets[Name] = Addresses
        self.token += 1


def test_waf_block_list_splits_families_and_retries_a_lost_race() -> None:
    fake = _FakeWaf()
    arn = "arn:aws:wafv2:us-east-1:123456789012:global/ipset/{}/id-{}"
    waf = WafBlockList(arn.format("v4", 1), arn.format("v6", 2), client_factory=lambda: fake)

    waf.add(parse_network("203.0.113.7"))
    waf.add(parse_network("2001:db8::1"))
    assert fake.sets == {"v4": ["192.0.2.1/32", "203.0.113.7/32"], "v6": ["2001:db8::1/128"]}
    assert waf.entries() == ["192.0.2.1/32", "203.0.113.7/32", "2001:db8::1/128"]

    waf.remove(parse_network("192.0.2.1"))
    assert fake.sets["v4"] == ["203.0.113.7/32"]


def test_local_block_list_round_trips_through_its_file(tmp_path: Path) -> None:
    path = tmp_path / "blocklist.json"
    local = LocalFileBlockList(path)
    assert local.entries() == []
    local.add(parse_network("203.0.113.7"))
    local.add(parse_network("203.0.113.7"))
    assert LocalFileBlockList(path).entries() == ["203.0.113.7/32"]
    assert b"\r\n" not in path.read_bytes()
    local.remove(parse_network("203.0.113.7"))
    assert local.entries() == []
