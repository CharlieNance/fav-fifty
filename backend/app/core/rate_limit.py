"""Token-bucket rate limiting — the store behind the app's per-route limits.

docs/ABUSE_PROTECTION_PLAN.md §Rate limits. Each limited caller has a bucket per
rule that holds up to ``capacity`` tokens and refills completely over ``period``
seconds. A request takes one token from every bucket it's checked against; if any
of them is empty, it's refused and nothing is taken.

**In-process on purpose.** The limited routes run on the one Lightsail box, so a
dict in memory is enough. Two consequences, both accepted at our scale:

* run **one** Uvicorn worker (each worker counts separately), and
* a restart forgets the counts (it doesn't make anyone *more* limited).

The store is behind the ``RateLimitStore`` protocol, so a Postgres-backed store can
replace it without touching the routes. The catalog and showcase routes (on Lambda)
are not limited here at all: AWS enforces those (Q16).

The FastAPI dependencies that apply the rules live in ``app.api.rate_limits``.
"""

import math
import threading
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

# Past this many tracked keys, buckets that have refilled completely are dropped,
# then the least recently used ones. Bounds memory under a flood of distinct IPs.
DEFAULT_MAX_KEYS = 10_000


@dataclass(frozen=True)
class Rate:
    """``capacity`` requests, refilled evenly over ``period_seconds``."""

    capacity: int
    period_seconds: float

    @property
    def per_second(self) -> float:
        return self.capacity / self.period_seconds


@dataclass(frozen=True)
class Check:
    """One bucket to take a token from: ``key`` identifies the caller *and* the rule."""

    key: str
    rate: Rate


@dataclass(frozen=True)
class Denied:
    """Why a request was refused: the first empty bucket and when it has a token."""

    check: Check
    retry_after_seconds: int


class RateLimitStore(Protocol):
    def take(self, checks: Sequence[Check]) -> Denied | None:
        """Take one token from every bucket, or none if any is empty (→ ``Denied``)."""
        ...


@dataclass
class _Bucket:
    tokens: float
    updated_at: float
    rate: Rate

    def is_full_at(self, now: float) -> bool:
        elapsed = max(0.0, now - self.updated_at)
        return self.tokens + elapsed * self.rate.per_second >= self.rate.capacity


class InMemoryRateLimitStore:
    """Thread-safe (sync routes run on a thread pool) in-memory buckets."""

    def __init__(
        self,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = DEFAULT_MAX_KEYS,
    ):
        self._clock = clock
        self._max_keys = max_keys
        self._lock = threading.Lock()
        self._buckets: dict[str, _Bucket] = {}

    def take(self, checks: Sequence[Check]) -> Denied | None:
        with self._lock:
            now = self._clock()
            buckets = [self._refilled(check, now) for check in checks]
            for check, bucket in zip(checks, buckets, strict=True):
                if bucket.tokens < 1:
                    wait = (1 - bucket.tokens) / check.rate.per_second
                    return Denied(check, max(1, math.ceil(wait)))
            for bucket in buckets:
                bucket.tokens -= 1
            if len(self._buckets) > self._max_keys:
                self._evict(now)
            return None

    def _refilled(self, check: Check, now: float) -> _Bucket:
        """The bucket for ``check``, topped up for the time since it was last used.

        A capacity changed at runtime applies at once: tokens are clamped to it.
        """
        capacity = check.rate.capacity
        bucket = self._buckets.get(check.key)
        if bucket is None:
            bucket = _Bucket(tokens=capacity, updated_at=now, rate=check.rate)
            self._buckets[check.key] = bucket
        else:
            elapsed = max(0.0, now - bucket.updated_at)
            bucket.tokens = min(capacity, bucket.tokens + elapsed * check.rate.per_second)
            bucket.updated_at = now
            bucket.rate = check.rate
        return bucket

    def _evict(self, now: float) -> None:
        # A bucket idle long enough to be full again is the same as no bucket.
        self._buckets = {
            key: bucket for key, bucket in self._buckets.items() if not bucket.is_full_at(now)
        }
        overflow = len(self._buckets) - self._max_keys
        if overflow > 0:
            oldest = sorted(self._buckets, key=lambda key: self._buckets[key].updated_at)
            for key in oldest[:overflow]:
                del self._buckets[key]
