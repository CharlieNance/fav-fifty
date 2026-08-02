"""List API schemas — the public shape of a list across the HTTP boundary."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class ListRead(BaseModel):
    """A list as returned by the API (e.g. ``GET /api/lists``)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: str
    created_at: datetime
    updated_at: datetime


class ListCreate(BaseModel):
    """Body for ``POST /api/lists`` — the only user-settable field is the title.

    ``user_id`` is never part of this schema: the owner always comes from the
    session (``current_user.id``), never the request body.
    """

    title: str

    @field_validator("title")
    @classmethod
    def _title_trimmed_and_non_empty(cls, value: str) -> str:
        trimmed = value.strip()
        if not trimmed:
            raise ValueError("Title is required.")
        if len(trimmed) > 200:
            raise ValueError("Title must be 200 characters or fewer.")
        return trimmed
