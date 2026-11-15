"""List import service — uploading a device's lists to an account in one go.

Backs ``POST /api/v1/lists/import``, used by the claim dialog after sign-in
(docs/ARCHITECTURE.md §Claim on sign-in). The rules:

* **Same rules as a normal create.** Every list and item goes through the same
  validators and service rules as the one-at-a-time routes: title, tags (and the
  per-list tag cap), item fields, the 50-item cap, case-insensitive duplicate items.
  The client checked them too, but it isn't trusted.
* **All or nothing.** One invalid list rejects the whole upload with an
  ``ImportRejectedError`` naming the list, and nothing is written. Everything that
  passes is written in **one transaction**.
* **Idempotent.** Each list is stored with ``import_key = "<device_id>:<local_id>"``,
  unique per account. A retry (e.g. after a dropped response) finds the lists the
  first attempt made and returns them instead of making them again.
* **Title clashes are renamed** ``"Title (2)"``, against the account's live lists
  and earlier lists in the same upload. ``unique_title`` matches the frontend's
  ``uniqueTitle`` (``frontend/src/features/lists/listRules.ts``), which the
  on-device file import uses, so both renames come out the same.

The rejection copy matches the frontend's file import (``localListTransfer.ts``),
so the user sees the same sentence whichever side catches a problem.
"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.limits import MAX_ITEMS_PER_LIST, MAX_TITLE_LENGTH
from app.models.list import List
from app.models.list_item import ListItem
from app.models.tag import Tag
from app.schemas.list import validated_title
from app.schemas.list_import import ImportedList, ListsImport
from app.schemas.list_item import validated_image_url, validated_note, validated_text
from app.services import tag_service

# Longest list title shown in a rejection message before it's shortened with "…".
_LABEL_MAX_CHARS = 40


class ImportRejectedError(Exception):
    """The upload breaks a rule. ``detail`` is user-facing and names the list."""

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


@dataclass(frozen=True)
class ImportOutcome:
    local_id: str
    already_imported: bool
    # ``None`` only for a list that was already imported and has since been deleted.
    list_row: List | None
    renamed_from: str | None


@dataclass(frozen=True)
class _ValidItem:
    text: str
    note: str | None
    image_url: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class _ValidList:
    local_id: str
    title: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime
    items: list[_ValidItem]


# ─── Rules ──────────────────────────────────────────────────────────────────────


def unique_title(title: str, taken: set[str], max_length: int = MAX_TITLE_LENGTH) -> str:
    """``title``, or ``"title (2)"``, ``"title (3)"``, … if ``taken`` already has it.

    ``taken`` holds the titles in use, lower-cased (the match ignores case). The
    base is shortened if a suffix would push it over ``max_length``. Slicing a
    ``str`` counts code points, like the frontend's ``Array.from``.
    """
    if title.lower() not in taken:
        return title
    n = 2
    while True:
        suffix = f" ({n})"
        base = title[: max_length - len(suffix)].rstrip()
        candidate = f"{base}{suffix}"
        if candidate.lower() not in taken:
            return candidate
        n += 1


def _label(title: str) -> str:
    """A list's title for an error message: quoted, and shortened if it's long."""
    shown = f"{title[:_LABEL_MAX_CHARS]}…" if len(title) > _LABEL_MAX_CHARS else title
    return f"'{shown.strip()}'"


def _for_list[T](title: str, validate: Callable[[], T]) -> T:
    """Apply ``validate``, re-raising a rule failure with the list's name in front."""
    try:
        return validate()
    except ValueError as exc:
        raise ImportRejectedError(f"{_label(title)}: {exc}") from None


def _normalized_tags(names: Sequence[str], max_tags: int) -> list[str]:
    """``TagsUpdate`` + ``set_list_tags``: normalize, de-duplicate, then apply the cap."""
    deduped = list(dict.fromkeys(tag_service.normalize_tag_name(name) for name in names))
    if len(deduped) > max_tags:
        raise ValueError(f"A list can have at most {max_tags} tags.")
    return deduped


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    # A timestamp without an offset is taken as UTC (the app always sends one).
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _timestamps(
    created: datetime | None, updated: datetime | None, now: datetime
) -> tuple[datetime, datetime]:
    """The device's timestamps, kept so the lists page sorts as it did on the device.

    Repaired so they can't claim the future or run backwards: ``created_at`` is at
    most ``now``, and ``updated_at`` is between ``created_at`` and ``now``.
    """
    created_at = min(_as_utc(created) or now, now)
    updated_at = min(max(_as_utc(updated) or created_at, created_at), now)
    return created_at, updated_at


