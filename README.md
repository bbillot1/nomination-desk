# nomination-desk
Agentic AI copilot for natural gas pipeline nomination and scheduling — multi-agent workflow over deterministic tariff engines, with human-in-the-loop approvals and a full audit trail.

## Documentation

- [Product overview](docs/product-overview.md)
- [Operator workflow](docs/operator-workflow.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Deployment modes](docs/deployment.md)
- [Measured latency and model cost](docs/performance-baseline.md)
- [Production roadmap](docs/production-roadmap.md)

## Repository safety

Install the checked-in Git hooks once after cloning:

```bash
scripts/install-git-hooks.sh
```

The hooks scan staged changes and Git history for secrets, reject sensitive/local files and
large artifacts, block force pushes, and require feature branches instead of direct pushes to
`main`. See [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Phase 1 foundation

Supabase is the runtime source of truth; [`supabase/migrations/`](supabase/migrations/) is the
reviewed, reproducible schema and canonical hero-seed history. Local project links and credentials
are intentionally ignored.

The deterministic engine gate runs with:

```bash
npm ci
npm test
npm run typecheck
```

It asserts the canonical §6 allocation, recut, and exposure figures before any model-facing
code is allowed. See [docs/schema-deviations.md](docs/schema-deviations.md) for the two
intentional topology additions to the §5 DDL.

## Phase 2 tool layer

The historian, EBB, operations-SOR, topology, and deterministic engine tools are registered
through one structured dispatcher. All reads are bounded and read-only; tariff values and
citations are loaded from Supabase rather than accepted from model input.

Unit tests exercise all 22 handlers. `scripts/verify-remote-tools.ts` additionally runs the
18 read/calculation handlers against the connected Supabase hero fixture using browser-safe
environment variables; the four staging handlers are verified through the live gated flow.

## Phase 3 agent runtime

`agent-run`, `approve-action`, and `simulate` are deployed to the connected project. The
runtime uses Claude Sonnet 5, versioned operator playbooks, append-only events, database-backed
tariff citations, and transactionally gated actions.

The verified hero path is:

```text
reset → trip_compressor → Scheduling recut → human approval
      → Exception assessment → Communications drafts → human approvals → resolved
```

Anthropic temporarily caches compiled strict-tool schemas, while the runtime uses a five-minute
prompt cache for repeated system, tool, and conversation prefixes and records token/cache/latency
telemetry without logging prompts. Before time-sensitive validation, execute one nonproduction
hero workflow to warm strict-tool schema compilation, verify it reaches `comms_pending`, and
restore the canonical baseline.

## Phase 4 operator desk

The React/Vite desk renders authoritative positions and segment utilization, the simulated
clock and phase rail, a gapless Realtime agent feed, human approval gates, the current EBB
notice, a full-workflow audit drawer, and simulation controls.

Copy `.env.example` to an ignored `.env.local` and provide only the project URL and
browser-safe publishable key:

```bash
npm run dev
```

The browser has read-only database access. Schedule changes, notice posting, shipper messaging,
and simulation transitions are invoked through the existing Edge Functions; service-role and
Anthropic credentials never enter the Vite bundle.

Validate the complete local source with:

```bash
npm test
npm run typecheck
npm run build
```

## Phase 5 hardening

The desk includes a clearly labeled replay mode backed by a captured, error-free hero workflow.
Replay is loaded as a separate client chunk and cannot invoke Edge Functions, mutate Supabase, or
make model calls. To replace the fixture after a verified resolved run:

```bash
npm run capture:replay
```

The capture script uses the ignored browser-safe Vite configuration, requires three executed
actions and zero error events, and never writes credentials into the artifact.

Measured hero and generated-run timing, cache usage, and estimated model cost are documented in
[`docs/performance-baseline.md`](docs/performance-baseline.md).

## Phase 6 deterministic scenarios

`scenario.ts` generates reproducible `SCN-*` fixtures with integer-only allocation, projection,
imbalance, and exposure arithmetic. The test gate exercises 25 seeds without model calls. Scenario
loading, current-seed reset, and canonical hero restoration are transactional Postgres RPCs, so the
desk never renders a partially loaded baseline.

Use **Generate new scenario** to load a randomized validated baseline. **Reset current** replays that
same seed exactly; **Restore canonical hero** returns the desk to the frozen §6 fixture. The live
generated-seed gate completed at Stage 3 with exact engine figures, zero error events, and final
phase `resolved`.
