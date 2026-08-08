"""Tests for the list item service — dedup/cap rules and the reorder/repack algorithm.

The reorder and delete paths are the ones worth exercising directly at the service
level: they issue several individually-ordered UPDATEs to avoid tripping the
``(list_id, position)`` unique constraint (see list_item_service.py), and a bug there
would surface as a DB IntegrityError, not just a wrong-looking response.
"""

import uuid

import pytest
from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.models.list import List
from app.models.list_item import ListItem
from app.models.user import User
from app.services import list_item_service, list_service, user_service


def _user(db_session: Session, sub: str) -> User:
    return user_service.get_or_create_user(
        db_session, Claims(sub=sub, email=f"{sub}@example.com", name=sub)
    )


def _list(db_session: Session, user: User, title: str = "My List") -> List:
    return list_service.create_list(db_session, user.id, title)


def _items(db_session: Session, list_row: List, count: int) -> list[ListItem]:
    """Create `count` items, in order, appended to the end of `list_row`."""
    return [
        list_item_service.create_item(db_session, list_row, f"Item {i}", None, None)
        for i in range(1, count + 1)
    ]


def _texts(rows: list[ListItem]) -> list[str]:
    return [row.text for row in rows]


def test_create_item_appends_at_the_end(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    first, second = _items(db_session, list_row, 2)

    assert first.position == 1
    assert second.position == 2


def test_create_item_rejects_the_51st_item(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    _items(db_session, list_row, 50)

    with pytest.raises(list_item_service.ListFullError):
        list_item_service.create_item(db_session, list_row, "One too many", None, None)


def test_create_item_rejects_case_insensitive_duplicate_text(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    list_item_service.create_item(db_session, list_row, "Sushi", None, None)

    with pytest.raises(list_item_service.DuplicateItemTextError):
        list_item_service.create_item(db_session, list_row, "sushi", None, None)


def test_update_item_allows_keeping_its_own_text(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    (item,) = _items(db_session, list_row, 1)

    updated = list_item_service.update_item(db_session, item, "Item 1", "a note", None)

    assert updated.note == "a note"


def test_update_item_rejects_colliding_with_a_different_items_text(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    first, second = _items(db_session, list_row, 2)

    with pytest.raises(list_item_service.DuplicateItemTextError):
        list_item_service.update_item(db_session, second, first.text, None, None)


def test_get_owned_item_is_none_for_an_item_in_a_different_list(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_a = _list(db_session, owner, "List A")
    list_b = _list(db_session, owner, "List B")
    (item,) = _items(db_session, list_a, 1)

    assert list_item_service.get_owned_item(db_session, list_b.id, item.id, owner.id) is None


def test_get_owned_item_is_none_for_a_different_owner(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    other = _user(db_session, "other")
    list_row = _list(db_session, owner)
    (item,) = _items(db_session, list_row, 1)

    assert list_item_service.get_owned_item(db_session, list_row.id, item.id, other.id) is None


def test_get_owned_item_is_none_for_a_nonexistent_id(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)

    assert list_item_service.get_owned_item(db_session, list_row.id, uuid.uuid4(), owner.id) is None


def test_delete_item_removes_it(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    (item,) = _items(db_session, list_row, 1)

    list_item_service.delete_item(db_session, item)

    assert list_item_service.list_items_for_list(db_session, list_row.id) == []


def test_delete_item_repacks_positions_contiguous(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    items = _items(db_session, list_row, 5)

    list_item_service.delete_item(db_session, items[1])  # remove "Item 2" (position 2)

    remaining = list_item_service.list_items_for_list(db_session, list_row.id)
    assert [row.position for row in remaining] == [1, 2, 3, 4]
    assert _texts(remaining) == ["Item 1", "Item 3", "Item 4", "Item 5"]


def test_delete_item_leaves_no_gap_when_deleting_the_last_item(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    items = _items(db_session, list_row, 3)

    list_item_service.delete_item(db_session, items[-1])

    remaining = list_item_service.list_items_for_list(db_session, list_row.id)
    assert [row.position for row in remaining] == [1, 2]


def test_reorder_item_moves_it_earlier(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    items = _items(db_session, list_row, 5)  # 1..5

    result = list_item_service.reorder_item(db_session, items[4], 2)  # "Item 5" -> position 2

    assert _texts(result) == ["Item 1", "Item 5", "Item 2", "Item 3", "Item 4"]
    assert [row.position for row in result] == [1, 2, 3, 4, 5]


def test_reorder_item_moves_it_later(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    items = _items(db_session, list_row, 5)

    result = list_item_service.reorder_item(db_session, items[0], 4)  # "Item 1" -> position 4

    assert _texts(result) == ["Item 2", "Item 3", "Item 4", "Item 1", "Item 5"]
    assert [row.position for row in result] == [1, 2, 3, 4, 5]


def test_reorder_item_to_its_own_position_is_a_no_op(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    items = _items(db_session, list_row, 3)

    result = list_item_service.reorder_item(db_session, items[1], 2)

    assert _texts(result) == ["Item 1", "Item 2", "Item 3"]


def test_reorder_item_to_the_first_position(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    items = _items(db_session, list_row, 4)

    result = list_item_service.reorder_item(db_session, items[3], 1)

    assert _texts(result) == ["Item 4", "Item 1", "Item 2", "Item 3"]


def test_reorder_item_to_the_last_position(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    items = _items(db_session, list_row, 4)

    result = list_item_service.reorder_item(db_session, items[0], 4)

    assert _texts(result) == ["Item 2", "Item 3", "Item 4", "Item 1"]


@pytest.mark.parametrize("position", [0, -1, 6])
def test_reorder_item_rejects_out_of_range_position(db_session: Session, position: int) -> None:
    owner = _user(db_session, "owner")
    list_row = _list(db_session, owner)
    items = _items(db_session, list_row, 5)

    with pytest.raises(list_item_service.InvalidPositionError):
        list_item_service.reorder_item(db_session, items[0], position)
