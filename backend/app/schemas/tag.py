"""Tag API schemas — the public shape of a list's tag set across the HTTP boundary."""

from pydantic import BaseModel, field_validator

from app.services.tag_service import normalize_tag_name


class TagsUpdate(BaseModel):
    """Body for ``PUT /api/lists/{list_id}/tags`` — replaces a list's full tag set.

    Each entry is normalized (trimmed, whitespace-collapsed, lower-cased) the same
    way ``tag_service.set_list_tags`` would need to anyway, so the set that reaches
    the service is already de-dupeable by plain equality.
    """

    tags: list[str]

    @field_validator("tags")
    @classmethod
    def _tags_normalized(cls, value: list[str]) -> list[str]:
        return [normalize_tag_name(tag) for tag in value]
