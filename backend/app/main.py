"""FastAPI application entrypoint.

Run locally from the ``backend/`` directory:

    uvicorn app.main:app --reload

Then open http://localhost:8000/api/v1/health and http://localhost:8000/api/v1/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import API_V1_PREFIX, api_router
from app.core.config import settings


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

    # Restrict cross-origin requests to known frontends (the Vue dev server, prod site).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)

    return app


app = create_app()
