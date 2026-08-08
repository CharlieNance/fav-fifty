#!/usr/bin/env bash
#
# mock_probe.sh — comb through the Claude Design homepage mock without opening it.
#
# `docs/Fav Fifty Homepage.html` is a single ~400 KB file; what we actually care
# about when referencing it is small: the colors, the (few) interactions, and the
# layout choices. This script pulls each of those out so nobody has to scroll the
# raw file. Read-only; safe to run anytime.
#
# Usage (from anywhere in the repo):
#   ./tools/mock_probe.sh colors          # every color literal, deduped, with counts
#   ./tools/mock_probe.sh motion          # transition/animation/transform declarations
#   ./tools/mock_probe.sh states          # :hover/:active/:focus rules, with their selectors
#   ./tools/mock_probe.sh layout          # flex/grid/position/max-width declarations, deduped
#   ./tools/mock_probe.sh find <regex>    # grep the mock with context (case-insensitive)
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MOCK="$REPO_ROOT/docs/Fav Fifty Example.html"

if [ ! -f "$MOCK" ]; then
  echo "Mock not found: $MOCK" >&2
  exit 1
fi

# Strip data: URIs (embedded images) so their base64 noise never pollutes matches.
clean() {
  sed -E 's/data:[^"'\'')]*//g' "$MOCK"
}

cmd="${1:-}"
case "$cmd" in
  colors)
    # Hex, rgb()/rgba(), hsl(), oklch() literals — sorted by how often they appear,
    # so the palette's workhorses float to the top.
    clean |
      grep -oiE '#[0-9a-f]{3,8}\b|(rgb|rgba|hsl|hsla|oklch)\([^)]*\)' |
      tr 'A-F' 'a-f' | sort | uniq -c | sort -rn
    ;;
  motion)
    clean |
      grep -oiE '(transition|animation|transform|@keyframes)[^;{]*[;{]' |
      sed -E 's/[;{]$//' | sed -E 's/^[[:space:]]+//' | sort | uniq -c | sort -rn
    ;;
  states)
    # Selector + rule body for every :hover/:active/:focus rule. The mock keeps
    # its CSS in one <style> block, so a brace-bounded match per rule works.
    clean |
      grep -oE '[^{}]{1,120}:(hover|active|focus(-visible|-within)?)[^{}]{0,60}\{[^}]*\}' |
      sed -E 's/^[[:space:]]+//'
    ;;
  layout)
    clean |
      grep -oiE '(display|grid-template[a-z-]*|flex[a-z-]*|justify-content|align-items|gap|position|max-width|aspect-ratio)[[:space:]]*:[^;}]*' |
      sed -E 's/[[:space:]]+/ /g; s/^ //' | sort | uniq -c | sort -rn
    ;;
  find)
    pattern="${2:?usage: mock_probe.sh find <regex>}"
    clean | grep -inE -C 2 "$pattern" || echo "(no matches)"
    ;;
  *)
    echo "usage: mock_probe.sh {colors|motion|states|layout|find <regex>}" >&2
    exit 1
    ;;
esac
