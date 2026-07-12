#!/usr/bin/env bash
#
# db_up.sh — start the local Postgres container and wait until it's healthy.
#
# This is the RIGHT way to start the DB — it goes through docker-compose, so the
# credentials in docker-compose.yml (user/password/db name) are applied. Do NOT
# start the postgres image directly from Docker Desktop; that skips the env vars
# and fails with "POSTGRES_PASSWORD is not specified".
#
#   ./tools/db_up.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

docker compose up -d db

echo "Waiting for Postgres to report healthy..."
for _ in $(seq 1 30); do
  status="$(docker inspect --format '{{.State.Health.Status}}' favfifty-db 2>/dev/null || echo missing)"
  if [ "$status" = "healthy" ]; then
    echo "Postgres is healthy and listening on localhost:5432."
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for Postgres to become healthy. Current state:" >&2
docker compose ps
exit 1
