"""Request body for ``POST /api/v1/events`` (docs/ADMIN_AND_ANALYTICS_PLAN.md §Analytics B).

The *shape* is checked strictly here (a malformed batch is a 422). The *content*
is filtered leniently in app/services/analytics_service.py: an event name or a
property the server doesn't know is dropped, not rejected, so a newer client can
add one without its whole batch failing against an older server.

Additive changes only (v1 contract: old mobile apps can't be force-updated).
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

MAX_EVENTS_PER_BATCH = 50
MAX_PROPS_PER_EVENT = 8

ShortText = Annotated[str, StringConstraints(max_length=40)]


class EventIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: ShortText
    # The client's clock. Missing or implausible → the time the batch arrived.
    at: datetime | None = None
    props: dict[ShortText, ShortText] = Field(default_factory=dict, max_length=MAX_PROPS_PER_EVENT)


class EventBatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # A random id the client keeps per browser tab session (web) or app launch.
    session_id: uuid.UUID
    platform: Literal["web", "ios", "android"]
    app_version: Annotated[str, StringConstraints(pattern=r"^[0-9A-Za-z.+_-]{1,32}$")]
    events: list[EventIn] = Field(max_length=MAX_EVENTS_PER_BATCH)
