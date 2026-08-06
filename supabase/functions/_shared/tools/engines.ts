/**
 * Deterministic calculation engines (BUILD_SPEC §7.4).
 *
 * Every dollar figure, allocation, and volume in this system originates here. The model
 * selects which function to call and explains the result; it never computes (§0 invariant 1).
 *
 * These are pure functions: no database access, no I/O, no model involvement. The tool layer
 * (Phase 2) reads rows and passes them in, which is why the signatures take data rather than
 * the `(segment_id, gas_day)` identifiers the §7.4 sketch uses.
 *
 * Names are snake_case to match the §7.4 contract and the tool names that wrap them, so a
 * figure in an event can be traced to the function that produced it.
 */

import {
  cents,
  dth,
  floorDiv,
  formatDth,
  formatFactor,
  formatPct,
  formatUsd,
  portionOfBps,
  ratioBps,
  sumExact,
} from "../numeric.ts";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** 1 firm primary | 2 firm secondary | 3 interruptible. */
export type PriorityRank = 1 | 2 | 3;

export const PRIORITY_RANKS: readonly PriorityRank[] = [1, 2, 3];

export interface TariffRule {
  rule_type: string;
  rule_key: string;
  value_numeric?: number | null;
  value_text?: string | null;
  citation: string;
}

export interface NominationInput {
  nomination_id: string;
  shipper_id: string;
  priority_rank: PriorityRank;
  nominated_dth: number;
  /**
   * Quantity currently scheduled for this nomination, when one exists. A recut reports the
   * reduction against this figure, which is the number a shipper recognises: Cardinal's cut
   * is 48,000 against a scheduled 102,000, not 96,000 against a nominated 150,000 (§6.7).
   */
  previous_scheduled_dth?: number | null;
}

export interface Allocation {
  nomination_id: string;
  shipper_id: string;
  priority_rank: PriorityRank;
  nominated_dth: number;
  scheduled_dth: number;
  /**
   * Reduction produced by this allocation decision. For an initial allocation the baseline
   * is nominated volume; for a recut it is the previously published schedule (§6.7).
   */
  cut_dth: number;
  /** Nominated minus scheduled: total requested volume that will not flow. */
  unscheduled_dth: number;
  cut_reason: string | null;
}

export interface TierTotals {
  rank: PriorityRank;
  nominated_dth: number;
  scheduled_dth: number;
}

// ---------------------------------------------------------------------------
// Tariff lookup
// ---------------------------------------------------------------------------

function find_rule(
  rules: readonly TariffRule[],
  rule_type: string,
  rule_key: string,
): TariffRule | undefined {
  return rules.find((r) => r.rule_type === rule_type && r.rule_key === rule_key);
}

/** Citation for a rule, or an explicit marker so a missing citation is visible, never blank. */
function citation_for(
  rules: readonly TariffRule[],
  rule_type: string,
  rule_key: string,
): string {
  const citation = find_rule(rules, rule_type, rule_key)?.citation;
  if (citation === undefined || citation.trim() === "") {
    throw new Error(`missing tariff citation: ${rule_type}/${rule_key}`);
  }
  return citation;
}

// ---------------------------------------------------------------------------
// check_segment_capacity
// ---------------------------------------------------------------------------

export interface SegmentCapacityResult {
  operating_capacity_dth: number;
  scheduled_by_tier: Record<PriorityRank, number>;
  scheduled_total_dth: number;
  headroom_dth: number;
  /** Positive volume by which schedules exceed operating capacity. */
  shortfall_dth: number;
}

export interface ScheduledNomination {
  priority_rank: PriorityRank;
  scheduled_dth: number | null;
}

/**
 * Scheduled load on a segment against its current operating capacity.
 *
 * `nominations` must already be filtered to those traversing the segment; path resolution is
 * the topology tool's job (§7.3), not this engine's.
 */
export function check_segment_capacity(
  operating_capacity_dth: number,
  nominations: readonly ScheduledNomination[],
): SegmentCapacityResult {
  dth(operating_capacity_dth);
  if (operating_capacity_dth < 0) {
    throw new RangeError(`operating capacity cannot be negative: ${operating_capacity_dth}`);
  }

  const scheduled_by_tier: Record<PriorityRank, number> = { 1: 0, 2: 0, 3: 0 };
  for (const n of nominations) {
    const scheduled = n.scheduled_dth ?? 0;
    dth(scheduled);
    if (scheduled < 0) {
      throw new RangeError(`scheduled volume cannot be negative: ${scheduled}`);
    }
    scheduled_by_tier[n.priority_rank] += scheduled;
  }

  const scheduled_total_dth = sumExact(PRIORITY_RANKS.map((r) => scheduled_by_tier[r]));

  return {
    operating_capacity_dth,
    scheduled_by_tier,
    scheduled_total_dth,
    headroom_dth: operating_capacity_dth - scheduled_total_dth,
    shortfall_dth: Math.max(0, scheduled_total_dth - operating_capacity_dth),
  };
}

