"""Runtime settings: sources, validation with per-key fallback, cache TTL, fail-safe."""

from pathlib import Path
from typing import Any

import pytest

from app.core.runtime_settings import (
    EnvSource,
    RuntimeSettings,
    RuntimeSettingsProvider,
    SsmSource,
    parse_runtime_settings,
)


class FakeSource:
    """Counts reads; returns ``values`` or raises ``error``."""

    def __init__(self, values: dict[str, str] | None = None, error: Exception | None = None):
        self.values = values or {}
        self.error = error
        self.calls = 0

    def fetch(self) -> dict[str, str]:
        self.calls += 1
        if self.error:
            raise self.error
        return dict(self.values)


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


# ─── Defaults and validation ──────────────────────────────────────────────────


def test_defaults_are_the_decided_quotas() -> None:
    assert RuntimeSettings().limits.max_tags_per_list == 25


def test_parse_coerces_raw_strings() -> None:
    parsed = parse_runtime_settings({"limits.max_tags_per_list": "40"})

    assert parsed.limits.max_tags_per_list == 40


@pytest.mark.parametrize("bad", ["0", "201", "-3", "lots", ""])
def test_parse_falls_back_to_the_default_for_an_invalid_value(bad: str) -> None:
    parsed = parse_runtime_settings({"limits.max_tags_per_list": bad})

    assert parsed.limits.max_tags_per_list == 25


def test_parse_ignores_unknown_keys() -> None:
    parsed = parse_runtime_settings({"no_such.setting": "1", "limits.max_tags_per_list": "30"})

    assert parsed.limits.max_tags_per_list == 30


def test_parse_drops_a_malformed_group_without_failing() -> None:
    # "limits" given as a scalar instead of a group, plus a key nested too deep.
    assert parse_runtime_settings({"limits": "5"}) == RuntimeSettings()
    assert parse_runtime_settings({"limits.max_tags_per_list.x": "5"}) == RuntimeSettings()


# ─── Sources ──────────────────────────────────────────────────────────────────


def test_env_source_maps_prefixed_vars_to_dotted_keys() -> None:
    source = EnvSource(
        env_file=None,
        environ={"RUNTIME_LIMITS__MAX_TAGS_PER_LIST": "12", "UNRELATED": "x"},
    )

    assert source.fetch() == {"limits.max_tags_per_list": "12"}


def test_env_source_reads_the_env_file_and_real_env_wins(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_bytes(b"RUNTIME_LIMITS__MAX_TAGS_PER_LIST=10\nRUNTIME_OTHER=1\n")

    from_file = EnvSource(env_file=str(env_file), environ={}).fetch()
    overridden = EnvSource(
        env_file=str(env_file), environ={"RUNTIME_LIMITS__MAX_TAGS_PER_LIST": "11"}
    ).fetch()

    assert from_file["limits.max_tags_per_list"] == "10"
    assert overridden["limits.max_tags_per_list"] == "11"


class FakeSsmClient:
    """Just enough of boto3's SSM client: a paginator over two pages."""

    def __init__(self, pages: list[list[dict[str, str]]]):
        self.pages = pages
        self.paths: list[str] = []

    def get_paginator(self, name: str) -> "FakeSsmClient":
        assert name == "get_parameters_by_path"
        return self

    def paginate(self, **kwargs: Any) -> list[dict[str, Any]]:
        self.paths.append(kwargs["Path"])
        assert kwargs["Recursive"] is True
        return [{"Parameters": page} for page in self.pages]


def test_ssm_source_maps_parameter_names_across_pages() -> None:
    client = FakeSsmClient(
        [
            [{"Name": "/favfifty/settings/limits/max_tags_per_list", "Value": "30"}],
            [{"Name": "/favfifty/settings/catalog_enabled", "Value": "false"}],
        ]
    )

    values = SsmSource("/favfifty/settings/", client=client).fetch()

    assert client.paths == ["/favfifty/settings/"]
    assert values == {"limits.max_tags_per_list": "30", "catalog_enabled": "false"}


# ─── Provider: cache + fail-safe ──────────────────────────────────────────────


def test_provider_caches_for_the_ttl_then_rereads() -> None:
    source = FakeSource({"limits.max_tags_per_list": "30"})
    clock = FakeClock()
    provider = RuntimeSettingsProvider(source, ttl_seconds=30, clock=clock)

    assert provider.get().limits.max_tags_per_list == 30
    source.values = {"limits.max_tags_per_list": "31"}
    clock.now += 29
    assert provider.get().limits.max_tags_per_list == 30
    assert source.calls == 1

    clock.now += 1
    assert provider.get().limits.max_tags_per_list == 31
    assert source.calls == 2


def test_provider_fails_safe_to_defaults_when_the_source_is_unreachable() -> None:
    source = FakeSource(error=ConnectionError("SSM is down"))
    clock = FakeClock()
    provider = RuntimeSettingsProvider(source, ttl_seconds=30, clock=clock)

    assert provider.get() == RuntimeSettings()
    # The failure is cached too: one slow call per TTL, not one per request.
    provider.get()
    assert source.calls == 1

    source.error = None
    source.values = {"limits.max_tags_per_list": "40"}
    clock.now += 30
    assert provider.get().limits.max_tags_per_list == 40
