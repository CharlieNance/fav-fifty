"""Lists routes — a signed-in user's own ranked lists."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.list import List
from app.models.user import User
from app.schemas.list import ListCreate, ListRead, ListUpdate
from app.services import list_service

router = APIRouter(prefix="/lists", tags=["lists"])


def get_owned_list(
    list_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List:
    """Resolve `{list_id}` scoped to the caller, or 404.

    Shared by every single-list route (GET/PATCH/DELETE) so the ownership and
    soft-delete rules live in one place — see list_service.get_owned_list.
    """
    row = list_service.get_owned_list(db, list_id, current_user.id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    return row


@router.get("", response_model=list[ListRead])
def read_lists(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[List]:
    """Return the current user's non-deleted lists (401 if not logged in)."""
    return list_service.list_for_user(db, current_user.id)


@router.post("", response_model=ListRead, status_code=status.HTTP_201_CREATED)
def create_list(
    payload: ListCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List:
    """Create a new list owned by the current user (401 if not logged in)."""
    return list_service.create_list(db, current_user.id, payload.title)


@router.get("/{list_id}", response_model=ListRead)
def read_list(list_row: List = Depends(get_owned_list)) -> List:
    """Return one of the current user's lists (404 if missing, not theirs, or deleted)."""
    return list_row


@router.patch("/{list_id}", response_model=ListRead)
def update_list(
    payload: ListUpdate,
    list_row: List = Depends(get_owned_list),
    db: Session = Depends(get_db),
) -> List:
    """Rename one of the current user's lists (404 if missing, not theirs, or deleted)."""
    return list_service.rename_list(db, list_row, payload.title)
