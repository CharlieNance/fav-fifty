#!/usr/bin/env bash
#
# check.sh — run the same checks CI will, before you open a PR.
#
# Mirrors .github/workflows/ci.yml:
#   Backend:  ruff check, ruff format --check, pytest
#   Frontend: eslint, prettier --check, vue-tsc + build, vitest
# Exits non-zero on the first failure, so "check.sh passed" == "safe to merge".
# This mirrors our "CI green = mergeable / don't merge red" rule.
#
# Note: pytest needs the local Postgres running once DB-backed tests exist —
# start it first with ./tools/db_up.sh if needed.
#
#   ./tools/check.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "### Backend: ruff + pytest ###"
(
  cd "$REPO_ROOT/backend"
  uv run ruff check .
  uv run ruff format --check .
  uv run pytest
)

echo
echo "### Frontend: lint + format + type-check + test ###"
(
  cd "$REPO_ROOT/frontend"
  npm run lint
  npm run format:check
  npm run build
  npm run test
)

echo
echo "All checks passed."
