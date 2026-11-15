"""Response schema for ``GET /api/v1/config/client``.

The public, user-facing limits that web and mobile clients need to validate
consistently and degrade gracefully. Two sources feed it:

* the tunable subset of the runtime settings (app/core/runtime_settings.py), built
  field by field so an internal setting (e.g. the breaker level) can't leak by being
  added there;
* the fixed content limits (app/core/limits.py), served so clients never hard-code
  them.

Additive changes only (v1 contract).
"""

from pydantic import BaseModel


class ClientLimits(BaseModel):
    # Runtime settings (tunable without a deploy).
    max_tags_per_list: int
    max_lists_per_import: int
    max_import_bytes: int
    # Fixed limits (app/core/limits.py).
    max_items_per_list: int
    max_title_length: int
    max_item_text_length: int
    max_note_length: int
    max_image_url_length: int
    max_tag_length: int


class ClientConfig(BaseModel):
    limits: ClientLimits
