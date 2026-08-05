#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'ERROR: working-tree safety check must run inside a Git repository.\n' >&2
  exit 1
}
cd "$repo_root"

temp_index="$(mktemp "${TMPDIR:-/tmp}/nomination-desk-index.XXXXXX")"
trap 'rm -f "$temp_index"' EXIT

# Build a throwaway index containing exactly what `git add -A` would stage, without touching
# the developer's real staging area.
GIT_INDEX_FILE="$temp_index" git read-tree HEAD
GIT_INDEX_FILE="$temp_index" git add -A -- .
GIT_INDEX_FILE="$temp_index" scripts/check-commit-safety.sh --staged

printf 'Working-tree safety checks passed without modifying the real Git index.\n'
