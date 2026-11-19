"""Per-minute request counters in Postgres, for the admin Health dashboard.

docs/ARCHITECTURE.md §Dashboards: logs stay on the box, so the app
counts what it answered (requests, 4xx, 5xx, 429 per route class per minute) into
``request_counts`` itself, and per client IP per hour into ``ip_request_counts`` for
the abuse view. Two upserts in one transaction per request is nothing at our scale.

* ``RequestCountMiddleware`` is the outermost layer, so it also counts what the
  origin, body-size and CSRF guards turn away. ``/health`` (the uptime probe) is
  not counted.
* The write runs in a worker thread, before the response call returns (no
  background work after it), and never fails the request: a counting error is
  logged and dropped.
* ``app.state.request_counter`` is the sink. ``None`` turns counting off: Lambda
  routes have no database, and tests use an in-memory counter so pytest never
  writes counts into the developer's database.
"""

import logging
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.requests import HTTPConnection
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.client_ip import client_ip
from app.models.metrics import IpRequestCount, RequestCount

logger = logging.getLogger(__name__)

ROUTE_CLASSES = ("lists", "auth", "config", "me", "admin", "events")


def route_class(path: str, prefix: str) -> str | None:
    """``/api/v1/lists/…`` → ``lists``; ``None`` for paths that aren't counted."""
    if not path.startswith(f"{prefix}/"):
        return "other"
    first = path[len(prefix) + 1 :].split("/", 1)[0]
    if first == "health":
        return None
    return first if first in ROUTE_CLASSES else "other"


def status_class(status: int) -> str:
    if status == 429:
        return "429"
    return f"{status // 100}xx"


class RequestCounter(Protocol):
    def record(self, route_class: str, status_class: str, minute: datetime, ip: str) -> None: ...


class PostgresRequestCounter:
    """Upserts ``request_counts`` rows, one short transaction per request."""

    def __init__(self, session_factory: Callable[[], Session]):
        self._session_factory = session_factory

    def record(self, route_class: str, status_class: str, minute: datetime, ip: str) -> None:
        statement = insert(RequestCount).values(
            minute=minute, route_class=route_class, status_class=status_class, count=1
        )
        statement = statement.on_conflict_do_update(
            index_elements=["minute", "route_class", "status_class"],
            set_={"count": RequestCount.count + 1},
        )
        limited = 1 if status_class == "429" else 0
        by_ip = insert(IpRequestCount).values(
            hour=minute.replace(minute=0), ip=ip[:45], requests=1, rate_limited=limited
        )
        by_ip = by_ip.on_conflict_do_update(
            index_elements=["hour", "ip"],
            set_={
                "requests": IpRequestCount.requests + 1,
                "rate_limited": IpRequestCount.rate_limited + limited,
            },
        )
        with self._session_factory() as db:
            db.execute(statement)
            db.execute(by_ip)
            db.commit()


class MemoryRequestCounter:
    """For tests: counts in a dict."""

    def __init__(self) -> None:
        self.counts: Counter[tuple[str, str]] = Counter()
        self.by_ip: Counter[tuple[str, str]] = Counter()

    def record(self, route_class: str, status_class: str, minute: datetime, ip: str) -> None:
        self.counts[(route_class, status_class)] += 1
        self.by_ip[(ip, status_class)] += 1


def _this_minute() -> datetime:
    return datetime.now(UTC).replace(second=0, microsecond=0)


class RequestCountMiddleware:
    def __init__(self, app: ASGIApp, prefix: str, clock: Callable[[], datetime] = _this_minute):
        self.app = app
        self.prefix = prefix
        self.clock = clock

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        counter: RequestCounter | None = getattr(scope["app"].state, "request_counter", None)
        kind = route_class(scope.get("path", ""), self.prefix) if scope["type"] == "http" else None
        if counter is None or kind is None:
            await self.app(scope, receive, send)
            return

        status = 500  # If the app raises before answering, that's what the client gets.

        async def capture(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, capture)
        finally:
            try:
                ip = client_ip(HTTPConnection(scope))
                await run_in_threadpool(
                    counter.record, kind, status_class(status), self.clock(), ip
                )
            except Exception:
                logger.exception("Could not record a request count")
