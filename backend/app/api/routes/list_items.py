"""List items routes — CRUD and reorder for the ranked items within one of the
current user's own lists."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.list import List
from app.models.list_item import ListItem
from app.models.user import User
from app.schemas.list_item import ItemCreate, ItemRead, ItemReorder, ItemUpdate
from app.services import list_item_service, list_service

router = APIRouter(prefix="/lists/{list_id}/items", tags=["list_items"])


def _get_owned_list(
    list_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List:
    """Resolve the parent `{list_id}` scoped to the caller, or 404.

    Shared by every route in this router — see list_service.get_owned_list.
    """
    row = list_service.get_owned_list(db, list_id, current_user.id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return row


def _get_owned_item(
    list_id: uuid.UUID,
    item_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ListItem:
    """Resolve `{item_id}` scoped to the caller's `{list_id}`, or 404.

    Shared by every single-item route (PATCH/DELETE/reorder). Deliberately does
    NOT depend on `_get_owned_list`: `list_item_service.get_owned_item` already
    performs the full ownership check itself (wrong owner, soft-deleted list,
    item in a different list — all None → 404), so the dependency would just
    run the same list-ownership query a second time.
    """
    row = list_item_service.get_owned_item(db, list_id, item_id, current_user.id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return row


@router.get("", response_model=list[ItemRead])
def read_items(
    list_row: List = Depends(_get_owned_list), db: Session = Depends(get_db)
) -> list[ListItem]:
    """Return one of the current user's lists' items, in rank order."""
    return list_item_service.list_items_for_list(db, list_row.id)


@router.post("", response_model=ItemRead, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: ItemCreate,
    list_row: List = Depends(_get_owned_list),
    db: Session = Depends(get_db),
) -> ListItem:
    """Append a new item to the end of one of the current user's lists.

    409 if the list is already at the 50-item cap, or another item in this list
    already has this text (case-insensitive).
    """
    try:
        return list_item_service.create_item(
            db, list_row, payload.text, payload.note, payload.image_url
        )
    except list_item_service.ListFullError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This list already has 50 items."
        ) from None
    except list_item_service.DuplicateItemTextError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An item with this text already exists in this list.",
        ) from None


@router.patch("/{item_id}", response_model=ItemRead)
def update_item(
    payload: ItemUpdate,
    item_row: ListItem = Depends(_get_owned_item),
    db: Session = Depends(get_db),
) -> ListItem:
    """Edit an item's text/note/image (404 if missing, not theirs, or in a different list).

    409 if another item in this list already has this text (case-insensitive).
    """
    try:
        return list_item_service.update_item(
            db, item_row, payload.text, payload.note, payload.image_url
        )
    except list_item_service.DuplicateItemTextError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An item with this text already exists in this list.",
        ) from None


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_row: ListItem = Depends(_get_owned_item), db: Session = Depends(get_db)
) -> None:
    """Delete an item and repack the remaining ranks.

    404 if missing, not theirs, or in a different list.
    """
    list_item_service.delete_item(db, item_row)


@router.patch("/{item_id}/position", response_model=list[ItemRead])
def reorder_item(
    payload: ItemReorder,
    item_row: ListItem = Depends(_get_owned_item),
    db: Session = Depends(get_db),
) -> list[ListItem]:
    """Move an item to a new 1-based rank, shifting the rest; returns the full new order.

    422 if the position isn't within the list's current item range.
    """
    try:
        return list_item_service.reorder_item(db, item_row, payload.position)
    except list_item_service.InvalidPositionError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Position is out of range for this list.",
        ) from None
