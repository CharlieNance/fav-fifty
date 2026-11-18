"""Admin audit log: write one row per admin action, and read them back.

``record`` only adds the row to the session; it never commits. The caller commits it
together with the action itself, so an action and its audit row land (or roll back)
as one (docs/ADMIN_AND_ANALYTICS_PLAN.md §Audit log). There's deliberately no
update or delete here: the log is append-only.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin_audit_log import AdminAuditLog


def record(
    db: Session,
    *,
    admin_user_id: uuid.UUID | None,
    action: str,
    target_type: str,
    target_id: str,
    reason: str | None = None,
    details: dict[str, Any] | None = None,
) -> AdminAuditLog:
    """Stage an audit row in ``db``'s current transaction (the caller commits)."""
    entry = AdminAuditLog(
        admin_user_id=admin_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        reason=reason,
        details=details or {},
    )
    db.add(entry)
    return entry


def list_entries(
    db: Session,
    *,
    limit: int,
    action: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    before: datetime | None = None,
) -> list[AdminAuditLog]:
    """Newest first, optionally filtered. ``before`` pages back through older rows."""
    query = select(AdminAuditLog)
    if action is not None:
        query = query.where(AdminAuditLog.action == action)
    if target_type is not None:
        query = query.where(AdminAuditLog.target_type == target_type)
    if target_id is not None:
        query = query.where(AdminAuditLog.target_id == target_id)
    if before is not None:
        query = query.where(AdminAuditLog.created_at < before)
    query = query.order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc()).limit(limit)
    return list(db.scalars(query))
