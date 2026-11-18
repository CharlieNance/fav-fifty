#!/usr/bin/env bash
# Grant (or revoke) the admin role. The ONLY way anyone becomes an admin: no API
# path can do it (docs/ADMIN_AND_ANALYTICS_PLAN.md §Access control). The person
# must have signed in once so their account exists.
#
#   ./tools/grant_admin.sh you@example.com            # grant
#   ./tools/grant_admin.sh --revoke you@example.com   # revoke
#   ./tools/grant_admin.sh --list                     # show admins
#
# Runs against whatever DATABASE_URL backend/.env points at (locally: the Docker
# Postgres). Locally, `./tools/grant_admin.sh dev@example.com` makes the dev-login
# user an admin. On the box, run the same `python -m app.cli` inside the API
# container (the deploy adds that wrapper).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/backend"

case "${1:-}" in
  --list) exec uv run python -m app.cli list-admins ;;
  --revoke) exec uv run python -m app.cli revoke-admin --email "${2:?usage: --revoke <email>}" ;;
  ""|-*) echo "usage: $0 <email> | --revoke <email> | --list" >&2; exit 2 ;;
  *) exec uv run python -m app.cli grant-admin --email "$1" ;;
esac
