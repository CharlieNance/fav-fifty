"""Authentication routes.

``/auth/dev-login`` is a **development-only** shortcut that stands in for the real
Google→Cognito flow: it mints a session for the fixed dev identity so the whole app
can be exercised locally and in tests before Cognito exists. In production the same
session-issuing tail (``get_or_create_user`` → ``issue_session`` → set cookie) will
be reached from the Cognito OAuth callback instead.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.auth.providers import get_identity_provider
from app.auth.session import clear_session_cookie, issue_session, set_session_cookie
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import UserRead
from app.services import user_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/dev-login", response_model=UserRead)
def dev_login(response: Response, db: Session = Depends(get_db)) -> User:
    """Log in as the fixed dev user and set the session cookie (development only)."""
    if not settings.is_development:
        # Unreachable outside dev: return 404 so the endpoint simply doesn't exist.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    provider = get_identity_provider()  # DevIdentityProvider also hard-fails outside dev
    claims = provider.get_claims()
    user = user_service.get_or_create_user(db, claims)
    set_session_cookie(response, issue_session(user))
    return user


@router.post("/logout")
def logout(response: Response) -> dict[str, str]:
    """Clear the session cookie."""
    clear_session_cookie(response)
    return {"status": "logged out"}
