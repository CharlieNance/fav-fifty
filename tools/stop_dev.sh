#!/usr/bin/env bash
#
# stop_dev.sh — stop the backend/frontend processes started by run_dev.sh.
# Uses `taskkill //T //F` (not plain `kill`) because uvicorn --reload and
# `npm run dev` both spawn a child process on Windows, and killing just the
# tracked PID leaves the real server running as an orphan. `//T` kills the
# whole tree.
#
#   ./tools/stop_dev.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

stop_one() {
  local name="$1" pidfile="logs/$1.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" 2>/dev/null; then
      taskkill //PID "$pid" //T //F >/dev/null 2>&1 || kill "$pid" 2>/dev/null || true
      echo "Stopped $name (PID $pid)."
    else
      echo "$name not running."
    fi
    rm -f "$pidfile"
  else
    echo "$name not running (no PID file)."
  fi
}

stop_one backend
stop_one frontend

echo "Postgres left running — stop it separately with 'docker compose down' if needed."
