"""The OIDC claims contract and the identity-provider interface.

Everything downstream of the auth seam (session, user service, routes) speaks only
in terms of :class:`Claims` — a small, standard OIDC subset. Whether those claims
came from the dev stub or a verified Cognito JWT is invisible past this boundary,
which is exactly what lets us build and test the whole user layer before Cognito
exists (see docs/DECISIONS.md §Auth seam).
"""

from typing import Protocol

from pydantic import BaseModel


class Claims(BaseModel):
    """Standard OIDC claims, mapped to our ``users`` columns.

    ``sub`` → ``User.cognito_sub`` (stable per-user id in our pool),
    ``name`` → ``User.display_name``, ``picture`` → ``User.avatar_url``.
    """

    sub: str
    email: str
    name: str
    picture: str | None = None


class IdentityProvider(Protocol):
    """Turns an external credential into :class:`Claims`.

    ``credential`` is ignored by the dev stub (fixed claims); the future Cognito
    provider will use it (the verified id token) to derive the same claim shape.
    """

    def get_claims(self, credential: str | None = None) -> Claims: ...
