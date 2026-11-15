"""Tag service — the one place that owns the ``tags``/``list_tags`` tables' business
rules.

Kept as its own service rather than folded into ``list_service`` (see
docs/TAGS_SEARCH_PLAN.md open question 3): no tag operation is in scope today that
isn't "as part of a list," but keeping tag logic contained here means it can grow
(search filtering, eventually a curated category system) without list_service
absorbing that complexity.

Functions take a ``Session`` argument (not a global), so they unit-test without the
HTTP app.
"""

import re

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.limits import MAX_TAG_LENGTH
from app.models.list import List
from app.models.tag import Tag

_WHITESPACE_RE = re.compile(r"\s+")


class TooManyTagsError(Exception):
    """Raised when a submitted tag set exceeds the per-list tag cap."""


def normalize_tag_name(name: str) -> str:
    """Trim, collapse internal whitespace, and lower-case a tag name.

    The one normalization rule, shared by every entry point that touches tag text
    (replacing a list's tags here; matching tags in search once that lands) so
    ``"Sci-Fi"``, ``"sci-fi"``, and ``"  sci-fi  "`` are always the same tag. Enforces
    the same length limit as the ``tags.name`` column (``String(MAX_TAG_LENGTH)``).
    """
    collapsed = _WHITESPACE_RE.sub(" ", name.strip()).lower()
    if not collapsed:
        raise ValueError("Tag is required.")
    if len(collapsed) > MAX_TAG_LENGTH:
        raise ValueError(f"Tag must be {MAX_TAG_LENGTH} characters or fewer.")
    return collapsed


def get_or_create_tag(db: Session, name: str) -> Tag:
    """Look up an already-normalized tag name, reusing the row if it exists."""
    row = db.scalar(select(Tag).where(Tag.name == name))
    if row is None:
        row = Tag(name=name)
        db.add(row)
        db.flush()
    return row


def set_list_tags(db: Session, list_row: List, names: list[str], max_tags: int) -> List:
    """Replace ``list_row``'s full tag set with ``names`` (already normalized).

    ``max_tags`` is the cap (a runtime setting, passed in by the caller) on the
    de-duplicated set; more raises ``TooManyTagsError``.

    Duplicate names are de-duplicated (case is already folded by normalization)
    rather than rejected.
    Reuses an existing
    ``Tag`` row by name instead of creating a duplicate, so two lists — even two
    different owners' lists — that both use "board games" share one row; a list that
    stops using a tag simply drops out of that row's ``lists`` relationship, and the
    orphaned ``Tag`` row is left in place (see docs/TAGS_SEARCH_PLAN.md).
    """
    deduped = list(dict.fromkeys(names))
    if len(deduped) > max_tags:
        raise TooManyTagsError

    # Two requests introducing the same brand-new tag name at once can both miss
    # `get_or_create_tag`'s lookup and race to insert it, tripping `tags.name`'s
    # unique constraint. Retry once after a rollback so the loser just reuses the
    # row the winner committed, instead of surfacing a raw 500.
    for attempt in range(2):
        try:
            list_row.tags = [get_or_create_tag(db, name) for name in deduped]
            db.commit()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 1:
                raise

    db.refresh(list_row)
    return list_row
