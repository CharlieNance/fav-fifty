"""Runtime settings — switches and limits the owner can change without a deploy.

Distinct from ``app.core.config`` (deploy-time config: DB URL, secrets, Cognito):
these values are meant to change while the app is running, from the admin portal
or the cost breaker (docs/ADMIN_AND_ANALYTICS_PLAN.md §Runtime settings).

* **Sources.** In AWS they live in SSM Parameter Store, one parameter per setting,
  e.g. ``/favfifty/settings/limits/max_tags_per_list``. Locally (and in CI) the same
  keys come from env vars / ``backend/.env``, e.g.
  ``RUNTIME_LIMITS__MAX_TAGS_PER_LIST=25`` — no AWS needed. ``settings.
  runtime_settings_source`` picks one; they are never mixed.
* **Typed and validated.** Every setting has a code default and bounds in the models
  below. A missing value uses its default; an invalid one is logged and *also*
  falls back to its default, without disturbing the other settings.
* **Fail safe.** If the source can't be read at all (SSM down, no IAM access),
  every setting is at its default — which must always be a safe value: optional
  features off, core features on, limits at their decided quotas.
* **~30 s cache.** Each process re-reads its source at most every ``ttl_seconds``,
  so a change applies within about that long. The cache is an optimization only:
  nothing depends on it for correctness (the box/Lambda portability rule).

Routes read the current values via the ``get_runtime_settings`` dependency, so tests
can override it with ``app.dependency_overrides``. Only the user-facing subset is
public, through ``GET /api/v1/config/client`` — never serialize ``RuntimeSettings``
straight to a client.
"""

import logging
import os
import threading
import time
from collections.abc import Callable, Mapping
from functools import lru_cache
from typing import Any, Protocol

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.config import settings

logger = logging.getLogger(__name__)

DEFAULT_TTL_SECONDS = 30.0
ENV_PREFIX = "RUNTIME_"


# ─── The settings themselves ────────────────────────────────────────────────────
# Add a new tunable here (with a safe default and bounds) rather than hard-coding
# it, and expose it via ClientConfig only if clients need it.


class Limits(BaseModel):
    """Quotas (docs/ABUSE_PROTECTION_PLAN.md, Q25). The 50-item cap is NOT here: it's
    the product's identity, fixed in app/core/limits.py."""

    model_config = ConfigDict(frozen=True, extra="ignore")

    max_tags_per_list: int = Field(default=25, ge=1, le=200)


class RuntimeSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")

    limits: Limits = Limits()


# ─── Sources ────────────────────────────────────────────────────────────────────
# A source returns flat dotted keys → raw string values, e.g.
# {"limits.max_tags_per_list": "25"}. Validation happens once, below, for all sources.


class RuntimeSettingsSource(Protocol):
    def fetch(self) -> dict[str, str]: ...


class EnvSource:
    """``RUNTIME_LIMITS__MAX_TAGS_PER_LIST=25`` → ``{"limits.max_tags_per_list": "25"}``.

    Reads ``backend/.env`` and then the real environment, which wins — the same
    precedence as ``app.core.config``.
    """

    def __init__(self, env_file: str | None = ".env", environ: Mapping[str, str] | None = None):
        self._env_file = env_file
        self._environ = os.environ if environ is None else environ

    def fetch(self) -> dict[str, str]:
        file_values = dotenv_values(self._env_file) if self._env_file else {}
        merged = {**file_values, **self._environ}
        return {
            name[len(ENV_PREFIX) :].lower().replace("__", "."): value
            for name, value in merged.items()
            if name.upper().startswith(ENV_PREFIX) and value is not None
        }


