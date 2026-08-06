# Nomination Desk — Product Overview

## Operational problem

Pipeline schedulers must respond to physical constraints quickly while preserving tariff priority,
customer clarity, and a defensible operational record. The challenge is coordinating evidence
across telemetry, contracts, nominations, tariff rules, approvals, and communications under time
pressure.

## Solution

Nomination Desk is a synthetic operator copilot for a North Texas gas corridor. A compressor trip
derates one segment, then four constrained agent personas coordinate the response:

- **Supervisor:** routes the incident and preserves workflow boundaries
- **Scheduling:** stages a tariff-priority recut
- **Exception:** assesses projected flow-order compliance
- **Communications:** drafts the public notice and affected-shipper messages

Agents never calculate authoritative figures and never write operational state directly.

## Safety and correctness model

- deterministic integer-only engines own allocation, tolerance, imbalance, and exposure figures
- every schedule, public notice, and shipper message requires explicit human approval
- Postgres executes approval effects and phase changes transactionally
- browser roles are read-only under RLS
- agent events are append-only and correlated across continuation runs
- tariff statements carry synthetic database-backed citations
- scenario generation is seeded, deterministic, and validated before loading

## Validated evidence

- canonical recut: factor 0.3600; CEMK 54,000 / −48,000; SABT 36,000 / −32,000
- canonical projected exposure: LSPP $625,000; ABCL $150,000; aggregate $775,000
- generated Stage 3 run: factor 0.1875; aggregate exposure $2,367,400; final `resolved`
- 110 automated tests, including 25 generated seeds
- generated live run: two correlated runs, 46 events, zero errors, three executed actions
- generated end-to-end time: 4:26 including human review pauses
- prompt-cached Sonnet 5 estimated generated-run cost: $0.16 at 2026-08-05 introductory pricing
- replay-only mode performs no database writes or model calls

## Important design choices

**Models reason; engines calculate.** This prevents fluent but incorrect arithmetic from becoming
operational truth.

**Draft first; execute transactionally.** Model tools create pending actions only. A separate
approval function owns domain writes.

**Physical truth is immediate.** The compressor derate updates capacity at incident time. Human
approval governs the operator's response, not telemetry.

**The audit unit is the incident.** Initial and continuation runs share one workflow ID, giving the
operator a gapless record across the approval boundary.

## Current reference scope

- all data, companies, tariffs, and events are synthetic
- one corridor, one active scenario, and one scheduler identity
- no application authentication; public distribution uses disconnected replay
- source integrations are simulated Postgres modules behind MCP-shaped tool contracts rather
  than external MCP adapters
- projected exposure is operational decision support, not settlement or an assessed penalty

## Production path

Replace simulated modules with contract-tested MCP adapters for SCADA, EBB, operations-SOR, and
ETRM. Add SSO/RBAC and approval limits; run in shadow mode; evaluate against a golden scenario
set; and
promote autonomy only for scenario classes that meet agreement, safety, and rejection-rate
thresholds.

## Getting started

1. Run `npm test`.
2. Read `BUILD_SPEC.md` and `docs/architecture.md`.
3. Inspect deterministic engines and transactional migrations.
4. Follow `docs/operator-workflow.md` for the live or replay workflow.
5. Open an exposure event in the audit drawer and export the dispute file.
