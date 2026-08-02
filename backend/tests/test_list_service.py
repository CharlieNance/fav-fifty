"""Tests for the list service — the index query's ownership and soft-delete filtering."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.models.list import List
from app.models.user import User
from app.services import list_service, user_service


def _user(db_session: Session, sub: str) -> User:
    return user_service.get_or_create_user(
        db_session, Claims(sub=sub, email=f"{sub}@example.com", name=sub)
    )


def _list(db_session: Session, user: User, title: str, **overrides: object) -> List:
    row = List(user_id=user.id, title=title, **overrides)
    db_session.add(row)
    db_session.commit()
    return row


def test_list_for_user_returns_only_own_non_deleted_lists(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    other = _user(db_session, "other")
    mine = _list(db_session, owner, "Mine")
    _list(db_session, owner, "Deleted", deleted_at=datetime.now(UTC))
    _list(db_session, other, "Someone else's")

    result = list_service.list_for_user(db_session, owner.id)

    assert [row.id for row in result] == [mine.id]


def test_list_for_user_empty_for_user_with_no_lists(db_session: Session) -> None:
    user = _user(db_session, "fresh")
    assert list_service.list_for_user(db_session, user.id) == []


def test_list_for_user_orders_by_updated_at_descending(db_session: Session) -> None:
    user = _user(db_session, "owner")
    now = datetime.now(UTC)
    older = _list(db_session, user, "Older", updated_at=now - timedelta(days=1))
    newer = _list(db_session, user, "Newer", updated_at=now)

    result = list_service.list_for_user(db_session, user.id)

    assert [row.id for row in result] == [newer.id, older.id]
