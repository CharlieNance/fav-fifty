"""Application configuration.

Settings are read from environment variables (and, for local development, a
``.env`` file) via pydantic-settings. Never hard-code secrets: in AWS they come
from Secrets Manager / SSM Parameter Store; locally from ``.env`` (git-ignored).

``backend/.env.example`` documents every backend variable. For local dev you can
copy it to ``backend/.env`` or export real environment variables — real env vars
always win over the file.
"""

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Placeholder used only so the app boots in local dev without any setup. Any other
# environment must supply a real SECRET_KEY (from Secrets Manager / SSM).
INSECURE_DEV_SECRET_KEY = "dev-insecure-change-me"


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

    # Signs/verifies the HttpOnly session cookie (itsdangerous). In AWS this comes
    # from Secrets Manager / SSM; locally from .env. The insecure default only works
    # in development — see ``_require_real_secret_outside_dev`` below.
    secret_key: str = INSECURE_DEV_SECRET_KEY

    # Session cookie: name, lifetime, and (implicitly) the Secure flag via app_env.
    session_cookie_name: str = "favfifty_session"
    session_max_age_seconds: int = 60 * 60 * 24 * 14  # 14 days

    @property
    def cors_origins(self) -> list[str]:
        """``cors_allowed_origins`` parsed into a list."""
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    @property
    def is_development(self) -> bool:
        """True only in local development — gates the dev login stub."""
        return self.app_env == "development"

    @model_validator(mode="after")
    def _require_real_secret_outside_dev(self) -> "Settings":
        """Fail fast rather than boot a non-dev environment with the placeholder key.

        A shipped/guessable signing key would let anyone forge session cookies, so
        production/staging must supply a real ``SECRET_KEY`` (Secrets Manager / SSM).
        """
        if not self.is_development and self.secret_key == INSECURE_DEV_SECRET_KEY:
            raise ValueError(
                f"SECRET_KEY must be set to a real secret when APP_ENV={self.app_env!r} "
                "(the development placeholder is not allowed outside development)."
            )
        return self


# Imported wherever configuration is needed: ``from app.core.config import settings``.
settings = Settings()
