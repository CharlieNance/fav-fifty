#!/usr/bin/env bash
#
# audit.sh — check both apps' locked dependencies for known vulnerabilities.
#
# Backend:  pip-audit (OSV database) over the exact versions in backend/uv.lock.
# Frontend: npm audit over frontend/package-lock.json (prod + dev deps).
#
# Fails on any advisory that isn't on the allowlist below. The allowlist is for
# advisories with no usable fix that we've judged harmless here. Every entry
# says why, and should be removed as soon as a fix lands (rerun this script
# after a dependency bump to find out). CI runs this in .github/workflows/audit.yml.
#
# Needs network access. pip-audit runs via `uvx`, so nothing gets installed
# into the project.
#
#   ./tools/audit.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- Backend allowlist (pip-audit IDs) --------------------------------------
# PYSEC-2026-4146  pyjwt: decode() mutates a reused `options` dict. No fix yet.
#                  We pass a fresh dict literal per call (app/auth/providers.py).
PY_IGNORE=(PYSEC-2026-4146)

# --- Frontend allowlist (GHSA IDs) ------------------------------------------
# GHSA-fc5q-39xc-vjpf  picomatch ReDoS. No fixed release. Build/test tooling
#                      only (vite, vue-router's build plugin); not in dist/, and
#                      the glob patterns are ours, not user input.
# GHSA-3g3m-2fjr-6pw4  glob, via @vue/test-utils -> js-beautify. Tests only.
# GHSA-g3hv-75wg-m249  minimatch <11.0.1. Dependents still pin ^10. Dev tooling only.
NPM_ALLOW="GHSA-fc5q-39xc-vjpf GHSA-3g3m-2fjr-6pw4 GHSA-g3hv-75wg-m249"

echo "### Backend: pip-audit ###"
(
  cd "$REPO_ROOT/backend"
  req="$(mktemp)"
  trap 'rm -f "$req"' EXIT
  uv export --frozen --extra dev --no-emit-project --quiet -o "$req"
  ignore_args=()
  for id in "${PY_IGNORE[@]}"; do ignore_args+=(--ignore-vuln "$id"); done
  uvx pip-audit@2.10.1 -r "$req" --disable-pip --vulnerability-service osv --timeout 60 "${ignore_args[@]}"
)

echo
echo "### Frontend: npm audit ###"
(
  cd "$REPO_ROOT/frontend"
  # npm audit exits non-zero whenever it finds anything, so take its JSON and
  # decide pass/fail ourselves against the allowlist.
  npm audit --json 2>/dev/null | node -e '
    const allow = new Set(process.argv[1].split(" "));
    const report = JSON.parse(require("fs").readFileSync(0, "utf8"));
    if (report.error) { console.error(report.error); process.exit(2); }
    const bad = new Map();
    let allowed = 0;
    for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
      for (const adv of v.via.filter((x) => typeof x === "object")) {
        const id = adv.url.split("/").pop();
        if (allow.has(id)) allowed++;
        else bad.set(id, `${name} ${adv.range} [${adv.severity}] ${adv.title} ${adv.url}`);
      }
    }
    for (const line of bad.values()) console.error(line);
    if (bad.size) { console.error(`\n${bad.size} advisory(ies) not on the allowlist in tools/audit.sh.`); process.exit(1); }
    console.log(`No known vulnerabilities outside the allowlist (${allowed} allowlisted finding(s)).`);
  ' "$NPM_ALLOW"
)

echo
echo "Audit passed."
