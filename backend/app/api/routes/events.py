"""``POST /api/v1/events`` — first-party analytics (docs/ARCHITECTURE.md
§Analytics).

Public: anonymous visitors' activity happens on their device, so this is the only
way the server hears of it. Clients batch events and send them every few seconds
and when the page is hidden. Always answers ``204``, whether the events were kept,
filtered out by the allowlist, or dropped because ``features.events_enabled`` is
off: a client has nothing to do differently either way.

Guards: a per-IP rate limit, a small body cap (app/main.py), at most 50 events a
batch, and the allowlist in app/services/analytics_service.py.
"""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_optional_user
from app.api.rate_limits import limit_events
from app.core.runtime_settings import RuntimeSettings, get_runtime_settings
from app.models.user import User
from app.schemas.events import EventBatch
from app.services import analytics_service

router = APIRouter(prefix="/events", tags=["events"], dependencies=[Depends(limit_events)])

# Small: 50 short events fit in well under this.
MAX_EVENTS_BODY_BYTES = 16 * 1024


@router.post("", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def record_events(
    batch: EventBatch,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
    runtime: RuntimeSettings = Depends(get_runtime_settings),
) -> Response:
    """Record a batch of product events. The user id comes from the session cookie."""
    if runtime.features.events_enabled:
        analytics_service.record_batch(db, batch, user.id if user else None, datetime.now(UTC))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
