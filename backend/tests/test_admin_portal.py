"""Admin portal routes: users (search, detail, lock/unlock, revoke) and settings.

Access control for these routes is tested in tests/test_admin_access.py.
"""

import uuid
from collections.abc import Iterator
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.auth.session import issue_session
from app.core.config import settings
from app.core.runtime_settings import (
    RuntimeSettingsProvider,
    SettingNotWritableError,
    get_runtime_settings_provider,
)
from app.models.list import List
from app.models.list_item import ListItem
from app.models.user import ROLE_ADMIN, User
from app.services import user_service
from tests.conftest import API_BASE_URL, BROWSER_HEADERS


def _make_user(db: Session, name: str, email: str) -> User:
    return user_service.get_or_create_user(
        db, Claims(sub=f"portal-{uuid.uuid4()}", email=email, name=name)
    )


@pytest.fixture
def admin(db_session: Session) -> User:
    user = _make_user(db_session, "Owner", "owner@example.com")
    user.role = ROLE_ADMIN
    db_session.commit()
    return user


@pytest.fixture
def admin_client(client: TestClient, admin: User) -> Iterator[TestClient]:
    with TestClient(client.app, base_url=API_BASE_URL, headers=BROWSER_HEADERS) as admin_client:
        admin_client.cookies.set(settings.session_cookie_name, issue_session(admin))
        yield admin_client


@pytest.fixture
def target(db_session: Session) -> User:
    """A regular user with one live list (2 items) and one deleted list."""
    user = _make_user(db_session, "Zebediah Quux", f"zq-{uuid.uuid4().hex[:8]}@example.com")
    live = List(user_id=user.id, title="Live")
    gone = List(user_id=user.id, title="Gone")
    db_session.add_all([live, gone])
    db_session.flush()
    db_session.add_all(
        [ListItem(list_id=live.id, position=i, text=f"Item {i}") for i in (1, 2)]
        + [ListItem(list_id=gone.id, position=1, text="Old")]
    )
    from datetime import UTC, datetime

    gone.deleted_at = datetime.now(UTC)
    db_session.commit()
    return user


@pytest.fixture
def target_client(client: TestClient, target: User) -> Iterator[TestClient]:
    with TestClient(client.app, base_url=API_BASE_URL, headers=BROWSER_HEADERS) as target_client:
        target_client.cookies.set(settings.session_cookie_name, issue_session(target))
        yield target_client


# ─── Users ──────────────────────────────────────────────────────────────────────


def test_search_finds_by_name_or_email_with_list_counts(
    admin_client: TestClient, target: User
) -> None:
    by_name = admin_client.get("/admin/users", params={"q": "ebediah qu"}).json()
    assert [row["id"] for row in by_name] == [str(target.id)]
    assert by_name[0]["list_count"] == 1  # the deleted list doesn't count
    assert by_name[0]["role"] == "user"

    assert target.email is not None
    by_email = admin_client.get("/admin/users", params={"q": target.email.upper()}).json()
    assert [row["id"] for row in by_email] == [str(target.id)]


def test_search_treats_like_wildcards_literally(admin_client: TestClient, target: User) -> None:
    assert admin_client.get("/admin/users", params={"q": "%"}).json() == []


def test_search_without_a_query_lists_newest_first(admin_client: TestClient) -> None:
    response = admin_client.get("/admin/users", params={"limit": 2})
    assert response.status_code == 200
    assert len(response.json()) <= 2
    assert response.headers["cache-control"] == "no-store"


def test_user_detail(admin_client: TestClient, target: User) -> None:
    detail = admin_client.get(f"/admin/users/{target.id}").json()
    assert detail["display_name"] == "Zebediah Quux"
    assert (detail["list_count"], detail["item_count"]) == (1, 2)
    assert detail["recent_actions"] == []


def test_unknown_user_is_404(admin_client: TestClient) -> None:
    assert admin_client.get(f"/admin/users/{uuid.uuid4()}").status_code == 404


def test_lock_takes_effect_on_the_users_next_request_and_is_audited(
    admin_client: TestClient, target_client: TestClient, target: User, admin: User
) -> None:
    assert target_client.get("/me").status_code == 200

    response = admin_client.post(f"/admin/users/{target.id}/lock", json={"reason": "spam"})
    assert response.status_code == 200
    detail = response.json()
    assert detail["is_active"] is False
    [entry] = detail["recent_actions"]
    assert (entry["action"], entry["reason"]) == ("lock_user", "spam")
    assert entry["admin_user_id"] == str(admin.id)

    assert target_client.get("/me").status_code == 401

    # Locking again changes nothing (no second audit row).
    again = admin_client.post(f"/admin/users/{target.id}/lock", json={}).json()
    assert len(again["recent_actions"]) == 1


def test_unlock_does_not_revive_old_sessions(
    admin_client: TestClient, target_client: TestClient, target: User
) -> None:
    admin_client.post(f"/admin/users/{target.id}/lock", json={})
    detail = admin_client.post(f"/admin/users/{target.id}/unlock", json={}).json()

    assert detail["is_active"] is True
    assert [e["action"] for e in detail["recent_actions"]] == ["unlock_user", "lock_user"]
    # The lock ended the cookie it had; the user signs in again.
    assert target_client.get("/me").status_code == 401


