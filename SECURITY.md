# Security Policy

This repository contains a synthetic operations reference implementation. It must never contain
production credentials, customer or operator data, real tariff material, or live operational
telemetry.

## Secret handling

- Store `ANTHROPIC_API_KEY` and Supabase secret/service-role keys only in local ignored
  environment files or Supabase project secrets.
- Browser code may receive only the Supabase project URL and publishable key. A key prefixed
  with `VITE_` is public by definition.
- Never paste secrets into source, tests, fixtures, logs, screenshots, prompts, agent events,
  GitHub issues, pull requests, or commit messages.
- `.env.example` contains names and placeholders only.

## Before every commit and push

1. Review staged paths and the complete staged diff.
2. Run `scripts/check-commit-safety.sh --staged`.
3. Run the relevant tests and static checks.
4. Push a feature branch and use a pull request; never push directly to `main`.

Native hooks can be installed with:

```bash
scripts/install-git-hooks.sh
```

## If a secret is exposed

1. Stop using the credential immediately.
2. Revoke or rotate it at the provider before editing Git history.
3. Determine whether it reached a commit, remote branch, log, issue, or artifact.
4. Ask for explicit approval before rewriting history or deleting remote resources.
5. Treat deletion from the latest commit as insufficient: Git history retains the value.

Do not open a public issue containing the exposed value.
