"""Tests for the real Google→Cognito auth flow.

Covers three layers behind the auth seam:

* ``CognitoIdentityProvider`` — that a **verified** id token yields the right
  claims, and that every way a token can be wrong (bad issuer/audience/expiry,
  wrong token type, nonce mismatch, missing token) is rejected.
* the OAuth helpers — PKCE, open-redirect safety, and the signed state cookie.
* the ``/auth/login`` and ``/auth/callback`` routes end-to-end, with the network
  call to Cognito's token endpoint mocked but real JWT verification in the loop.

No real network calls: the JWKS lookup is replaced with an in-test RSA key, and
the token exchange is monkeypatched.
"""

import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urljoin, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt import InvalidTokenError

import app.api.routes.auth as auth_routes
from app.auth.oauth import (
    OAUTH_STATE_COOKIE,
    OAuthState,
    generate_pkce_pair,
    read_state,
    safe_redirect_path,
    serialize_state,
)
from app.auth.providers import CognitoIdentityProvider
from app.core.config import settings

# --- Test fixtures: a fake user pool + signing key ----------------------------

CLIENT_ID = "test-app-client"
USER_POOL_ID = "us-east-1_testpool"
REGION = "us-east-1"


@pytest.fixture
def cognito_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Point ``settings`` at a fake, fully-configured Cognito pool."""
    monkeypatch.setattr(settings, "cognito_user_pool_id", USER_POOL_ID)
    monkeypatch.setattr(settings, "cognito_client_id", CLIENT_ID)
    monkeypatch.setattr(settings, "cognito_client_secret", "test-secret")
    monkeypatch.setattr(settings, "cognito_domain", "favfifty.auth.us-east-1.amazoncognito.com")
    monkeypatch.setattr(settings, "cognito_region", REGION)
    assert settings.cognito_configured


@pytest.fixture(scope="module")
def rsa_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _FakeJWKS:
    """Stands in for PyJWKClient — always returns our one test public key."""

    def __init__(self, public_key: object) -> None:
        self._public_key = public_key

    def get_signing_key_from_jwt(self, token: str) -> SimpleNamespace:
        return SimpleNamespace(key=self._public_key)


def make_id_token(rsa_key: rsa.RSAPrivateKey, **overrides: object) -> str:
    """Mint an RS256 id token with sane Cognito-shaped defaults, then apply overrides."""
    now = int(time.time())
    payload: dict[str, object] = {
        "iss": settings.cognito_issuer,
        "aud": CLIENT_ID,
        "sub": "cognito-sub-123",
        "token_use": "id",
        "email": "player@example.com",
        "name": "Velma Dinkley",
        "picture": "https://img.example.com/velma.png",
        "nonce": "the-nonce",
        "iat": now,
        "exp": now + 3600,
    }
    payload.update(overrides)
    return jwt.encode(payload, rsa_key, algorithm="RS256")


def build_provider(rsa_key: rsa.RSAPrivateKey) -> CognitoIdentityProvider:
    provider = CognitoIdentityProvider()
    provider._jwks_client = _FakeJWKS(rsa_key.public_key())  # type: ignore[assignment]
    return provider


# --- CognitoIdentityProvider: verification --------------------------------------


def test_valid_id_token_maps_to_claims(cognito_env: None, rsa_key: rsa.RSAPrivateKey) -> None:
    provider = build_provider(rsa_key)
    claims = provider.get_claims(make_id_token(rsa_key), nonce="the-nonce")

    assert claims.sub == "cognito-sub-123"
    assert claims.email == "player@example.com"
    assert claims.name == "Velma Dinkley"
    assert claims.picture == "https://img.example.com/velma.png"


def test_name_falls_back_to_email_when_absent(
    cognito_env: None, rsa_key: rsa.RSAPrivateKey
) -> None:
    provider = build_provider(rsa_key)
    token = make_id_token(rsa_key, name=None, picture=None)
    claims = provider.get_claims(token, nonce="the-nonce")

    assert claims.name == "player@example.com"
    assert claims.picture is None


def test_missing_credential_is_rejected(cognito_env: None, rsa_key: rsa.RSAPrivateKey) -> None:
    provider = build_provider(rsa_key)
    with pytest.raises(InvalidTokenError):
        provider.get_claims(None)


def test_wrong_audience_is_rejected(cognito_env: None, rsa_key: rsa.RSAPrivateKey) -> None:
    provider = build_provider(rsa_key)
    with pytest.raises(InvalidTokenError):
        provider.get_claims(make_id_token(rsa_key, aud="someone-elses-client"), nonce="the-nonce")


def test_wrong_issuer_is_rejected(cognito_env: None, rsa_key: rsa.RSAPrivateKey) -> None:
    provider = build_provider(rsa_key)
    with pytest.raises(InvalidTokenError):
        provider.get_claims(
            make_id_token(rsa_key, iss="https://evil.example.com"), nonce="the-nonce"
        )


def test_expired_token_is_rejected(cognito_env: None, rsa_key: rsa.RSAPrivateKey) -> None:
    provider = build_provider(rsa_key)
    past = int(time.time()) - 3600
    with pytest.raises(InvalidTokenError):
        provider.get_claims(make_id_token(rsa_key, exp=past, iat=past - 60), nonce="the-nonce")


def test_access_token_replayed_as_id_token_is_rejected(
    cognito_env: None, rsa_key: rsa.RSAPrivateKey
) -> None:
    provider = build_provider(rsa_key)
    with pytest.raises(InvalidTokenError):
        provider.get_claims(make_id_token(rsa_key, token_use="access"), nonce="the-nonce")


def test_nonce_mismatch_is_rejected(cognito_env: None, rsa_key: rsa.RSAPrivateKey) -> None:
    provider = build_provider(rsa_key)
    with pytest.raises(InvalidTokenError):
        provider.get_claims(make_id_token(rsa_key, nonce="not-mine"), nonce="the-nonce")


def test_token_signed_by_a_different_key_is_rejected(
    cognito_env: None, rsa_key: rsa.RSAPrivateKey
) -> None:
    # Provider trusts `rsa_key`, but the token is signed by an attacker's key.
    attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    provider = build_provider(rsa_key)
    forged = jwt.encode(
        {
            "iss": settings.cognito_issuer,
            "aud": CLIENT_ID,
            "sub": "attacker",
            "token_use": "id",
            "email": "a@evil.com",
            "name": "A",
            "nonce": "the-nonce",
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
        },
        attacker_key,
        algorithm="RS256",
    )
    with pytest.raises(InvalidTokenError):
        provider.get_claims(forged, nonce="the-nonce")


# --- OAuth helpers --------------------------------------------------------------


def test_pkce_pair_is_verifiable() -> None:
    import base64
    import hashlib

    verifier, challenge = generate_pkce_pair()
    expected = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    assert challenge == expected.decode()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("/lists/new", "/lists/new"),
        ("/", "/"),
        (None, "/"),
        ("//evil.com", "/"),  # protocol-relative open redirect
        ("https://evil.com", "/"),  # absolute open redirect
        ("javascript:alert(1)", "/"),  # scheme injection
    ],
)
def test_safe_redirect_path(raw: str | None, expected: str) -> None:
    assert safe_redirect_path(raw) == expected


def test_state_round_trips() -> None:
    state = OAuthState(state="s", nonce="n", code_verifier="v", redirect="/x")
    assert read_state(serialize_state(state)) == state


def test_read_state_rejects_garbage() -> None:
    assert read_state(None) is None
    assert read_state("not-a-real-token") is None


# --- Routes: /auth/login --------------------------------------------------------


def test_login_redirects_to_cognito_with_pkce_and_state(
    cognito_env: None, client: TestClient
) -> None:
    resp = client.get("/auth/login", params={"redirect": "/lists/new"}, follow_redirects=False)

    assert resp.status_code == 302
    location = resp.headers["location"]
    assert location.startswith(settings.cognito_authorize_url)

    query = parse_qs(urlparse(location).query)
    assert query["response_type"] == ["code"]
    assert query["client_id"] == [CLIENT_ID]
    assert query["scope"] == ["openid email profile"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["identity_provider"] == ["Google"]
    assert query["redirect_uri"] == [settings.cognito_redirect_uri]

    # The signed state cookie must carry the same `state` and the safe redirect.
    state_cookie = client.cookies.get(OAUTH_STATE_COOKIE)
    assert state_cookie is not None
    stored = read_state(state_cookie)
    assert stored is not None
    assert query["state"] == [stored.state]
    assert stored.redirect == "/lists/new"


def test_login_is_404_when_cognito_not_configured(client: TestClient) -> None:
    # No cognito_env fixture here → not configured → the real flow doesn't exist.
    assert client.get("/auth/login", follow_redirects=False).status_code == 404


# --- Routes: /auth/callback -----------------------------------------------------


def _prime_callback(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    rsa_key: rsa.RSAPrivateKey,
    *,
    id_token: str,
    nonce: str = "the-nonce",
) -> str:
    """Set a matching state cookie and stub the token exchange + provider. Returns state."""
    state = OAuthState(
        state="state-abc", nonce=nonce, code_verifier="verifier", redirect="/lists/new"
    )
    client.cookies.set(OAUTH_STATE_COOKIE, serialize_state(state))

    async def fake_exchange(code: str, code_verifier: str) -> dict:
        assert code == "auth-code"
        assert code_verifier == "verifier"
        return {"id_token": id_token}

    monkeypatch.setattr(auth_routes, "exchange_code_for_tokens", fake_exchange)
    monkeypatch.setattr(auth_routes, "get_identity_provider", lambda: build_provider(rsa_key))
    return state.state


def test_callback_happy_path_sets_session_and_redirects(
    cognito_env: None,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    rsa_key: rsa.RSAPrivateKey,
) -> None:
    state = _prime_callback(client, monkeypatch, rsa_key, id_token=make_id_token(rsa_key))

    resp = client.get(
        "/auth/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )

    assert resp.status_code == 302
    assert resp.headers["location"] == urljoin(settings.frontend_url, "/lists/new")
    assert client.cookies.get(settings.session_cookie_name) is not None

    # The session actually works: /me resolves the freshly created user.
    me = client.get("/me")
    assert me.status_code == 200
    assert me.json()["display_name"] == "Velma Dinkley"


def test_callback_rejects_state_mismatch(
    cognito_env: None,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    rsa_key: rsa.RSAPrivateKey,
) -> None:
    _prime_callback(client, monkeypatch, rsa_key, id_token=make_id_token(rsa_key))

    resp = client.get(
        "/auth/callback",
        params={"code": "auth-code", "state": "WRONG"},
        follow_redirects=False,
    )

    assert resp.status_code == 302
    assert "error=auth_failed" in resp.headers["location"]
    assert client.cookies.get(settings.session_cookie_name) is None


def test_callback_rejects_bad_id_token(
    cognito_env: None,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    rsa_key: rsa.RSAPrivateKey,
) -> None:
    # Token carries the wrong nonce → verification fails → error redirect, no session.
    bad = make_id_token(rsa_key, nonce="tampered")
    state = _prime_callback(client, monkeypatch, rsa_key, id_token=bad)

    resp = client.get(
        "/auth/callback",
        params={"code": "auth-code", "state": state},
        follow_redirects=False,
    )

    assert resp.status_code == 302
    assert "error=auth_failed" in resp.headers["location"]
    assert client.cookies.get(settings.session_cookie_name) is None


def test_callback_handles_provider_error_param(cognito_env: None, client: TestClient) -> None:
    # Cognito can bounce back with ?error=... (e.g. user denied consent).
    resp = client.get(
        "/auth/callback",
        params={"error": "access_denied"},
        follow_redirects=False,
    )
    assert resp.status_code == 302
    assert "error=auth_failed" in resp.headers["location"]
