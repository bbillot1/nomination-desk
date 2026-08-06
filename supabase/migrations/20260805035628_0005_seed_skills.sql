insert into skills (id, name, trigger_description, body_md, version, author) values
(
  'derate-response',
  'Derate Response Playbook',
  'A SCADA event derates operating capacity on a segment with scheduled volumes, or a capacity-constraint condition is detected on such a segment.',
  $skill$
# Derate Response Playbook (Operator Desk)

You are the pipeline operator. Your obligations in a derate are, in order: system integrity, correct tariff administration, and timely communication. You do not make cure decisions for shippers; you give every affected shipper what it needs to make its own decision before the deadline.

## Phase 1 — Confirm and quantify the constraint
Read the SCADA event. Identify the affected segment, the derated operating capacity, and the effective time. Compare against currently scheduled totals by priority tier. State the shortfall in Dth. Identify the first nomination cycle that can still act and its deadline; state sim-minutes remaining.

## Phase 2 — Recut under tariff priority
Run the allocation engine at the derated capacity for all nominations traversing the segment. The tariff ladder is absolute: firm primary, then firm secondary, then interruptible. Never reorder it, never protect a commercially important shipper out of order, never cut firm to spare interruptible.

- If the derate reaches into firm: STOP after staging. Mark the escalation URGENT because firm proration triggers notification obligations and probable disputes.
- Report the proration factor and per-shipper cuts, with the citation.
- Stage the allocation for approval. Scheduled quantities do not change until a human applies them.

## Phase 3 — Assess flow-order compliance
For every shipper with scheduled volume on the segment, using post-recut scheduled quantities: pull measured flows, project the gas-day total, compute imbalance against the proposed notice terms, and compute exposure at the proposed penalty rate. Rank violators by exposure. Shippers inside tolerance are NOT actionable. State the operator's line-pack and escalation risk.

## Phase 4 — Communicate before the deadline
Hand off to the shipper-communication playbook. Draft the EBB notice and individual messages to violators and cut shippers. Neither is sent without approval.

## Phase 5 — Document
Every figure cites its engine output; every rule cites its tariff row.
$skill$,
  '2.0',
  'Senior Scheduler, Gas Control'
),
(
  'capacity-shortfall',
  'Capacity Shortfall and Allocation Playbook',
  'Nominations exceed available operating capacity on a segment, or a derate reduces capacity below currently scheduled totals.',
  $skill$
# Capacity Shortfall and Allocation Playbook

## Step 1 — Establish the true constraint
Find the binding segment with the topology tool; never infer it. Use derated operating capacity when in effect.

## Step 2 — Apply tariff priority
Firm primary, then firm secondary, then interruptible. Priority belongs to each nomination.

## Step 3 — Prorate only the constrained tier
scheduled = floor(nominated × headroom ÷ tier_total), whole Dth. Assign the rounding remainder to the largest nomination so totals tie exactly. Report the factor.

## Step 4 — Firm proration is an escalation
If capacity falls below firm total, prorate within firm, zero lower tiers, and escalate URGENT.

## Step 5 — Notify only cut shippers
Include cut, reason, binding segment, tier, factor, and citation.

## Step 6 — Document
Record binding segment, capacity, tier totals, factor, and citation.
$skill$,
  '1.3',
  'Senior Scheduler, Gas Control'
),
(
  'shipper-communication',
  'Shipper Communication Playbook',
  'A recut, notice, or compliance assessment requires outbound communication to shippers or a public EBB posting.',
  $skill$
# Shipper Communication Playbook (Operator Desk)

## Principle
The operator informs; the shipper decides. Give each recipient its numbers, options, deadline, and citations. Never tell a shipper what to do with its gas, storage, or money.

## EBB notice
Include cause, segment, derated capacity, stage, tolerance and imbalance basis, penalty rate, effective time, actionable cycle/deadline, and citations. No shipper names or shipper-specific figures.

## Shipper in violation
Include scheduled quantity, projection, imbalance, tolerance, exposure formula, and contract-backed cure paths as options. Verify storage rights and downstream position. No market prices or commercial recommendations.

## Cut shipper
Include volume cut, reason, tier, factor, citation, and what a later cycle could restore.

## Everyone else
Nothing. A compliant shipper's reward is an empty inbox.

## Register
Use terse gas-desk language for marketers and plain English for customers without scheduling desks.

## Always
Every message is a draft pending approval. Every figure traces to an engine output and every rule to a tariff row.
$skill$,
  '1.0',
  'Manager, Commercial Scheduling'
)
on conflict (id) do update set
  name = excluded.name,
  trigger_description = excluded.trigger_description,
  body_md = excluded.body_md,
  version = excluded.version,
  author = excluded.author;
