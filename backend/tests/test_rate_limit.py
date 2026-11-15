"""Rate limiting: the token-bucket store, the client-IP rules, and the route classes
(docs/ABUSE_PROTECTION_PLAN.md §Rate limits)."""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from starlette.requests import HTTPConnection

from app.core.client_ip import client_ip
from app.core.rate_limit import Check, InMemoryRateLimitStore, Rate
from app.core.runtime_settings import Limits, RateLimits, RuntimeSettings


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def store(clock: FakeClock) -> InMemoryRateLimitStore:
    return InMemoryRateLimitStore(clock=clock)


PER_MINUTE_2 = Rate(capacity=2, period_seconds=60)

# ─── The store ──────────────────────────────────────────────────────────────────


def test_allows_up_to_capacity_then_denies(store: InMemoryRateLimitStore) -> None:
    check = Check("writes:a", PER_MINUTE_2)
    assert store.take([check]) is None
    assert store.take([check]) is None

    denied = store.take([check])

    assert denied is not None
    assert denied.check == check
    # One token refills every 30 s.
    assert denied.retry_after_seconds == 30


def test_refills_over_time(store: InMemoryRateLimitStore, clock: FakeClock) -> None:
    check = Check("writes:a", PER_MINUTE_2)
    store.take([check])
    store.take([check])
    assert store.take([check]) is not None

    clock.now += 30

    assert store.take([check]) is None
    assert store.take([check]) is not None


def test_keys_are_independent(store: InMemoryRateLimitStore) -> None:
    store.take([Check("writes:a", PER_MINUTE_2)])
    store.take([Check("writes:a", PER_MINUTE_2)])

    assert store.take([Check("writes:a", PER_MINUTE_2)]) is not None
    assert store.take([Check("writes:b", PER_MINUTE_2)]) is None


def test_a_refusal_takes_nothing_from_the_other_buckets(store: InMemoryRateLimitStore) -> None:
    roomy = Check("minute:a", Rate(10, 60))
    empty = Check("day:a", Rate(1, 86_400))
    assert store.take([roomy, empty]) is None

    # The day bucket refuses, so the minute bucket must not be charged for it.
    for _ in range(5):
        denied = store.take([roomy, empty])
        assert denied is not None and denied.check == empty
    for _ in range(9):
        assert store.take([roomy]) is None


def test_a_lowered_capacity_applies_at_once(store: InMemoryRateLimitStore) -> None:
    store.take([Check("k", Rate(100, 60))])

    assert store.take([Check("k", Rate(1, 60))]) is None
    assert store.take([Check("k", Rate(1, 60))]) is not None


def test_evicts_idle_buckets_past_max_keys(clock: FakeClock) -> None:
    store = InMemoryRateLimitStore(clock=clock, max_keys=3)
    for name in "abcd":
        store.take([Check(name, PER_MINUTE_2)])
    clock.now += 120  # every bucket has refilled: same as never seen
    store.take([Check("e", PER_MINUTE_2)])

    assert len(store._buckets) <= 3


def test_evicts_least_recently_used_when_none_are_idle(clock: FakeClock) -> None:
    store = InMemoryRateLimitStore(clock=clock, max_keys=2)
    for name in "abc":
        clock.now += 1
        store.take([Check(name, PER_MINUTE_2)])

    assert set(store._buckets) == {"b", "c"}


# ─── Client IP ──────────────────────────────────────────────────────────────────


def _conn(headers: dict[str, str], peer: str = "10.0.0.9") -> HTTPConnection:
    return HTTPConnection(
        {
            "type": "http",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": (peer, 1234),
        }
    )


def test_client_ip_is_the_socket_peer_without_a_secret() -> None:
    conn = _conn({"CloudFront-Viewer-Address": "203.0.113.5:443"})
    assert client_ip(conn, secret="") == "10.0.0.9"


def test_client_ip_ignores_the_viewer_header_without_the_origin_secret() -> None:
    conn = _conn({"CloudFront-Viewer-Address": "203.0.113.5:443", "X-Origin-Verify": "wrong"})
    assert client_ip(conn, secret="s3cret") == "10.0.0.9"


def test_client_ip_trusts_the_viewer_header_with_the_origin_secret() -> None:
    conn = _conn({"CloudFront-Viewer-Address": "203.0.113.5:443", "X-Origin-Verify": "s3cret"})
    assert client_ip(conn, secret="s3cret") == "203.0.113.5"


def test_client_ip_handles_ipv6_viewer_addresses() -> None:
    conn = _conn({"CloudFront-Viewer-Address": "2001:db8::1:443", "X-Origin-Verify": "s3cret"})
    assert client_ip(conn, secret="s3cret") == "2001:db8::1"


