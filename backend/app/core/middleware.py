"""Request-hardening middleware (docs/ABUSE_PROTECTION_PLAN.md).

Plain ASGI classes rather than ``BaseHTTPMiddleware``, so the body-size cap can
watch a request body as it streams in. Wired up in ``app.main.create_app``, outermost
first:

1. ``OriginVerifyMiddleware`` — only CloudFront may call the API (when configured).
2. ``BodySizeLimitMiddleware`` — ``413`` for an oversized body, before it's parsed.
3. (CORS)
4. ``CsrfOriginMiddleware`` — cookie-authenticated writes must come from our site.
"""

from collections.abc import Callable, Iterable
from urllib.parse import urlsplit

from fastapi import HTTPException, status
from starlette.datastructures import Headers
from starlette.requests import HTTPConnection
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.client_ip import has_origin_secret

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

# Every body that isn't an import is a small JSON object; 64 KiB is generous.
DEFAULT_MAX_BODY_BYTES = 64 * 1024

TOO_LARGE = "That's too much to send at once."


async def _reject(scope: Scope, receive: Receive, send: Send, status_code: int, detail: str):
    await JSONResponse({"detail": detail}, status_code=status_code)(scope, receive, send)


class OriginVerifyMiddleware:
    """Reject requests that didn't come through CloudFront.

    CloudFront adds ``X-Origin-Verify: <secret>`` to every request it forwards; the
    box's public address must not be a way around the WAF and rate rules at the edge
    (docs/DEPLOYMENT_TOPOLOGY_PLAN.md §Security). Off when no secret is configured
    (local dev). ``exempt_paths`` (the health check) stay reachable for the box's own
    container health probe.
    """

    def __init__(self, app: ASGIApp, secret: str, exempt_paths: Iterable[str] = ()):
        self.app = app
        self.secret = secret
        self.exempt_paths = frozenset(exempt_paths)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and self.secret
            and scope["path"] not in self.exempt_paths
            and not has_origin_secret(Headers(scope=scope), self.secret)
        ):
            await _reject(scope, receive, send, status.HTTP_403_FORBIDDEN, "Forbidden")
            return
        await self.app(scope, receive, send)


class BodySizeLimitMiddleware:
    """``413`` for a request body over its path's limit.

    Neither Uvicorn nor FastAPI caps bodies. A declared ``Content-Length`` over the
    limit is refused before anything is read; a body without one (chunked) is
    counted as it arrives and refused once it passes the limit, so an oversized
    upload is never held in memory whole.

    ``limit_for(path)`` returns a path's limit, or ``None`` for the default.
    """

    def __init__(
        self,
        app: ASGIApp,
        default_max_bytes: int = DEFAULT_MAX_BODY_BYTES,
        limit_for: Callable[[str], int | None] = lambda _path: None,
    ):
        self.app = app
        self.default_max_bytes = default_max_bytes
        self.limit_for = limit_for

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self.limit_for(scope["path"])
        if limit is None:
            limit = self.default_max_bytes

        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            if not declared.isdigit():
                await _reject(scope, receive, send, 400, "Invalid Content-Length.")
                return
            if int(declared) > limit:
                await _reject(scope, receive, send, status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # FastAPI re-raises an HTTPException from body reading as-is, so
                    # this becomes an ordinary 413 response.
                    raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, detail=TOO_LARGE)
            return message

        await self.app(scope, limited_receive, send)


def origin_of(url: str) -> str | None:
    """``"https://favfifty.com/lists?x"`` → ``"https://favfifty.com"``; junk → ``None``."""
    parts = urlsplit(url.strip())
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


class CsrfOriginMiddleware:
    """Cookie-authenticated writes must come from one of our own origins.

    ``SameSite=Lax`` already stops most cross-site form posts, but not a *same-site*
    attacker (another subdomain) or an old browser. So an unsafe method
    (POST/PUT/PATCH/DELETE) that carries the session cookie must also carry an
    ``Origin`` (or, failing that, ``Referer``) from ``allowed_origins`` — else 403.

    Requests without the cookie are left alone: they aren't authenticated by
    anything a browser attaches on its own (e.g. a mobile app's bearer token), so
    there's nothing to forge.
    """

    def __init__(self, app: ASGIApp, allowed_origins: Iterable[str], cookie_name: str):
        self.app = app
        self.allowed = frozenset(o for o in (origin_of(url) for url in allowed_origins) if o)
        self.cookie_name = cookie_name

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["method"] not in _SAFE_METHODS:
            conn = HTTPConnection(scope)
            if self.cookie_name in conn.cookies and not self._from_allowed_origin(conn.headers):
                await _reject(
                    scope, receive, send, status.HTTP_403_FORBIDDEN, "Cross-site request blocked."
                )
                return
        await self.app(scope, receive, send)

    def _from_allowed_origin(self, headers: Headers) -> bool:
        origin = headers.get("origin")
        # A privacy-sensitive context sends ``Origin: null``; fall back to Referer.
        if not origin or origin == "null":
            origin = headers.get("referer")
        return origin is not None and origin_of(origin) in self.allowed
