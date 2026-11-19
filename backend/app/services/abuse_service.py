"""The admin abuse view (docs/ARCHITECTURE.md §Abuse view): who is being
rate limited, which IPs are busiest, and the WAF block list.

The numbers come from what the app already counts (app/core/request_counts.py):
``request_counts`` per route class per minute, ``ip_request_counts`` per IP per hour.
The hourly IP rows are the only IP addresses the app keeps, and only for
``IP_RETENTION_DAYS`` (the privacy policy says so).

Blocking writes to the block list (app/core/ip_blocklist.py) and the audit log
together: the audit row commits only if the list change went through, like a
settings change.
"""

import ipaddress
import uuid
from collections.abc import Callable
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from app.core.ip_blocklist import MAX_ENTRIES, BlockList, IpNetwork, parse_network
from app.models.admin_audit_log import AdminAuditLog
from app.models.metrics import IpRequestCount, RequestCount
from app.models.user import User
from app.services import audit_service

IP_RETENTION_DAYS = 7
TOP_IPS = 25
_NEVER = datetime.min.replace(tzinfo=UTC)


class BlockRefusedError(Exception):
    """A block the app won't make (your own address, a duplicate, a full list)."""


class NotBlockedError(Exception):
    """An unblock of an address that isn't on the list."""


def _hour(moment: datetime) -> datetime:
    return moment.replace(minute=0, second=0, microsecond=0)


def _networks(entries: list[str]) -> list[IpNetwork]:
    out = []
    for entry in entries:
        try:
            out.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            continue
    return out


def _blocked_by(ip: str, networks: list[IpNetwork]) -> str | None:
    """The block-list entry that covers ``ip``, if any."""
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return None
    return next((str(net) for net in networks if address in net), None)


def overview(
    db: Session, now: datetime, hours: int, blocked: list[str], your_ip: str
) -> dict[str, Any]:
    """429s by route class and the busiest IPs over the last ``hours`` hours."""
    since = now - timedelta(hours=hours)
    limited = func.sum(case((RequestCount.status_class == "429", RequestCount.count), else_=0))
    total = func.sum(RequestCount.count)
    route_rows = db.execute(
        select(RequestCount.route_class, total, limited)
        .where(RequestCount.minute >= since)
        .group_by(RequestCount.route_class)
        .order_by(limited.desc(), total.desc())
    ).all()

    ip_requests = func.sum(IpRequestCount.requests)
    ip_limited = func.sum(IpRequestCount.rate_limited)
    ip_rows = db.execute(
        select(IpRequestCount.ip, ip_requests, ip_limited)
        .where(IpRequestCount.hour >= _hour(since))
        .group_by(IpRequestCount.ip)
        .order_by(ip_limited.desc(), ip_requests.desc(), IpRequestCount.ip)
        .limit(TOP_IPS)
    ).all()

    networks = _networks(blocked)
    return {
        "window_hours": hours,
        "your_ip": your_ip,
        "rate_limited_total": sum(int(row[2] or 0) for row in route_rows),
        "by_route": [
            {"route_class": route, "requests": int(req or 0), "rate_limited": int(lim or 0)}
            for route, req, lim in route_rows
        ],
        "top_ips": [
            {
                "ip": ip,
                "requests": int(req or 0),
                "rate_limited": int(lim or 0),
                "blocked_by": _blocked_by(ip, networks),
            }
            for ip, req, lim in ip_rows
        ],
    }


def prune(db: Session, today: date) -> int:
    """Delete per-IP counts older than ``IP_RETENTION_DAYS``. Returns rows removed."""
    cutoff = datetime.combine(today - timedelta(days=IP_RETENTION_DAYS), time(), UTC)
    removed = db.execute(delete(IpRequestCount).where(IpRequestCount.hour < cutoff)).rowcount
    db.commit()
    return int(removed or 0)


def blocked_entries(db: Session, blocklist: BlockList) -> list[dict[str, Any]]:
    """Each blocked range with when, by whom and why (its latest ``block_ip`` row)."""
    entries = blocklist.entries()
    if not entries:
        return []
    latest = {
        row.target_id: row
        for row in db.scalars(
            select(AdminAuditLog)
            .where(
                AdminAuditLog.target_type == "ip",
                AdminAuditLog.action == "block_ip",
                AdminAuditLog.target_id.in_(entries),
            )
            .order_by(AdminAuditLog.target_id, AdminAuditLog.created_at.desc())
            .distinct(AdminAuditLog.target_id)
        )
    }
    admin_ids = {row.admin_user_id for row in latest.values() if row.admin_user_id}
    names: dict[uuid.UUID, str] = {}
    if admin_ids:
        rows = db.execute(select(User.id, User.display_name).where(User.id.in_(admin_ids)))
        names = {user_id: name for user_id, name in rows}
    out = []
    for network in entries:
        row = latest.get(network)
        out.append(
            {
                "network": network,
                # Null for an entry added outside the app (e.g. in the AWS console).
                "blocked_at": row.created_at if row else None,
                "blocked_by": names.get(row.admin_user_id) if row and row.admin_user_id else None,
                "reason": row.reason if row else None,
            }
        )
    # Newest first; entries added outside the app (no audit row) last.
    out.sort(key=lambda e: e["blocked_at"] or _NEVER, reverse=True)
    return out


def _store_then_commit(db: Session, change: Callable[[], None]) -> None:
    """Change the block list, then commit the staged audit row (rolled back if the
    change fails: no record of a block that never happened)."""
    try:
        change()
    except Exception:
        db.rollback()
        raise
    db.commit()


def block(
    db: Session, blocklist: BlockList, admin: User, text: str, reason: str, your_ip: str
) -> IpNetwork:
    """Add an address or range. ``ValueError`` for a bad one, ``BlockRefusedError``
    for one the app won't block."""
    network = parse_network(text)
    if _blocked_by(your_ip, [network]):
        raise BlockRefusedError("That would block you: it covers the address you're using now.")
    current = blocklist.entries()
    if str(network) in current:
        raise BlockRefusedError(f"{network} is already blocked.")
    if len(current) >= MAX_ENTRIES:
        raise BlockRefusedError(f"The block list is full ({MAX_ENTRIES} entries).")
    audit_service.record(
        db,
        admin_user_id=admin.id,
        action="block_ip",
        target_type="ip",
        target_id=str(network),
        reason=reason,
    )
    db.flush()  # A bad audit row fails here, before the list is touched.
    _store_then_commit(db, lambda: blocklist.add(network))
    return network


def unblock(
    db: Session, blocklist: BlockList, admin: User, text: str, reason: str | None
) -> IpNetwork:
    """Remove an entry. ``NotBlockedError`` if it isn't on the list."""
    network = parse_network(text, check_width=False)
    if str(network) not in blocklist.entries():
        raise NotBlockedError(str(network))
    audit_service.record(
        db,
        admin_user_id=admin.id,
        action="unblock_ip",
        target_type="ip",
        target_id=str(network),
        reason=reason,
    )
    db.flush()
    _store_then_commit(db, lambda: blocklist.remove(network))
    return network