def _validate_list(raw: ImportedList, max_tags: int, now: datetime) -> _ValidList:
    """Check one list against the create rules; return it trimmed and normalized.

    The order of checks (and so which problem is reported first) matches the
    frontend's ``validateList``.
    """
    title = _for_list(raw.title, lambda: validated_title(raw.title))
    tags = _for_list(title, lambda: _normalized_tags(raw.tags, max_tags))

    if len(raw.items) > MAX_ITEMS_PER_LIST:
        raise ImportRejectedError(
            f"{_label(title)} has {len(raw.items)} items; the limit is {MAX_ITEMS_PER_LIST}."
        )

    seen: set[str] = set()
    items: list[_ValidItem] = []
    for item in raw.items:
        text = _for_list(title, lambda item=item: validated_text(item.text))
        note = _for_list(title, lambda item=item: validated_note(item.note))
        image_url = _for_list(title, lambda item=item: validated_image_url(item.image_url))
        if text.lower() in seen:
            raise ImportRejectedError(f"{_label(title)} has '{text}' more than once.")
        seen.add(text.lower())
        created_at, updated_at = _timestamps(item.created_at, item.updated_at, now)
        items.append(_ValidItem(text, note, image_url, created_at, updated_at))

    created_at, updated_at = _timestamps(raw.created_at, raw.updated_at, now)
    return _ValidList(raw.local_id, title, tags, created_at, updated_at, items)


def validate_import(request: ListsImport, max_tags: int, now: datetime) -> list[_ValidList]:
    """Check every list, raising ``ImportRejectedError`` for the first that fails."""
    local_ids = [raw.local_id for raw in request.lists]
    if len(set(local_ids)) != len(local_ids):
        raise ImportRejectedError("The same list is in this upload more than once.")
    return [_validate_list(raw, max_tags, now) for raw in request.lists]


# ─── Writing ────────────────────────────────────────────────────────────────────


def _write(
    db: Session, user_id: uuid.UUID, device_id: str, lists: list[_ValidList]
) -> list[ImportOutcome]:
    """Add every list not already imported. Flushes; the caller commits."""
    keys = [f"{device_id}:{valid.local_id}" for valid in lists]
    # Deleted lists count too: a list imported and then deleted stays deleted.
    existing = {
        row.import_key: row
        for row in db.scalars(
            select(List).where(List.user_id == user_id, List.import_key.in_(keys))
        )
    }
    taken = {
        title.lower()
        for title in db.scalars(
            select(List.title).where(List.user_id == user_id, List.deleted_at.is_(None))
        )
    }
    tags: dict[str, Tag] = {}

    outcomes: list[ImportOutcome] = []
    for valid, key in zip(lists, keys, strict=True):
        found = existing.get(key)
        if found is not None:
            live = found if found.deleted_at is None else None
            outcomes.append(ImportOutcome(valid.local_id, True, live, None))
            continue

        title = unique_title(valid.title, taken)
        taken.add(title.lower())
        for name in valid.tags:
            if name not in tags:
                tags[name] = tag_service.get_or_create_tag(db, name)

        row = List(
            user_id=user_id,
            title=title,
            import_key=key,
            created_at=valid.created_at,
            updated_at=valid.updated_at,
            tags=[tags[name] for name in valid.tags],
            items=[
                ListItem(
                    position=index + 1,
                    text=item.text,
                    note=item.note,
                    image_url=item.image_url,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
                for index, item in enumerate(valid.items)
            ],
        )
        db.add(row)
        renamed_from = valid.title if title != valid.title else None
        outcomes.append(ImportOutcome(valid.local_id, False, row, renamed_from))

    db.flush()
    return outcomes


def import_lists(
    db: Session,
    user_id: uuid.UUID,
    request: ListsImport,
    max_tags: int,
    now: datetime | None = None,
) -> list[ImportOutcome]:
    """Validate and import ``request``'s lists for ``user_id``, all or nothing.

    Raises ``ImportRejectedError`` (nothing written) if any list breaks a rule.
    Returns one outcome per uploaded list, in order.
    """
    valid = validate_import(request, max_tags, now or datetime.now(UTC))
    outcomes: list[ImportOutcome] = []

    # Two requests racing (a double-click, or a retry while the first is still
    # running) can both miss the existing-key lookup, or both insert the same new
    # tag; the loser trips a unique constraint. Retry once after a rollback: the
    # second attempt sees what the winner committed and returns those lists.
    for attempt in range(2):
        try:
            outcomes = _write(db, user_id, request.device_id, valid)
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 1:
                raise

    for outcome in outcomes:
        if outcome.list_row is not None and not outcome.already_imported:
            # Load the database-computed `item_count` for the response.
            db.refresh(outcome.list_row)
    return outcomes
