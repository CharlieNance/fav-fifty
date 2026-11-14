"""Health-check endpoint.

Used by load balancers / uptime checks, and serves as the first end-to-end slice
proving the app can receive and answer a request. Also says *which* deployment
answered and *which build* it runs, so a CloudFront routing flip (box ↔ Lambda) or
a deploy can be confirmed from outside (docs/DEPLOYMENT_TOPOLOGY_PLAN.md).
"""

from fastapi import APIRouter

from app.core.config import settings
from app.schemas.health import HealthRead

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthRead)
def health_check() -> HealthRead:
    return HealthRead(
        status="ok",
        deploy_target=settings.deploy_target,
        git_sha=settings.git_sha,
    )
