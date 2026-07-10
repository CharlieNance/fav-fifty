"""Application configuration.

Settings are read from environment variables (and, for local development, a
``.env`` file) via pydantic-settings. Never hard-code secrets: in AWS they come
from Secrets Manager / SSM Parameter Store; locally from ``.env`` (git-ignored).

The repo-root ``.env.example`` documents every variable used across the project.
For the backend you can create ``backend/.env`` or export real environment
variables — real env vars always win over the file.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # development | staging | production
    app_env: str = "development"

    # PostgreSQL connection URL (SQLAlchemy + psycopg 3 driver).
    database_url: str = "postgresql+psycopg://favfifty:password@localhost:5432/favfifty"

    # Comma-separated allowed CORS origins (frontend dev server, prod site, ...).
    cors_allowed_origins: str = "http://localhost:5173"

    @property
    def cors_origins(self) -> list[str]:
        """``cors_allowed_origins`` parsed into a list."""
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]


# Imported wherever configuration is needed: ``from app.core.config import settings``.
settings = Settings()
