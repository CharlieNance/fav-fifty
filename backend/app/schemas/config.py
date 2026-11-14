"""Response schema for ``GET /api/v1/config/client``.

The public, user-facing subset of the runtime settings (app/core/runtime_settings.py)
that web and mobile clients need to validate consistently and degrade gracefully.
Built field by field from ``RuntimeSettings`` — so an internal setting (e.g. the
breaker level) can't leak by being added there. Additive changes only (v1 contract).
"""

from pydantic import BaseModel


class ClientLimits(BaseModel):
    max_tags_per_list: int


class ClientConfig(BaseModel):
    limits: ClientLimits
