"""Tests for /lists/{list_id}/items — CRUD and reorder for a list's ranked items."""

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.auth.providers import DEV_CLAIMS
from app.models.list import List
from app.models.list_item import ListItem
from app.models.user import User
from app.services import user_service


def _dev_user(db_session: Session) -> User:
    return user_service.get_or_create_user(db_session, DEV_CLAIMS)


def _second_user(db_session: Session) -> User:
    return user_service.get_or_create_user(
        db_session, Claims(sub="second-user", email="second@example.com", name="Second User")
    )


def _list(db_session: Session, user: User, title: str = "Mine", **overrides: object) -> List:
    row = List(user_id=user.id, title=title, **overrides)
    db_session.add(row)
    db_session.commit()
    return row


def _item(
    db_session: Session, list_row: List, position: int, text: str, **overrides: object
) -> ListItem:
    row = ListItem(list_id=list_row.id, position=position, text=text, **overrides)
    db_session.add(row)
    db_session.commit()
    return row


# --- GET /lists/{list_id}/items -------------------------------------------------


def test_read_items_requires_authentication(client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session))
    assert client.get(f"/lists/{row.id}/items").status_code == 401


def test_read_items_empty_for_a_fresh_list(auth_client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session))
    response = auth_client.get(f"/lists/{row.id}/items")
    assert response.status_code == 200
    assert response.json() == []


def test_read_items_returns_items_in_rank_order(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    _item(db_session, row, 2, "Second")
    _item(db_session, row, 1, "First")

    response = auth_client.get(f"/lists/{row.id}/items")

    assert response.status_code == 200
    assert [item["text"] for item in response.json()] == ["First", "Second"]


def test_read_items_404s_for_a_different_users_list(
    auth_client: TestClient, db_session: Session
) -> None:
    theirs = _list(db_session, _second_user(db_session))
    assert auth_client.get(f"/lists/{theirs.id}/items").status_code == 404


def test_read_items_404s_for_a_soft_deleted_list(
    auth_client: TestClient, db_session: Session
) -> None:
    deleted = _list(db_session, _dev_user(db_session), deleted_at=datetime.now(UTC))
    assert auth_client.get(f"/lists/{deleted.id}/items").status_code == 404


def test_read_items_404s_for_a_nonexistent_list(auth_client: TestClient) -> None:
    assert auth_client.get(f"/lists/{uuid.uuid4()}/items").status_code == 404


def test_read_items_isolates_a_different_authenticated_user(
    auth_client: TestClient, second_user_client: TestClient, db_session: Session
) -> None:
    mine = _list(db_session, _dev_user(db_session))
    theirs = _list(db_session, _second_user(db_session))
    _item(db_session, mine, 1, "Mine")
    _item(db_session, theirs, 1, "Theirs")

    response = second_user_client.get(f"/lists/{theirs.id}/items")

    assert response.status_code == 200
    assert [item["text"] for item in response.json()] == ["Theirs"]


# --- POST /lists/{list_id}/items ------------------------------------------------


def test_create_item_requires_authentication(client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session))
    assert client.post(f"/lists/{row.id}/items", json={"text": "New item"}).status_code == 401


