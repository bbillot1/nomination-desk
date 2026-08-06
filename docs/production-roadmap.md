# Production Roadmap

The reference implementation proves the operating model, not production readiness. Promotion must
be earned per scenario class rather than granted to the system globally.

## 1. Identity and governance

- add enterprise SSO and short-lived user sessions
- enforce scheduler, supervisor, and administrator roles
- scale approval authority to action type and financial exposure
- add immutable audit export and retention policy
- preserve a named accountable human on every externally visible action

## 2. Real source-system adapters

- replace the simulated historian with read-only SCADA/historian integration
- replace EBB tables with posting, cycle, nomination, and notice adapters
- integrate the operations system of record through contract-tested APIs
- add ETRM only for commercial workflows; keep it outside physical scheduling authority
- version every adapter contract and fail closed when vendor payloads change

## 3. Evaluation before autonomy

- build a golden set of generated and hand-authored scenarios
- score exact arithmetic, tool selection, citation accuracy, playbook adherence, and recipient
  discrimination
- gate every prompt, skill, model, and tool-contract change in CI
- measure operator rejection and correction rates by scenario class
- include firm-proration, missing-data, stale-telemetry, and contradictory-source edge cases

## 4. Shadow operation

- run beside the live desk with no write privileges
- compare recommendations to scheduler decisions daily
- investigate every material disagreement
- define minimum sample size and agreement thresholds before enabling any action class

## 5. Reliability and observability

- trace provider latency, token usage, cache effectiveness, and cost per run
- monitor tool errors, retry rates, wall-clock caps, and queued continuation age
- add a sweeper for abandoned continuation outbox rows
- provide provider-independent replay and degraded read-only operation
- define SLOs and rollback procedures for each integration

## 6. Bounded autonomy

Progression:

1. **Assist:** every operational output requires approval.
2. **Semi-autonomous:** routine recuts within explicitly approved limits may apply automatically;
   public notices and shipper messages still require approval.
3. **Exception supervision:** only proven scenario classes operate automatically; uncertainty,
   missing evidence, firm impacts, and novel conditions stop for a human.

No promotion occurs solely because a model is newer. Each model configuration must pass the same
golden set and shadow criteria at an acceptable cost and latency.
