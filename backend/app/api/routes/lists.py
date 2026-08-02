"""Lists routes — a signed-in user's own ranked lists."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.list import List
from app.models.user import User
from app.schemas.list import ListCreate, ListRead
from app.services import list_service

router = APIRouter(prefix="/lists", tags=["lists"])


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
