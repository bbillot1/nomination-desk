#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"
command="$(printf '%s' "$input" | jq -r '.command // .input.command // .tool_input.command // empty')"

respond() {
  local permission="$1"
  local user_message="$2"
  local agent_message="$3"
  jq -n \
    --arg permission "$permission" \
    --arg user_message "$user_message" \
    --arg agent_message "$agent_message" \
    '{permission: $permission, user_message: $user_message, agent_message: $agent_message}'
}

if [[ -z "$command" ]]; then
  respond "allow" "" ""
  exit 0
fi

if [[ "$command" =~ git[[:space:]]+(commit|push).*(--no-verify|-n([[:space:]]|$)) ]]; then
  respond "deny" \
    "Bypassing Git safety hooks is prohibited in this project." \
    "Remove --no-verify/-n and fix the failing safety check."
  exit 0
fi

if [[ "$command" =~ git[[:space:]]+push.*(--force-with-lease|--force|-f([[:space:]]|$)) ]]; then
  respond "deny" \
    "Force pushes are blocked to protect repository history." \
    "Use a normal feature-branch push and open a pull request."
  exit 0
fi

if [[ "$command" =~ git[[:space:]]+(reset[[:space:]]+--hard|clean[[:space:]].*-[a-zA-Z]*f|checkout[[:space:]]+--|branch[[:space:]]+-D) ]]; then
  respond "deny" \
    "This destructive Git command is blocked by project policy." \
    "Use a reversible alternative or ask the user for a narrowly scoped recovery plan."
  exit 0
fi

if [[ "$command" =~ git[[:space:]]+commit([[:space:]]|$) ]]; then
  if ! safety_output="$(scripts/check-commit-safety.sh --staged 2>&1)"; then
    respond "deny" \
      "Commit blocked: staged safety checks failed." \
      "$safety_output"
    exit 0
  fi

  respond "ask" \
    "Safety checks passed. Confirm this exact commit after reviewing the staged diff." \
    "Do not commit unless the user explicitly requested it and the staged diff was reviewed."
  exit 0
fi

if [[ "$command" =~ git[[:space:]]+push([[:space:]]|$) ]]; then
  respond "ask" \
    "Confirm this push. Direct pushes to main and non-fast-forward pushes will be blocked." \
    "Push only an explicitly approved feature branch after reviewing outgoing commits."
  exit 0
fi

if [[ "$command" =~ (git[[:space:]]+(rebase|merge|rm|tag[[:space:]]+-d|add[[:space:]]+-f)|gh[[:space:]]+(pr[[:space:]]+merge|repo[[:space:]]+delete|release[[:space:]]+delete)|gh[[:space:]]+api.*(-X|--method)[[:space:]]*(POST|PUT|PATCH|DELETE)) ]]; then
  respond "ask" \
    "This command changes Git history, tracked files, or GitHub state. Review it carefully." \
    "Proceed only when the user explicitly requested this exact mutation."
  exit 0
fi

respond "allow" "" ""
