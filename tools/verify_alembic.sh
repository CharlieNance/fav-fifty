#!/usr/bin/env bash
#
# verify_alembic.sh — read-only check that the local database matches the code.
#
# Prints (1) the migration revision the DB is currently on and (2) the tables
# that actually exist. Makes NO changes, so it's safe to run anytime.
#
# Why this script exists: `alembic` only works when run from `backend/` (that's
# where alembic.ini lives). This script cd's there for you, so you can run it
# from anywhere in the repo:  ./tools/verify_alembic.sh
#
set -euo pipefail

# Resolve the repo root from THIS script's own location (not your current
# directory), so the paths below work no matter where you invoke it from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_CONTAINER="favfifty-db"

# Fail early with a friendly message if the DB isn't up yet.
if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "Postgres container '$DB_CONTAINER' isn't running. Start it with: ./tools/db_up.sh" >&2
  exit 1
fi

echo "=== alembic current (migration the DB is on) ==="
( cd "$REPO_ROOT/backend" && uv run alembic current )

echo
echo "=== tables ==="
docker exec "$DB_CONTAINER" psql -U favfifty -d favfifty -c "\dt"
