"""Management commands run with direct access to the box: ``python -m app.cli ...``.

This is the ONLY way to make someone an admin (docs/ADMIN_AND_ANALYTICS_PLAN.md
§Access control, CLAUDE.md): no API path reads or writes ``users.role``. Wrapped by
``tools/grant_admin.sh``.

    python -m app.cli grant-admin --email you@example.com
    python -m app.cli revoke-admin --email you@example.com
    python -m app.cli list-admins
    python -m app.cli daily-jobs     # from cron, once a day (see below)

The person must have signed in once first, so their ``users`` row exists.
"""

import argparse
import sys
from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.metrics import RequestCount
from app.models.user import ROLE_ADMIN, ROLE_USER
from app.services import cost_service, user_service


class CliError(Exception):
    """A user-facing failure: printed without a traceback, exit code 1."""


def set_role_by_email(db: Session, email: str, role: str) -> str:
    """Set the role of the one user with ``email``; returns a message saying what happened."""
    users = user_service.get_users_by_email(db, email)
    if not users:
        raise CliError(f"No user with email {email!r}. They must sign in once first.")
    if len(users) > 1:
        ids = ", ".join(str(user.id) for user in users)
        raise CliError(f"{len(users)} users share email {email!r} ({ids}); refusing to guess.")

    user = users[0]
    if user.role == role:
        return f"{user.display_name} <{email}> is already {role!r}; nothing changed."
    user_service.set_role(db, user, role)
    return f"{user.display_name} <{email}> is now {role!r}."


def list_admins(db: Session) -> list[str]:
    return [
        f"{user.id}  {user.email or '(no email)'}  {user.display_name}"
        for user in user_service.list_admins(db)
    ]


COUNT_RETENTION_DAYS = 35


def daily_jobs(db: Session, today: date | None = None, cost_client: Any = None) -> list[str]:
    """Once a day, from cron on the box: housekeeping for the admin dashboard.

    Prunes request counts past ``COUNT_RETENTION_DAYS`` and, when
    ``COST_SNAPSHOT_ENABLED``, records one Cost Explorer snapshot ($0.01).
    """
    today = today or datetime.now(UTC).date()
    cutoff = datetime.combine(today - timedelta(days=COUNT_RETENTION_DAYS), time(), UTC)
    pruned = db.execute(delete(RequestCount).where(RequestCount.minute < cutoff)).rowcount
    db.commit()
    report = [f"Pruned {pruned} request-count rows older than {cutoff.date()}."]

    if settings.cost_snapshot_enabled or cost_client is not None:
        client = cost_client or cost_service.cost_explorer_client()
        snapshot = cost_service.take_snapshot(db, client, today)
        report.append(
            f"Cost so far this month: {snapshot.month_to_date} {snapshot.currency}"
            f" (forecast {snapshot.forecast or 'n/a'})."
        )
    else:
        report.append("Cost snapshot skipped (COST_SNAPSHOT_ENABLED is off).")
    return report


def main(argv: Sequence[str] | None = None, db: Session | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__.split("\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("grant-admin", "Make a user an admin."),
        ("revoke-admin", "Make an admin a regular user again."),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--email", required=True)
    commands.add_parser("list-admins", help="Show every admin.")
    commands.add_parser(
        "daily-jobs", help="Prune old request counts; take the cost snapshot if enabled."
    )
    args = parser.parse_args(argv)

    session = db if db is not None else SessionLocal()
    try:
        if args.command == "list-admins":
            print("\n".join(list_admins(session)) or "No admins.")
        elif args.command == "daily-jobs":
            print("\n".join(daily_jobs(session)))
        else:
            role = ROLE_ADMIN if args.command == "grant-admin" else ROLE_USER
            print(set_role_by_email(session, args.email.strip(), role))
    except CliError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    finally:
        if db is None:
            session.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
