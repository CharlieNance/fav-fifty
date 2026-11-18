"""Admin access control: who can reach ``/admin``, and that nothing grants admin.

docs/ADMIN_AND_ANALYTICS_PLAN.md §Access control and §Tests. The walks below are
behavioral, like tests/test_route_protection.py: a new admin route that somehow
skips ``require_admin`` fails CI.
"""

import re
import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner
from sqlalchemy.orm import Session

from app.api.router import API_V1_PREFIX
from app.auth.claims import Claims
from app.auth.session import issue_session
from app.core.config import settings
from app.main import create_app
from app.models.user import ROLE_ADMIN, ROLE_USER, User
from app.services import user_service
from tests.conftest import API_BASE_URL, BROWSER_HEADERS

_PATH_PARAM = re.compile(r"\{[^}]+\}")


def _admin_operations() -> set[tuple[str, str]]:
    paths = create_app().openapi()["paths"]
    return {
        (method.upper(), path.removeprefix(API_V1_PREFIX))
        for path, operations in paths.items()
        if path.startswith(f"{API_V1_PREFIX}/admin")
        for method in operations
    }


def _call_all(client: TestClient) -> dict[str, int]:
    some_id = str(uuid.uuid4())
    return {
        f"{method} {path}": client.request(
            method, _PATH_PARAM.sub(some_id, path), json={}
        ).status_code
        for method, path in sorted(_admin_operations())
    }


@pytest.fixture
def admin_user(db_session: Session) -> User:
    user = user_service.get_or_create_user(
        db_session,
        Claims(sub=f"admin-{uuid.uuid4()}", email="owner@example.com", name="Owner"),
    )
    user.role = ROLE_ADMIN
    db_session.commit()
    return user


def _client_for(client: TestClient, token: str) -> TestClient:
    other = TestClient(client.app, base_url=API_BASE_URL, headers=BROWSER_HEADERS)
    other.cookies.set(settings.session_cookie_name, token)
    return other


@pytest.fixture
def admin_client(client: TestClient, admin_user: User) -> Iterator[TestClient]:
    with _client_for(client, issue_session(admin_user)) as admin:
        yield admin


def test_there_are_admin_routes() -> None:
    """Guards the walks below against passing vacuously."""
    assert ("GET", "/admin/audit-log") in _admin_operations()


def test_every_admin_route_rejects_a_signed_in_non_admin(auth_client: TestClient) -> None:
    not_forbidden = {route: code for route, code in _call_all(auth_client).items() if code != 403}
    assert not_forbidden == {}, f"Reachable by a non-admin: {not_forbidden}"


def test_every_admin_route_rejects_an_anonymous_caller(client: TestClient) -> None:
    not_401 = {route: code for route, code in _call_all(client).items() if code != 401}
    assert not_401 == {}


def test_an_admin_gets_in(admin_client: TestClient) -> None:
    assert admin_client.get("/admin/audit-log").status_code == 200


def test_a_stale_admin_session_must_sign_in_again(
    client: TestClient, admin_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    signed_13h_ago = int(time.time()) - 13 * 3600
    monkeypatch.setattr(TimestampSigner, "get_timestamp", lambda self: signed_13h_ago)
    token = issue_session(admin_user)
    monkeypatch.undo()

    with _client_for(client, token) as stale:
        response = stale.get("/admin/audit-log")
        assert response.status_code == 403
        assert response.json()["detail"] == "Sign in again to use admin tools"
        # The same old session is still fine for the regular app.
        assert stale.get("/me").status_code == 200


def test_a_locked_admin_is_locked_out(
    admin_client: TestClient, admin_user: User, db_session: Session
) -> None:
    user_service.deactivate_user(db_session, admin_user.id)
    assert admin_client.get("/admin/audit-log").status_code == 401


def test_revoking_admin_takes_effect_on_the_next_request(
    admin_client: TestClient, admin_user: User, db_session: Session
) -> None:
    assert admin_client.get("/admin/audit-log").status_code == 200
    user_service.set_role(db_session, admin_user, ROLE_USER)
    assert admin_client.get("/admin/audit-log").status_code == 403


# --- Nothing in the API can grant admin ------------------------------------------

_FORBIDDEN_INPUTS = {"role", "is_admin"}


def _input_property_names(schema: dict[str, Any], node: Any, seen: set[str]) -> set[str]:
    """Every property name reachable from ``node``, following $refs."""
    names: set[str] = set()
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref not in seen:
            seen.add(ref)
            name = ref.rsplit("/", 1)[-1]
            names |= _input_property_names(schema, schema["components"]["schemas"][name], seen)
        names |= set(node.get("properties", {}))
        for value in node.values():
            names |= _input_property_names(schema, value, seen)
    elif isinstance(node, list):
        for value in node:
            names |= _input_property_names(schema, value, seen)
    return names


def test_no_api_path_accepts_a_role_as_input() -> None:
    """Admin is granted only by the CLI on the box (CLAUDE.md, never-do list)."""
    schema = create_app().openapi()
    offenders = []
    for path, operations in schema["paths"].items():
        for method, operation in operations.items():
            params = {param["name"] for param in operation.get("parameters", [])}
            body = _input_property_names(schema, operation.get("requestBody", {}), set())
            if (params | body) & _FORBIDDEN_INPUTS:
                offenders.append(f"{method.upper()} {path}")
    assert offenders == []


def test_the_role_walk_would_catch_a_body_field() -> None:
    """Guards the test above: it does see properties behind $refs."""
    schema = {
        "components": {"schemas": {"Evil": {"properties": {"role": {"type": "string"}}}}},
    }
    body = {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/Evil"}}}}
    assert "role" in _input_property_names(schema, body, set())
