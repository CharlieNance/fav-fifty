"""Admin routes: owner-only tools (docs/ARCHITECTURE.md §Admin and analytics).

``require_admin`` sits on the router itself, so a route added here can't forget it;
tests/test_admin_access.py walks every ``/admin`` route to make sure. Every route
also gets the admin rate limit and ``Cache-Control: no-store``.
"""

import logging
import time
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_admin
from app.api.rate_limits import limit_admin
from app.core.client_ip import client_ip
from app.core.config import settings
from app.core.ip_blocklist import (
    BlockList,
    BlockListError,
    BlockListNotConfiguredError,
    get_ip_blocklist,
)
from app.core.runtime_settings import (
    RuntimeSettings,
    RuntimeSettingsProvider,
    SettingNotWritableError,
    get_runtime_settings,
    get_runtime_settings_provider,
)
from app.models.list import List
from app.models.user import User
from app.schemas.admin import (
    AbuseOverview,
    AdminAction,
    AdminListDetail,
    AdminListSummary,
    AdminReasonRequired,
    AdminUserDetail,
    AdminUserSummary,
    AuditLogEntryRead,
    BlockIpRequest,
    BlockListRead,
    Dashboard,
    SettingRead,
    SettingUpdate,
    UnblockIpRequest,
)
from app.schemas.list import ListRead
from app.schemas.list_item import ItemRead
from app.services import abuse_service, admin_service, audit_service, dashboard_service

logger = logging.getLogger(__name__)

MAX_AUDIT_PAGE = 100
MAX_USER_PAGE = 50


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin), Depends(limit_admin), Depends(_no_store)],
)


# ─── Dashboard ──────────────────────────────────────────────────────────────────

DASHBOARD_CACHE_SECONDS = 300


@router.get("/dashboard", response_model=Dashboard)
def read_dashboard(
    request: Request,
    db: Session = Depends(get_db),
    refresh: bool = Query(default=False, description="Skip the few-minute cache."),
    runtime: RuntimeSettings = Depends(get_runtime_settings),
) -> Any:
    """Product, analytics, health and cost numbers. Aggregates only; cached ~5 minutes."""
    cached = request.app.state.dashboard_cache
    if cached is not None and not refresh and cached[0] > time.monotonic():
        return cached[1]
    data = Dashboard.model_validate(
        dashboard_service.dashboard(
            db,
            datetime.now(UTC),
            settings.cloudwatch_dashboard_url,
            runtime.features.events_enabled,
        )
    )
    request.app.state.dashboard_cache = (time.monotonic() + DASHBOARD_CACHE_SECONDS, data)
    return data


# ─── Audit log ──────────────────────────────────────────────────────────────────


@router.get("/audit-log", response_model=list[AuditLogEntryRead])
def read_audit_log(
    db: Session = Depends(get_db),
    action: str | None = Query(default=None, max_length=64),
    target_type: str | None = Query(default=None, max_length=32),
    target_id: str | None = Query(default=None, max_length=255),
    subject_user_id: uuid.UUID | None = Query(
        default=None, description="Everything about one user: their account and their lists."
    ),
    before: datetime | None = Query(
        default=None, description="Only entries older than this (to page back)."
    ),
    limit: int = Query(default=50, ge=1, le=MAX_AUDIT_PAGE),
) -> list[AuditLogEntryRead]:
    """The audit log, newest first, filterable by action, target or subject user.

    Each entry carries the acting admin's and the subject user's display names. List
    titles are left out on purpose: the log names a list's owner, not its content.
    """
    entries = audit_service.list_entries(
        db,
        limit=limit,
        action=action,
        target_type=target_type,
        target_id=target_id,
        subject_user_id=subject_user_id,
        before=before,
    )
    names = audit_service.display_names(db, entries)
    rows = []
    for entry in entries:
        subject = audit_service.subject_user_id(entry)
        row = AuditLogEntryRead.model_validate(entry)
        row.admin_display_name = names.get(entry.admin_user_id) if entry.admin_user_id else None
        row.subject_user_id = subject
        row.subject_display_name = names.get(subject) if subject else None
        rows.append(row)
    return rows


# ─── Users ──────────────────────────────────────────────────────────────────────


