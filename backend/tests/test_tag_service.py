"""Tests for the tag service — normalization and the tag-set replace/reuse rules."""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.claims import Claims
from app.core.config import settings
from app.models.list import List
from app.models.tag import Tag
from app.models.user import User
from app.services import list_service, tag_service, user_service


def _user(db_session: Session, sub: str) -> User:
    return user_service.get_or_create_user(
        db_session, Claims(sub=sub, email=f"{sub}@example.com", name=sub)
    )


def _list(db_session: Session, user: User, title: str = "My List") -> List:
    return list_service.create_list(db_session, user.id, title)


def _tag_names(row: List) -> list[str]:
    return [tag.name for tag in row.tags]


@pytest.mark.parametrize(
    ("raw", "normalized"),
    [
        ("Sci-Fi", "sci-fi"),
        ("  sci-fi  ", "sci-fi"),
        ("board   games", "board games"),
        ("Board\tGames", "board games"),
    ],
)
def test_normalize_tag_name_trims_collapses_and_lowercases(raw: str, normalized: str) -> None:
    assert tag_service.normalize_tag_name(raw) == normalized


@pytest.mark.parametrize("raw", ["", "   ", "\t\n"])
def test_normalize_tag_name_rejects_empty_after_trim(raw: str) -> None:
    with pytest.raises(ValueError, match="required"):
        tag_service.normalize_tag_name(raw)


def test_normalize_tag_name_rejects_over_the_length_limit() -> None:
    with pytest.raises(ValueError, match="50 characters"):
        tag_service.normalize_tag_name("x" * 51)


def test_normalize_tag_name_allows_exactly_the_length_limit() -> None:
    assert tag_service.normalize_tag_name("x" * 50) == "x" * 50


def test_set_list_tags_creates_new_tags(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    row = _list(db_session, owner)

    updated = tag_service.set_list_tags(db_session, row, ["games", "sci-fi"])

    assert sorted(_tag_names(updated)) == ["games", "sci-fi"]


def test_set_list_tags_replaces_the_full_set(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    row = _list(db_session, owner)
    tag_service.set_list_tags(db_session, row, ["games", "sci-fi"])

    updated = tag_service.set_list_tags(db_session, row, ["sci-fi", "board games"])

    assert sorted(_tag_names(updated)) == ["board games", "sci-fi"]


def test_set_list_tags_removes_all_tags_with_an_empty_list(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    row = _list(db_session, owner)
    tag_service.set_list_tags(db_session, row, ["games"])

    updated = tag_service.set_list_tags(db_session, row, [])

    assert _tag_names(updated) == []


def test_set_list_tags_dedupes_within_one_call(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    row = _list(db_session, owner)

    updated = tag_service.set_list_tags(db_session, row, ["games", "games"])

    assert _tag_names(updated) == ["games"]


def test_set_list_tags_reuses_one_tag_row_across_different_lists(db_session: Session) -> None:
    owner = _user(db_session, "owner")
    other = _user(db_session, "other")
    mine = _list(db_session, owner, "Mine")
    theirs = _list(db_session, other, "Theirs")

    tag_service.set_list_tags(db_session, mine, ["board games"])
    tag_service.set_list_tags(db_session, theirs, ["board games"])

    rows = list(db_session.scalars(select(Tag).where(Tag.name == "board games")))
    assert len(rows) == 1


def test_set_list_tags_rejects_over_the_cap(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "max_tags_per_list", 2)
    owner = _user(db_session, "owner")
    row = _list(db_session, owner)

    with pytest.raises(tag_service.TooManyTagsError):
        tag_service.set_list_tags(db_session, row, ["a", "b", "c"])


def test_set_list_tags_allows_exactly_the_cap_after_deduping(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "max_tags_per_list", 2)
    owner = _user(db_session, "owner")
    row = _list(db_session, owner)

    updated = tag_service.set_list_tags(db_session, row, ["a", "a", "b"])

    assert sorted(_tag_names(updated)) == ["a", "b"]
