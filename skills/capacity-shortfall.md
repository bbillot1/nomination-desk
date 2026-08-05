---
name: Capacity Shortfall and Allocation Playbook
version: 1.3
author: Senior Scheduler, Gas Control
trigger: Nominations exceed available operating capacity on a segment, or a derate
         reduces capacity below currently scheduled totals.
---

# Capacity Shortfall and Allocation Playbook

## Step 1 — Establish the true constraint

A nomination is limited by the smallest headroom on any segment it traverses. Find
the binding segment with the topology tool; never assume it is the segment nearest
the delivery point. Use derated operating capacity when a derate is in effect, and
confirm the derate's effective time against the allocation being run — a derate
effective mid-day does not retroactively govern a cycle that already scheduled.

## Step 2 — Apply the priority ladder in tariff order

1. Firm primary (rank 1): allocated in full. This is what the reservation charge buys.
2. Firm secondary (rank 2): from what remains. Flag any scheduled secondary volume
   as bump-exposed to later primary nominations.
3. Interruptible (rank 3): from remaining headroom only.

Priority is a property of the nomination, not the shipper: a firm shipper nominating
a non-primary point is rank 2 for that nomination.

## Step 3 — Prorate only the constrained tier

Tiers above the constrained one are untouched; tiers below receive zero.
scheduled = floor(nominated × headroom ÷ tier_total), whole Dth. The rounding
remainder is assigned to the largest nomination in the tier so the scheduled total
ties exactly to capacity. An allocation that does not tie is an error, not an
artifact. Report the factor itself — shippers verify it against their own numbers.

## Step 4 — Firm proration is an escalation

If capacity falls below the firm total, prorate pro rata within firm, zero to
everything below, and escalate URGENT before anything is published.

## Step 5 — Notify cut shippers, and only cut shippers

Each cut shipper is told: volume cut, reason, binding segment, tier applied,
proration factor, citation. Shippers scheduled in full receive nothing.

## Step 6 — Document

Binding segment, capacity used, tier totals, factor, citation.
