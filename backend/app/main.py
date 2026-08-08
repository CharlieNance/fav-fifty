"""FastAPI application entrypoint.

Run locally from the ``backend/`` directory:

    uvicorn app.main:app --reload

Then open http://localhost:8000/health and http://localhost:8000/docs
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, health, list_items, lists, me
from app.core.config import settings


def create_app() -> FastAPI:
    """Application factory — builds and configures the FastAPI app.

    Using a factory (instead of a single module-level instance) keeps setup
    explicit and lets tests construct a fresh, isolated app per test.
    """
    app = FastAPI(title="Fav Fifty API", version="0.1.0")

    # Restrict cross-origin requests to known frontends (the Vue dev server, prod site).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers are registered here. Each feature gets its own router module.
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(me.router)
    app.include_router(lists.router)
    app.include_router(list_items.router)

    return app


app = create_app()
