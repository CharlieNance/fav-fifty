"""List API schemas — the public shape of a list across the HTTP boundary."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ListRead(BaseModel):
    """A list as returned by the API (e.g. ``GET /api/lists``)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    status: str
    created_at: datetime
    updated_at: datetime
