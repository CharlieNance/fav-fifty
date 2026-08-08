#!/usr/bin/env bash
#
# run_dev.sh — start Postgres, the FastAPI backend, and the Vite frontend
# together in the background, for manually poking at the app or driving it
# with a browser (e.g. the `run` skill + chromium-cli). Existing terminal
# workflows (running uvicorn/vite in their own foreground shells) still work
# fine — this is just a one-command shortcut when you want all three up at
# once without babysitting three terminals.
#
#   ./tools/run_dev.sh          # start db + backend + frontend
#   ./tools/stop_dev.sh         # stop backend + frontend (db keeps running)
#
# Logs go to logs/backend.log and logs/frontend.log (git-ignored). PIDs are
# tracked in logs/*.pid so stop_dev.sh knows what to kill.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

mkdir -p logs

"$REPO_ROOT/tools/db_up.sh"

if [ -f logs/backend.pid ] && kill -0 "$(cat logs/backend.pid)" 2>/dev/null; then
  echo "Backend already running (PID $(cat logs/backend.pid))."
else
  echo "Starting backend..."
  (cd backend && nohup uv run uvicorn app.main:app --reload >"$REPO_ROOT/logs/backend.log" 2>&1 &
   echo $! >"$REPO_ROOT/logs/backend.pid")
fi

if [ -f logs/frontend.pid ] && kill -0 "$(cat logs/frontend.pid)" 2>/dev/null; then
  echo "Frontend already running (PID $(cat logs/frontend.pid))."
else
  echo "Starting frontend..."
  (cd frontend && nohup npm run dev >"$REPO_ROOT/logs/frontend.log" 2>&1 &
   echo $! >"$REPO_ROOT/logs/frontend.pid")
fi

echo "Backend:  http://localhost:8000/docs   (logs/backend.log)"
echo "Frontend: http://localhost:5173        (logs/frontend.log)"
echo "Run ./tools/stop_dev.sh when done."
