"""Shared pytest fixtures.

Fixtures defined here are available to every test without importing.

Tests run against the Dockerized Postgres (per docs/DECISIONS.md — the schema uses
Postgres-only features, so SQLite would give false confidence). Start it first:

    docker compose up -d db

Isolation is per-test transactional rollback: each test runs inside a transaction
that is rolled back at the end, so nothing touches the real data and tests can run
in any order. ``get_db`` is overridden so the app and the test share one session.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import engine, get_db
from app.main import create_app


@pytest.fixture(autouse=True)
def _cognito_not_configured_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    """Force ``settings.cognito_configured`` to False, regardless of local ``.env``.

    A dev machine with real Cognito credentials in ``backend/.env`` (needed to test
    the live Google login) would otherwise make every test see Cognito as
    configured, silently switching tests that expect the dev-login stub over to
    the real provider. Tests that need the real flow opt back in via the
    ``cognito_env`` fixture (test_cognito_auth.py), which runs after this one and
    overrides these values.
    """
    monkeypatch.setattr(settings, "cognito_user_pool_id", "")
    monkeypatch.setattr(settings, "cognito_client_id", "")
    monkeypatch.setattr(settings, "cognito_client_secret", "")
    monkeypatch.setattr(settings, "cognito_domain", "")


@pytest.fixture
def db_session() -> Iterator[Session]:
    """A Session wrapped in a transaction that is rolled back after the test.

    ``join_transaction_mode="create_savepoint"`` lets code under test call
    ``commit()`` (as the user service does) without escaping the outer transaction:
    each commit just releases a savepoint, and the outer ``rollback()`` undoes
    everything at the end.
    """
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db_session: Session) -> Iterator[TestClient]:
    """A TestClient whose app shares the test's rolled-back DB session."""
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def auth_client(client: TestClient) -> TestClient:
    """A logged-in TestClient — has POSTed /auth/dev-login, so it carries the cookie."""
    response = client.post("/auth/dev-login")
    assert response.status_code == 200
    return client
