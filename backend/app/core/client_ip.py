"""Who is calling — the client IP for per-IP rate limits.

In production every request reaches the box through CloudFront, so the socket peer
is a CloudFront edge, not the visitor. CloudFront puts the visitor's address in
``CloudFront-Viewer-Address`` (``"<ip>:<port>"``). Anyone can *send* that header,
though, so it's trusted **only** on a request that also carries our secret origin
header — proof CloudFront forwarded it (docs/ABUSE_PROTECTION_PLAN.md §Rate limits).

``X-Forwarded-For`` is never used: its first entry is whatever the client wrote.
"""

import hmac

from starlette.datastructures import Headers
from starlette.requests import HTTPConnection

from app.core.config import settings

ORIGIN_VERIFY_HEADER = "x-origin-verify"
VIEWER_ADDRESS_HEADER = "cloudfront-viewer-address"

_UNKNOWN = "unknown"


def has_origin_secret(headers: Headers, secret: str) -> bool:
    """True if ``secret`` is configured and the request carries it (constant-time)."""
    sent = headers.get(ORIGIN_VERIFY_HEADER)
    return bool(secret) and sent is not None and hmac.compare_digest(sent, secret)


def _strip_port(address: str) -> str:
    """``"192.0.2.1:443"`` → ``"192.0.2.1"``; ``"2001:db8::1:443"`` → ``"2001:db8::1"``.

    CloudFront writes IPv6 addresses unbracketed, so the port is after the last ``:``.
    """
    host, sep, _port = address.strip().rpartition(":")
    return host if sep and host else address.strip()


def client_ip(conn: HTTPConnection, secret: str | None = None) -> str:
    """The visitor's IP: CloudFront's viewer address when trusted, else the socket peer."""
    secret = settings.origin_verify_secret if secret is None else secret
    if has_origin_secret(conn.headers, secret):
        viewer = conn.headers.get(VIEWER_ADDRESS_HEADER)
        if viewer:
            return _strip_port(viewer) or _UNKNOWN
    return conn.client.host if conn.client else _UNKNOWN
