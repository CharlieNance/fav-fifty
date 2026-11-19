"""Application configuration.

Settings are read from environment variables (and, for local development, a
``.env`` file) via pydantic-settings. Never hard-code secrets: in AWS they come
from Secrets Manager / SSM Parameter Store; locally from ``.env`` (git-ignored).

``backend/.env.example`` documents every backend variable. For local dev you can
copy it to ``backend/.env`` or export real environment variables — real env vars
always win over the file.
"""

from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# local = a developer's machine or CI; the others are the production targets
# (docs/DEPLOYMENT_TOPOLOGY_PLAN.md).
DeployTarget = Literal["local", "lightsail", "lambda"]

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
    # Admin routes also need a *recent* sign-in: the session must have been issued
    # within this window (docs/ARCHITECTURE.md §Access control). Kept out
    # of runtime settings on purpose: an SSM write shouldn't be able to weaken it.
    admin_recent_login_seconds: int = 60 * 60 * 12  # 12 hours

    # Admin dashboard (docs/ARCHITECTURE.md §Dashboards).
    # Per-minute request counts into Postgres. Always off on Lambda (no database).
    request_counts_enabled: bool = True
    # Link to the CloudWatch health dashboard (created by Terraform); empty = no link.
    cloudwatch_dashboard_url: str = ""
    # The daily job's Cost Explorer snapshot. Off until the box's IAM user has
    # ce:GetCostAndUsage (each call is $0.01; the job makes one a day).
    cost_snapshot_enabled: bool = False

    # Where the SPA lives — used to resolve post-login redirects to an absolute URL
    # and as the default landing page after a successful sign-in.
    frontend_url: str = "http://localhost:5173"

    # Which deployment is answering, and the build it runs — both reported by
    # GET /api/v1/health. Set at image build / deploy time; the defaults mean "a
    # developer's machine".
    deploy_target: DeployTarget = "local"
    git_sha: str = "unknown"

    # Where runtime settings (switches, limits — app/core/runtime_settings.py) are
    # read from: "env" = RUNTIME_* env vars / .env (local dev, CI), "ssm" = SSM
    # Parameter Store under the prefix below (AWS). Limits like the tag cap live
    # there, not here, so they can change without a deploy.
    runtime_settings_source: Literal["env", "ssm"] = "env"
    runtime_settings_ssm_prefix: str = "/favfifty/settings"

    # The IP block list the admin abuse view edits (app/core/ip_blocklist.py). "waf"
    # = the two WAFv2 IP sets below (created by Terraform; the WAF enforces them at
    # the edge). "local" = a git-ignored JSON file that nothing enforces, so the
    # page works in development.
    ip_blocklist_source: Literal["local", "waf"] = "local"
    ip_blocklist_local_path: str = ".ip_blocklist.local.json"
    waf_ipv4_ip_set_arn: str = ""
    waf_ipv6_ip_set_arn: str = ""

    # Postgres cancels any app query running longer than this, so one pathological
    # query (e.g. an ILIKE search) can't pin the box's CPU. 0 turns it off.
    db_statement_timeout_ms: int = 5000

    # The secret CloudFront adds to every request it forwards to the origin, as the
    # ``X-Origin-Verify`` header (docs/DEPLOYMENT_TOPOLOGY_PLAN.md §Security). When
    # set, the app rejects requests without it (so nobody can bypass CloudFront and
    # its WAF by calling the box directly) and trusts ``CloudFront-Viewer-Address``
    # for the client IP. Empty locally: no check, and the socket peer is the client.
    # A real secret: Secrets Manager / SSM, never committed.
    origin_verify_secret: str = ""

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

    # Absolute URL of our own `/api/v1/auth/callback`, registered as an allowed callback
    # on the Cognito app client. Cognito redirects the browser back here with the code.
    cognito_redirect_uri: str = "http://localhost:8000/api/v1/auth/callback"

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

    @model_validator(mode="after")
    def _deployed_targets_are_hardened(self) -> "Settings":
        """Refuse to boot a deployed app with development behavior.

        ``app_env`` defaults to ``development``, which turns on the dev-login stub
        (anyone becomes the dev user) and non-Secure cookies. A deploy that forgot
        ``APP_ENV`` would otherwise ship both silently, so a real deploy target must
        say it isn't development. The box is only safe behind CloudFront, so it also
        needs the origin secret.
        """
        if self.deploy_target != "local" and self.is_development:
            raise ValueError(
                f"APP_ENV must not be 'development' when DEPLOY_TARGET={self.deploy_target!r} "
                "(development enables the dev-login stub)."
            )
        if self.deploy_target == "lightsail" and not self.origin_verify_secret:
            raise ValueError(
                "ORIGIN_VERIFY_SECRET must be set when DEPLOY_TARGET='lightsail', so only "
                "CloudFront can reach the API."
            )
        return self


# Imported wherever configuration is needed: ``from app.core.config import settings``.
settings = Settings()
