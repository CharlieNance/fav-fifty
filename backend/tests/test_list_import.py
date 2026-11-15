"""``POST /lists/import`` — uploading a device's lists to an account (the claim).

docs/ARCHITECTURE.md §POST /api/v1/lists/import. Most tests use
``fresh_user_client`` so "the account's lists" starts empty, whatever the dev-login
user owns in the local database.
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.runtime_settings import Limits, RuntimeSettings
from app.models.list import List
from app.models.list_item import ListItem
from app.models.tag import Tag
from app.models.user import User
from app.services import list_import_service
from app.services.list_import_service import unique_title

DEVICE_ID = "6f1c2a52-8d0e-4b7a-9a59-6a3f4f0d2e11"


def _item(text: str, **fields: Any) -> dict[str, Any]:
    return {"local_id": str(uuid.uuid4()), "text": text, **fields}


def _list(title: str, items: list[dict[str, Any]] | None = None, **fields: Any) -> dict[str, Any]:
    return {
        "local_id": str(uuid.uuid4()),
        "title": title,
        "tags": [],
        "items": items or [],
        **fields,
    }


def _body(*lists: dict[str, Any], device_id: str = DEVICE_ID) -> dict[str, Any]:
    return {"device_id": device_id, "lists": list(lists)}


def _own_lists(db_session: Session, user: User) -> list[List]:
    return list(
        db_session.scalars(select(List).where(List.user_id == user.id).order_by(List.title))
    )


def _count(db_session: Session, model: type[List] | type[ListItem]) -> int:
    count = db_session.scalar(select(func.count()).select_from(model))
    assert count is not None
    return count


# ─── Happy path ─────────────────────────────────────────────────────────────────


def test_import_creates_every_list_with_its_items_tags_and_timestamps(
    fresh_user_client: TestClient, fresh_user: User, db_session: Session
) -> None:
    albums = _list(
        "  Top Albums  ",
        items=[
            _item("In Rainbows", note="  The best one ", image_url="https://example.com/a.jpg"),
            _item("Blue", note="   ", image_url=""),
        ],
        tags=["Music", "  music ", "Vinyl  Records"],
        created_at="2026-10-13T18:00:00Z",
        updated_at="2026-10-13T18:05:00Z",
    )
    desserts = _list("Desserts")

    response = fresh_user_client.post("/lists/import", json=_body(albums, desserts))

    assert response.status_code == 200
    results = response.json()["lists"]
    assert [r["local_id"] for r in results] == [albums["local_id"], desserts["local_id"]]
    assert [r["outcome"] for r in results] == ["created", "created"]
    assert [r["renamed_from"] for r in results] == [None, None]
    first = results[0]["list"]
    assert first["title"] == "Top Albums"
    assert sorted(first["tags"]) == ["music", "vinyl records"]
    assert first["item_count"] == 2
    assert first["status"] == "draft"
    assert first["created_at"].startswith("2026-10-13T18:00:00")
    assert first["updated_at"].startswith("2026-10-13T18:05:00")
    assert results[1]["list"]["item_count"] == 0

    # The lists are the caller's, and readable through the normal routes.
    assert sorted(row.title for row in _own_lists(db_session, fresh_user)) == [
        "Desserts",
        "Top Albums",
    ]
    items = fresh_user_client.get(f"/lists/{first['id']}/items").json()
    assert [(i["position"], i["text"], i["note"], i["image_url"]) for i in items] == [
        (1, "In Rainbows", "The best one", "https://example.com/a.jpg"),
        (2, "Blue", None, None),
    ]


def test_import_stores_the_idempotency_key(
    fresh_user_client: TestClient, fresh_user: User, db_session: Session
) -> None:
    albums = _list("Albums")

    fresh_user_client.post("/lists/import", json=_body(albums))

    [row] = _own_lists(db_session, fresh_user)
    assert row.import_key == f"{DEVICE_ID}:{albums['local_id']}"


def test_import_ignores_fields_it_doesnt_know(fresh_user_client: TestClient) -> None:
    # The client may send the whole stored document, or a newer schema's fields.
    body = {
        **_body(_list("Albums", items=[_item("Blue", catalog_ref={"x": 1})], kind="music")),
        "schema_version": 1,
        "claimed_at": None,
    }

    response = fresh_user_client.post("/lists/import", json=body)

    assert response.status_code == 200


def test_import_reuses_existing_tags(fresh_user_client: TestClient, db_session: Session) -> None:
    db_session.add(Tag(name="shared-import-tag"))
    db_session.commit()

    response = fresh_user_client.post(
        "/lists/import",
        json=_body(
            _list("One", tags=["shared-import-tag", "new-import-tag"]),
            _list("Two", tags=["Shared-Import-Tag", "new-import-tag"]),
        ),
    )

    assert response.status_code == 200
    for name in ("shared-import-tag", "new-import-tag"):
        assert len(list(db_session.scalars(select(Tag).where(Tag.name == name)))) == 1


def test_import_repairs_timestamps_from_the_future_or_out_of_order(
    fresh_user_client: TestClient,
) -> None:
    future = (datetime.now(UTC) + timedelta(days=30)).isoformat()
    response = fresh_user_client.post(
        "/lists/import",
        json=_body(
            _list("Future", created_at=future, updated_at=future),
            _list(
                "Backwards", created_at="2026-10-13T18:00:00Z", updated_at="2026-01-01T00:00:00Z"
            ),
            _list("Naive", created_at="2026-10-13T18:00:00"),
        ),
    )

    assert response.status_code == 200
    future_list, backwards, naive = (r["list"] for r in response.json()["lists"])
    now = datetime.now(UTC)
    assert datetime.fromisoformat(future_list["created_at"]) <= now
    assert datetime.fromisoformat(future_list["updated_at"]) <= now
    assert backwards["updated_at"] == backwards["created_at"]
    assert naive["created_at"].startswith("2026-10-13T18:00:00")
    assert naive["updated_at"] == naive["created_at"]


# ─── Idempotency ────────────────────────────────────────────────────────────────


def test_a_retry_returns_the_lists_the_first_attempt_made(
    fresh_user_client: TestClient, fresh_user: User, db_session: Session
) -> None:
    body = _body(_list("Albums", items=[_item("Blue")]), _list("Desserts"))

    first = fresh_user_client.post("/lists/import", json=body).json()["lists"]
    lists_before, items_before = _count(db_session, List), _count(db_session, ListItem)
    retry = fresh_user_client.post("/lists/import", json=body)

    assert retry.status_code == 200
    again = retry.json()["lists"]
    assert [r["outcome"] for r in again] == ["already_imported", "already_imported"]
    assert [r["list"]["id"] for r in again] == [r["list"]["id"] for r in first]
    assert again[0]["list"]["item_count"] == 1
    assert _count(db_session, List) == lists_before
    assert _count(db_session, ListItem) == items_before


def test_a_retry_with_one_new_list_creates_only_that_one(
    fresh_user_client: TestClient, fresh_user: User, db_session: Session
) -> None:
    albums = _list("Albums")
    fresh_user_client.post("/lists/import", json=_body(albums))

    response = fresh_user_client.post("/lists/import", json=_body(albums, _list("Desserts")))

    assert [r["outcome"] for r in response.json()["lists"]] == ["already_imported", "created"]
    assert len(_own_lists(db_session, fresh_user)) == 2


def test_a_list_deleted_after_import_is_not_brought_back(
    fresh_user_client: TestClient, fresh_user: User, db_session: Session
) -> None:
    body = _body(_list("Albums"))
    [created] = fresh_user_client.post("/lists/import", json=body).json()["lists"]
    fresh_user_client.delete(f"/lists/{created['list']['id']}")

    [again] = fresh_user_client.post("/lists/import", json=body).json()["lists"]

    assert again["outcome"] == "already_imported"
    assert again["list"] is None
    assert fresh_user_client.get("/lists").json() == []


def test_the_same_device_list_can_be_imported_by_two_accounts(
    fresh_user_client: TestClient, second_user_client: TestClient
) -> None:
    # The key is unique per account, not globally: a shared device's lists can go
    # to whoever claims them, and one account's import never finds another's.
    body = _body(_list("Albums"))

    mine = fresh_user_client.post("/lists/import", json=body).json()["lists"][0]
    theirs = second_user_client.post("/lists/import", json=body).json()["lists"][0]

    assert mine["outcome"] == theirs["outcome"] == "created"
    assert mine["list"]["id"] != theirs["list"]["id"]


def test_import_retries_once_when_a_concurrent_request_wins_the_race(
    db_session: Session, fresh_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Simulates a double-submit: the first attempt's insert loses to a concurrent
    # request that committed the same list, so the retry must find and return it.
    from app.schemas.list_import import ListsImport

    request = ListsImport.model_validate(_body(_list("Albums")))
    original = list_import_service._write
    attempts = 0

    def racing_once(db: Session, *args: Any) -> Any:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            original(db, *args)  # the "other" request's work…
            db.commit()  # …committed first
            raise IntegrityError("insert", {}, Exception("duplicate key value"))
        return original(db, *args)

    monkeypatch.setattr(list_import_service, "_write", racing_once)

    [outcome] = list_import_service.import_lists(db_session, fresh_user.id, request, max_tags=25)

    assert attempts == 2
    assert outcome.already_imported
    assert len(_own_lists(db_session, fresh_user)) == 1


# ─── Title clashes ──────────────────────────────────────────────────────────────


def test_a_title_clash_is_renamed_and_reported(
    fresh_user_client: TestClient, fresh_user: User, db_session: Session
) -> None:
    fresh_user_client.post("/lists", json={"title": "Top Albums"})

    response = fresh_user_client.post(
        "/lists/import",
        json=_body(_list("top albums"), _list("TOP ALBUMS"), _list("Desserts")),
    )

    results = response.json()["lists"]
    assert [r["list"]["title"] for r in results] == ["top albums (2)", "TOP ALBUMS (3)", "Desserts"]
    assert [r["renamed_from"] for r in results] == ["top albums", "TOP ALBUMS", None]


def test_deleted_and_other_users_lists_dont_count_as_clashes(
    fresh_user_client: TestClient, second_user_client: TestClient
) -> None:
    second_user_client.post("/lists", json={"title": "Albums"})
    old = fresh_user_client.post("/lists", json={"title": "Albums"}).json()
    fresh_user_client.delete(f"/lists/{old['id']}")

    [result] = fresh_user_client.post("/lists/import", json=_body(_list("Albums"))).json()["lists"]

    assert result["list"]["title"] == "Albums"
    assert result["renamed_from"] is None


def test_a_renamed_title_still_fits_the_column(fresh_user_client: TestClient) -> None:
    long_title = "x" * 200
    fresh_user_client.post("/lists", json={"title": long_title})

    [result] = fresh_user_client.post("/lists/import", json=_body(_list(long_title))).json()[
        "lists"
    ]

    assert result["list"]["title"] == "x" * 196 + " (2)"


# Same cases as `uniqueTitle` in frontend/src/features/lists/listRules.spec.ts: the
# two must rename the same way.
def test_unique_title_keeps_a_title_nobody_is_using() -> None:
    assert unique_title("Albums", {"songs"}) == "Albums"


def test_unique_title_numbers_a_clash_from_2_ignoring_case() -> None:
    assert unique_title("Albums", {"albums"}) == "Albums (2)"
    assert unique_title("ALBUMS", {"albums", "albums (2)"}) == "ALBUMS (3)"


def test_unique_title_shortens_the_base_so_the_numbered_title_still_fits() -> None:
    assert unique_title("Top albums", {"top albums"}, max_length=10) == "Top al (2)"
    # Trailing spaces left by the cut are dropped, and lengths count code points.
    assert unique_title("Top 🎵 song", {"top 🎵 song"}, max_length=10) == "Top 🎵 (2)"


# ─── Rejections: all or nothing ─────────────────────────────────────────────────


def _assert_rejected(
    client: TestClient, db_session: Session, body: dict[str, Any], detail: str
) -> None:
    lists_before = _count(db_session, List)

    response = client.post("/lists/import", json=body)

    assert response.status_code == 422
    assert response.json()["detail"] == detail
    assert _count(db_session, List) == lists_before


def test_a_list_over_the_item_cap_rejects_the_whole_import(
    fresh_user_client: TestClient, db_session: Session
) -> None:
    too_many = _list("Top Albums", items=[_item(f"Album {n}") for n in range(51)])
    body = _body(_list("Fine"), too_many)

    _assert_rejected(
        fresh_user_client, db_session, body, "'Top Albums' has 51 items; the limit is 50."
    )


def test_exactly_the_item_cap_is_allowed(fresh_user_client: TestClient) -> None:
    full = _list("Full", items=[_item(f"Album {n}") for n in range(50)])

    response = fresh_user_client.post("/lists/import", json=_body(full))

    assert response.status_code == 200
    assert response.json()["lists"][0]["list"]["item_count"] == 50


@pytest.mark.parametrize(
    ("bad_list", "detail"),
    [
        (_list("   "), "'': Title is required."),
        (_list("t" * 201), f"'{'t' * 40}…': Title must be 200 characters or fewer."),
        (_list("Albums", items=[_item(" ")]), "'Albums': Text is required."),
        (
            _list("Albums", items=[_item("Blue"), _item(" BLUE ")]),
            "'Albums' has 'BLUE' more than once.",
        ),
        (
            _list("Albums", items=[_item("Blue", note="n" * 2001)]),
            "'Albums': Note must be 2000 characters or fewer.",
        ),
        (
            _list("Albums", items=[_item("Blue", image_url="javascript:alert(1)")]),
            "'Albums': Image URL must start with http:// or https://.",
        ),
        (_list("Albums", tags=["ok", "  "]), "'Albums': Tag is required."),
        (_list("Albums", tags=["t" * 51]), "'Albums': Tag must be 50 characters or fewer."),
        (
            _list("Albums", tags=[f"tag {n}" for n in range(26)]),
            "'Albums': A list can have at most 25 tags.",
        ),
    ],
)
def test_a_list_breaking_a_rule_rejects_the_whole_import(
    fresh_user_client: TestClient, db_session: Session, bad_list: dict[str, Any], detail: str
) -> None:
    _assert_rejected(fresh_user_client, db_session, _body(_list("Fine"), bad_list), detail)


def test_the_tag_cap_follows_the_runtime_setting(
    fresh_user_client: TestClient,
    db_session: Session,
    set_runtime_settings: Callable[[RuntimeSettings], None],
) -> None:
    set_runtime_settings(RuntimeSettings(limits=Limits(max_tags_per_list=2)))
    body = _body(_list("Albums", tags=["a", "b", "c"]))

    _assert_rejected(
        fresh_user_client, db_session, body, "'Albums': A list can have at most 2 tags."
    )


def test_the_same_list_twice_is_rejected(
    fresh_user_client: TestClient, db_session: Session
) -> None:
    albums = _list("Albums")

    _assert_rejected(
        fresh_user_client,
        db_session,
        _body(albums, {**albums, "title": "Other"}),
        "The same list is in this upload more than once.",
    )


@pytest.mark.parametrize(
    "body",
    [
        {"device_id": DEVICE_ID, "lists": []},
        {"device_id": "", "lists": [_list("Albums")]},
        {"device_id": "has:colon", "lists": [_list("Albums")]},
        {"device_id": "d" * 65, "lists": [_list("Albums")]},
        {"device_id": DEVICE_ID, "lists": [{**_list("Albums"), "local_id": ""}]},
        {"device_id": DEVICE_ID, "lists": [{"local_id": "x", "items": []}]},
        {"lists": [_list("Albums")]},
    ],
)
def test_a_malformed_body_is_a_422(fresh_user_client: TestClient, body: dict[str, Any]) -> None:
    assert fresh_user_client.post("/lists/import", json=body).status_code == 422


# ─── Limits and access ──────────────────────────────────────────────────────────


def test_too_many_lists_is_a_413(
    fresh_user_client: TestClient,
    db_session: Session,
    set_runtime_settings: Callable[[RuntimeSettings], None],
) -> None:
    set_runtime_settings(RuntimeSettings(limits=Limits(max_lists_per_import=2)))

    response = fresh_user_client.post(
        "/lists/import", json=_body(_list("A"), _list("B"), _list("C"))
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "You can upload at most 2 lists at a time."
    assert fresh_user_client.get("/lists").json() == []


def test_an_oversized_body_is_a_413(
    fresh_user_client: TestClient, set_runtime_settings: Callable[[RuntimeSettings], None]
) -> None:
    set_runtime_settings(RuntimeSettings(limits=Limits(max_import_bytes=64 * 1024)))
    # ~100 KB of otherwise valid notes.
    big = _list("Big", items=[_item(f"Item {n}", note="n" * 2000) for n in range(50)])

    response = fresh_user_client.post("/lists/import", json=_body(big))

    assert response.status_code == 413
    assert fresh_user_client.get("/lists").json() == []


def test_import_requires_authentication(client: TestClient, db_session: Session) -> None:
    lists_before = _count(db_session, List)

    response = client.post("/lists/import", json=_body(_list("Albums")))

    assert response.status_code == 401
    assert _count(db_session, List) == lists_before


def test_import_always_goes_to_the_caller(
    fresh_user_client: TestClient,
    fresh_user: User,
    second_user_client: TestClient,
    db_session: Session,
) -> None:
    # There is no owner field to set; extra ones (like a user_id) are ignored.
    body = {**_body(_list("Mine")), "user_id": str(uuid.uuid4())}

    [result] = fresh_user_client.post("/lists/import", json=body).json()["lists"]

    row = db_session.get(List, uuid.UUID(result["list"]["id"]))
    assert row is not None and row.user_id == fresh_user.id
    assert second_user_client.get(f"/lists/{result['list']['id']}").status_code == 404
