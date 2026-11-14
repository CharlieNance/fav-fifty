"""The committed API contract: ``backend/openapi.json``.

The snapshot is the reviewable record of the v1 contract that installed mobile apps
depend on (docs/MOBILE_READINESS.md §4). ``tests/test_openapi_snapshot.py`` fails
when the app's schema drifts from it, so every contract change shows up as a diff
to this file in the PR, where it gets reviewed. Changes within v1 must be additive.

Regenerate after an intended API change (from anywhere):

    ./tools/openapi_snapshot.sh
"""

import json
from pathlib import Path

from fastapi import FastAPI

SNAPSHOT_PATH = Path(__file__).resolve().parent.parent / "openapi.json"


def render_openapi(app: FastAPI) -> str:
    """The app's schema as stable, diff-friendly JSON (LF line endings)."""
    return json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    from app.main import create_app

    # Bytes, not write_text: text mode would write CRLF on Windows.
    SNAPSHOT_PATH.write_bytes(render_openapi(create_app()).encode("utf-8"))
    print(f"Wrote {SNAPSHOT_PATH}")


if __name__ == "__main__":
    main()
