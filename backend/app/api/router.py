"""The versioned API router — every route the app serves lives under ``/api/v1``.

The app serves this prefix itself in every environment (no proxy rewrite anywhere),
so ``https://favfifty.com/api/v1`` is one permanent base URL that web and mobile
clients bake in (docs/MOBILE_READINESS.md §4). Changes within v1 are additive only;
a breaking change goes to ``/api/v2`` alongside it.
"""

from fastapi import APIRouter

from app.api.routes import auth, config, health, list_items, lists, me

API_V1_PREFIX = "/api/v1"

api_router = APIRouter(prefix=API_V1_PREFIX)

# Each feature gets its own router module; register new ones here.
api_router.include_router(health.router)
api_router.include_router(config.router)
api_router.include_router(auth.router)
api_router.include_router(me.router)
api_router.include_router(lists.router)
api_router.include_router(list_items.router)
