"""The public API contract: everything under ``/api/v1``, and the committed schema.

See docs/MOBILE_READINESS.md §4 — installed apps can't be force-updated, so the
path and the schema are both things we promise not to break.
"""

from fastapi.testclient import TestClient

from app.main import create_app
from app.openapi_snapshot import SNAPSHOT_PATH, render_openapi


def test_routes_are_served_under_api_v1(client: TestClient) -> None:
    assert client.get("/health").status_code == 200
    # Absolute URLs bypass the client's /api/v1 base: nothing answers at the root.
    assert client.get("http://testserver/health").status_code == 404
    assert client.get("http://testserver/docs").status_code == 404


def test_every_route_is_versioned() -> None:
    paths = create_app().openapi()["paths"]

    assert paths
    assert all(path.startswith("/api/v1/") for path in paths)


def test_docs_and_schema_are_served_under_api_v1(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").json()["info"]["title"] == "Fav Fifty API"


def test_openapi_snapshot_is_current() -> None:
    """The committed backend/openapi.json must match what the app serves.

    Failing? If the API change is intended, run ./tools/openapi_snapshot.sh and
    commit the updated snapshot so the contract change is reviewed with the code.
    Within v1 it must be additive: no removed/renamed fields or paths.
    """
    committed = SNAPSHOT_PATH.read_bytes().decode("utf-8") if SNAPSHOT_PATH.exists() else ""

    assert render_openapi(create_app()) == committed, (
        "backend/openapi.json is out of date — run ./tools/openapi_snapshot.sh and "
        "review/commit the diff."
    )
