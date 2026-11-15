"""``POST /api/v1/lists/import`` schemas — uploading on-device lists to an account.

The body is the on-device document (frontend ``localListDocument.ts``) without
``schema_version`` and ``claimed_at``, so the client sends it with no mapping
(docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md §Claim on sign-in).

These schemas check **structure only**. The content rules (title, tags, item
fields, the item cap, duplicate items) run in ``list_import_service``, so a
rejection is one readable sentence naming the list, not a Pydantic error list.

Unknown fields are ignored, so a newer client document (e.g. Track 2's ``kind``)
doesn't fail here before the server learns the field.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.limits import MAX_LOCAL_ID_LENGTH
from app.schemas.list import ListRead


class ImportedItem(BaseModel):
    """One item, in rank order. Its ``local_id`` is ignored: items get server ids."""

    model_config = ConfigDict(extra="ignore")

    text: str
    note: str | None = None
    image_url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ImportedList(BaseModel):
    model_config = ConfigDict(extra="ignore")

    local_id: str = Field(min_length=1, max_length=MAX_LOCAL_ID_LENGTH)
    title: str
    tags: list[str] = []
    created_at: datetime | None = None
    updated_at: datetime | None = None
    items: list[ImportedItem] = []


class ListsImport(BaseModel):
    """Body for ``POST /api/lists/import``. The owner is always the caller."""

    model_config = ConfigDict(extra="ignore")

    # No ``:`` in the device id, so ``"<device_id>:<local_id>"`` (the idempotency
    # key) splits one way only and two different lists can't share a key.
    device_id: str = Field(min_length=1, max_length=MAX_LOCAL_ID_LENGTH, pattern=r"^[^:]+$")
    lists: list[ImportedList] = Field(min_length=1)


class ImportedListRead(BaseModel):
    """What became of one uploaded list, in the order they were sent."""

    local_id: str
    # ``created``: made by this request. ``already_imported``: an earlier request
    # (e.g. one whose response was lost) already made it, and nothing was changed.
    outcome: Literal["created", "already_imported"]
    # The list in the account. ``None`` only if it was already imported and has
    # since been deleted.
    list: ListRead | None
    # The title the upload asked for, if it clashed with one of the account's
    # lists and was renamed ("Top Albums" → "Top Albums (2)"). Always ``None``
    # for ``already_imported``.
    renamed_from: str | None


class ListsImportResult(BaseModel):
    lists: list[ImportedListRead]
