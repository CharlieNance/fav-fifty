"""List item API schemas — the public shape of a ranked item across the HTTP boundary."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class ItemRead(BaseModel):
    """An item as returned by the API (e.g. ``GET /api/lists/{list_id}/items``)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    list_id: uuid.UUID
    position: int
    text: str
    note: str | None
    image_url: str | None
    created_at: datetime
    updated_at: datetime


def _validated_text(value: str) -> str:
    """Trim and enforce the same length limit as the ``list_items.text`` column."""
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("Text is required.")
    if len(trimmed) > 500:
        raise ValueError("Text must be 500 characters or fewer.")
    return trimmed


def _validated_note(value: str | None) -> str | None:
    """Trim; blank becomes ``None``; cap length at a sane application-level limit.

    The column itself (``Text``) is unbounded — this cap just keeps notes reasonable.
    """
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    if len(trimmed) > 2000:
        raise ValueError("Note must be 2000 characters or fewer.")
    return trimmed


def _validated_image_url(value: str | None) -> str | None:
    """Trim; blank becomes ``None``; else require an http(s) URL, matching the column cap.

    Restricting to ``http(s)://`` keeps a ``javascript:``/``data:`` URL from ever
    reaching an ``<img src>`` on the frontend.
    """
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
        raise ValueError("Image URL must start with http:// or https://.")
    if len(trimmed) > 2048:
        raise ValueError("Image URL must be 2048 characters or fewer.")
    return trimmed


class ItemCreate(BaseModel):
    """Body for ``POST /api/lists/{list_id}/items``.

    ``position`` is never part of this schema: a new item always lands at the end of
    the list — the position is computed server-side in the service layer.
    """

    text: str
    note: str | None = None
    image_url: str | None = None

    @field_validator("text")
    @classmethod
    def _text_trimmed_and_non_empty(cls, value: str) -> str:
        return _validated_text(value)

    @field_validator("note")
    @classmethod
    def _note_trimmed(cls, value: str | None) -> str | None:
        return _validated_note(value)

    @field_validator("image_url")
    @classmethod
    def _image_url_trimmed(cls, value: str | None) -> str | None:
        return _validated_image_url(value)


class ItemUpdate(BaseModel):
    """Body for ``PATCH /api/lists/{list_id}/items/{item_id}``.

    Full-replace, like ``ListUpdate`` — all three fields are sent together from one
    edit form, not a partial/merge patch. ``position`` isn't settable here; use the
    dedicated reorder endpoint (``ItemReorder``) instead.
    """

    text: str
    note: str | None = None
    image_url: str | None = None

    @field_validator("text")
    @classmethod
    def _text_trimmed_and_non_empty(cls, value: str) -> str:
        return _validated_text(value)

    @field_validator("note")
    @classmethod
    def _note_trimmed(cls, value: str | None) -> str | None:
        return _validated_note(value)

    @field_validator("image_url")
    @classmethod
    def _image_url_trimmed(cls, value: str | None) -> str | None:
        return _validated_image_url(value)


class ItemReorder(BaseModel):
    """Body for ``PATCH /api/lists/{list_id}/items/{item_id}/position``.

    ``position`` is a 1-based rank; whether it's actually in range for the list
    depends on how many items exist, which this schema can't see — that check
    happens in ``list_item_service.reorder_item``.
    """

    position: int
