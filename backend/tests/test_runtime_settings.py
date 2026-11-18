"""Runtime settings: sources, validation with per-key fallback, cache TTL, fail-safe."""

from pathlib import Path
from typing import Any

import pytest

from app.core.runtime_settings import (
    EnvSource,
    RuntimeSettings,
    RuntimeSettingsProvider,
    SettingNotWritableError,
    SsmSource,
    parse_runtime_settings,
    setting_specs,
    validate_setting,
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


# ─── Writes (the admin Settings page) ─────────────────────────────────────────


def test_specs_cover_every_leaf_with_its_bounds() -> None:
    specs = setting_specs()
    tags = specs["limits.max_tags_per_list"]
    assert (tags.kind, tags.default, tags.minimum, tags.maximum) == ("int", 25, 1, 200)
    assert tags.description
    assert specs["rate_limits.enabled"].kind == "bool"
    assert all(spec.description for spec in specs.values()), "every setting needs a description"


@pytest.mark.parametrize(
    ("key", "value", "stored"),
    [("limits.max_tags_per_list", 30, "30"), ("rate_limits.enabled", False, "false")],
)
def test_validate_setting_returns_the_stored_text(key: str, value: int | bool, stored: str) -> None:
    assert validate_setting(key, value) == stored


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("limits.max_tags_per_list", 0),  # under the minimum
        ("limits.max_tags_per_list", 201),  # over the maximum
        ("limits.max_tags_per_list", True),  # a bool is not an int here
        ("rate_limits.enabled", 1),  # nor an int a bool
    ],
)
def test_validate_setting_rejects_bad_values(key: str, value: int | bool) -> None:
    with pytest.raises(ValueError):
        validate_setting(key, value)


def test_validate_setting_rejects_unknown_keys() -> None:
    with pytest.raises(KeyError):
        validate_setting("limits.nope", 1)


def test_env_source_writes_and_deletes_lines_in_the_env_file(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_bytes(b"DATABASE_URL=postgres://x" + bytes([10]))
    source = EnvSource(env_file=str(env_file), environ={})

    source.write("limits.max_tags_per_list", "30")
    assert source.fetch() == {"limits.max_tags_per_list": "30"}
    source.write("limits.max_tags_per_list", "31")
    assert source.fetch() == {"limits.max_tags_per_list": "31"}

    source.delete("limits.max_tags_per_list")
    assert source.fetch() == {}
    source.delete("limits.max_tags_per_list")  # already gone: fine
    assert "DATABASE_URL=postgres://x" in env_file.read_text()


def test_env_source_refuses_a_key_pinned_by_the_real_environment(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_bytes(b"")
    source = EnvSource(env_file=str(env_file), environ={"RUNTIME_LIMITS__MAX_TAGS_PER_LIST": "40"})
    with pytest.raises(SettingNotWritableError):
        source.write("limits.max_tags_per_list", "30")


class FakeSsmWriteClient:
    class exceptions:  # noqa: N801 - mirrors boto3's client.exceptions
        class ParameterNotFound(Exception):
            pass

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def put_parameter(self, **kwargs: Any) -> None:
        self.calls.append(("put", kwargs))

    def delete_parameter(self, **kwargs: Any) -> None:
        self.calls.append(("delete", kwargs))
        raise self.exceptions.ParameterNotFound()


def test_ssm_source_writes_and_deletes_parameters() -> None:
    client = FakeSsmWriteClient()
    source = SsmSource("/favfifty/settings/", client=client)

    source.write("limits.max_tags_per_list", "30")
    source.delete("limits.max_tags_per_list")  # ParameterNotFound is swallowed

    name = "/favfifty/settings/limits/max_tags_per_list"
    assert client.calls == [
        ("put", {"Name": name, "Value": "30", "Type": "String", "Overwrite": True}),
        ("delete", {"Name": name}),
    ]


class WritableSource(FakeSource):
    def write(self, key: str, value: str) -> None:
        self.values[key] = value

    def delete(self, key: str) -> None:
        self.values.pop(key, None)


def test_provider_write_applies_at_once_despite_the_cache() -> None:
    source = WritableSource()
    provider = RuntimeSettingsProvider(source, ttl_seconds=30, clock=FakeClock())
    assert provider.get().limits.max_tags_per_list == 25

    provider.write("limits.max_tags_per_list", "30")
    assert provider.get().limits.max_tags_per_list == 30

    provider.delete("limits.max_tags_per_list")
    assert provider.get().limits.max_tags_per_list == 25
