"""Admin content tools: read any user's lists (audit-logged), remove and restore.

docs/ARCHITECTURE.md §Content. Access control for these routes is
covered by the router walks in tests/test_admin_access.py.
"""

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.auth.session import issue_session
from app.core.config import settings
from app.models.admin_audit_log import AdminAuditLog
from app.models.list import List
from app.models.list_item import ListItem
from app.models.user import ROLE_ADMIN, User
from app.services import tag_service, user_service
from tests.conftest import API_BASE_URL, BROWSER_HEADERS


def _make_user(db: Session, name: str) -> User:
    return user_service.get_or_create_user(
        db, Claims(sub=f"content-{uuid.uuid4()}", email=f"{uuid.uuid4().hex[:8]}@x.com", name=name)
    )


def _client(client: TestClient, user: User) -> TestClient:
    other = TestClient(client.app, base_url=API_BASE_URL, headers=BROWSER_HEADERS)
    other.cookies.set(settings.session_cookie_name, issue_session(user))
    return other


@pytest.fixture
def admin(db_session: Session) -> User:
    user = _make_user(db_session, "Owner")
    user.role = ROLE_ADMIN
    db_session.commit()
    return user


@pytest.fixture
def admin_client(client: TestClient, admin: User) -> Iterator[TestClient]:
    with _client(client, admin) as admin_client:
        yield admin_client


@pytest.fixture
def owner(db_session: Session) -> User:
    return _make_user(db_session, "List Owner")


@pytest.fixture
def owner_client(client: TestClient, owner: User) -> Iterator[TestClient]:
    with _client(client, owner) as owner_client:
        yield owner_client


@pytest.fixture
def the_list(db_session: Session, owner: User) -> List:
    row = List(user_id=owner.id, title="Secret sandwiches")
    db_session.add(row)
    db_session.flush()
    db_session.add_all(
        [
            ListItem(list_id=row.id, position=2, text="Reuben", note="the best"),
            ListItem(list_id=row.id, position=1, text="Cubano"),
        ]
    )
    db_session.commit()
    tag_service.set_list_tags(db_session, row, ["food"], max_tags=25)
    db_session.refresh(row)
    return row


def _audit(db: Session, action: str, target_id: object) -> list[AdminAuditLog]:
    """This test's audit rows for ``action`` on ``target_id``.

    Scoped to the target on purpose: the e2e suite commits real audit rows to the
    same local database, so matching on the action alone would find theirs too.
    """
    query = select(AdminAuditLog).where(
        AdminAuditLog.action == action, AdminAuditLog.target_id == str(target_id)
    )
    return list(db.scalars(query))


# ─── Reading ────────────────────────────────────────────────────────────────────


def test_reading_a_users_lists_includes_deleted_ones_and_is_audited(
    admin_client: TestClient,
    owner_client: TestClient,
    owner: User,
    the_list: List,
    db_session: Session,
) -> None:
    gone = owner_client.post("/lists", json={"title": "Old one"}).json()
    owner_client.delete(f"/lists/{gone['id']}")

    rows = admin_client.get(f"/admin/users/{owner.id}/lists").json()

    by_title = {row["title"]: row for row in rows}
    assert set(by_title) == {"Secret sandwiches", "Old one"}
    assert by_title["Secret sandwiches"]["item_count"] == 2
    assert by_title["Secret sandwiches"]["tags"] == ["food"]
    assert by_title["Secret sandwiches"]["deleted_at"] is None
    assert by_title["Old one"]["deleted_at"] is not None
    assert by_title["Old one"]["removed_by_admin"] is False

    [entry] = _audit(db_session, "read_lists", owner.id)
    assert (entry.target_type, entry.target_id) == ("user", str(owner.id))
    assert entry.details == {"count": 2}


def test_reading_one_list_shows_its_items_in_order_and_is_audited(
    admin_client: TestClient, the_list: List, owner: User, db_session: Session
) -> None:
    detail = admin_client.get(f"/admin/lists/{the_list.id}").json()

    assert detail["title"] == "Secret sandwiches"
    assert detail["user_id"] == str(owner.id)
    assert detail["owner_display_name"] == "List Owner"
    assert [(i["position"], i["text"]) for i in detail["items"]] == [(1, "Cubano"), (2, "Reuben")]

    [entry] = _audit(db_session, "read_list", the_list.id)
    assert (entry.target_type, entry.target_id) == ("list", str(the_list.id))
    assert entry.details == {"owner_id": str(owner.id)}
    # The read itself shows in the list's history.
    assert [a["action"] for a in detail["recent_actions"]] == ["read_list"]


def test_an_unknown_list_is_404(admin_client: TestClient) -> None:
    assert admin_client.get(f"/admin/lists/{uuid.uuid4()}").status_code == 404


# ─── Removing and restoring ─────────────────────────────────────────────────────


def test_removal_needs_a_reason(admin_client: TestClient, the_list: List) -> None:
    for body in ({}, {"reason": "   "}):
        response = admin_client.post(f"/admin/lists/{the_list.id}/remove", json=body)
        assert response.status_code == 422


def test_remove_hides_the_list_from_its_owner_and_restore_brings_it_back(
    admin_client: TestClient, owner_client: TestClient, the_list: List, db_session: Session
) -> None:
    assert owner_client.get(f"/lists/{the_list.id}").status_code == 200

    removed = admin_client.post(
        f"/admin/lists/{the_list.id}/remove", json={"reason": "  slurs in the title "}
    ).json()
    assert removed["deleted_at"] is not None
    assert removed["removed_by_admin"] is True
    assert owner_client.get(f"/lists/{the_list.id}").status_code == 404
    assert the_list.id not in {row["id"] for row in owner_client.get("/lists").json()}

    [entry] = _audit(db_session, "remove_list", the_list.id)
    assert entry.reason == "slurs in the title"
    assert "Secret" not in str(entry.details)  # the log doesn't copy the content

    # Removing twice is refused.
    again = admin_client.post(f"/admin/lists/{the_list.id}/remove", json={"reason": "x"})
    assert again.status_code == 409

    restored = admin_client.post(f"/admin/lists/{the_list.id}/restore", json={}).json()
    assert restored["deleted_at"] is None
    assert restored["removed_by_admin"] is False
    assert owner_client.get(f"/lists/{the_list.id}").status_code == 200
    assert [a["action"] for a in restored["recent_actions"]][:2] == ["restore_list", "remove_list"]


def test_a_list_its_owner_deleted_cannot_be_restored_by_an_admin(
    admin_client: TestClient, owner_client: TestClient, the_list: List
) -> None:
    owner_client.delete(f"/lists/{the_list.id}")

    response = admin_client.post(f"/admin/lists/{the_list.id}/restore", json={})
    assert response.status_code == 409
    assert "owner deleted" in response.json()["detail"]


def test_restoring_a_live_list_is_refused(admin_client: TestClient, the_list: List) -> None:
    assert admin_client.post(f"/admin/lists/{the_list.id}/restore", json={}).status_code == 409


def test_an_owner_delete_after_an_admin_restore_is_not_restorable(
    admin_client: TestClient, owner_client: TestClient, the_list: List
) -> None:
    """Only the latest moderation action counts: remove → restore → owner deletes."""
    admin_client.post(f"/admin/lists/{the_list.id}/remove", json={"reason": "oops"})
    admin_client.post(f"/admin/lists/{the_list.id}/restore", json={})
    owner_client.delete(f"/lists/{the_list.id}")

    assert admin_client.post(f"/admin/lists/{the_list.id}/restore", json={}).status_code == 409