// ---------------------------------------------------------------------------
// apply_scheduling_priority
// ---------------------------------------------------------------------------

export interface SchedulingResult {
  allocations: Allocation[];
  /** Proration factor of the constrained tier, 4 decimal places. "1.0000" when nothing prorates. */
  proration_factor_str: string;
  /** The tier where capacity ran out, or null when every nomination scheduled in full. */
  binding_tier: PriorityRank | null;
  tier_totals: TierTotals[];
  scheduled_total_dth: number;
  operating_capacity_dth: number;
  /** True when the firm tier itself had to prorate: a material event requiring escalation. */
  firm_prorated: boolean;
  citation: string;
}

/**
 * Allocate capacity down the tariff priority ladder.
 *
 * Rank 1 in full unless capacity is below the rank-1 total, in which case rank 1 prorates and
 * every lower rank receives zero. Rank 2 takes what remains, then rank 3. Only the tier where
 * capacity runs out prorates; tiers above are untouched and tiers below receive zero (§7.4).
 *
 * Within the constrained tier: scheduled = floor(nominated x headroom / tier_total). Flooring
 * leaves a remainder of at most (tier size - 1) Dth, which is assigned to the largest
 * nomination in the tier so the scheduled total ties exactly to capacity. An allocation that
 * does not tie is an error, not a rounding artifact.
 */
export function apply_scheduling_priority(
  nominations: readonly NominationInput[],
  operating_capacity_dth: number,
  tariff_rules: readonly TariffRule[],
): SchedulingResult {
  dth(operating_capacity_dth);
  if (operating_capacity_dth < 0) {
    throw new RangeError(`operating capacity cannot be negative: ${operating_capacity_dth}`);
  }
  for (const n of nominations) {
    dth(n.nominated_dth);
    if (n.nominated_dth < 0) {
      throw new RangeError(`nominated volume cannot be negative: ${n.nomination_id}`);
    }
    if (n.previous_scheduled_dth !== undefined && n.previous_scheduled_dth !== null) {
      dth(n.previous_scheduled_dth);
      if (n.previous_scheduled_dth < 0 || n.previous_scheduled_dth > n.nominated_dth) {
        throw new RangeError(
          `previous schedule must be between zero and nominated volume: ${n.nomination_id}`,
        );
      }
    }
  }

  const nomination_ids = new Set(nominations.map((n) => n.nomination_id));
  if (nomination_ids.size !== nominations.length) {
    throw new Error("nomination ids must be unique within an allocation");
  }

  const allocations = new Map<string, Allocation>();
  const tier_totals: TierTotals[] = [];
  let remaining = operating_capacity_dth;
  let binding_tier: PriorityRank | null = null;
  let proration_factor_bps: number | null = null;

  for (const rank of PRIORITY_RANKS) {
    const tier = nominations.filter((n) => n.priority_rank === rank);
    const tier_nominated = sumExact(tier.map((n) => n.nominated_dth));

    if (tier.length === 0) {
      tier_totals.push({ rank, nominated_dth: 0, scheduled_dth: 0 });
      continue;
    }

    let tier_scheduled = 0;

    if (binding_tier !== null) {
      // Capacity ran out in a higher tier. Everything here receives zero.
      for (const n of tier) {
        allocations.set(
          n.nomination_id,
          build_allocation(n, 0, `No capacity remaining after tier ${binding_tier}`),
        );
      }
    } else if (tier_nominated <= remaining) {
      // Tier schedules in full.
      for (const n of tier) {
        allocations.set(n.nomination_id, build_allocation(n, n.nominated_dth, null));
      }
      tier_scheduled = tier_nominated;
      remaining -= tier_nominated;
    } else {
      // Capacity runs out here: prorate this tier only.
      binding_tier = rank;
      const headroom = remaining;
      proration_factor_bps = tier_nominated === 0 ? 0 : ratioBps(headroom, tier_nominated);
      const factor_str = formatFactor(proration_factor_bps);

      const prorated = tier.map((n) => ({
        nomination: n,
        scheduled: tier_nominated === 0
          ? 0
          : floorDiv(n.nominated_dth * headroom, tier_nominated),
      }));

      // Assign the flooring remainder to the largest nomination in the tier so the tier ties
      // exactly to available headroom. Ties broken by nomination id for determinism.
      const remainder = headroom - sumExact(prorated.map((p) => p.scheduled));
      if (remainder > 0) {
        const largest = [...prorated].sort((a, b) =>
          b.nomination.nominated_dth - a.nomination.nominated_dth ||
          a.nomination.nomination_id.localeCompare(b.nomination.nomination_id)
        )[0];
        if (largest === undefined) {
          throw new Error("proration remainder with no nomination to assign it to");
        }
        largest.scheduled += remainder;
      }

      for (const p of prorated) {
        const reason = p.scheduled === p.nomination.nominated_dth
          ? null
          : `Tier ${rank} prorated to available capacity at factor ${factor_str}`;
        allocations.set(p.nomination.nomination_id, build_allocation(p.nomination, p.scheduled, reason));
      }

      tier_scheduled = sumExact(prorated.map((p) => p.scheduled));
      remaining -= tier_scheduled;
    }

    tier_totals.push({ rank, nominated_dth: tier_nominated, scheduled_dth: tier_scheduled });
  }

  const ordered = nominations.map((n) => {
    const a = allocations.get(n.nomination_id);
    if (a === undefined) throw new Error(`nomination not allocated: ${n.nomination_id}`);
    return a;
  });

  const scheduled_total_dth = sumExact(ordered.map((a) => a.scheduled_dth));
  const nominated_total_dth = sumExact(nominations.map((n) => n.nominated_dth));
  const expected_total = Math.min(operating_capacity_dth, nominated_total_dth);

  if (scheduled_total_dth !== expected_total) {
    throw new Error(
      `allocation does not tie: scheduled ${scheduled_total_dth} against expected ${expected_total}`,
    );
  }

  const firm_prorated = binding_tier === 1;

  return {
    allocations: ordered,
    proration_factor_str: proration_factor_bps === null
      ? formatFactor(10_000)
      : formatFactor(proration_factor_bps),
    binding_tier,
    tier_totals,
    scheduled_total_dth,
    operating_capacity_dth,
    firm_prorated,
    citation: binding_tier === null
      ? citation_for(tariff_rules, "scheduling_priority", "firm_primary")
      : binding_tier === 3
      ? citation_for(tariff_rules, "proration_method", "it_prorata")
      : citation_for(
        tariff_rules,
        "scheduling_priority",
        binding_tier === 1 ? "firm_primary" : "firm_secondary",
      ),
  };
}

