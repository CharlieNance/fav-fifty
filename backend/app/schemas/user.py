"""User API schemas — the public shape of a user across the HTTP boundary.

Deliberately a subset of the ORM model: internal fields (``cognito_sub``,
``is_active``, ``session_token_version``) are never exposed.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserRead(BaseModel):
    """A user as returned by the API (e.g. ``GET /me``)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    display_name: str
    avatar_url: str | None
    created_at: datetime
    last_login_at: datetime | None
