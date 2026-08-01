#!/usr/bin/env bash
#
# coverage.sh — print test coverage for both apps.
#
# Backend: pytest-cov, terminal report with missing line numbers.
# Frontend: Vitest's v8 coverage provider (@vitest/coverage-v8), terminal
# report + coverage/coverage-summary.json (git-ignored, safe to delete anytime).
#
#   ./tools/coverage.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "### Backend coverage (pytest-cov) ###"
(
  cd "$REPO_ROOT/backend"
  uv run pytest --cov=app --cov-report=term-missing -q
)

echo
echo "### Frontend coverage (vitest) ###"
(
  cd "$REPO_ROOT/frontend"
  npm run test:coverage
)
