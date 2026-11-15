"""Rate-limit dependencies, one per route class (docs/ABUSE_PROTECTION_PLAN.md).

| Dependency      | Key       | Rule (runtime settings)                                 |
| --------------- | --------- | ------------------------------------------------------- |
| ``limit_auth``   | client IP | ``rate_limits.auth_per_minute``                         |
| ``limit_config`` | client IP | ``rate_limits.config_per_minute``                       |
| ``limit_writes`` | user id   | ``rate_limits.writes_per_minute`` **and**               |
|                 |           | ``limits.max_writes_per_user_per_day``; unsafe methods  |
| ``limit_imports``| user id   | ``rate_limits.imports_per_hour``                        |

A refused request gets ``429`` with ``Retry-After`` and a human ``detail`` (the
frontend shows it). Every 429 is logged with its rule, so the dashboards and the cost
tripwires can count them. The buckets live in ``app.state.rate_limiter`` (one per app,
so each test gets fresh ones). ``rate_limits.enabled = false`` turns every rule off.
"""

import logging

from fastapi import Depends, HTTPException, Request, status

from app.api.deps import get_current_user
from app.core.client_ip import client_ip
from app.core.rate_limit import Check, Denied, Rate, RateLimitStore
from app.core.runtime_settings import RuntimeSettings, get_runtime_settings
from app.models.user import User

logger = logging.getLogger(__name__)

MINUTE = 60.0
HOUR = 60 * MINUTE
DAY = 24 * HOUR

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

SLOW_DOWN = "Slow down a sec. Try again in a moment."
DAILY_CAP = "You've made a lot of changes today. Try again a little later."
TOO_MANY_IMPORTS = "That's a lot of uploads. Try again later."


def _store(request: Request) -> RateLimitStore:
    return request.app.state.rate_limiter


def _enforce(request: Request, checks: list[Check], details: dict[str, str]) -> None:
    denied: Denied | None = _store(request).take(checks)
    if denied is None:
        return
    rule = denied.check.key.split(":", 1)[0]
    logger.warning(
        "rate_limited rule=%s key=%s path=%s retry_after=%s",
        rule,
        denied.check.key,
        request.url.path,
        denied.retry_after_seconds,
    )
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=details.get(rule, SLOW_DOWN),
        headers={"Retry-After": str(denied.retry_after_seconds)},
    )


def limit_auth(request: Request, runtime: RuntimeSettings = Depends(get_runtime_settings)) -> None:
    rules = runtime.rate_limits
    if rules.enabled:
        rate = Rate(rules.auth_per_minute, MINUTE)
        _enforce(request, [Check(f"auth:{client_ip(request)}", rate)], {})


def limit_config(
    request: Request, runtime: RuntimeSettings = Depends(get_runtime_settings)
) -> None:
    rules = runtime.rate_limits
    if rules.enabled:
        rate = Rate(rules.config_per_minute, MINUTE)
        _enforce(request, [Check(f"config:{client_ip(request)}", rate)], {})


def limit_writes(
    request: Request,
    current_user: User = Depends(get_current_user),
    runtime: RuntimeSettings = Depends(get_runtime_settings),
) -> None:
    """For a whole router: reads pass, writes count against the user's buckets."""
    rules = runtime.rate_limits
    if not rules.enabled or request.method in _SAFE_METHODS:
        return
    user = current_user.id
    checks = [
        Check(f"writes:{user}", Rate(rules.writes_per_minute, MINUTE)),
        Check(f"writes_day:{user}", Rate(runtime.limits.max_writes_per_user_per_day, DAY)),
    ]
    _enforce(request, checks, {"writes_day": DAILY_CAP})


def limit_imports(
    request: Request,
    current_user: User = Depends(get_current_user),
    runtime: RuntimeSettings = Depends(get_runtime_settings),
) -> None:
    rules = runtime.rate_limits
    if rules.enabled:
        rate = Rate(rules.imports_per_hour, HOUR)
        check = Check(f"imports:{current_user.id}", rate)
        _enforce(request, [check], {"imports": TOO_MANY_IMPORTS})
