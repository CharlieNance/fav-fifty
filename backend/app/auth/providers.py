"""Concrete identity providers and the factory that selects one.

Today only the development stub exists. When Cognito is wired, a
``CognitoIdentityProvider`` (verify JWT via JWKS, extract the same claims) is added
here and returned by :func:`get_identity_provider` in non-dev environments — with
zero changes anywhere downstream, because everything speaks :class:`Claims`.
"""

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

    def get_claims(self, credential: str | None = None) -> Claims:
        return DEV_CLAIMS


def get_identity_provider() -> IdentityProvider:
    """Return the identity provider for the current environment."""
    if settings.is_development:
        return DevIdentityProvider()
    # Cognito provider slots in here (Phase 1 cloud wiring).
    raise RuntimeError("No production identity provider configured yet (Cognito wiring pending).")
