#!/usr/bin/env bash
#
# check.sh — run the same checks CI will, before you open a PR.
#
# Backend: ruff (lint) + pytest.  Frontend: eslint + vitest.
# Exits non-zero on the first failure, so "check.sh passed" == "safe to merge".
# This mirrors our "CI green = mergeable / don't merge red" rule.
#
#   ./tools/check.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "### Backend: ruff + pytest ###"
( cd "$REPO_ROOT/backend" && uv run ruff check . && uv run pytest )

echo
echo "### Frontend: lint + test ###"
( cd "$REPO_ROOT/frontend" && npm run lint && npm run test )

echo
echo "All checks passed."
