"""Admin API schemas (responses only so far).

Nothing here, or anywhere in the API, accepts ``role`` as input: admin is granted
only by the CLI on the box (tests/test_admin_access.py enforces it).
"""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditLogEntryRead(BaseModel):
    """One admin audit-log row."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    admin_user_id: uuid.UUID | None
    action: str
    target_type: str
    target_id: str
    reason: str | None
    details: dict[str, Any]
    created_at: datetime
