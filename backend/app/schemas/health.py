"""Response schema for ``GET /api/v1/health``."""

from typing import Literal

from pydantic import BaseModel

from app.core.config import DeployTarget


class HealthRead(BaseModel):
    status: Literal["ok"]
    deploy_target: DeployTarget
    # The commit the running build was made from ("unknown" outside a built image).
    git_sha: str
