"""Admin actions on users and runtime settings (docs/ADMIN_AND_ANALYTICS_PLAN.md).

Every mutating function stages its audit row (``audit_service.record``) and commits
once, so the action and its audit row land together. Routes stay thin and map the
errors below to HTTP statuses.
"""

import uuid
from collections.abc import Callable
from typing import Any

from pydantic import ValidationError
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.core.runtime_settings import (
    RuntimeSettingsProvider,
    parse_runtime_settings,
    setting_specs,
    setting_value,
    validate_setting,
)
from app.models.admin_audit_log import AdminAuditLog
from app.models.list import List
from app.models.list_item import ListItem
from app.models.user import User
from app.services import audit_service

RECENT_ACTIONS = 20


class AdminActionError(Exception):
    """The action doesn't make sense for this target (e.g. locking yourself) → 409."""


# ─── Users ──────────────────────────────────────────────────────────────────────


def _live_list_count() -> Any:
    return (
        select(func.count(List.id))
        .where(List.user_id == User.id, List.deleted_at.is_(None))
        .correlate(User)
        .scalar_subquery()
    )


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def search_users(
    db: Session, *, query: str | None, limit: int, offset: int
) -> list[tuple[User, int]]:
    """Users whose display name or email contains ``query`` (newest first), with
    their live list counts. No query = the newest users."""
    statement: Select[tuple[User, int]] = select(User, _live_list_count())
    if query:
        pattern = f"%{_escape_like(query)}%"
        statement = statement.where(
            or_(
                User.display_name.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
            )
        )
    statement = statement.order_by(User.created_at.desc(), User.id).limit(limit).offset(offset)
    return [(user, count) for user, count in db.execute(statement).all()]


def user_detail(db: Session, user: User) -> dict[str, Any]:
    """The fields of ``AdminUserDetail`` beyond the user row itself."""
    list_count = db.scalar(
        select(func.count(List.id)).where(List.user_id == user.id, List.deleted_at.is_(None))
    )
    item_count = db.scalar(
        select(func.count(ListItem.id))
        .join(List, ListItem.list_id == List.id)
        .where(List.user_id == user.id, List.deleted_at.is_(None))
    )
    recent_actions = audit_service.list_entries(
        db, limit=RECENT_ACTIONS, target_type="user", target_id=str(user.id)
    )
    return {
        "list_count": list_count or 0,
        "item_count": item_count or 0,
        "recent_actions": recent_actions,
    }


def _record_user_action(
    db: Session, admin: User, user: User, action: str, reason: str | None
) -> None:
    audit_service.record(
        db,
        admin_user_id=admin.id,
        action=action,
        target_type="user",
        target_id=str(user.id),
        reason=reason,
    )


def lock_user(db: Session, admin: User, user: User, reason: str | None) -> None:
    """Lock the account and end its sessions. Locking an already-locked user is a no-op.

    Ending the sessions too means unlocking later doesn't revive a cookie that may
    have been the reason for the lock.
    """
    if user.id == admin.id:
        raise AdminActionError("You can't lock your own account.")
    if not user.is_active:
        return
    user.is_active = False
    user.session_token_version += 1
    _record_user_action(db, admin, user, "lock_user", reason)
    db.commit()


def unlock_user(db: Session, admin: User, user: User, reason: str | None) -> None:
    if user.is_active:
        return
    user.is_active = True
    _record_user_action(db, admin, user, "unlock_user", reason)
    db.commit()


def revoke_sessions(db: Session, admin: User, user: User, reason: str | None) -> None:
    """Sign the user out everywhere; they can sign straight back in."""
    user.session_token_version += 1
    _record_user_action(db, admin, user, "revoke_sessions", reason)
    db.commit()


# ─── Runtime settings ───────────────────────────────────────────────────────────


def _last_changes(db: Session) -> dict[str, AdminAuditLog]:
    """The newest audit row per setting key."""
    statement = (
        select(AdminAuditLog)
        .where(AdminAuditLog.target_type == "setting")
        .order_by(AdminAuditLog.target_id, AdminAuditLog.created_at.desc())
        .distinct(AdminAuditLog.target_id)
    )
    return {entry.target_id: entry for entry in db.scalars(statement)}


def list_settings(db: Session, provider: RuntimeSettingsProvider) -> list[dict[str, Any]]:
    """Every setting with its default, bounds, stored override and effective value.

    Reads the source fresh, not through the cache, so the page shows what's stored
    right now. Raises whatever the source raises if it's unreachable.
    """
    raw = provider.raw()
    effective = parse_runtime_settings(raw)
    changes = _last_changes(db)
    rows = []
    for key, spec in setting_specs().items():
        override = raw.get(key)
        value = setting_value(effective, key)
        rows.append(
            {
                "key": key,
                "kind": spec.kind,
                "description": spec.description,
                "default": spec.default,
                "minimum": spec.minimum,
                "maximum": spec.maximum,
                "value": value,
                "override": override,
                # A stored value the app rejected, so it's running on the default.
                "override_invalid": override is not None and _invalid(key, override),
                "last_change": changes.get(key),
            }
        )
    return rows


def _invalid(key: str, override: str) -> bool:
    """Would the app reject this stored text? (Same lax parsing as the source read.)"""
    try:
        setting_specs()[key].adapter.validate_python(override)
    except ValidationError:
        return True
    return False


def update_setting(
    db: Session,
    provider: RuntimeSettingsProvider,
    admin: User,
    key: str,
    value: int | bool,
    reason: str | None,
) -> None:
    """Validate and store one setting. ``KeyError``/``ValueError`` on a bad key/value."""
    stored = validate_setting(key, value)
    previous = provider.raw().get(key)
    audit_service.record(
        db,
        admin_user_id=admin.id,
        action="update_setting",
        target_type="setting",
        target_id=key,
        reason=reason,
        details={"from": previous, "to": stored},
    )
    db.flush()  # A bad audit row fails here, before the source is touched.
    _store_then_commit(db, lambda: provider.write(key, stored))


def reset_setting(
    db: Session, provider: RuntimeSettingsProvider, admin: User, key: str, reason: str | None
) -> None:
    """Remove the stored override, so the setting is back on its code default."""
    if key not in setting_specs():
        raise KeyError(key)
    previous = provider.raw().get(key)
    if previous is None:
        return
    audit_service.record(
        db,
        admin_user_id=admin.id,
        action="reset_setting",
        target_type="setting",
        target_id=key,
        reason=reason,
        details={"from": previous, "to": None},
    )
    db.flush()
    _store_then_commit(db, lambda: provider.delete(key))


def _store_then_commit(db: Session, change: Callable[[], None]) -> None:
    """Apply a settings-store change, then commit its staged audit row.

    If the store refuses, the audit row is rolled back with it: no record of a
    change that never happened.
    """
    try:
        change()
    except Exception:
        db.rollback()
        raise
    db.commit()


def get_user(db: Session, user_id: uuid.UUID) -> User | None:
    return db.get(User, user_id)
