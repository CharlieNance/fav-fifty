#!/usr/bin/env bash
#
# openapi_snapshot.sh — regenerate backend/openapi.json, the committed API contract.
#
# Run this after an intended API change, then commit the diff with it. The backend
# test suite (tests/test_api_contract.py, so CI too) fails while the snapshot
# and the app disagree — that's what makes every contract change visible in review.
# Within /api/v1, changes must be additive only (docs/MOBILE_READINESS.md §4).
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO_ROOT/backend"
uv run python -m app.openapi_snapshot
git -C "$REPO_ROOT" --no-pager diff --stat -- backend/openapi.json
