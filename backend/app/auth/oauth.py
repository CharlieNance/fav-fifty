"""Cognito OAuth (authorization code + PKCE) helpers.

Isolates the moving parts of the *real* login flow so the routes stay readable:

* a short-lived, **signed** ``state`` cookie that ties ``/auth/login`` to
  ``/auth/callback`` — it carries the CSRF token, the OIDC ``nonce``, the PKCE
  ``code_verifier``, and the safe post-login redirect path;
* PKCE generation (S256);
* open-redirect-safe handling of the caller-supplied ``redirect``;
* the code→token exchange against Cognito's token endpoint.

Like the session cookie, the state is stateless (signed, not stored server-side)
so any container can complete a login another started.
"""

import base64
import hashlib
import secrets

import httpx2
from fastapi import Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, ValidationError

from app.core.config import settings

# Distinct from the session cookie: this one exists only during the login round-trip.
OAUTH_STATE_COOKIE = "favfifty_oauth_state"
# The authorize→callback round-trip is quick; a short life bounds the CSRF window.
OAUTH_STATE_MAX_AGE_SECONDS = 600  # 10 minutes

# Separate salt from the session signer so a token minted for one can't be
# replayed against the other, even though both use SECRET_KEY.
_state_serializer = URLSafeTimedSerializer(settings.secret_key, salt="favfifty.oauth-state")


class OAuthState(BaseModel):
    """Everything ``/auth/callback`` needs to safely finish what ``/auth/login`` began."""

    state: str  # CSRF token; must match the `state` Cognito echoes back
    nonce: str  # bound into the id token; must match its `nonce` claim
    code_verifier: str  # PKCE verifier; its challenge was sent to authorize
    redirect: str  # safe, same-site path to land on after login


def _b64url(raw: bytes) -> str:
    """URL-safe base64 with padding stripped (per RFC 7636)."""
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def new_random_token() -> str:
    """A high-entropy, URL-safe random token (state / nonce)."""
    return secrets.token_urlsafe(32)


def generate_pkce_pair() -> tuple[str, str]:
    """Return ``(code_verifier, code_challenge)`` for PKCE using the S256 method."""
    verifier = _b64url(secrets.token_bytes(32))
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


def safe_redirect_path(raw: str | None) -> str:
    """Return a safe same-site path to land on after login.

    Only single-slash relative paths are allowed, which blocks open redirects to
    ``//evil.com`` or ``https://evil.com``. Anything else falls back to ``/``.
    """
    if raw and raw.startswith("/") and not raw.startswith("//"):
        return raw
    return "/"


def serialize_state(data: OAuthState) -> str:
    """Sign the OAuth state into an opaque cookie value."""
    return _state_serializer.dumps(data.model_dump())


def read_state(token: str | None) -> OAuthState | None:
    """Verify and decode the state cookie, or ``None`` if missing/invalid/expired."""
    if not token:
        return None
    try:
        raw = _state_serializer.loads(token, max_age=OAUTH_STATE_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(raw, dict):
        return None
    try:
        return OAuthState(**raw)
    except ValidationError:
        return None


def set_oauth_state_cookie(response: Response, token: str) -> None:
    """Attach the short-lived state cookie.

    ``SameSite=Lax`` (not Strict) is required: the cookie must ride along on the
    top-level GET navigation Cognito uses to return the browser to ``/callback``.
    """
    response.set_cookie(
        key=OAUTH_STATE_COOKIE,
        value=token,
        max_age=OAUTH_STATE_MAX_AGE_SECONDS,
        path="/",
        httponly=True,
        secure=not settings.is_development,
        samesite="lax",
    )


def clear_oauth_state_cookie(response: Response) -> None:
    """Remove the state cookie once the callback has consumed it."""
    response.delete_cookie(
        key=OAUTH_STATE_COOKIE,
        path="/",
        httponly=True,
        secure=not settings.is_development,
        samesite="lax",
    )


async def exchange_code_for_tokens(code: str, code_verifier: str) -> dict:
    """Exchange an authorization ``code`` for tokens at Cognito's token endpoint.

    Uses PKCE (``code_verifier``) *and* HTTP Basic client authentication, since our
    app client is confidential (has a secret). Returns the parsed token response
    (``id_token``, ``access_token``, …); raises ``httpx2.HTTPStatusError`` on non-2xx.
    """
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.cognito_client_id,
        "code": code,
        "redirect_uri": settings.cognito_redirect_uri,
        "code_verifier": code_verifier,
    }
    async with httpx2.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            settings.cognito_token_url,
            data=data,
            auth=(settings.cognito_client_id, settings.cognito_client_secret),
        )
    resp.raise_for_status()
    return resp.json()
