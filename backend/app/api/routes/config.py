"""Public client configuration — the runtime limits and switches clients act on."""

from fastapi import APIRouter, Depends

from app.core.runtime_settings import RuntimeSettings, get_runtime_settings
from app.schemas.config import ClientConfig, ClientLimits

router = APIRouter(prefix="/config", tags=["config"])


@router.get("/client", response_model=ClientConfig)
def client_config(runtime: RuntimeSettings = Depends(get_runtime_settings)) -> ClientConfig:
    """No auth: anonymous visitors and not-yet-signed-in apps need it too."""
    return ClientConfig(
        limits=ClientLimits(max_tags_per_list=runtime.limits.max_tags_per_list),
    )
