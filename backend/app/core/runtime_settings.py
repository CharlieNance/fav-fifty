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

* **Writable.** The admin Settings page writes one key at a time
  (``RuntimeSettingsProvider.write``/``delete``): SSM ``PutParameter``/
  ``DeleteParameter`` in AWS, the ``RUNTIME_*`` lines of ``backend/.env`` locally. A
  value is validated against its field (``validate_setting``) before it's stored, and
  this process's cache is dropped, so the change shows at once here and within one
  TTL everywhere else. Deleting a key puts the setting back on its code default.

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
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Any, Literal, Protocol

import annotated_types
from dotenv import dotenv_values, set_key, unset_key
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

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

    max_tags_per_list: int = Field(
        default=25,
        ge=1,
        le=200,
        description="Tags one list can have.",
    )
    # Live (not deleted) lists one account may hold. Creating and importing both
    # count against it. Served to clients.
    max_lists_per_user: int = Field(
        default=100,
        ge=1,
        le=10_000,
        description="Live lists one account can hold (create and import).",
    )
    # Signed-in write requests (lists, items, tags, imports) per user per rolling day.
    # Bounds how fast one account can grow storage. Enforced by the rate limiter.
    max_writes_per_user_per_day: int = Field(
        default=2000,
        ge=1,
        le=1_000_000,
        description="Signed-in writes per user per rolling day.",
    )
    # ``POST /lists/import`` (docs/ARCHITECTURE.md). Over either is a 413. Both go to
    # clients via /config/client; the byte cap is also the frontend's import-file cap.
    # The edge should enforce one too, since the app only sees the body once it's
    # read (docs/ABUSE_PROTECTION_PLAN.md §Request hygiene).
    max_lists_per_import: int = Field(
        default=100,
        ge=1,
        le=1000,
        description="Lists in one import.",
    )
    max_import_bytes: int = Field(
        default=5 * 1024 * 1024,
        ge=64 * 1024,
        le=50 * 1024 * 1024,
        description="Largest import file, in bytes.",
    )


class RateLimits(BaseModel):
    """Per-route-class request rates (docs/ABUSE_PROTECTION_PLAN.md §Rate limits),
    enforced by ``app.core.rate_limit``. The daily write cap is a quota, in ``Limits``.

    ``enabled`` is the kill switch: off only for load-free local runs (e.g. the e2e
    suite) or an emergency. The default is on.
    """

    model_config = ConfigDict(frozen=True, extra="ignore")

    enabled: bool = Field(default=True, description="Rate limiting on (off only in an emergency).")
    # Admin routes, per admin (docs/ADMIN_AND_ANALYTICS_PLAN.md §Access control).
    admin_per_minute: int = Field(
        default=60, ge=1, le=10_000, description="Admin requests per admin per minute."
    )
    # /auth/login and /auth/callback, per client IP.
    auth_per_minute: int = Field(
        default=20,
        ge=1,
        le=10_000,
        description="Sign-in requests per IP per minute.",
    )
    # /config/*, per client IP.
    config_per_minute: int = Field(
        default=60,
        ge=1,
        le=10_000,
        description="Client-config requests per IP per minute.",
    )
    # Signed-in writes (POST/PATCH/PUT/DELETE on lists, items, tags), per user.
    writes_per_minute: int = Field(
        default=120,
        ge=1,
        le=10_000,
        description="Signed-in writes per user per minute.",
    )
    # POST /lists/import, per user (on top of the write limits).
    imports_per_hour: int = Field(
        default=5,
        ge=1,
        le=10_000,
        description="Imports per user per hour.",
    )


class RuntimeSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="ignore")

    limits: Limits = Limits()
    rate_limits: RateLimits = RateLimits()


# ─── Sources ────────────────────────────────────────────────────────────────────
# A source returns flat dotted keys → raw string values, e.g.
# {"limits.max_tags_per_list": "25"}. Validation happens once, below, for all sources.


class RuntimeSettingsSource(Protocol):
    def fetch(self) -> dict[str, str]: ...

    def write(self, key: str, value: str) -> None: ...

    def delete(self, key: str) -> None: ...


