"""Tests for the user service — the get-or-create + revocation business rules."""

from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.services import user_service


def _claims(**overrides: str | None) -> Claims:
    base = {"sub": "sub-123", "email": "a@example.com", "name": "Alice", "picture": None}
    base.update(overrides)
    return Claims(**base)


def test_get_or_create_creates_then_reuses(db_session: Session) -> None:
    created = user_service.get_or_create_user(db_session, _claims())
    assert created.cognito_sub == "sub-123"
    assert created.display_name == "Alice"
    assert created.is_active is True
    assert created.session_token_version == 0
    assert created.last_login_at is not None

    again = user_service.get_or_create_user(db_session, _claims())
    assert again.id == created.id  # same row, not a duplicate


def test_get_or_create_refreshes_profile_fields(db_session: Session) -> None:
    user = user_service.get_or_create_user(db_session, _claims(name="Alice", picture=None))
    user_id = user.id

    updated = user_service.get_or_create_user(
        db_session, _claims(name="Alice Cooper", picture="https://cdn/x.png")
    )
    assert updated.id == user_id
    assert updated.display_name == "Alice Cooper"
    assert updated.avatar_url == "https://cdn/x.png"


def test_deactivate_user(db_session: Session) -> None:
    user = user_service.get_or_create_user(db_session, _claims())
    user_service.deactivate_user(db_session, user.id)
    db_session.refresh(user)
    assert user.is_active is False


def test_revoke_all_sessions_bumps_version(db_session: Session) -> None:
    user = user_service.get_or_create_user(db_session, _claims())
    assert user.session_token_version == 0
    user_service.revoke_all_sessions(db_session, user.id)
    db_session.refresh(user)
    assert user.session_token_version == 1
