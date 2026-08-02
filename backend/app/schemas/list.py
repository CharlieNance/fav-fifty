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


def _validated_title(value: str) -> str:
    """Trim and enforce the same length limit as the ``lists.title`` column.

    Shared by ``ListCreate`` and ``ListUpdate`` so create and rename can never
    silently drift apart on what counts as a valid title.
    """
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("Title is required.")
    if len(trimmed) > 200:
        raise ValueError("Title must be 200 characters or fewer.")
    return trimmed


class ListCreate(BaseModel):
    """Body for ``POST /api/lists`` — the only user-settable field is the title.

    ``user_id`` is never part of this schema: the owner always comes from the
    session (``current_user.id``), never the request body.
    """

    title: str

    @field_validator("title")
    @classmethod
    def _title_trimmed_and_non_empty(cls, value: str) -> str:
        return _validated_title(value)


class ListUpdate(BaseModel):
    """Body for ``PATCH /api/lists/{list_id}`` — rename only, same rules as create."""

    title: str

    @field_validator("title")
    @classmethod
    def _title_trimmed_and_non_empty(cls, value: str) -> str:
        return _validated_title(value)