def test_create_item_appends_owned_by_the_list(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))

    response = auth_client.post(
        f"/lists/{row.id}/items",
        json={"text": "  Sushi  ", "note": " great ", "image_url": "https://example.com/sushi.jpg"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["text"] == "Sushi"
    assert body["note"] == "great"
    assert body["image_url"] == "https://example.com/sushi.jpg"
    assert body["position"] == 1

    item_row = db_session.get(ListItem, uuid.UUID(body["id"]))
    assert item_row is not None
    assert item_row.list_id == row.id


def test_create_item_blank_note_and_image_url_become_null(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))

    response = auth_client.post(
        f"/lists/{row.id}/items", json={"text": "Sushi", "note": "   ", "image_url": "  "}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["note"] is None
    assert body["image_url"] is None


def test_create_item_404s_for_a_different_users_list(
    auth_client: TestClient, db_session: Session
) -> None:
    theirs = _list(db_session, _second_user(db_session))
    response = auth_client.post(f"/lists/{theirs.id}/items", json={"text": "Hijacked"})
    assert response.status_code == 404


def test_create_item_409s_when_the_list_already_has_50_items(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    for i in range(1, 51):
        _item(db_session, row, i, f"Item {i}")

    response = auth_client.post(f"/lists/{row.id}/items", json={"text": "One too many"})

    assert response.status_code == 409


def test_create_item_409s_on_case_insensitive_duplicate_text(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    _item(db_session, row, 1, "Sushi")

    response = auth_client.post(f"/lists/{row.id}/items", json={"text": "  SUSHI  "})

    assert response.status_code == 409


@pytest.mark.parametrize("text", ["", "   ", "x" * 501])
def test_create_item_rejects_invalid_text(
    auth_client: TestClient, db_session: Session, text: str
) -> None:
    row = _list(db_session, _dev_user(db_session))
    assert auth_client.post(f"/lists/{row.id}/items", json={"text": text}).status_code == 422


def test_create_item_rejects_a_note_over_the_limit(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    response = auth_client.post(
        f"/lists/{row.id}/items", json={"text": "Sushi", "note": "x" * 2001}
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "image_url", ["javascript:alert(1)", "ftp://example.com/x.jpg", "x" * 2049]
)
def test_create_item_rejects_an_invalid_image_url(
    auth_client: TestClient, db_session: Session, image_url: str
) -> None:
    row = _list(db_session, _dev_user(db_session))
    response = auth_client.post(
        f"/lists/{row.id}/items", json={"text": "Sushi", "image_url": image_url}
    )
    assert response.status_code == 422


# --- PATCH /lists/{list_id}/items/{item_id} -------------------------------------


def test_update_item_requires_authentication(client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session))
    item = _item(db_session, row, 1, "Sushi")
    response = client.patch(f"/lists/{row.id}/items/{item.id}", json={"text": "Ramen"})
    assert response.status_code == 401


def test_update_item_edits_text_note_and_image(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    item = _item(db_session, row, 1, "Sushi")

    response = auth_client.patch(
        f"/lists/{row.id}/items/{item.id}",
        json={"text": "Ramen", "note": "spicy", "image_url": "https://example.com/ramen.jpg"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["text"] == "Ramen"
    assert body["note"] == "spicy"
    assert body["image_url"] == "https://example.com/ramen.jpg"


def test_update_item_keeping_its_own_text_is_not_a_collision(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    item = _item(db_session, row, 1, "Sushi")

    response = auth_client.patch(
        f"/lists/{row.id}/items/{item.id}", json={"text": "Sushi", "note": "still great"}
    )

    assert response.status_code == 200


def test_update_item_409s_colliding_with_a_different_items_text(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    _item(db_session, row, 1, "Sushi")
    second = _item(db_session, row, 2, "Ramen")

    response = auth_client.patch(f"/lists/{row.id}/items/{second.id}", json={"text": "sushi"})

    assert response.status_code == 409


def test_update_item_404s_for_an_item_in_a_different_list(
    auth_client: TestClient, db_session: Session
) -> None:
    list_a = _list(db_session, _dev_user(db_session), "List A")
    list_b = _list(db_session, _dev_user(db_session), "List B")
    item = _item(db_session, list_a, 1, "Sushi")

    response = auth_client.patch(f"/lists/{list_b.id}/items/{item.id}", json={"text": "Hijacked"})

    assert response.status_code == 404


def test_update_item_404s_for_a_different_users_list(
    auth_client: TestClient, db_session: Session
) -> None:
    theirs = _list(db_session, _second_user(db_session))
    item = _item(db_session, theirs, 1, "Sushi")

    response = auth_client.patch(f"/lists/{theirs.id}/items/{item.id}", json={"text": "Hijacked"})

    assert response.status_code == 404


def test_update_item_404s_for_a_nonexistent_item(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    response = auth_client.patch(f"/lists/{row.id}/items/{uuid.uuid4()}", json={"text": "Ghost"})
    assert response.status_code == 404


@pytest.mark.parametrize("text", ["", "   ", "x" * 501])
def test_update_item_rejects_invalid_text(
    auth_client: TestClient, db_session: Session, text: str
) -> None:
    row = _list(db_session, _dev_user(db_session))
    item = _item(db_session, row, 1, "Sushi")
    assert (
        auth_client.patch(f"/lists/{row.id}/items/{item.id}", json={"text": text}).status_code
        == 422
    )


# --- DELETE /lists/{list_id}/items/{item_id} ------------------------------------


def test_delete_item_requires_authentication(client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session))
    item = _item(db_session, row, 1, "Sushi")
    assert client.delete(f"/lists/{row.id}/items/{item.id}").status_code == 401


def test_delete_item_removes_it_and_repacks_positions(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    first = _item(db_session, row, 1, "First")
    second = _item(db_session, row, 2, "Second")
    third = _item(db_session, row, 3, "Third")

    response = auth_client.delete(f"/lists/{row.id}/items/{second.id}")

    assert response.status_code == 204
    assert response.content == b""
    remaining = auth_client.get(f"/lists/{row.id}/items").json()
    assert [(item["text"], item["position"]) for item in remaining] == [
        (first.text, 1),
        (third.text, 2),
    ]


def test_delete_item_twice_404s_the_second_time(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    item = _item(db_session, row, 1, "Sushi")

    first = auth_client.delete(f"/lists/{row.id}/items/{item.id}")
    second = auth_client.delete(f"/lists/{row.id}/items/{item.id}")

    assert first.status_code == 204
    assert second.status_code == 404


def test_delete_item_404s_for_a_different_users_list(
    auth_client: TestClient, db_session: Session
) -> None:
    theirs = _list(db_session, _second_user(db_session))
    item = _item(db_session, theirs, 1, "Sushi")

    response = auth_client.delete(f"/lists/{theirs.id}/items/{item.id}")

    assert response.status_code == 404
    db_session.refresh(item)


# --- PATCH /lists/{list_id}/items/{item_id}/position ----------------------------


def test_reorder_item_requires_authentication(client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session))
    item = _item(db_session, row, 1, "Sushi")
    response = client.patch(f"/lists/{row.id}/items/{item.id}/position", json={"position": 1})
    assert response.status_code == 401


def test_reorder_item_moves_it_earlier_and_returns_full_order(
    auth_client: TestClient, db_session: Session
) -> None:
    row = _list(db_session, _dev_user(db_session))
    _item(db_session, row, 1, "First")
    _item(db_session, row, 2, "Second")
    third = _item(db_session, row, 3, "Third")

    response = auth_client.patch(f"/lists/{row.id}/items/{third.id}/position", json={"position": 1})

    assert response.status_code == 200
    body = response.json()
    assert [item["text"] for item in body] == ["Third", "First", "Second"]
    assert [item["position"] for item in body] == [1, 2, 3]


def test_reorder_item_moves_it_later(auth_client: TestClient, db_session: Session) -> None:
    row = _list(db_session, _dev_user(db_session))
    first = _item(db_session, row, 1, "First")
    _item(db_session, row, 2, "Second")
    _item(db_session, row, 3, "Third")

    response = auth_client.patch(f"/lists/{row.id}/items/{first.id}/position", json={"position": 3})

    assert response.status_code == 200
    assert [item["text"] for item in response.json()] == ["Second", "Third", "First"]


@pytest.mark.parametrize("position", [0, -1, 4])
def test_reorder_item_rejects_out_of_range_position(
    auth_client: TestClient, db_session: Session, position: int
) -> None:
    row = _list(db_session, _dev_user(db_session))
    first = _item(db_session, row, 1, "First")
    _item(db_session, row, 2, "Second")
    _item(db_session, row, 3, "Third")

    response = auth_client.patch(
        f"/lists/{row.id}/items/{first.id}/position", json={"position": position}
    )

    assert response.status_code == 422


def test_reorder_item_404s_for_an_item_in_a_different_list(
    auth_client: TestClient, db_session: Session
) -> None:
    list_a = _list(db_session, _dev_user(db_session), "List A")
    list_b = _list(db_session, _dev_user(db_session), "List B")
    item = _item(db_session, list_a, 1, "Sushi")
    _item(db_session, list_b, 1, "Other")

    response = auth_client.patch(
        f"/lists/{list_b.id}/items/{item.id}/position", json={"position": 1}
    )

    assert response.status_code == 404