class SsmSource:
    """``/favfifty/settings/limits/max_tags_per_list`` → ``{"limits.max_tags_per_list": …}``.

    Standard parameters, read with one paginated ``GetParametersByPath`` (free at our
    volume). The boto3 client is created on first use, so app startup never needs
    AWS; region and credentials come from the standard AWS env/instance config.
    """

    def __init__(self, prefix: str, client: Any = None):
        self._prefix = prefix.rstrip("/")
        self._client = client

    def _get_client(self) -> Any:
        if self._client is None:
            import boto3  # Deferred: only AWS deployments pay its import cost.
            from botocore.config import Config

            # Short timeouts and one retry: a slow SSM must not stall requests —
            # failing fast lands on the safe defaults instead.
            self._client = boto3.client(
                "ssm",
                config=Config(connect_timeout=2, read_timeout=2, retries={"max_attempts": 1}),
            )
        return self._client

    def fetch(self) -> dict[str, str]:
        paginator = self._get_client().get_paginator("get_parameters_by_path")
        values: dict[str, str] = {}
        for page in paginator.paginate(Path=f"{self._prefix}/", Recursive=True):
            for parameter in page["Parameters"]:
                key = parameter["Name"][len(self._prefix) + 1 :].replace("/", ".")
                values[key] = parameter["Value"]
        return values


# ─── Validation ─────────────────────────────────────────────────────────────────


def _nest(flat: Mapping[str, str]) -> dict[str, Any]:
    """``{"limits.max_tags_per_list": "25"}`` → ``{"limits": {"max_tags_per_list": "25"}}``."""
    nested: dict[str, Any] = {}
    for key, value in flat.items():
        *parents, leaf = key.split(".")
        node = nested
        for part in parents:
            child = node.setdefault(part, {})
            if not isinstance(child, dict):
                break  # A value and a group share a name (bad keys) — skip this one.
            node = child
        else:
            node[leaf] = value
    return nested


def parse_runtime_settings(raw: Mapping[str, str]) -> RuntimeSettings:
    """Validate raw source values, dropping each invalid one back to its default.

    Pydantic reports every failing field at once; we remove exactly those keys and
    validate again, so one typo can't reset (or block) the rest.
    """
    remaining = dict(raw)
    while True:
        try:
            return RuntimeSettings.model_validate(_nest(remaining))
        except ValidationError as exc:
            failed = {".".join(str(part) for part in error["loc"]) for error in exc.errors()}
            # A failing field drops its own key and anything nested under it.
            bad = {
                key
                for key in remaining
                if any(key == path or key.startswith(f"{path}.") for path in failed)
            }
            if not bad:
                # Can't attribute the error to a key we were given — use all defaults.
                logger.warning("Invalid runtime settings %s; using all defaults", sorted(failed))
                return RuntimeSettings()
            for key in sorted(bad):
                logger.warning(
                    "Ignoring invalid runtime setting %s=%r; using the default",
                    key,
                    remaining[key],
                )
            remaining = {key: value for key, value in remaining.items() if key not in bad}


# ─── Cached access ──────────────────────────────────────────────────────────────


class RuntimeSettingsProvider:
    """Serves the current ``RuntimeSettings``, re-reading the source every ``ttl``."""

    def __init__(
        self,
        source: RuntimeSettingsSource,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._source = source
        self._ttl = ttl_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._value: RuntimeSettings | None = None
        self._expires_at = 0.0

    def get(self) -> RuntimeSettings:
        # The lock means one refresh per expiry, not one per in-flight request
        # (sync routes run on a thread pool), so a slow source isn't hit N times.
        with self._lock:
            if self._value is None or self._clock() >= self._expires_at:
                self._value = self._load()
                # A failed read is cached too, so an SSM outage costs one slow call
                # per TTL rather than one per request.
                self._expires_at = self._clock() + self._ttl
            return self._value

    def _load(self) -> RuntimeSettings:
        try:
            raw = self._source.fetch()
        except Exception:
            logger.exception("Could not read runtime settings; using safe defaults")
            return RuntimeSettings()
        return parse_runtime_settings(raw)


def _build_source() -> RuntimeSettingsSource:
    if settings.runtime_settings_source == "ssm":
        return SsmSource(settings.runtime_settings_ssm_prefix)
    return EnvSource()


@lru_cache(maxsize=1)
def _provider() -> RuntimeSettingsProvider:
    # Built on first use (not at import), so startup never touches the source.
    return RuntimeSettingsProvider(_build_source())


def get_runtime_settings() -> RuntimeSettings:
    """FastAPI dependency: the current runtime settings (cached ~30 s)."""
    return _provider().get()
