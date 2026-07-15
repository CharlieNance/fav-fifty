"""Authentication routes.

Two ways in, one shared tail. Both the dev stub and the real Google→Cognito flow
converge on ``get_or_create_user`` → ``issue_session`` → set the session cookie, so
everything past the auth seam is identical no matter how the user signed in.

* ``POST /auth/dev-login`` — **development only** shortcut: mints a session for the
  fixed dev identity so the app is usable before/without Cognito.
* ``GET /auth/login`` / ``GET /auth/callback`` — the real authorization-code + PKCE
  flow, active only once Cognito is configured. ``/login`` redirects the browser to
  the Cognito hosted UI; ``/callback`` verifies the returned id token and logs in.
* ``POST /auth/logout`` — clears our session cookie.
"""

import logging
from urllib.parse import urlencode, urljoin

import httpx2
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Response, status
from fastapi.responses import RedirectResponse
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from app.auth.oauth import (
    OAUTH_STATE_COOKIE,
    OAuthState,
    clear_oauth_state_cookie,
    exchange_code_for_tokens,
    generate_pkce_pair,
    new_random_token,
    read_state,
    safe_redirect_path,
    serialize_state,
    set_oauth_state_cookie,
)
from app.auth.providers import get_identity_provider
from app.auth.session import clear_session_cookie, issue_session, set_session_cookie
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import UserRead
from app.services import user_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/dev-login", response_model=UserRead)
def dev_login(response: Response, db: Session = Depends(get_db)) -> User:
    """Log in as the fixed dev user and set the session cookie (development only)."""
    if not settings.is_development:
        # Unreachable outside dev: return 404 so the endpoint simply doesn't exist.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    provider = get_identity_provider()  # DevIdentityProvider also hard-fails outside dev
    claims = provider.get_claims()
    user = user_service.get_or_create_user(db, claims)
    set_session_cookie(response, issue_session(user))
    return user


@router.get("/login")
def login(redirect: str | None = None) -> RedirectResponse:
    """Begin the real login flow: redirect to Cognito's hosted UI (straight to Google).

    Stashes a signed state cookie (CSRF token + nonce + PKCE verifier + the safe
    post-login redirect) that ``/callback`` reads back to finish the exchange.
    """
    if not settings.cognito_configured:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    state = new_random_token()
    nonce = new_random_token()
    code_verifier, code_challenge = generate_pkce_pair()

    params = {
        "response_type": "code",
        "client_id": settings.cognito_client_id,
        "redirect_uri": settings.cognito_redirect_uri,
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        # Skip the Cognito account chooser and go straight to Google (our only IdP).
        "identity_provider": "Google",
    }
    authorize_url = f"{settings.cognito_authorize_url}?{urlencode(params)}"

    response = RedirectResponse(authorize_url, status_code=status.HTTP_302_FOUND)
    set_oauth_state_cookie(
        response,
        serialize_state(
            OAuthState(
                state=state,
                nonce=nonce,
                code_verifier=code_verifier,
                redirect=safe_redirect_path(redirect),
            )
        ),
    )
    return response


@router.get("/callback")
async def callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    state_cookie: str | None = Cookie(default=None, alias=OAUTH_STATE_COOKIE),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Finish the login flow: verify the returned id token and mint a session.

    On any failure we redirect the browser to the frontend login page with a
    generic ``?error=`` flag (details are logged, never leaked to the URL).
    """
    if not settings.cognito_configured:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    oauth_state = read_state(state_cookie)

    if error or not code:
        logger.warning("OAuth callback error from provider: %s", error or "missing code")
        return _login_failed()

    if oauth_state is None or not state or state != oauth_state.state:
        # Missing/expired state cookie, or a `state` that doesn't match → possible CSRF.
        logger.warning("OAuth callback rejected: state mismatch or missing state cookie")
        return _login_failed()

    try:
        tokens = await exchange_code_for_tokens(code, oauth_state.code_verifier)
        claims = get_identity_provider().get_claims(tokens.get("id_token"), nonce=oauth_state.nonce)
    except (httpx2.HTTPError, InvalidTokenError, KeyError) as exc:
        logger.warning("OAuth callback failed during token exchange/verification: %r", exc)
        return _login_failed()

    user = user_service.get_or_create_user(db, claims)

    destination = urljoin(settings.frontend_url, oauth_state.redirect)
    response = RedirectResponse(destination, status_code=status.HTTP_302_FOUND)
    set_session_cookie(response, issue_session(user))
    clear_oauth_state_cookie(response)
    return response


@router.post("/logout")
def logout(response: Response) -> dict[str, str]:
    """Clear the session cookie."""
    clear_session_cookie(response)
    return {"status": "logged out"}


def _login_failed() -> RedirectResponse:
    """Redirect to the frontend login page with a generic error flag."""
    response = RedirectResponse(
        urljoin(settings.frontend_url, "/login?error=auth_failed"),
        status_code=status.HTTP_302_FOUND,
    )
    clear_oauth_state_cookie(response)
    return response
