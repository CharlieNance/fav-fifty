#!/usr/bin/env bash
#
# db_reset.sh — wipe the local database and rebuild it fresh from migrations.
#
# DESTRUCTIVE: deletes ALL local data by removing the docker volume. That's fine
# per our "local DB is disposable" decision (docs/DECISIONS.md) — nothing local
# is worth keeping until launch. This ONLY touches the local docker-compose
# Postgres; it has no idea AWS/production exists and cannot affect it.
#
# Use when you want a guaranteed-clean slate (e.g. after messing with migrations):
#   ./tools/db_reset.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "Wiping local database (docker compose down -v)..."
docker compose down -v

# Reuse db_up.sh so "how we start the DB" lives in exactly one place.
bash "$REPO_ROOT/tools/db_up.sh"

echo "Applying migrations (alembic upgrade head)..."
( cd "$REPO_ROOT/backend" && uv run alembic upgrade head )

# Show the result so you can eyeball that it worked.
bash "$REPO_ROOT/tools/verify_alembic.sh"
