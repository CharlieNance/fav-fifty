"""Concrete identity providers and the factory that selects one.

Two providers live behind the :class:`~app.auth.claims.IdentityProvider` seam:

* :class:`DevIdentityProvider` — fixed claims, no network/JWT, development only.
* :class:`CognitoIdentityProvider` — verifies a Cognito **id token** (signature via
  the pool's JWKS, plus issuer/audience/expiry/nonce) and extracts the same claims.

:func:`get_identity_provider` picks between them by configuration, so nothing
downstream ever knows which one produced the :class:`Claims` it received.
"""

import jwt
from jwt import InvalidTokenError, PyJWKClient

from app.auth.claims import Claims, IdentityProvider
from app.core.config import settings

# Fixed identity used for local development. Deliberately obvious/fake — it never
# reaches any real environment (see the guard in ``DevIdentityProvider``).
DEV_CLAIMS = Claims(
    sub="dev-user-0001",
    email="dev@example.com",
    name="Dev User",
    picture=None,
)


class DevIdentityProvider:
    """Development-only identity stub: fixed claims, no network, no JWT.

    Hard-fails if constructed outside development, so it can never mint identities
    in staging/production even if a route guard were bypassed — this is the guard
    the ``test_dev_provider_hard_fails_outside_development`` test exercises.
    """

    def __init__(self) -> None:
        if not settings.is_development:
            raise RuntimeError(
                "DevIdentityProvider is only available in development "
                f"(APP_ENV={settings.app_env!r})"
            )

    def get_claims(self, credential: str | None = None, *, nonce: str | None = None) -> Claims:
        # The stub issues no real token, so there is no signature or nonce to check.
        return DEV_CLAIMS


class CognitoIdentityProvider:
    """Verifies a Cognito id token (JWT) and maps it onto our :class:`Claims`.

    Verification is the whole point of this class: an id token is only trustworthy
    if its signature checks out against the pool's published keys **and** its
    issuer, audience, expiry, purpose, and nonce all match what we expect. Anything
    off raises :class:`jwt.InvalidTokenError`, which the OAuth callback treats as a
    login failure and redirects back to the frontend — a malformed
    or forged token never becomes a session.
    """

    def __init__(self) -> None:
        if not settings.cognito_configured:
            raise RuntimeError(
                "CognitoIdentityProvider requires Cognito settings to be configured."
            )
        # PyJWKClient fetches and caches the pool's signing keys, refetching when it
        # sees a `kid` it doesn't know (i.e. after Cognito rotates keys).
        self._jwks_client = PyJWKClient(settings.cognito_jwks_url)

    def get_claims(self, credential: str | None = None, *, nonce: str | None = None) -> Claims:
        if not credential:
            raise InvalidTokenError("Missing id token.")

        signing_key = self._jwks_client.get_signing_key_from_jwt(credential)
        payload = jwt.decode(
            credential,
            signing_key.key,
            algorithms=["RS256"],  # Cognito signs id tokens with RS256
            audience=settings.cognito_client_id,  # `aud` must be our app client
            issuer=settings.cognito_issuer,  # `iss` must be our user pool
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )

        # Reject access tokens or other token types replayed as an id token.
        if payload.get("token_use") != "id":
            raise InvalidTokenError("Not an id token.")

        # Replay protection: the token must carry the nonce we bound to this login.
        if nonce is not None and payload.get("nonce") != nonce:
            raise InvalidTokenError("Nonce mismatch.")

        return Claims(
            sub=payload["sub"],
            # Cognito always includes `email` for a Google identity with the
            # standard attribute mapping; fail loudly if the mapping is wrong.
            email=payload["email"],
            # `name`/`picture` depend on the Google→Cognito attribute mapping and
            # may be absent; fall back so a thin token still yields a usable user.
            name=payload.get("name") or payload.get("email", ""),
            picture=payload.get("picture"),
        )


def get_identity_provider() -> IdentityProvider:
    """Return the identity provider for the current environment.

    Real Cognito wins whenever it's configured (any environment, so the real flow
    can be exercised outside prod); otherwise development falls back to the stub.
    """
    if settings.cognito_configured:
        return CognitoIdentityProvider()
    if settings.is_development:
        return DevIdentityProvider()
    raise RuntimeError(
        "No identity provider configured (set Cognito settings or run in development)."
    )