function build_allocation(
  n: NominationInput,
  scheduled_dth: number,
  cut_reason: string | null,
): Allocation {
  dth(scheduled_dth);
  const baseline_dth = n.previous_scheduled_dth ?? n.nominated_dth;
  return {
    nomination_id: n.nomination_id,
    shipper_id: n.shipper_id,
    priority_rank: n.priority_rank,
    nominated_dth: n.nominated_dth,
    scheduled_dth,
    cut_dth: Math.max(0, baseline_dth - scheduled_dth),
    unscheduled_dth: n.nominated_dth - scheduled_dth,
    cut_reason,
  };
}

// ---------------------------------------------------------------------------
// calculate_imbalance
// ---------------------------------------------------------------------------

export type ImbalanceDirection = "over" | "under" | "balanced";

export interface ImbalanceResult {
  scheduled_dth: number;
  projected_dth: number;
  imbalance_dth: number;
  imbalance_pct_str: string;
  tolerance_dth: number;
  excess_dth: number;
  in_violation: boolean;
  direction: ImbalanceDirection;
}

/**
 * Compare a shipper's projected full-gas-day takes against its scheduled delivery quantity
 * (§6.8 imbalance basis).
 *
 * The tolerance band is symmetric, matching the "+/-5%" the notice states: excess is the
 * amount by which the absolute imbalance exceeds the band, in either direction. `direction`
 * is reported separately because the cure differs — an over-take drains line pack.
 *
 * `tolerance_pct` arrives from the notice as a decimal percentage (5.0) and is converted to
 * integer basis points immediately; no float enters the arithmetic.
 */
export function calculate_imbalance(
  scheduled_dth: number,
  projected_dth: number,
  tolerance_pct: number,
): ImbalanceResult {
  dth(scheduled_dth);
  dth(projected_dth);
  if (scheduled_dth < 0) throw new RangeError(`scheduled cannot be negative: ${scheduled_dth}`);
  if (tolerance_pct < 0) throw new RangeError(`tolerance cannot be negative: ${tolerance_pct}`);

  const tolerance_bps = Math.round(tolerance_pct * 100);
  const tolerance_dth = portionOfBps(scheduled_dth, tolerance_bps);

  const imbalance_dth = projected_dth - scheduled_dth;
  const magnitude = Math.abs(imbalance_dth);
  const excess_dth = Math.max(0, magnitude - tolerance_dth);

  const direction: ImbalanceDirection = imbalance_dth > 0
    ? "over"
    : imbalance_dth < 0
    ? "under"
    : "balanced";

  return {
    scheduled_dth,
    projected_dth,
    imbalance_dth,
    imbalance_pct_str: scheduled_dth === 0
      ? "n/a"
      : formatPct(ratioBps(imbalance_dth, scheduled_dth)),
    tolerance_dth,
    excess_dth,
    in_violation: excess_dth > 0,
    direction,
  };
}

