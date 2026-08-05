#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

assert_permission() {
  local expected="$1"
  local command="$2"
  local actual
  actual="$(
    jq -n --arg command "$command" '{command: $command}' |
      .cursor/hooks/git-command-guard.sh |
      jq -r '.permission'
  )"
  [[ "$actual" == "$expected" ]] || {
    printf 'Expected %s for %q, got %s\n' "$expected" "$command" "$actual" >&2
    exit 1
  }
}

assert_permission allow "git status --short"
assert_permission deny "git push --force origin main"
assert_permission deny "git commit --no-verify -m unsafe"
assert_permission deny "git reset --hard HEAD"
assert_permission ask "git commit -m test"
assert_permission ask "git push origin feature/test"

head_sha="$(git rev-parse HEAD)"
zero_sha="0000000000000000000000000000000000000000"

if printf 'refs/heads/main %s refs/heads/main %s\n' "$head_sha" "$zero_sha" |
   .githooks/pre-push origin https://example.invalid/repo.git >/dev/null 2>&1; then
  printf 'Expected a direct push to main to be rejected.\n' >&2
  exit 1
fi

printf 'refs/heads/feature/test %s refs/heads/feature/test %s\n' "$head_sha" "$zero_sha" |
  .githooks/pre-push origin https://example.invalid/repo.git >/dev/null

tmp_repo="$(mktemp -d)"
trap 'rm -rf "$tmp_repo"' EXIT
git -C "$tmp_repo" init -q
printf 'not-a-secret\n' > "$tmp_repo/.env"
git -C "$tmp_repo" add -f .env

if (
  cd "$tmp_repo"
  SKIP_GITLEAKS=1 "$repo_root/scripts/check-commit-safety.sh" --staged >/dev/null 2>&1
); then
  printf 'Expected a staged .env file to be rejected.\n' >&2
  exit 1
fi

printf 'Safety guard tests passed.\n'
