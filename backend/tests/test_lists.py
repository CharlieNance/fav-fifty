"""Tests for /lists — a signed-in user's own lists (index + create)."""

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.auth.providers import DEV_CLAIMS
from app.core.config import settings
from app.models.list import List
from app.models.user import User
from app.services import tag_service, user_service


def _dev_user(db_session: Session) -> User:
    """The DEV_CLAIMS user, created on demand.

    Tests using ``auth_client`` already have this row (dev-login created it), but
    the ``*_requires_authentication`` tests build a list to point an unauthenticated
    request at without ever logging in, so it may not exist yet. ``get_or_create_user``
    is idempotent, so this is safe either way.
    """
    return user_service.get_or_create_user(db_session, DEV_CLAIMS)


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


# The three index-content tests below use `fresh_user`/`fresh_user_client`, NOT
# `auth_client`: the dev-login user may own real rows in the shared local DB
# (manual browser testing, e2e leftovers), and "exactly these lists" assertions
# must start from a user guaranteed to have none — see conftest.py.


def test_list_lists_empty_for_user_with_no_lists(fresh_user_client: TestClient) -> None:
    response = fresh_user_client.get("/lists")
    assert response.status_code == 200
    assert response.json() == []


def test_list_lists_returns_only_own_non_deleted_lists(
    fresh_user_client: TestClient, fresh_user: User, db_session: Session
) -> None:
    mine = _list(db_session, fresh_user, "Mine")
    _list(db_session, fresh_user, "Deleted", deleted_at=datetime.now(UTC))
    _list(db_session, _second_user(db_session), "Someone else's")

    response = fresh_user_client.get("/lists")

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


def test_create_list_requires_authentication(client: TestClient) -> None:
    assert client.post("/lists", json={"title": "New list"}).status_code == 401


def test_create_list_creates_a_row_owned_by_the_caller(
    auth_client: TestClient, db_session: Session
) -> None:
    response = auth_client.post("/lists", json={"title": "  My New List  "})

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "My New List"
    assert "deleted_at" not in body

    row = db_session.get(List, uuid.UUID(body["id"]))
    assert row is not None
    assert row.user_id == _dev_user(db_session).id
    assert row.deleted_at is None


@pytest.mark.parametrize("title", ["", "   ", "x" * 201])
def test_create_list_rejects_invalid_title(auth_client: TestClient, title: str) -> None:
    assert auth_client.post("/lists", json={"title": title}).status_code == 422