// ---------------------------------------------------------------------------
// calculate_exposure
// ---------------------------------------------------------------------------

export interface ExposureResult {
  excess_dth: number;
  penalty_rate_cents_dth: number;
  days: number;
  exposure_cents: number;
  /** Rendered verbatim in the UI and quoted by the agent, so a reader can check the maths. */
  formula_string: string;
  citation: string;
}

/**
 * Projected potential exposure for a volume beyond tolerance under the proposed flow order.
 *
 * This is a forecast that lets a shipper act before a violation crystallises, not an assessed
 * penalty (§6.8).
 */
export function calculate_exposure(
  excess_dth: number,
  penalty_rate_cents_dth: number,
  days = 1,
  citation = "",
): ExposureResult {
  dth(excess_dth);
  cents(penalty_rate_cents_dth);
  if (excess_dth < 0) throw new RangeError(`excess cannot be negative: ${excess_dth}`);
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`days must be a positive integer: ${days}`);
  }

  const exposure_cents = cents(excess_dth * penalty_rate_cents_dth * days);
  const day_word = days === 1 ? "day" : "days";

  return {
    excess_dth,
    penalty_rate_cents_dth,
    days,
    exposure_cents,
    formula_string: `${formatDth(excess_dth)} Dth × ${formatUsd(penalty_rate_cents_dth)}/Dth × ` +
      `${days} ${day_word} = ${formatUsd(exposure_cents)}`,
    citation,
  };
}

// ---------------------------------------------------------------------------
// assess_system_impact
// ---------------------------------------------------------------------------

export interface ShipperExposure {
  shipper_id: string;
  imbalance: ImbalanceResult;
  exposure: ExposureResult;
}

export interface SystemImpactResult {
  /** Total volume beyond tolerance across every shipper in violation. */
  uncured_excess_dth: number;
  /** Portion of the uncured excess that is an over-take, which is what drains line pack. */
  uncured_over_take_dth: number;
  aggregate_exposure_cents: number;
  aggregate_exposure_str: string;
  violators: string[];
  compliant: string[];
  /**
   * Factual inputs the Exception agent turns into a sentence about line pack and the desk's
   * next escalation step. Deliberately figures, not prose: the engine does not editorialise.
   */
  linepack_commentary_inputs: {
    segment_id: string;
    operating_capacity_dth: number;
    scheduled_total_dth: number;
    headroom_dth: number;
    uncured_over_take_dth: number;
    violator_count: number;
    largest_violator: string | null;
    largest_violator_excess_dth: number;
  };
}

/**
 * Roll per-shipper imbalances into the operator's own stake in the incident: how much volume
 * is uncured, and therefore whether the desk is heading toward an EFO or curtailment.
 *
 * Ranked largest exposure first, since that is the order the playbook works in.
 */
export function assess_system_impact(
  segment_id: string,
  capacity: SegmentCapacityResult,
  shipper_exposures: readonly ShipperExposure[],
): SystemImpactResult {
  const violators = shipper_exposures
    .filter((s) => s.imbalance.in_violation)
    .sort((a, b) =>
      b.exposure.exposure_cents - a.exposure.exposure_cents ||
      a.shipper_id.localeCompare(b.shipper_id)
    );

  const uncured_excess_dth = sumExact(violators.map((v) => v.imbalance.excess_dth));
  const uncured_over_take_dth = sumExact(
    violators.filter((v) => v.imbalance.direction === "over").map((v) => v.imbalance.excess_dth),
  );
  const aggregate_exposure_cents = cents(
    sumExact(shipper_exposures.map((s) => s.exposure.exposure_cents)),
  );
  const largest = violators[0] ?? null;

  return {
    uncured_excess_dth,
    uncured_over_take_dth,
    aggregate_exposure_cents,
    aggregate_exposure_str: formatUsd(aggregate_exposure_cents),
    violators: violators.map((v) => v.shipper_id),
    compliant: shipper_exposures
      .filter((s) => !s.imbalance.in_violation)
      .map((s) => s.shipper_id),
    linepack_commentary_inputs: {
      segment_id,
      operating_capacity_dth: capacity.operating_capacity_dth,
      scheduled_total_dth: capacity.scheduled_total_dth,
      headroom_dth: capacity.headroom_dth,
      uncured_over_take_dth,
      violator_count: violators.length,
      largest_violator: largest?.shipper_id ?? null,
      largest_violator_excess_dth: largest?.imbalance.excess_dth ?? 0,
    },
  };
}
