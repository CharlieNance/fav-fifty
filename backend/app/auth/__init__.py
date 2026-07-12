"""Authentication seam.

The boundary between *how identity is proven* (a dev stub now, a verified Cognito
JWT later) and the rest of the app, which only ever sees a validated ``User``.

- ``claims``   — the OIDC claims contract + the ``IdentityProvider`` interface.
- ``providers`` — concrete providers (dev stub now; Cognito later) + a factory.
- ``session``  — the signed, HttpOnly session cookie that carries identity between
  requests. Stateless by design: no server-side session store, so any container
  can serve any request (scale out, not up).
"""