def test_client_ip_never_uses_x_forwarded_for() -> None:
    conn = _conn({"X-Forwarded-For": "198.51.100.7", "X-Origin-Verify": "s3cret"})
    assert client_ip(conn, secret="s3cret") == "10.0.0.9"


# ─── Route classes ──────────────────────────────────────────────────────────────

SetRuntime = Callable[[RuntimeSettings], None]


def _tight(**rate_limits: int) -> RuntimeSettings:
    return RuntimeSettings(rate_limits=RateLimits(**rate_limits))


def test_writes_are_limited_per_user_with_retry_after(
    auth_client: TestClient, second_user_client: TestClient, set_runtime_settings: SetRuntime
) -> None:
    set_runtime_settings(_tight(writes_per_minute=2))
    assert auth_client.post("/lists", json={"title": "One"}).status_code == 201
    assert auth_client.post("/lists", json={"title": "Two"}).status_code == 201

    response = auth_client.post("/lists", json={"title": "Three"})

    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) >= 1
    assert "Slow down" in response.json()["detail"]
    # Someone else's budget is untouched.
    assert second_user_client.post("/lists", json={"title": "Theirs"}).status_code == 201


def test_reads_do_not_count_as_writes(
    auth_client: TestClient, set_runtime_settings: SetRuntime
) -> None:
    set_runtime_settings(_tight(writes_per_minute=1))
    for _ in range(5):
        assert auth_client.get("/lists").status_code == 200

    assert auth_client.post("/lists", json={"title": "Still allowed"}).status_code == 201


def test_item_and_tag_writes_count_too(
    auth_client: TestClient, set_runtime_settings: SetRuntime
) -> None:
    list_id = auth_client.post("/lists", json={"title": "Counted"}).json()["id"]
    set_runtime_settings(_tight(writes_per_minute=2))

    assert auth_client.post(f"/lists/{list_id}/items", json={"text": "a"}).status_code == 201
    assert auth_client.put(f"/lists/{list_id}/tags", json={"tags": ["x"]}).status_code == 200
    assert auth_client.post(f"/lists/{list_id}/items", json={"text": "b"}).status_code == 429


def test_the_daily_write_cap_has_its_own_message(
    auth_client: TestClient, set_runtime_settings: SetRuntime
) -> None:
    set_runtime_settings(RuntimeSettings(limits=Limits(max_writes_per_user_per_day=1)))
    assert auth_client.post("/lists", json={"title": "Only one today"}).status_code == 201

    response = auth_client.post("/lists", json={"title": "One too many"})

    assert response.status_code == 429
    assert "today" in response.json()["detail"]


def test_the_switch_turns_every_limit_off(
    auth_client: TestClient, set_runtime_settings: SetRuntime
) -> None:
    set_runtime_settings(
        RuntimeSettings(
            limits=Limits(max_writes_per_user_per_day=1),
            rate_limits=RateLimits(enabled=False, writes_per_minute=1),
        )
    )
    for n in range(3):
        assert auth_client.post("/lists", json={"title": f"L{n}"}).status_code == 201


def test_unauthenticated_writes_are_401_not_429(
    client: TestClient, set_runtime_settings: SetRuntime
) -> None:
    set_runtime_settings(_tight(writes_per_minute=1))
    for _ in range(3):
        assert client.post("/lists", json={"title": "x"}).status_code == 401


def test_auth_routes_are_limited_per_ip(
    client: TestClient, set_runtime_settings: SetRuntime
) -> None:
    set_runtime_settings(_tight(auth_per_minute=2))
    # Cognito isn't configured in tests, so the route itself is a 404 — the limiter
    # runs first either way.
    assert client.get("/auth/login", follow_redirects=False).status_code == 404
    assert client.get("/auth/callback", follow_redirects=False).status_code == 404

    assert client.get("/auth/login", follow_redirects=False).status_code == 429


def test_config_is_limited_per_ip(client: TestClient, set_runtime_settings: SetRuntime) -> None:
    set_runtime_settings(_tight(config_per_minute=1))
    assert client.get("/config/client").status_code == 200
    assert client.get("/config/client").status_code == 429


def test_imports_are_limited_per_user(
    fresh_user_client: TestClient, set_runtime_settings: SetRuntime
) -> None:
    set_runtime_settings(_tight(imports_per_hour=1))
    body = {"device_id": "dev-1", "lists": [{"local_id": "l1", "title": "Imported"}]}
    assert fresh_user_client.post("/lists/import", json=body).status_code == 200

    response = fresh_user_client.post("/lists/import", json=body)

    assert response.status_code == 429
    assert "uploads" in response.json()["detail"]


def test_health_is_never_limited(client: TestClient, set_runtime_settings: SetRuntime) -> None:
    set_runtime_settings(_tight(auth_per_minute=1, config_per_minute=1))
    for _ in range(5):
        assert client.get("/health").status_code == 200
