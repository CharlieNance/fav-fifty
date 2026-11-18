# tools/

Small, reusable bash scripts for local development. Each is self-contained,
path-independent (run it from anywhere in the repo), and starts with a comment
explaining what it does and why.

Run them from the repo root like `./tools/<name>.sh` (Git Bash on Windows).

| Script | What it does | Safe to rerun? |
|--------|--------------|----------------|
| `db_up.sh` | Start the local Postgres container (via docker-compose) and wait until healthy. | Yes |
| `db_psql.sh` | Open an interactive psql shell against the local Postgres container. | Yes |
| `verify_alembic.sh` | Read-only: show the migration the DB is on + the tables that exist. | Yes |
| `db_reset.sh` | **Destructive.** Wipe the local DB volume, restart it, re-apply all migrations. | Yes (but erases local data) |
| `check.sh` | Run the CI checks locally: backend ruff+pytest, frontend lint+test. | Yes |
| `audit.sh` | Check both apps' locked dependencies for known vulnerabilities (pip-audit + npm audit), with a commented allowlist. Needs network. CI runs it on PRs and weekly. | Yes |
| `grant_admin.sh` | Grant (`<email>`), revoke (`--revoke <email>`) or list (`--list`) the admin role via `python -m app.cli`. The only way to make an admin. Locally, `dev@example.com` is the dev-login user. | Yes |
| `openapi_snapshot.sh` | Regenerate `backend/openapi.json` (the committed API contract) after an intended API change; commit the diff. | Yes |
| `coverage.sh` | Print test coverage for both apps (pytest-cov + vitest). | Yes |
| `run_dev.sh` | Start db + backend + frontend together in the background (logs in `logs/`), for manual poking or browser-driven testing. | Yes |
| `stop_dev.sh` | Stop the backend/frontend processes started by `run_dev.sh`. | Yes |
| `mock_probe.sh` | Read-only: comb the Claude Design homepage mock (`docs/Fav Fifty Example.html`, ~400 KB) without opening it — `colors`, `motion`, `states`, `layout` summaries, or `find <regex>`. | Yes |

## Conventions for scripts here

- Start with `#!/usr/bin/env bash` and `set -euo pipefail`.
- Resolve the repo root from the script's own location
  (`REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`) so it works
  from any directory.
- A top comment says **what** it does and **why** it exists.
- Keep them short and readable — favor several small scripts over one big one.
- `.gitattributes` forces LF endings on `*.sh`, so they run correctly even on
  Windows checkouts.
