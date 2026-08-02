"""Lists routes — a signed-in user's own ranked lists."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.list import List
from app.models.user import User
from app.schemas.list import ListRead
from app.services import list_service

router = APIRouter(prefix="/lists", tags=["lists"])


@router.get("", response_model=list[ListRead])
def read_lists(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[List]:
    """Return the current user's non-deleted lists (401 if not logged in)."""
    return list_service.list_for_user(db, current_user.id)