class SettingNotWritableError(Exception):
    """The source can't store this key (e.g. it's pinned by a real env var)."""


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

    @staticmethod
    def env_name(key: str) -> str:
        """``limits.max_tags_per_list`` → ``RUNTIME_LIMITS__MAX_TAGS_PER_LIST``."""
        return ENV_PREFIX + key.upper().replace(".", "__")

    def _writable_name(self, key: str) -> str:
        name = self.env_name(key)
        if not self._env_file:
            raise SettingNotWritableError("No env file to write to.")
        if name in self._environ:
            # The real environment wins over the file, so a write there would be
            # silently ignored. Say so instead.
            raise SettingNotWritableError(f"{name} is set in the process environment.")
        return name

    def write(self, key: str, value: str) -> None:
        assert self._env_file is not None
        set_key(self._env_file, self._writable_name(key), value, quote_mode="never")

    def delete(self, key: str) -> None:
        name = self._writable_name(key)
        assert self._env_file is not None
        if name in (dotenv_values(self._env_file) or {}):
            unset_key(self._env_file, name)


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

    def _name(self, key: str) -> str:
        return f"{self._prefix}/{key.replace('.', '/')}"

    def write(self, key: str, value: str) -> None:
        self._get_client().put_parameter(
            Name=self._name(key), Value=value, Type="String", Overwrite=True
        )

    def delete(self, key: str) -> None:
        client = self._get_client()
        try:
            client.delete_parameter(Name=self._name(key))
        except client.exceptions.ParameterNotFound:
            pass  # Already on its default.


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


# ─── One setting at a time (the admin Settings page) ───────────────────────────


@dataclass(frozen=True)
class SettingSpec:
    """One leaf setting: its dotted key, type, default and bounds."""

    key: str
    kind: Literal["int", "bool"]
    default: int | bool
    minimum: int | None
    maximum: int | None
    description: str
    adapter: TypeAdapter[Any]


def _walk(model: type[BaseModel], prefix: str = "") -> list[SettingSpec]:
    specs: list[SettingSpec] = []
    for name, field in model.model_fields.items():
        key = f"{prefix}{name}"
        annotation = field.annotation
        if isinstance(annotation, type) and issubclass(annotation, BaseModel):
            specs.extend(_walk(annotation, f"{key}."))
            continue
        if annotation not in (int, bool):
            raise TypeError(f"runtime setting {key} must be an int or a bool")
        metadata = field.metadata
        specs.append(
            SettingSpec(
                key=key,
                kind="bool" if annotation is bool else "int",
                default=field.default,
                minimum=next((m.ge for m in metadata if isinstance(m, annotated_types.Ge)), None),
                maximum=next((m.le for m in metadata if isinstance(m, annotated_types.Le)), None),
                description=field.description or "",
                adapter=TypeAdapter(Annotated[annotation, *metadata] if metadata else annotation),
            )
        )
    return specs


@lru_cache(maxsize=1)
def setting_specs() -> dict[str, SettingSpec]:
    """Every leaf setting by dotted key, in declaration order."""
    return {spec.key: spec for spec in _walk(RuntimeSettings)}


def validate_setting(key: str, value: int | bool) -> str:
    """Check ``value`` against ``key``'s type and bounds; return it as stored text.

    Strict, so ``true`` can't stand in for an int (or 1 for a bool). Raises
    ``KeyError`` for an unknown key and ``ValueError`` (with a readable message) for
    a bad value.
    """
    spec = setting_specs()[key]
    try:
        checked = spec.adapter.validate_python(value, strict=True)
    except ValidationError as exc:
        raise ValueError(exc.errors()[0]["msg"]) from None
    if spec.kind == "bool":
        return "true" if checked else "false"
    return str(checked)


def setting_value(runtime: RuntimeSettings, key: str) -> int | bool:
    """The effective value of a dotted ``key`` in ``runtime``."""
    node: Any = runtime
    for part in key.split("."):
        node = getattr(node, part)
    return node


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

    def raw(self) -> dict[str, str]:
        """The source's stored values, read fresh (raises if the source is down)."""
        return self._source.fetch()

    def write(self, key: str, value: str) -> None:
        self._source.write(key, value)
        self.invalidate()

    def delete(self, key: str) -> None:
        self._source.delete(key)
        self.invalidate()

    def invalidate(self) -> None:
        """Drop the cached value, so the next ``get`` re-reads the source."""
        with self._lock:
            self._value = None

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


def get_runtime_settings_provider() -> RuntimeSettingsProvider:
    """FastAPI dependency for the admin Settings page, which reads and writes."""
    return _provider()
