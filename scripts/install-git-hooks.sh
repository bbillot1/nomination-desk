#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'ERROR: run this script inside the nomination-desk Git repository.\n' >&2
  exit 1
}
cd "$repo_root"

install_hook() {
  local name="$1"
  local target=".git/hooks/$name"
  local source="../../.githooks/$name"

  if [[ -e "$target" && ! -L "$target" ]]; then
    mv "$target" "$target.backup.$(date +%Y%m%d%H%M%S)"
    printf 'Backed up existing %s hook.\n' "$name"
  fi

  ln -sfn "$source" "$target"
  printf 'Installed %s hook.\n' "$name"
}

chmod +x scripts/check-commit-safety.sh scripts/check-working-tree-safety.sh \
  scripts/test-safety-guards.sh .githooks/pre-commit .githooks/pre-push
install_hook pre-commit
install_hook pre-push

printf 'Git safety hooks are active for %s.\n' "$repo_root"
