#!/usr/bin/env bash
#
# db_psql.sh — open an interactive psql shell against the local Postgres container.
#
# Uses `docker exec` into the running container, so there's no need to install
# a psql client locally.
#
#   ./tools/db_psql.sh
#
set -euo pipefail

DB_CONTAINER="favfifty-db"

running="$(docker inspect --format '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || echo false)"
if [ "$running" != "true" ]; then
  echo "Postgres container '$DB_CONTAINER' isn't running. Start it with: ./tools/db_up.sh" >&2
  exit 1
fi

docker exec -it "$DB_CONTAINER" psql -U favfifty -d favfifty