def _target_user(user_id: uuid.UUID, db: Session = Depends(get_db)) -> User:
    user = admin_service.get_user(db, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _detail(db: Session, user: User) -> AdminUserDetail:
    extra = admin_service.user_detail(db, user)
    return AdminUserDetail(
        **_summary(user, extra["list_count"]).model_dump(),
        item_count=extra["item_count"],
        recent_actions=[AuditLogEntryRead.model_validate(e) for e in extra["recent_actions"]],
    )


@router.get("/users", response_model=list[AdminUserSummary])
def search_users(
    db: Session = Depends(get_db),
    q: str | None = Query(default=None, max_length=100, description="Name or email contains."),
    limit: int = Query(default=25, ge=1, le=MAX_USER_PAGE),
    offset: int = Query(default=0, ge=0, le=10_000),
) -> list[AdminUserSummary]:
    """Users, newest first; ``q`` filters by display name or email."""
    rows = admin_service.search_users(
        db, query=(q or "").strip() or None, limit=limit, offset=offset
    )
    return [_summary(user, count) for user, count in rows]


def _summary(user: User, list_count: int) -> AdminUserSummary:
    return AdminUserSummary(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        avatar_url=user.avatar_url,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        list_count=list_count,
    )


@router.get("/users/{user_id}", response_model=AdminUserDetail)
def read_user(user: User = Depends(_target_user), db: Session = Depends(get_db)) -> Any:
    return _detail(db, user)


def _act(action: Any, db: Session, admin: User, user: User, body: AdminAction) -> AdminUserDetail:
    try:
        action(db, admin, user, body.reason)
    except admin_service.AdminActionError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from None
    return _detail(db, user)


@router.post("/users/{user_id}/lock", response_model=AdminUserDetail)
def lock_user(
    body: AdminAction,
    user: User = Depends(_target_user),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Any:
    """Lock the account and sign it out everywhere. Effective on its next request."""
    return _act(admin_service.lock_user, db, admin, user, body)


@router.post("/users/{user_id}/unlock", response_model=AdminUserDetail)
def unlock_user(
    body: AdminAction,
    user: User = Depends(_target_user),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Any:
    return _act(admin_service.unlock_user, db, admin, user, body)


@router.post("/users/{user_id}/revoke-sessions", response_model=AdminUserDetail)
def revoke_sessions(
    body: AdminAction,
    user: User = Depends(_target_user),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Any:
    """Sign the user out on every device (they can sign back in)."""
    return _act(admin_service.revoke_sessions, db, admin, user, body)


# ─── Lists (content; every read is audit-logged) ──────────────────────────────


def _list_summary(row: List, removed_by_admin: bool) -> AdminListSummary:
    return AdminListSummary.model_validate(
        {
            **ListRead.model_validate(row).model_dump(),
            "deleted_at": row.deleted_at,
            "removed_by_admin": removed_by_admin,
        }
    )


@router.get("/users/{user_id}/lists", response_model=list[AdminListSummary])
def read_user_lists(
    user: User = Depends(_target_user),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Any:
    """Every list the user has, deleted ones included. Audit-logged as a read."""
    return [
        _list_summary(row, removed) for row, removed in admin_service.user_lists(db, admin, user)
    ]


def _target_list(list_id: uuid.UUID, db: Session = Depends(get_db)) -> List:
    row = admin_service.get_list(db, list_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="List not found")
    return row


def _list_detail(db: Session, row: List) -> AdminListDetail:
    extra = admin_service.list_detail(db, row)
    return AdminListDetail(
        **_list_summary(row, extra["removed_by_admin"]).model_dump(),
        user_id=row.user_id,
        owner_display_name=row.owner.display_name,
        items=[ItemRead.model_validate(item) for item in row.items],
        recent_actions=[AuditLogEntryRead.model_validate(e) for e in extra["recent_actions"]],
    )


@router.get("/lists/{list_id}", response_model=AdminListDetail)
def read_list(
    row: List = Depends(_target_list),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Any:
    """One list with its items, deleted or not. Audit-logged as a read."""
    admin_service.record_list_read(db, admin, row)
    return _list_detail(db, row)


def _act_on_list(action: Any, db: Session, admin: User, row: List, reason: str | None) -> Any:
    try:
        action(db, admin, row, reason)
    except admin_service.AdminActionError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from None
    return _list_detail(db, row)


@router.post("/lists/{list_id}/remove", response_model=AdminListDetail)
def remove_list(
    body: AdminReasonRequired,
    row: List = Depends(_target_list),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Any:
    """Remove a list for moderation (soft delete, so reversible). Needs a reason."""
    return _act_on_list(admin_service.remove_list, db, admin, row, body.reason)


@router.post("/lists/{list_id}/restore", response_model=AdminListDetail)
def restore_list(
    body: AdminAction,
    row: List = Depends(_target_list),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Any:
    """Undo an admin's removal. A list its owner deleted can't be restored here."""
    return _act_on_list(admin_service.restore_list, db, admin, row, body.reason)


# ─── Runtime settings ───────────────────────────────────────────────────────────

SETTINGS_UNREACHABLE = "Couldn't read the settings store. Try again in a moment."


def _settings(db: Session, provider: RuntimeSettingsProvider) -> list[dict[str, Any]]:
    try:
        return admin_service.list_settings(db, provider)
    except Exception:
        logger.exception("Could not read runtime settings for the admin page")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=SETTINGS_UNREACHABLE
        ) from None


def _one_setting(db: Session, provider: RuntimeSettingsProvider, key: str) -> dict[str, Any]:
    return next(row for row in _settings(db, provider) if row["key"] == key)


SettingKey = Path(max_length=128, pattern=r"^[a-z0-9_.]+$")


@router.get("/settings", response_model=list[SettingRead])
def read_settings(
    db: Session = Depends(get_db),
    provider: RuntimeSettingsProvider = Depends(get_runtime_settings_provider),
) -> Any:
    """Every runtime setting, its default and bounds, and its current value."""
    return _settings(db, provider)


@router.put("/settings/{key}", response_model=SettingRead)
def update_setting(
    body: SettingUpdate,
    key: str = SettingKey,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    provider: RuntimeSettingsProvider = Depends(get_runtime_settings_provider),
) -> Any:
    """Store a new value. Applies here at once and on other instances within ~30 s."""
    try:
        admin_service.update_setting(db, provider, admin, key, body.value, body.reason)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown setting") from None
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    except SettingNotWritableError as error:
        raise HTTPException(status_code=409, detail=f"Can't change it here: {error}") from None
    return _one_setting(db, provider, key)


@router.post("/settings/{key}/reset", response_model=SettingRead)
def reset_setting(
    body: AdminAction,
    key: str = SettingKey,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    provider: RuntimeSettingsProvider = Depends(get_runtime_settings_provider),
) -> Any:
    """Remove the stored value, so the setting is back on its code default."""
    try:
        admin_service.reset_setting(db, provider, admin, key, body.reason)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown setting") from None
    except SettingNotWritableError as error:
        raise HTTPException(status_code=409, detail=f"Can't change it here: {error}") from None
    return _one_setting(db, provider, key)


# ─── Abuse view ─────────────────────────────────────────────────────────────────

MAX_ABUSE_WINDOW_HOURS = abuse_service.IP_RETENTION_DAYS * 24


@contextmanager
def _blocklist_errors() -> Generator[None]:
    """Map block-list failures to responses: a bad address 422, a refused block 409,
    no WAF configured 503, AWS refusing 502."""
    try:
        yield
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from None
    except abuse_service.BlockRefusedError as error:
        raise HTTPException(status_code=409, detail=str(error)) from None
    except abuse_service.NotBlockedError:
        raise HTTPException(status_code=404, detail="That address isn't blocked.") from None
    except BlockListNotConfiguredError as error:
        raise HTTPException(status_code=503, detail=str(error)) from None
    except BlockListError as error:
        raise HTTPException(status_code=502, detail=str(error)) from None


def _block_list(db: Session, blocklist: BlockList) -> dict[str, Any]:
    with _blocklist_errors():
        entries = abuse_service.blocked_entries(db, blocklist)
    return {"source": blocklist.source, "enforced": blocklist.source == "waf", "entries": entries}


@router.get("/abuse", response_model=AbuseOverview)
def read_abuse(
    request: Request,
    db: Session = Depends(get_db),
    blocklist: BlockList = Depends(get_ip_blocklist),
    hours: int = Query(default=24, ge=1, le=MAX_ABUSE_WINDOW_HOURS),
) -> Any:
    """429s by route class and the busiest client IPs over the last ``hours``."""
    try:
        blocked = blocklist.entries()
    except BlockListError:
        blocked = []  # The numbers are still worth showing without the "blocked" marks.
    return abuse_service.overview(db, datetime.now(UTC), hours, blocked, client_ip(request))


@router.get("/blocked-ips", response_model=BlockListRead)
def read_blocked_ips(
    db: Session = Depends(get_db), blocklist: BlockList = Depends(get_ip_blocklist)
) -> Any:
    """The block list, each entry with who added it, when and why."""
    return _block_list(db, blocklist)


@router.post("/blocked-ips", response_model=BlockListRead)
def block_ip(
    body: BlockIpRequest,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    blocklist: BlockList = Depends(get_ip_blocklist),
) -> Any:
    """Block an address or range (at most a /24 or /48) at the edge. Reason required."""
    with _blocklist_errors():
        abuse_service.block(db, blocklist, admin, body.network, body.reason, client_ip(request))
    return _block_list(db, blocklist)


@router.post("/blocked-ips/remove", response_model=BlockListRead)
def unblock_ip(
    body: UnblockIpRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    blocklist: BlockList = Depends(get_ip_blocklist),
) -> Any:
    """Take an entry off the block list."""
    with _blocklist_errors():
        abuse_service.unblock(db, blocklist, admin, body.network, body.reason)
    return _block_list(db, blocklist)
