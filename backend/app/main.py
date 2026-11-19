"""FastAPI application entrypoint.

Run locally from the ``backend/`` directory:

    uvicorn app.main:app --reload

Then open http://localhost:8000/api/v1/health and http://localhost:8000/api/v1/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import API_V1_PREFIX, api_router
from app.api.routes.events import MAX_EVENTS_BODY_BYTES
from app.core.config import settings
from app.core.middleware import (
    BodySizeLimitMiddleware,
    CsrfOriginMiddleware,
    OriginVerifyMiddleware,
)
from app.core.rate_limit import InMemoryRateLimitStore
from app.core.request_counts import PostgresRequestCounter, RequestCountMiddleware
from app.core.runtime_settings import get_runtime_settings
from app.db.session import SessionLocal

IMPORT_PATH = f"{API_V1_PREFIX}/lists/import"
EVENTS_PATH = f"{API_V1_PREFIX}/events"
HEALTH_PATH = f"{API_V1_PREFIX}/health"


def create_app() -> FastAPI:
    """Application factory — builds and configures the FastAPI app.

    Using a factory (instead of a single module-level instance) keeps setup
    explicit and lets tests construct a fresh, isolated app per test.
    """
    # The docs and schema live under the API prefix too: in production only
    # `/api/v1/*` reaches this app (everything else is the SPA), so root-level
    # `/docs` would be unreachable there.
    app = FastAPI(
        title="Fav Fifty API",
        version="0.1.0",
        openapi_url=f"{API_V1_PREFIX}/openapi.json",
        docs_url=f"{API_V1_PREFIX}/docs",
        redoc_url=None,
    )

    # Per-app rate-limit buckets (app.api.rate_limits). In-process: run one worker.
    app.state.rate_limiter = InMemoryRateLimitStore()
    # Where request counts go (app/core/request_counts.py); None = not counted.
    # Lambda routes have no database. Tests swap in an in-memory counter.
    counting = settings.request_counts_enabled and settings.deploy_target != "lambda"
    app.state.request_counter = PostgresRequestCounter(SessionLocal) if counting else None
    # The dashboard's few-minute cache (app/api/routes/admin.py).
    app.state.dashboard_cache = None

    def body_limit_for(path: str) -> int | None:
        """The import takes whole device documents and events get a small cap;
        everything else gets the default.

        Read through ``dependency_overrides`` so a test's runtime settings apply here
        the same way they do in routes.
        """
        if path == EVENTS_PATH:
            return MAX_EVENTS_BODY_BYTES
        if path != IMPORT_PATH:
            return None
        resolve = app.dependency_overrides.get(get_runtime_settings, get_runtime_settings)
        return resolve().limits.max_import_bytes

    # Middleware added last runs first. Outermost → innermost: request counts,
    # origin secret, body size, CORS, CSRF origin check (app/core/middleware.py).
    app.add_middleware(
        CsrfOriginMiddleware,
        allowed_origins=[*settings.cors_origins, settings.frontend_url],
        cookie_name=settings.session_cookie_name,
    )
    # Restrict cross-origin requests to known frontends (the Vue dev server, prod site).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )
    app.add_middleware(BodySizeLimitMiddleware, limit_for=body_limit_for)
    app.add_middleware(
        OriginVerifyMiddleware,
        secret=settings.origin_verify_secret,
        exempt_paths=[HEALTH_PATH],
    )
    # Outermost, so it also counts what the guards above turn away.
    app.add_middleware(RequestCountMiddleware, prefix=API_V1_PREFIX)

    app.include_router(api_router)

    return app


app = create_app()
