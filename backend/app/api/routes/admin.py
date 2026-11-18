"""Admin routes: owner-only tools (docs/ADMIN_AND_ANALYTICS_PLAN.md).

``require_admin`` sits on the router itself, so a route added here can't forget it;
tests/test_admin_access.py walks every ``/admin`` route to make sure.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.models.admin_audit_log import AdminAuditLog
from app.schemas.admin import AuditLogEntryRead
from app.services import audit_service

MAX_AUDIT_PAGE = 100

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/audit-log", response_model=list[AuditLogEntryRead])
def read_audit_log(
    db: Session = Depends(get_db),
    action: str | None = Query(default=None, max_length=64),
    target_type: str | None = Query(default=None, max_length=32),
    target_id: str | None = Query(default=None, max_length=255),
    before: datetime | None = Query(
        default=None, description="Only entries older than this (to page back)."
    ),
    limit: int = Query(default=50, ge=1, le=MAX_AUDIT_PAGE),
) -> list[AdminAuditLog]:
    """The audit log, newest first, optionally filtered by action or target."""
    return audit_service.list_entries(
        db,
        limit=limit,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before=before,
    )
