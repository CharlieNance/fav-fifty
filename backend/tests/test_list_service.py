"""Tests for the list service — the index query's ownership and soft-delete filtering."""

import uuid
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


def test_create_list_returns_a_new_row_owned_by_the_user(db_session: Session) -> None:
    user = _user(db_session, "owner")

    row = list_service.create_list(db_session, user.id, "My New List")

    assert row.id is not None
    assert row.user_id == user.id
    assert row.title == "My New List"
    assert row.deleted_at is None


def test_get_owned_list_returns_the_row_for_its_owner(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    mine = _list(db_session, owner, "Mine")

    result = list_service.get_owned_list(db_session, mine.id, owner.id)

    assert result is not None
    assert result.id == mine.id


def test_get_owned_list_is_none_for_a_different_user(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    other = _user(db_session, "other")
    theirs = _list(db_session, owner, "Theirs")

    assert list_service.get_owned_list(db_session, theirs.id, other.id) is None


def test_get_owned_list_is_none_for_a_soft_deleted_list(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    deleted = _list(db_session, owner, "Gone", deleted_at=datetime.now(UTC))

    assert list_service.get_owned_list(db_session, deleted.id, owner.id) is None


def test_get_owned_list_is_none_for_a_nonexistent_id(db_session: Session) -> None:
    owner = _user(db_session, "owner")

    assert list_service.get_owned_list(db_session, uuid.uuid4(), owner.id) is None


def test_rename_list_updates_the_title(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    row = _list(db_session, owner, "Old Title")

    renamed = list_service.rename_list(db_session, row, "New Title")

    assert renamed.id == row.id
    assert renamed.title == "New Title"


def test_soft_delete_list_stamps_deleted_at(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    row = _list(db_session, owner, "Gone")

    list_service.soft_delete_list(db_session, row)

    assert row.deleted_at is not None


def test_soft_delete_list_hides_the_row_from_get_owned_list(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    row = _list(db_session, owner, "Gone")

    list_service.soft_delete_list(db_session, row)

    assert list_service.get_owned_list(db_session, row.id, owner.id) is None
