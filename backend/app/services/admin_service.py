"""Admin actions on users and runtime settings (docs/ARCHITECTURE.md §Admin and analytics).

Every mutating function stages its audit row (``audit_service.record``) and commits
once, so the action and its audit row land together. Routes stay thin and map the
errors below to HTTP statuses.
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

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


# ─── Lists (content) ────────────────────────────────────────────────────────────
# Reading someone's lists is reading private content, so every read is audit-logged
# (docs/ARCHITECTURE.md §Content). Removal reuses the owner's soft
# delete, so it's reversible; restore only undoes an admin's removal, never the
# owner's own delete.

_MODERATION_ACTIONS = ("remove_list", "restore_list")


def _removed_by_admin(db: Session, lists: list[List]) -> set[uuid.UUID]:
    """The deleted lists among ``lists`` whose latest moderation action is a removal."""
    deleted = {str(row.id): row.id for row in lists if row.deleted_at is not None}
    if not deleted:
        return set()
    latest = (
        select(AdminAuditLog.target_id, AdminAuditLog.action)
        .where(
            AdminAuditLog.target_type == "list",
            AdminAuditLog.target_id.in_(deleted),
            AdminAuditLog.action.in_(_MODERATION_ACTIONS),
        )
        .order_by(AdminAuditLog.target_id, AdminAuditLog.created_at.desc())
        .distinct(AdminAuditLog.target_id)
    )
    return {deleted[target] for target, action in db.execute(latest) if action == "remove_list"}


def user_lists(db: Session, admin: User, user: User) -> list[tuple[List, bool]]:
    """All of ``user``'s lists, deleted included (newest first), audit-logged as a read.

    Each pair is the list and whether an admin removed it.
    """
    rows = list(
        db.scalars(
            select(List)
            .where(List.user_id == user.id)
            .options(selectinload(List.tags))
            .order_by(List.created_at.desc(), List.id)
        )
    )
    audit_service.record(
        db,
        admin_user_id=admin.id,
        action="read_lists",
        target_type="user",
        target_id=str(user.id),
        details={"count": len(rows)},
    )
    db.commit()
    removed = _removed_by_admin(db, rows)
    return [(row, row.id in removed) for row in rows]


def get_list(db: Session, list_id: uuid.UUID) -> List | None:
    """Any list by id, deleted or not, with its items and tags."""
    return db.scalar(
        select(List)
        .where(List.id == list_id)
        .options(selectinload(List.items), selectinload(List.tags), selectinload(List.owner))
    )


def record_list_read(db: Session, admin: User, row: List) -> None:
    audit_service.record(
        db,
        admin_user_id=admin.id,
        action="read_list",
        target_type="list",
        target_id=str(row.id),
        details={"owner_id": str(row.user_id)},
    )
    db.commit()


def list_detail(db: Session, row: List) -> dict[str, Any]:
    """The fields of ``AdminListDetail`` beyond the list row itself."""
    recent_actions = audit_service.list_entries(
        db, limit=RECENT_ACTIONS, target_type="list", target_id=str(row.id)
    )
    return {
        "removed_by_admin": row.id in _removed_by_admin(db, [row]),
        "recent_actions": recent_actions,
    }


def remove_list(db: Session, admin: User, row: List, reason: str) -> None:
    """Soft-delete someone's list for moderation. Reversible with ``restore_list``."""
    if row.deleted_at is not None:
        raise AdminActionError("This list is already deleted.")
    row.deleted_at = datetime.now(UTC)
    audit_service.record(
        db,
        admin_user_id=admin.id,
        action="remove_list",
        target_type="list",
        target_id=str(row.id),
        reason=reason,
        # The owner, not the title: the log shouldn't copy private content.
        details={"owner_id": str(row.user_id)},
    )
    db.commit()


def restore_list(db: Session, admin: User, row: List, reason: str | None) -> None:
    """Undo an admin's removal. A list its owner deleted stays deleted.

    Bypasses the owner's list quota: it puts back a list they already had.
    """
    if row.deleted_at is None:
        raise AdminActionError("This list isn't deleted.")
    if row.id not in _removed_by_admin(db, [row]):
        raise AdminActionError("Its owner deleted this list, so it can't be restored here.")
    row.deleted_at = None
    audit_service.record(
        db,
        admin_user_id=admin.id,
        action="restore_list",
        target_type="list",
        target_id=str(row.id),
        reason=reason,
        details={"owner_id": str(row.user_id)},
    )
    db.commit()
