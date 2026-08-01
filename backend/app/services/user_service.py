"""User service — the one place that owns the ``users`` table's business rules.

Functions take a ``Session`` argument (not a global), so they unit-test without the
HTTP app. Routes and the auth layer delegate here; the DB row is created/looked up
here and nowhere else.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.models.user import User


def _apply_login(user: User, claims: Claims) -> None:
    """Refresh a user's profile from the latest claims and stamp this login."""
    if claims.name and user.display_name != claims.name:
        user.display_name = claims.name
    if user.avatar_url != claims.picture:
        user.avatar_url = claims.picture
    if user.email != claims.email:
        user.email = claims.email
    user.last_login_at = datetime.now(UTC)


def get_or_create_user(db: Session, claims: Claims) -> User:
    """Find the user for these identity claims, creating the row on first login.

    Profile fields are refreshed from the provider each login (a user may change
    their name/avatar upstream), and ``last_login_at`` is stamped. This is the
    single seam where a future ``record_event(...)`` login-analytics call lands.
    """
    user = db.scalar(select(User).where(User.cognito_sub == claims.sub))
    if user is not None:
        _apply_login(user, claims)
        db.commit()
        db.refresh(user)
        return user

    # First login for this identity — insert the row.
    user = User(
        cognito_sub=claims.sub,
        display_name=claims.name,
        avatar_url=claims.picture,
        email=claims.email,
    )
    user.last_login_at = datetime.now(UTC)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent first-login for the same cognito_sub won the race on the
        # unique index. Discard our failed INSERT, reuse the row they created,
        # and re-apply this login instead of surfacing a 500.
        db.rollback()
        user = db.scalar(select(User).where(User.cognito_sub == claims.sub))
        if user is None:
            raise
        _apply_login(user, claims)
        db.commit()

    db.refresh(user)
    return user


def get_user_by_id(db: Session, user_id: uuid.UUID) -> User | None:
    """Load a user by primary key (used to resolve the session cookie each request)."""
    return db.get(User, user_id)


def deactivate_user(db: Session, user_id: uuid.UUID) -> None:
    """Revoke a user's access immediately — checked on every authenticated request."""
    user = db.get(User, user_id)
    if user is not None:
        user.is_active = False
        db.commit()


def revoke_all_sessions(db: Session, user_id: uuid.UUID) -> None:
    """Invalidate all of a user's outstanding session cookies ("log out everywhere").

    Bumping the version means every previously-issued cookie fails the version check
    in ``get_current_user``, without rotating ``SECRET_KEY`` (which would log out
    everyone). The user simply logs in again to get a fresh cookie.
    """
    user = db.get(User, user_id)
    if user is not None:
        user.session_token_version += 1
        db.commit()
