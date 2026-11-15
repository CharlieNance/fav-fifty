"""``GET /api/v1/config/client`` — the public runtime config clients validate against."""

from collections.abc import Callable

from fastapi.testclient import TestClient

from app.core import limits
from app.core.runtime_settings import Limits, RuntimeSettings
from app.models.list import List
from app.models.list_item import ListItem
from app.models.tag import Tag


def test_client_config_is_public_and_serves_the_defaults(client: TestClient) -> None:
    response = client.get("/config/client")

    assert response.status_code == 200
    assert response.json() == {
        "limits": {
            "max_tags_per_list": 25,
            "max_items_per_list": 50,
            "max_title_length": 200,
            "max_item_text_length": 500,
            "max_note_length": 2000,
            "max_image_url_length": 2048,
            "max_tag_length": 50,
        }
    }


def test_client_config_follows_the_runtime_settings(
    client: TestClient, set_runtime_settings: Callable[[RuntimeSettings], None]
) -> None:
    set_runtime_settings(RuntimeSettings(limits=Limits(max_tags_per_list=7)))

    assert client.get("/config/client").json()["limits"]["max_tags_per_list"] == 7


def test_served_length_limits_match_the_column_sizes() -> None:
    """A validator that allowed more than its column holds would 500 on insert."""
    assert List.__table__.c.title.type.length == limits.MAX_TITLE_LENGTH
    assert ListItem.__table__.c.text.type.length == limits.MAX_ITEM_TEXT_LENGTH
    assert ListItem.__table__.c.image_url.type.length == limits.MAX_IMAGE_URL_LENGTH
    assert Tag.__table__.c.name.type.length == limits.MAX_TAG_LENGTH
