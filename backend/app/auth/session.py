"""Signed, timed, HttpOnly session cookie.

This is *our* session mechanism — distinct from the Cognito JWT we'll verify at
*login* time in production. The cookie carries only an opaque, signed reference to
the user (id + token version); the app re-loads the ``User`` from the DB on each
request, so revocation (``is_active`` / version bump) takes effect immediately.

Stateless: nothing is stored server-side, so horizontal scale needs no shared
session store — every container verifies the same ``SECRET_KEY``.
"""

from fastapi import Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel, ValidationError

from app.core.config import settings
from app.models.user import User

# ``salt`` namespaces this signer so a token minted for one purpose can't be
# replayed against another signer sharing the same SECRET_KEY.
_serializer = URLSafeTimedSerializer(settings.secret_key, salt="favfifty.session")


class SessionData(BaseModel):
    """Decoded, verified contents of a session cookie."""

    uid: str  # User.id (UUID as string)
    tv: int  # User.session_token_version at issue time


def issue_session(user: User) -> str:
    """Sign a session token for ``user``."""
    return _serializer.dumps({"uid": str(user.id), "tv": user.session_token_version})


def read_session(token: str) -> SessionData | None:
    """Verify and decode a session token, or ``None`` if invalid/expired/malformed."""
    try:
        raw = _serializer.loads(token, max_age=settings.session_max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(raw, dict):
        return None
    try:
        return SessionData(**raw)
    except ValidationError:
        return None


def set_session_cookie(response: Response, token: str) -> None:
    """Attach the session cookie to ``response``.

    Attributes must stay in lockstep with :func:`clear_session_cookie` so the
    browser matches (and thus clears) the same cookie on logout.
    """
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_max_age_seconds,
        path="/",
        httponly=True,  # not readable by JS — an XSS can't exfiltrate it
        secure=not settings.is_development,  # HTTPS-only outside local dev
        samesite="lax",  # baseline CSRF protection for the auth cookie
    )


def clear_session_cookie(response: Response) -> None:
    """Remove the session cookie (logout) — attributes mirror ``set_session_cookie``."""
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        secure=not settings.is_development,
        samesite="lax",
    )
