"""Request hardening: body-size cap, CSRF Origin check, the CloudFront origin secret,
and the database statement timeout (docs/ABUSE_PROTECTION_PLAN.md §Request hygiene,
§CSRF and headers)."""

from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.config import settings
from app.core.middleware import DEFAULT_MAX_BODY_BYTES
from app.core.runtime_settings import Limits, RuntimeSettings
from app.db.session import engine
from app.main import create_app
from tests.conftest import API_BASE_URL

# ─── Body size ──────────────────────────────────────────────────────────────────


def test_an_oversized_body_is_413_before_it_is_parsed(auth_client: TestClient) -> None:
    title = "x" * (DEFAULT_MAX_BODY_BYTES + 1)

    response = auth_client.post("/lists", json={"title": title})

    assert response.status_code == 413
    assert response.json()["detail"] == "That's too much to send at once."


def test_an_oversized_chunked_body_is_413(auth_client: TestClient) -> None:
    """No Content-Length: the body is counted as it streams in."""

    def chunks() -> Iterator[bytes]:
        yield b'{"title": "'
        for _ in range(DEFAULT_MAX_BODY_BYTES // 1024 + 1):
            yield b"x" * 1024
        yield b'"}'

    response = auth_client.post(
        "/lists", content=chunks(), headers={"Content-Type": "application/json"}
    )

    assert response.status_code == 413


def test_the_import_gets_the_larger_runtime_limit(
    fresh_user_client: TestClient, set_runtime_settings: Callable[[RuntimeSettings], None]
) -> None:
    set_runtime_settings(RuntimeSettings(limits=Limits(max_import_bytes=256 * 1024)))
    # Over the default 64 KiB, under the import's 256 KiB.
    note = "n" * 2000
    items = [{"text": f"item {n}", "note": note} for n in range(40)]
    body = {"device_id": "dev", "lists": [{"local_id": "a", "title": "Big", "items": items}]}

    assert fresh_user_client.post("/lists/import", json=body).status_code == 200


def test_a_malformed_content_length_is_400(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/lists",
        content=b'{"title": "x"}',
        headers={"Content-Type": "application/json", "Content-Length": "abc"},
    )
    assert response.status_code == 400


# ─── CSRF Origin check ──────────────────────────────────────────────────────────


def test_a_cookie_write_from_a_foreign_origin_is_403(auth_client: TestClient) -> None:
    response = auth_client.post(
        "/lists", json={"title": "Forged"}, headers={"Origin": "https://evil.example"}
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Cross-site request blocked."


def test_a_cookie_write_from_a_lookalike_origin_is_403(auth_client: TestClient) -> None:
    lookalike = f"{settings.frontend_url}.evil.example"
    response = auth_client.post("/lists", json={"title": "Forged"}, headers={"Origin": lookalike})
    assert response.status_code == 403


def test_a_cookie_write_with_no_origin_or_referer_is_403(auth_client: TestClient) -> None:
    del auth_client.headers["Origin"]

    response = auth_client.post("/lists", json={"title": "No origin"})

    assert response.status_code == 403


def test_a_cookie_write_falls_back_to_a_same_site_referer(auth_client: TestClient) -> None:
    del auth_client.headers["Origin"]

    response = auth_client.post(
        "/lists",
        json={"title": "Referer ok"},
        headers={"Referer": f"{settings.frontend_url}/lists"},
    )

    assert response.status_code == 201


def test_logout_is_protected_too(auth_client: TestClient) -> None:
    response = auth_client.post("/auth/logout", headers={"Origin": "https://evil.example"})
    assert response.status_code == 403


def test_reads_are_not_origin_checked(auth_client: TestClient) -> None:
    response = auth_client.get("/lists", headers={"Origin": "https://evil.example"})
    assert response.status_code == 200


def test_a_write_without_the_cookie_is_not_origin_checked(client: TestClient) -> None:
    """Nothing to forge (e.g. a future mobile bearer token): it's left to auth, here 401."""
    response = client.post(
        "/lists", json={"title": "x"}, headers={"Origin": "https://evil.example"}
    )
    assert response.status_code == 401


# ─── CloudFront origin secret ───────────────────────────────────────────────────


@pytest.fixture
def secret_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(settings, "origin_verify_secret", "s3cret")
    with TestClient(create_app(), base_url=API_BASE_URL) as test_client:
        yield test_client


def test_without_the_origin_secret_every_route_is_403(secret_client: TestClient) -> None:
    assert secret_client.get("/config/client").status_code == 403
    assert secret_client.get("/me", headers={"X-Origin-Verify": "wrong"}).status_code == 403


def test_with_the_origin_secret_requests_go_through(secret_client: TestClient) -> None:
    response = secret_client.get("/config/client", headers={"X-Origin-Verify": "s3cret"})
    assert response.status_code == 200


def test_health_skips_the_origin_secret(secret_client: TestClient) -> None:
    """The box's own container health probe calls it directly."""
    assert secret_client.get("/health").status_code == 200


# ─── Database ───────────────────────────────────────────────────────────────────


def test_app_connections_have_a_statement_timeout() -> None:
    with engine.connect() as connection:
        value = connection.execute(text("SHOW statement_timeout")).scalar_one()
    assert value == f"{settings.db_statement_timeout_ms // 1000}s"
