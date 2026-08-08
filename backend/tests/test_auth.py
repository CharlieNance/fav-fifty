"""Tests for the auth seam — session cookie, dev login, /me, and revocation."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import session as session_mod
from app.auth.providers import DEV_CLAIMS, DevIdentityProvider, get_identity_provider
from app.auth.session import read_session
from app.core.config import settings
from app.models.user import User
from app.services import user_service


def _dev_user(db_session: Session) -> User:
    user = db_session.scalar(select(User).where(User.cognito_sub == DEV_CLAIMS.sub))
    assert user is not None
    return user


# ── dev login + /me ───────────────────────────────────────────────────────────


def test_dev_login_sets_cookie_and_returns_user(client: TestClient) -> None:
    response = client.post("/auth/dev-login")
    assert response.status_code == 200
    body = response.json()
    assert body["display_name"] == DEV_CLAIMS.name
    assert "cognito_sub" not in body  # internal field never exposed
    assert settings.session_cookie_name in response.cookies


def test_me_requires_authentication(client: TestClient) -> None:
    assert client.get("/me").status_code == 401


def test_me_returns_current_user(auth_client: TestClient) -> None:
    response = auth_client.get("/me")
    assert response.status_code == 200
    assert response.json()["display_name"] == DEV_CLAIMS.name


def test_logout_clears_cookie(auth_client: TestClient) -> None:
    assert auth_client.get("/me").status_code == 200
    assert auth_client.post("/auth/logout").status_code == 200
    assert auth_client.get("/me").status_code == 401


# ── revocation ──────────────────────────────────────────────────────────────


def test_inactive_user_is_rejected(auth_client: TestClient, db_session: Session) -> None:
    assert auth_client.get("/me").status_code == 200
    user_service.deactivate_user(db_session, _dev_user(db_session).id)
    assert auth_client.get("/me").status_code == 401


def test_token_version_bump_invalidates_existing_cookie(
    auth_client: TestClient, db_session: Session
) -> None:
    assert auth_client.get("/me").status_code == 200
    # The cookie was issued at version 0; bumping the user's version invalidates it.
    user_service.revoke_all_sessions(db_session, _dev_user(db_session).id)
    assert auth_client.get("/me").status_code == 401


# ── cookie integrity ────────────────────────────────────────────────────────


def test_tampered_cookie_is_rejected(client: TestClient) -> None:
    client.cookies.set(settings.session_cookie_name, "not-a-valid-token")
    assert client.get("/me").status_code == 401


def test_read_session_rejects_foreign_signature() -> None:
    from itsdangerous import URLSafeTimedSerializer

    forged = URLSafeTimedSerializer("a-different-secret", salt="favfifty.session").dumps(
        {"uid": "x", "tv": 0}
    )
    assert read_session(forged) is None


def test_read_session_rejects_malformed_payload() -> None:
    # Correctly signed, but not the {uid, tv} shape read_session expects.
    token = session_mod._serializer.dumps({"unexpected": "shape"})
    assert read_session(token) is None


# ── dev stub must never run outside development ──────────────────────────────


def test_dev_provider_hard_fails_outside_development(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    with pytest.raises(RuntimeError):
        DevIdentityProvider()
    with pytest.raises(RuntimeError):
        get_identity_provider()


def test_dev_login_endpoint_hidden_outside_development(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "app_env", "production")
    assert client.post("/auth/dev-login").status_code == 404


def test_dev_login_works_even_if_cognito_is_also_configured(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Regression test: a dev machine with real Cognito credentials in backend/.env
    # (needed to test the live Google login) must not break the dev-login stub.
    # get_identity_provider() would route to Cognito here; dev_login() must not use it.
    monkeypatch.setattr(settings, "cognito_user_pool_id", "us-east-1_fake")
    monkeypatch.setattr(settings, "cognito_client_id", "fake-client-id")
    monkeypatch.setattr(settings, "cognito_client_secret", "fake-secret")
    monkeypatch.setattr(settings, "cognito_domain", "fake.auth.us-east-1.amazoncognito.com")
    assert settings.cognito_configured  # sanity-check the fixture actually did its job

    response = client.post("/auth/dev-login")
    assert response.status_code == 200
    assert response.json()["display_name"] == DEV_CLAIMS.name
