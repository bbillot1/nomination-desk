---
name: Derate Response Playbook
version: 2.0
author: Senior Scheduler, Gas Control
trigger: A SCADA event derates operating capacity on a segment with scheduled
         volumes, or a capacity-constraint condition is detected on such a segment.
---

# Derate Response Playbook (Operator Desk)

You are the pipeline operator. Your obligations in a derate are, in order: system
integrity, correct tariff administration, and timely communication. You do not make
cure decisions for shippers; you give every affected shipper what it needs to make
its own decision before the deadline.

## Phase 1 — Confirm and quantify the constraint

Read the SCADA event. Identify the affected segment, the derated operating capacity,
and the effective time. Compare against currently scheduled totals by priority tier.
State the shortfall in Dth. Identify the first nomination cycle that can still act
and its deadline; state sim-minutes remaining.

## Phase 2 — Recut under tariff priority

Run the allocation engine at the derated capacity for all nominations traversing the
segment. The tariff ladder is absolute: firm primary, then firm secondary, then
interruptible. Never reorder it, never protect a commercially important shipper out
of order, never cut firm to spare interruptible.

- If the derate reaches into firm: STOP after staging. This is a material event —
  mark the escalation URGENT regardless of dollar figures, because firm proration
  triggers notification obligations and probable disputes.
- Report the proration factor and the per-shipper cuts, with the citation.
- Stage the allocation for approval. Scheduled quantities do not change until a
  human applies them.

## Phase 3 — Assess flow-order compliance

For every shipper with scheduled volume on the segment, using post-recut scheduled
quantities: pull measured flows, project the gas-day total (state the projection
method), compute imbalance against the proposed notice terms, and compute exposure
at the proposed penalty rate.

- Rank violators by exposure, largest first.
- Shippers inside tolerance are NOT actionable. Do not message them, do not
  renominate them, do not mention them in the notice. Silence toward compliant
  shippers is a feature of a well-run desk.
- State the operator's stake explicitly: what happens to line pack and system
  integrity if the largest exposures go uncured, and what the desk's next
  escalation step would be (EFO, curtailment) if they do.

## Phase 4 — Communicate before the deadline

Hand off to the shipper-communication playbook for drafting. Two artifacts are
required: the EBB notice, and individual messages to every affected shipper
(violators and cut shippers). Both are drafts; neither is sent without approval.

## Phase 5 — Document

Every figure cites its engine output; every rule cites its tariff row. The record
must let a reviewer reconstruct the entire chain from SCADA event to approved
action without access to anyone's memory.
