#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---staged}"
MAX_FILE_BYTES=$((10 * 1024 * 1024))
FAILED=0

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  FAILED=1
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'ERROR: commit safety check must run inside a Git repository.\n' >&2
  exit 1
}
cd "$repo_root"

case "$MODE" in
  --staged|--tracked|--history) ;;
  *)
    printf 'Usage: %s [--staged|--tracked|--history]\n' "$0" >&2
    exit 2
    ;;
esac

is_forbidden_path() {
  local path="$1"
  local base="${path##*/}"

  case "$path" in
    .env|*/.env|.env.*|*/.env.*)
      case "$base" in
        .env.example|.env.sample|.env.template) return 1 ;;
      esac
      return 0
      ;;
    .mcp.json|*/.mcp.json|.cursor/mcp.json|*/.cursor/mcp.json)
      return 0
      ;;
    .supabase/*|*/.supabase/*|supabase/.temp/*|supabase/.branches/*)
      return 0
      ;;
  esac

  case "$base" in
    .DS_Store|credentials.json|credentials.*.json|service-account*.json|\
    id_rsa|id_ed25519|*.p12|*.pfx|*.jks|*.keystore|*.sqlite|*.sqlite3|\
    *.db|*.dump|*.sql.gz)
      return 0
      ;;
  esac

  return 1
}

check_blob() {
  local path="$1"
  local source="$2"
  local size

  if is_forbidden_path "$path"; then
    fail "forbidden sensitive/local file is staged or tracked: $path"
  fi

  if [[ "$source" == "index" ]]; then
    size="$(git cat-file -s ":$path" 2>/dev/null || printf '0')"
  else
    [[ -f "$path" ]] || return 0
    size="$(wc -c < "$path" | tr -d ' ')"
  fi

  if (( size > MAX_FILE_BYTES )); then
    fail "$path is larger than 10 MiB; use an artifact store or Git LFS after review"
  fi

  if [[ "$path" == "BUILD_SPEC.md" ]] && (( size == 0 )); then
    fail "BUILD_SPEC.md is empty; save the editor buffer before committing"
  fi

  if [[ "$source" == "index" ]]; then
    if git show ":$path" 2>/dev/null | LC_ALL=C grep -Eq '^(<<<<<<< |>>>>>>> )'; then
      fail "unresolved merge-conflict marker in $path"
    fi
    if git show ":$path" 2>/dev/null | LC_ALL=C grep -Eq -- '-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----'; then
      fail "private-key material detected in $path"
    fi
    if [[ "$path" == src/* ]] && \
       git show ":$path" 2>/dev/null | LC_ALL=C grep -Eqi \
         'SUPABASE_(SERVICE_ROLE|SECRET)|SERVICE_ROLE_KEY|ANTHROPIC_API_KEY|VITE_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ROLE|ANTHROPIC)'; then
      fail "server-only secret name or credential is referenced from browser code: $path"
    fi
  else
    if LC_ALL=C grep -Eq '^(<<<<<<< |>>>>>>> )' "$path" 2>/dev/null; then
      fail "unresolved merge-conflict marker in $path"
    fi
    if LC_ALL=C grep -Eq -- '-----BEGIN ([A-Z ]+ )?PRIVATE KEY-----' "$path" 2>/dev/null; then
      fail "private-key material detected in $path"
    fi
    if [[ "$path" == src/* ]] && \
       LC_ALL=C grep -Eqi \
         'SUPABASE_(SERVICE_ROLE|SECRET)|SERVICE_ROLE_KEY|ANTHROPIC_API_KEY|VITE_[A-Z0-9_]*(SECRET|PRIVATE|SERVICE_ROLE|ANTHROPIC)' \
         "$path" 2>/dev/null; then
      fail "server-only secret name or credential is referenced from browser code: $path"
    fi
  fi
}

if [[ "$MODE" == "--staged" ]]; then
  while IFS= read -r -d '' path; do
    check_blob "$path" index
  done < <(git diff --cached --name-only --diff-filter=ACMR -z)

  if ! git diff --cached --check; then
    fail "staged diff contains whitespace errors or conflict markers"
  fi
else
  while IFS= read -r -d '' path; do
    check_blob "$path" worktree
  done < <(git ls-files -z)
fi

if [[ "${SKIP_GITLEAKS:-0}" != "1" ]]; then
  if ! command -v gitleaks >/dev/null 2>&1; then
    fail "gitleaks is required and was not found (macOS: brew install gitleaks)"
  elif [[ "$MODE" == "--staged" ]]; then
    if ! gitleaks git --staged --redact --no-banner; then
      fail "gitleaks detected a secret in staged changes"
    fi
  else
    if ! gitleaks git --redact --no-banner; then
      fail "gitleaks detected a secret in repository history"
    fi
  fi
fi

if (( FAILED != 0 )); then
  printf '\nCommit safety checks failed. Fix the cause; do not bypass hooks.\n' >&2
  exit 1
fi

printf 'Commit safety checks passed (%s).\n' "$MODE"
