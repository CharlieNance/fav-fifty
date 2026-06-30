"""Health-check endpoint.

Used by load balancers / uptime checks, and serves as the first end-to-end slice
proving the app can receive and answer a request.
"""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
