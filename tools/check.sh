#!/usr/bin/env bash
#
# check.sh — run the same checks CI will, before you open a PR.
#
# Mirrors .github/workflows/ci.yml:
#   Backend:  ruff check, ruff format --check, alembic upgrade head, pytest
#   Frontend: eslint, prettier --check, vue-tsc + build, vitest
# Exits non-zero on the first failure, so "check.sh passed" == "safe to merge".
# This mirrors our "CI green = mergeable / don't merge red" rule.
#
# Note: the migration + pytest steps need the local Postgres running — start it
# with ./tools/db_up.sh first.
#
#   ./tools/check.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "### Backend: ruff + format + migrate + tests ###"
(
  cd "$REPO_ROOT/backend"
  uv run ruff check .
  uv run ruff format --check .

  # CI applies migrations before tests; mirror that so a broken migration shows
  # up locally too. Requires the local Postgres (start it with ./tools/db_up.sh).
  if [ "$(docker inspect --format '{{.State.Running}}' favfifty-db 2>/dev/null || echo false)" != "true" ]; then
    echo "Postgres container 'favfifty-db' isn't running. Start it with: ./tools/db_up.sh" >&2
    exit 1
  fi
  uv run alembic upgrade head

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
