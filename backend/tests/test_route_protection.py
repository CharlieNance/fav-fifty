"""Every route needs a signed-in user unless it's on the public list below.

Enumerates every operation the app serves (from its OpenAPI schema) and calls each
one with no session: anything not listed as public must answer 401. A new route
that forgets ``get_current_user`` (or an ownership dependency built on it) fails CI
instead of shipping open (docs/ABUSE_PROTECTION_PLAN.md §Layer 3). Adding a route
here is a deliberate, reviewable decision that strangers may call it.

Behavioral on purpose: it checks what a stranger actually gets back, not how the
route is wired, so it survives refactors (and FastAPI's routing internals).
"""

import re
import uuid

from fastapi.testclient import TestClient

from app.api.router import API_V1_PREFIX
from app.main import create_app

PUBLIC_ROUTES = {
    ("GET", "/health"),
    ("GET", "/config/client"),
    ("POST", "/auth/dev-login"),  # 404 outside development
    ("GET", "/auth/login"),
    ("GET", "/auth/callback"),
    ("POST", "/auth/logout"),  # only clears a cookie
}

_PATH_PARAM = re.compile(r"\{[^}]+\}")


def _operations() -> set[tuple[str, str]]:
    paths = create_app().openapi()["paths"]
    return {
        (method.upper(), path.removeprefix(API_V1_PREFIX))
        for path, operations in paths.items()
        for method in operations
    }


def test_the_schema_lists_the_routes() -> None:
    """Guards the test below against passing vacuously."""
    operations = _operations()
    assert PUBLIC_ROUTES <= operations, "a public route was renamed or removed"
    assert ("POST", "/lists") in operations


def test_every_non_public_route_requires_a_signed_in_user(client: TestClient) -> None:
    some_id = str(uuid.uuid4())
    answers = {
        f"{method} {path}": client.request(
            method, _PATH_PARAM.sub(some_id, path), json={}
        ).status_code
        for method, path in sorted(_operations() - PUBLIC_ROUTES)
    }

    open_routes = {route: code for route, code in answers.items() if code != 401}
    assert open_routes == {}, (
        f"Not 401 without a session (add auth, or list as public): {open_routes}"
    )
