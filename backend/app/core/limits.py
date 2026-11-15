"""Fixed content limits — the one place each number is written down.

Validators, services, ORM column sizes and ``GET /api/v1/config/client`` all import
from here, so they can't drift apart (docs/ANONYMOUS_AND_LOCAL_LISTS_PLAN.md
§Shared limits). Clients get these values from the config endpoint instead of
hard-coding them.

These are deliberately **constants, not runtime settings**
(``app/core/runtime_settings.py``):

* The length limits match DB column sizes, so changing one needs a migration anyway.
* ``MAX_ITEMS_PER_LIST`` is the product's identity ("fifty"). It's served so clients
  don't hard-code it, not so it can be tuned.
"""

MAX_ITEMS_PER_LIST = 50

# ``lists.title`` is ``String(MAX_TITLE_LENGTH)``.
MAX_TITLE_LENGTH = 200

# ``list_items.text`` is ``String(MAX_ITEM_TEXT_LENGTH)``.
MAX_ITEM_TEXT_LENGTH = 500

# ``list_items.note`` is an unbounded ``Text`` column; this is an application cap
# that just keeps notes reasonable.
MAX_NOTE_LENGTH = 2000

# ``list_items.image_url`` is ``String(MAX_IMAGE_URL_LENGTH)``.
MAX_IMAGE_URL_LENGTH = 2048

# ``tags.name`` is ``String(MAX_TAG_LENGTH)``.
MAX_TAG_LENGTH = 50

# ``device_id`` and ``local_id`` in ``POST /lists/import``. The app generates UUIDs
# (36 characters); the extra room tolerates a hand-edited document. ``lists.
# import_key`` (``"<device_id>:<local_id>"``) is sized from this.
MAX_LOCAL_ID_LENGTH = 64
MAX_IMPORT_KEY_LENGTH = 2 * MAX_LOCAL_ID_LENGTH + 1
