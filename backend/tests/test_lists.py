"""Tests for GET /lists — a signed-in user's own list index."""

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.auth.providers import DEV_CLAIMS
from app.models.list import List
from app.models.user import User
from app.services import user_service


def _dev_user(db_session: Session) -> User:
    user = db_session.scalar(select(User).where(User.cognito_sub == DEV_CLAIMS.sub))
    assert user is not None
    return user


def _second_user(db_session: Session) -> User:
    """The same identity `second_user_client` (conftest.py) is logged in as."""
    return user_service.get_or_create_user(
        db_session, Claims(sub="second-user", email="second@example.com", name="Second User")
    )


def _list(db_session: Session, user: User, title: str, **overrides: object) -> List:
    row = List(user_id=user.id, title=title, **overrides)
    db_session.add(row)
    db_session.commit()
    return row


def test_list_lists_requires_authentication(client: TestClient) -> None:
    assert client.get("/lists").status_code == 401


def test_list_lists_empty_for_user_with_no_lists(auth_client: TestClient) -> None:
    response = auth_client.get("/lists")
    assert response.status_code == 200
    assert response.json() == []


def test_list_lists_returns_only_own_non_deleted_lists(
    auth_client: TestClient, db_session: Session
) -> None:
    owner = _dev_user(db_session)
    mine = _list(db_session, owner, "Mine")
    _list(db_session, owner, "Deleted", deleted_at=datetime.now(UTC))
    _list(db_session, _second_user(db_session), "Someone else's")

    response = auth_client.get("/lists")

    assert response.status_code == 200
    body = response.json()
    assert [row["id"] for row in body] == [str(mine.id)]
    assert body[0]["title"] == "Mine"
    assert "deleted_at" not in body[0]


def test_list_lists_isolates_a_different_authenticated_user(
    auth_client: TestClient, second_user_client: TestClient, db_session: Session
) -> None:
    """Route-level check that ownership scoping is real, not just service-level.

    `second_user_client` is a *separate* authenticated identity from `auth_client`
    (see conftest.py) — this is the test that couldn't exist without it.
    """
    _list(db_session, _dev_user(db_session), "Dev user's list")
    theirs = _list(db_session, _second_user(db_session), "Second user's list")

    response = second_user_client.get("/lists")

    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [str(theirs.id)]