def test_get_list_requires_authentication(client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")
    assert client.get(f"/lists/{row.id}").status_code == 401


def test_get_list_returns_the_owners_list(auth_client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")

    response = auth_client.get(f"/lists/{row.id}")

    assert response.status_code == 200
    assert response.json()["title"] == "Mine"


def test_get_list_404s_for_a_different_users_list(
    auth_client: TestClient, db_session: Session
) -> None:
    theirs = _list(db_session, _second_user(db_session), "Someone else's")
    assert auth_client.get(f"/lists/{theirs.id}").status_code == 404


def test_get_list_404s_for_a_soft_deleted_list(
    auth_client: TestClient, db_session: Session
) -> None:
    deleted = _list(db_session, _dev_user(db_session), "Gone", deleted_at=datetime.now(UTC))
    assert auth_client.get(f"/lists/{deleted.id}").status_code == 404


def test_get_list_404s_for_a_nonexistent_id(auth_client: TestClient) -> None:
    assert auth_client.get(f"/lists/{uuid.uuid4()}").status_code == 404


def test_update_list_requires_authentication(client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")
    assert client.patch(f"/lists/{row.id}", json={"title": "New Title"}).status_code == 401


def test_update_list_renames_the_owners_list(auth_client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session), "Old Title")

    response = auth_client.patch(f"/lists/{row.id}", json={"title": "  New Title  "})

    assert response.status_code == 200
    assert response.json()["title"] == "New Title"
    db_session.refresh(row)
    assert row.title == "New Title"


def test_update_list_404s_for_a_different_users_list(
    auth_client: TestClient, db_session: Session
) -> None:
    theirs = _list(db_session, _second_user(db_session), "Someone else's")
    response = auth_client.patch(f"/lists/{theirs.id}", json={"title": "Hijacked"})
    assert response.status_code == 404


def test_update_list_404s_for_a_soft_deleted_list(
    auth_client: TestClient, db_session: Session
) -> None:
    deleted = _list(db_session, _dev_user(db_session), "Gone", deleted_at=datetime.now(UTC))
    response = auth_client.patch(f"/lists/{deleted.id}", json={"title": "New Title"})
    assert response.status_code == 404


def test_update_list_404s_for_a_nonexistent_id(auth_client: TestClient) -> None:
    response = auth_client.patch(f"/lists/{uuid.uuid4()}", json={"title": "New Title"})
    assert response.status_code == 404


@pytest.mark.parametrize("title", ["", "   ", "x" * 201])
def test_update_list_rejects_invalid_title(
    auth_client: TestClient, db_session: Session, title: str
) -> None:
    row = _list(db_session, _dev_user(db_session), "Old Title")
    assert auth_client.patch(f"/lists/{row.id}", json={"title": title}).status_code == 422


def test_delete_list_requires_authentication(client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")
    assert client.delete(f"/lists/{row.id}").status_code == 401


def test_delete_list_soft_deletes_the_owners_list(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")

    response = auth_client.delete(f"/lists/{row.id}")

    assert response.status_code == 204
    assert response.content == b""
    db_session.refresh(row)
    assert row.deleted_at is not None


def test_delete_list_removes_it_from_the_index(
    fresh_user_client: TestClient, fresh_user: User, db_session: Session
) -> None:
    row = _list(db_session, fresh_user, "Mine")

    fresh_user_client.delete(f"/lists/{row.id}")

    assert fresh_user_client.get("/lists").json() == []


def test_delete_list_makes_the_single_get_404(auth_client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")

    auth_client.delete(f"/lists/{row.id}")

    assert auth_client.get(f"/lists/{row.id}").status_code == 404


def test_delete_list_twice_404s_the_second_time(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")

    first = auth_client.delete(f"/lists/{row.id}")
    second = auth_client.delete(f"/lists/{row.id}")

    assert first.status_code == 204
    assert second.status_code == 404


def test_delete_list_404s_for_a_different_users_list(
    auth_client: TestClient, db_session: Session
) -> None:
    theirs = _list(db_session, _second_user(db_session), "Someone else's")

    response = auth_client.delete(f"/lists/{theirs.id}")

    assert response.status_code == 404
    db_session.refresh(theirs)
    assert theirs.deleted_at is None


def test_delete_list_404s_for_a_nonexistent_id(auth_client: TestClient) -> None:
    assert auth_client.delete(f"/lists/{uuid.uuid4()}").status_code == 404


def test_get_list_includes_its_tags(auth_client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")
    tag_service.set_list_tags(db_session, row, ["games", "sci-fi"])

    response = auth_client.get(f"/lists/{row.id}")

    assert sorted(response.json()["tags"]) == ["games", "sci-fi"]


def test_get_list_has_an_empty_tags_list_by_default(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")
    assert auth_client.get(f"/lists/{row.id}").json()["tags"] == []


def test_update_list_tags_requires_authentication(client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")
    response = client.put(f"/lists/{row.id}/tags", json={"tags": ["games"]})
    assert response.status_code == 401


def test_update_list_tags_sets_the_owners_tags(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")

    response = auth_client.put(f"/lists/{row.id}/tags", json={"tags": ["Games", "Sci-Fi"]})

    assert response.status_code == 200
    assert sorted(response.json()["tags"]) == ["games", "sci-fi"]
    db_session.refresh(row)
    assert sorted(tag.name for tag in row.tags) == ["games", "sci-fi"]


def test_update_list_tags_replaces_rather_than_merges(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")
    auth_client.put(f"/lists/{row.id}/tags", json={"tags": ["games", "sci-fi"]})

    response = auth_client.put(f"/lists/{row.id}/tags", json={"tags": ["board games"]})

    assert response.status_code == 200
    assert response.json()["tags"] == ["board games"]


def test_update_list_tags_normalizes_and_dedupes(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")

    response = auth_client.put(
        f"/lists/{row.id}/tags", json={"tags": ["  Sci-Fi  ", "sci-fi", "SCI-FI"]}
    )

    assert response.status_code == 200
    assert response.json()["tags"] == ["sci-fi"]


def test_update_list_tags_clears_with_an_empty_list(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")
    auth_client.put(f"/lists/{row.id}/tags", json={"tags": ["games"]})

    response = auth_client.put(f"/lists/{row.id}/tags", json={"tags": []})

    assert response.status_code == 200
    assert response.json()["tags"] == []


@pytest.mark.parametrize("tag", ["", "   ", "x" * 51])
def test_update_list_tags_rejects_an_invalid_tag(
    auth_client: TestClient, db_session: Session, tag: str
) -> None:
    row = _list(db_session, _dev_user(db_session), "Mine")
    response = auth_client.put(f"/lists/{row.id}/tags", json={"tags": [tag]})
    assert response.status_code == 422


def test_update_list_tags_rejects_over_the_cap(
    auth_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "max_tags_per_list", 2)
    row = _list(db_session, _dev_user(db_session), "Mine")

    response = auth_client.put(f"/lists/{row.id}/tags", json={"tags": ["a", "b", "c"]})

    assert response.status_code == 422


def test_update_list_tags_404s_for_a_different_users_list(
    auth_client: TestClient, db_session: Session
) -> None:
    theirs = _list(db_session, _second_user(db_session), "Someone else's")
    response = auth_client.put(f"/lists/{theirs.id}/tags", json={"tags": ["games"]})
    assert response.status_code == 404


def test_update_list_tags_404s_for_a_soft_deleted_list(
    auth_client: TestClient, db_session: Session
) -> None:
    deleted = _list(db_session, _dev_user(db_session), "Gone", deleted_at=datetime.now(UTC))
    response = auth_client.put(f"/lists/{deleted.id}/tags", json={"tags": ["games"]})
    assert response.status_code == 404


def test_update_list_tags_404s_for_a_nonexistent_id(auth_client: TestClient) -> None:
    response = auth_client.put(f"/lists/{uuid.uuid4()}/tags", json={"tags": ["games"]})
    assert response.status_code == 404


def test_update_list_tags_reuses_one_tag_row_across_users(
    auth_client: TestClient, second_user_client: TestClient, db_session: Session
) -> None:
    """Route-level check that reuse-not-duplicate happens even across owners."""
    mine = _list(db_session, _dev_user(db_session), "Mine")
    theirs = _list(db_session, _second_user(db_session), "Theirs")

    auth_client.put(f"/lists/{mine.id}/tags", json={"tags": ["board games"]})
    second_user_client.put(f"/lists/{theirs.id}/tags", json={"tags": ["board games"]})

    db_session.refresh(mine)
    db_session.refresh(theirs)
    assert mine.tags[0].id == theirs.tags[0].id
