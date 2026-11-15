"""Public client configuration — the runtime limits and switches clients act on."""

from fastapi import APIRouter, Depends

from app.core import limits
from app.core.runtime_settings import RuntimeSettings, get_runtime_settings
from app.schemas.config import ClientConfig, ClientLimits

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/client", response_model=ClientConfig)
def client_config(runtime: RuntimeSettings = Depends(get_runtime_settings)) -> ClientConfig:
    """No auth: anonymous visitors and not-yet-signed-in apps need it too."""
    return ClientConfig(
        limits=ClientLimits(
            max_tags_per_list=runtime.limits.max_tags_per_list,
            max_items_per_list=limits.MAX_ITEMS_PER_LIST,
            max_title_length=limits.MAX_TITLE_LENGTH,
            max_item_text_length=limits.MAX_ITEM_TEXT_LENGTH,
            max_note_length=limits.MAX_NOTE_LENGTH,
            max_image_url_length=limits.MAX_IMAGE_URL_LENGTH,
            max_tag_length=limits.MAX_TAG_LENGTH,
        ),
    )