def test_revoke_sessions_signs_the_user_out(
    admin_client: TestClient, target_client: TestClient, target: User
) -> None:
    detail = admin_client.post(f"/admin/users/{target.id}/revoke-sessions", json={}).json()
    assert detail["is_active"] is True
    assert detail["recent_actions"][0]["action"] == "revoke_sessions"
    assert target_client.get("/me").status_code == 401


def test_an_admin_cannot_lock_themselves(admin_client: TestClient, admin: User) -> None:
    response = admin_client.post(f"/admin/users/{admin.id}/lock", json={})
    assert response.status_code == 409
    assert admin_client.get("/me").status_code == 200


def test_reason_length_is_capped(admin_client: TestClient, target: User) -> None:
    response = admin_client.post(f"/admin/users/{target.id}/lock", json={"reason": "x" * 501})
    assert response.status_code == 422


def test_me_says_whether_you_are_an_admin(
    admin_client: TestClient, target_client: TestClient
) -> None:
    assert admin_client.get("/me").json()["is_admin"] is True
    assert target_client.get("/me").json()["is_admin"] is False


# ─── Settings ───────────────────────────────────────────────────────────────────


class MemorySource:
    def __init__(self, values: dict[str, str] | None = None, read_only: bool = False):
        self.values = values or {}
        self.read_only = read_only
        self.down = False

    def fetch(self) -> dict[str, str]:
        if self.down:
            raise ConnectionError("store is down")
        return dict(self.values)

    def write(self, key: str, value: str) -> None:
        if self.read_only:
            raise SettingNotWritableError("pinned")
        self.values[key] = value

    def delete(self, key: str) -> None:
        if self.read_only:
            raise SettingNotWritableError("pinned")
        self.values.pop(key, None)


@pytest.fixture
def store(client: TestClient) -> MemorySource:
    source = MemorySource()
    provider = RuntimeSettingsProvider(source)
    cast(FastAPI, client.app).dependency_overrides[get_runtime_settings_provider] = lambda: provider
    return source


def _row(rows: list[dict], key: str) -> dict:
    return next(row for row in rows if row["key"] == key)


def test_settings_lists_defaults_bounds_and_values(
    admin_client: TestClient, store: MemorySource
) -> None:
    store.values = {"limits.max_tags_per_list": "30", "limits.max_lists_per_user": "lots"}
    rows = admin_client.get("/admin/settings").json()

    tags = _row(rows, "limits.max_tags_per_list")
    assert tags["kind"] == "int"
    assert (tags["default"], tags["minimum"], tags["maximum"]) == (25, 1, 200)
    assert (tags["value"], tags["override"], tags["override_invalid"]) == (30, "30", False)

    lists = _row(rows, "limits.max_lists_per_user")
    assert (lists["value"], lists["override_invalid"]) == (100, True)

    enabled = _row(rows, "rate_limits.enabled")
    assert (enabled["kind"], enabled["value"], enabled["override"]) == ("bool", True, None)


def test_update_stores_the_value_and_audits_it(
    admin_client: TestClient, store: MemorySource
) -> None:
    response = admin_client.put(
        "/admin/settings/limits.max_tags_per_list", json={"value": 40, "reason": "more tags"}
    )
    assert response.status_code == 200
    row = response.json()
    assert (row["value"], row["override"]) == (40, "40")
    assert row["last_change"]["action"] == "update_setting"
    assert row["last_change"]["details"] == {"from": None, "to": "40"}
    assert store.values == {"limits.max_tags_per_list": "40"}

    switch = admin_client.put("/admin/settings/rate_limits.enabled", json={"value": False})
    assert switch.json()["value"] is False
    assert store.values["rate_limits.enabled"] == "false"


@pytest.mark.parametrize("value", [0, 201, True])
def test_update_rejects_out_of_bounds_or_mistyped_values(
    admin_client: TestClient, store: MemorySource, value: int | bool
) -> None:
    response = admin_client.put("/admin/settings/limits.max_tags_per_list", json={"value": value})
    assert response.status_code == 422
    assert store.values == {}


def test_unknown_setting_is_404(admin_client: TestClient, store: MemorySource) -> None:
    assert admin_client.put("/admin/settings/limits.nope", json={"value": 1}).status_code == 404
    assert admin_client.post("/admin/settings/limits.nope/reset", json={}).status_code == 404


def test_reset_returns_to_the_default(admin_client: TestClient, store: MemorySource) -> None:
    store.values = {"limits.max_tags_per_list": "40"}
    row = admin_client.post("/admin/settings/limits.max_tags_per_list/reset", json={}).json()
    assert (row["value"], row["override"]) == (25, None)
    assert row["last_change"]["action"] == "reset_setting"
    assert store.values == {}


def test_a_pinned_setting_is_409_and_not_audited(
    admin_client: TestClient, store: MemorySource
) -> None:
    store.read_only = True
    response = admin_client.put("/admin/settings/limits.max_tags_per_list", json={"value": 40})
    assert response.status_code == 409
    rows = admin_client.get("/admin/settings").json()
    assert _row(rows, "limits.max_tags_per_list")["last_change"] is None


def test_an_unreachable_store_is_503(admin_client: TestClient, store: MemorySource) -> None:
    store.down = True
    assert admin_client.get("/admin/settings").status_code == 503
