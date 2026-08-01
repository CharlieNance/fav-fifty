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

    # Where the SPA lives — used to resolve post-login redirects to an absolute URL
    # and as the default landing page after a successful sign-in.
    frontend_url: str = "http://localhost:5173"

    # ─── AWS Cognito (real Google→Cognito auth) ────────────────────────────────
    # All empty in local dev, where the dev-login stub stands in. When these are
    # set, the real OAuth routes activate and Cognito becomes the identity provider
    # (see app/auth/providers.py and app/api/routes/auth.py). The client secret is
    # a real secret — source it from Secrets Manager / SSM in AWS, never commit it.
    cognito_user_pool_id: str = ""
    cognito_client_id: str = ""
    cognito_client_secret: str = ""
    cognito_domain: str = ""  # host only, e.g. favfifty.auth.us-east-1.amazoncognito.com
    cognito_region: str = "us-east-1"

    # Absolute URL of our own `/auth/callback`, registered as an allowed callback on
    # the Cognito app client. Cognito redirects the browser back here with the code.
    cognito_redirect_uri: str = "http://localhost:8000/auth/callback"

    @property
    def cors_origins(self) -> list[str]:
        """``cors_allowed_origins`` parsed into a list."""
        return [origin.strip() for origin in self.cors_allowed_origins.split(",") if origin.strip()]

    @property
    def is_development(self) -> bool:
        """True only in local development — gates the dev login stub."""
        return self.app_env == "development"

    @property
    def cognito_configured(self) -> bool:
        """True once every value the real OAuth flow needs is present.

        Gates both the identity-provider factory and the `/auth/login|callback`
        routes: absent config → the real flow simply doesn't exist (404), and dev
        falls back to the stub.
        """
        return all(
            (
                self.cognito_user_pool_id,
                self.cognito_client_id,
                self.cognito_client_secret,
                self.cognito_domain,
                self.cognito_region,
            )
        )

    @property
    def cognito_issuer(self) -> str:
        """OIDC issuer for our user pool — the `iss` we require on every id token."""
        return (
            f"https://cognito-idp.{self.cognito_region}.amazonaws.com/{self.cognito_user_pool_id}"
        )

    @property
    def cognito_jwks_url(self) -> str:
        """Where Cognito publishes the public keys used to verify id-token signatures."""
        return f"{self.cognito_issuer}/.well-known/jwks.json"

    @property
    def cognito_authorize_url(self) -> str:
        """Hosted-UI authorize endpoint we redirect the browser to at login."""
        return f"https://{self.cognito_domain}/oauth2/authorize"

    @property
    def cognito_token_url(self) -> str:
        """Token endpoint where the callback exchanges the auth code for tokens."""
        return f"https://{self.cognito_domain}/oauth2/token"

    @property
    def cognito_logout_url(self) -> str:
        """Hosted-UI logout endpoint (clears the Cognito session), for full sign-out."""
        return f"https://{self.cognito_domain}/logout"

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
