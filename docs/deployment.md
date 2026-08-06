# Deployment Guide

## Recommended public deployment: disconnected replay

The safest shareable artifact is the replay-only build:

```bash
npm ci
npm run build:replay
```

Publish the generated `dist/` directory as a static site. Set only:

```text
VITE_DESK_MODE=replay
```

Do not configure Supabase values for this deployment. The build configuration also replaces any
developer-local Supabase values with empty strings at compile time. The repository gate verifies
that the generated artifact contains no project reference, publishable-key prefix, service-role
identifier, or Anthropic secret name.

Replay is explicitly labeled in the UI, loads the captured verified workflow as a separate chunk,
and cannot invoke an Edge Function.

## Protected live deployment

Use a live deployment only behind hosting-level access control with named authorized users.
Configure:

```text
VITE_DESK_MODE=live
VITE_SUPABASE_URL=<project URL>
VITE_SUPABASE_PUBLISHABLE_KEY=<browser-safe publishable key>
```

These Vite values are public by design. Never configure a service-role key, Supabase secret key,
or Anthropic key in browser or hosting build variables.

The current reference implementation has no user authentication. Anyone who can load the live
bundle can invoke the synthetic simulation and approval functions, alter shared scenario state,
and trigger model cost. Hosting protection limits distribution but does not replace application
authentication.

## Pre-deployment gate

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run build:replay
npm run verify:replay
npm audit --audit-level=high
scripts/check-working-tree-safety.sh
git diff --check
```

For the replay artifact, scan `dist/` without printing any value:

```bash
rg -l 'https://[a-z0-9]{20}\.supabase\.co|sb_publishable_|sb_secret_|SUPABASE_SERVICE|ANTHROPIC_API_KEY' dist
```

The command must return no paths. CI enforces the same condition with `npm run verify:replay`.

## Post-deployment checks

### Replay URL

- page loads without Supabase environment values
- visible banner says Replay mode
- playback reaches `Resolved`
- 37 captured events appear
- approval controls remain disabled
- audit drawer and dispute-file export work

### Protected live URL

- RLS reads succeed
- Realtime indicator becomes live
- baseline is the canonical hero seed
- no secrets appear in page source or built assets
- reset is blocked during an active run
- only intended authorized users can reach the hosting URL

## Release handoff

Before sharing Git access:

- commit only reviewed source, migrations, documentation, tests, and lockfiles
- keep `.env.local`, Supabase `.temp`, credentials, reports, and build output ignored
- verify local and remote migration versions match
- verify deployed Edge Function source parity
- share a tagged or commit-pinned URL so consumers can identify the exact release
