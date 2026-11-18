"""Shared FastAPI dependencies.

Injected into routes via ``Depends(...)`` to keep routes thin and tests easy — a
test can override a dependency to inject a fake (e.g. a throwaway DB session).

``get_db`` is defined in ``app/db/session.py`` and re-exported here so routes have
a single, predictable import location for dependencies.
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.auth.session import read_session
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.services import user_service

__all__ = ["get_db", "get_current_user", "require_admin"]


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Resolve the authenticated user from the session cookie, or raise 401.

    The user is re-loaded from the DB on every request (cheap at our scale), so
    ``is_active`` and ``session_token_version`` changes take effect immediately —
    this is what makes access revocation instant.
    """
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise _unauthorized()

    session = read_session(token)
    if session is None:
        raise _unauthorized()
    request.state.session = session  # for require_admin's recent-login check

    try:
        user_id = uuid.UUID(session.uid)
    except ValueError:
        raise _unauthorized() from None

    user = user_service.get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise _unauthorized()
    if session.tv != user.session_token_version:
        raise _unauthorized()

    return user


def require_admin(request: Request, user: User = Depends(get_current_user)) -> User:
    """The signed-in admin, or 403. Applied to the whole ``/admin`` router.

    Builds on ``get_current_user``, so anonymous callers still get 401 and a locked
    admin is locked out too. Admin routes also need a session issued within
    ``admin_recent_login_seconds``: an old stolen cookie can't drive them.
    """
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admins only")

    issued_at = request.state.session.issued_at
    max_age = timedelta(seconds=settings.admin_recent_login_seconds)
    if datetime.now(UTC) - issued_at > max_age:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sign in again to use admin tools",
        )
    return user
