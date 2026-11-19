"""The admin audit log (service + route) and the grant-admin CLI."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli
from app.auth.claims import Claims
from app.auth.session import issue_session
from app.core.config import settings
from app.models.admin_audit_log import AdminAuditLog
from app.models.user import ROLE_ADMIN, ROLE_USER, User
from app.services import audit_service, user_service
from tests.conftest import API_BASE_URL, BROWSER_HEADERS


def _user(db: Session, email: str = "someone@example.com") -> User:
    return user_service.get_or_create_user(
        db, Claims(sub=f"cli-{uuid.uuid4()}", email=email, name="Someone")
    )


def _entries_for(db: Session, user: User) -> list[AdminAuditLog]:
    query = select(AdminAuditLog).where(AdminAuditLog.target_id == str(user.id))
    return list(db.scalars(query))


# --- CLI ---------------------------------------------------------------------------


def test_grant_and_revoke_admin(db_session: Session, capsys: pytest.CaptureFixture[str]) -> None:
    user = _user(db_session, "Grant.Me@Example.com")

    assert cli.main(["grant-admin", "--email", "grant.me@example.com"], db=db_session) == 0
    db_session.refresh(user)
    assert user.role == ROLE_ADMIN
    assert "is now 'admin'" in capsys.readouterr().out

    assert cli.main(["revoke-admin", "--email", "grant.me@example.com"], db=db_session) == 0
    db_session.refresh(user)
    assert user.role == ROLE_USER

    actions = sorted(entry.action for entry in _entries_for(db_session, user))
    assert actions == ["grant_admin", "revoke_admin"]
    assert all(entry.admin_user_id is None for entry in _entries_for(db_session, user))


def test_granting_twice_changes_nothing(db_session: Session) -> None:
    user = _user(db_session, "twice@example.com")
    cli.main(["grant-admin", "--email", "twice@example.com"], db=db_session)
    cli.main(["grant-admin", "--email", "twice@example.com"], db=db_session)
    assert len(_entries_for(db_session, user)) == 1


def test_unknown_email_fails(db_session: Session, capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["grant-admin", "--email", "ghost@example.com"], db=db_session) == 1
    assert "sign in once first" in capsys.readouterr().err


def test_shared_email_refuses_to_guess(db_session: Session) -> None:
    first = _user(db_session, "shared@example.com")
    second = _user(db_session, "shared@example.com")
    assert cli.main(["grant-admin", "--email", "shared@example.com"], db=db_session) == 1
    db_session.refresh(first)
    db_session.refresh(second)
    assert first.role == second.role == ROLE_USER


def test_list_admins(db_session: Session, capsys: pytest.CaptureFixture[str]) -> None:
    user = _user(db_session, "listed@example.com")
    user_service.set_role(db_session, user, ROLE_ADMIN)
    assert cli.main(["list-admins"], db=db_session) == 0
    assert "listed@example.com" in capsys.readouterr().out


def test_set_role_rejects_unknown_roles(db_session: Session) -> None:
    with pytest.raises(ValueError):
        user_service.set_role(db_session, _user(db_session), "superuser")


# --- Audit log route ---------------------------------------------------------------


@pytest.fixture
def admin_client(client: TestClient, db_session: Session) -> TestClient:
    admin = _user(db_session, "owner@example.com")
    admin.role = ROLE_ADMIN
    db_session.commit()
    admin_client = TestClient(client.app, base_url=API_BASE_URL, headers=BROWSER_HEADERS)
    admin_client.cookies.set(settings.session_cookie_name, issue_session(admin))
    return admin_client


def _seed(db: Session, target_id: str, action: str, created_at: datetime) -> None:
    entry = audit_service.record(
        db,
        admin_user_id=None,
        action=action,
        target_type="user",
        target_id=target_id,
        reason="testing",
        details={"n": 1},
    )
    # Rows in one transaction share now(); set times so ordering is testable.
    entry.created_at = created_at
    db.commit()


def test_audit_log_is_newest_first_and_filterable(
    admin_client: TestClient, db_session: Session
) -> None:
    target = str(uuid.uuid4())
    now = datetime.now(UTC)
    _seed(db_session, target, "lock_user", now - timedelta(minutes=2))
    _seed(db_session, target, "unlock_user", now - timedelta(minutes=1))

    rows = admin_client.get("/admin/audit-log", params={"target_id": target}).json()
    assert [row["action"] for row in rows] == ["unlock_user", "lock_user"]
    assert rows[0]["reason"] == "testing"
    assert rows[0]["details"] == {"n": 1}

    locked = admin_client.get(
        "/admin/audit-log", params={"target_id": target, "action": "lock_user"}
    ).json()
    assert [row["action"] for row in locked] == ["lock_user"]

    older = admin_client.get(
        "/admin/audit-log", params={"target_id": target, "before": rows[0]["created_at"]}
    ).json()
    assert [row["action"] for row in older] == ["lock_user"]


def test_audit_log_page_size_is_capped(admin_client: TestClient) -> None:
    assert admin_client.get("/admin/audit-log", params={"limit": 101}).status_code == 422


def test_audit_log_names_the_admin_and_the_subject_user(
    admin_client: TestClient, db_session: Session
) -> None:
    owner = _user(db_session, "list.owner@example.com")
    owner.display_name = "List Owner"
    db_session.commit()
    me = admin_client.get("/me").json()
    list_id = str(uuid.uuid4())
    audit_service.record(
        db_session,
        admin_user_id=uuid.UUID(me["id"]),
        action="remove_list",
        target_type="list",
        target_id=list_id,
        reason="spam",
        details={"owner_id": str(owner.id)},
    )
    db_session.commit()

    [row] = admin_client.get("/admin/audit-log", params={"target_id": list_id}).json()
    assert row["admin_display_name"] == me["display_name"]
    assert row["subject_user_id"] == str(owner.id)
    assert row["subject_display_name"] == "List Owner"


def test_audit_log_filters_by_subject_user(admin_client: TestClient, db_session: Session) -> None:
    subject = _user(db_session, "subject@example.com")
    other = str(uuid.uuid4())
    now = datetime.now(UTC)
    _seed(db_session, str(subject.id), "lock_user", now - timedelta(minutes=3))
    for owner, minutes in ((str(subject.id), 2), (other, 1)):
        entry = audit_service.record(
            db_session,
            admin_user_id=None,
            action="read_list",
            target_type="list",
            target_id=str(uuid.uuid4()),
            details={"owner_id": owner},
        )
        entry.created_at = now - timedelta(minutes=minutes)
        db_session.commit()

    rows = admin_client.get("/admin/audit-log", params={"subject_user_id": str(subject.id)}).json()
    assert [row["action"] for row in rows] == ["read_list", "lock_user"]
    assert all(row["subject_user_id"] == str(subject.id) for row in rows)
    # A CLI action has no admin, so no admin name.
    assert rows[1]["admin_display_name"] is None
