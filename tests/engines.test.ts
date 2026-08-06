/**
 * Engine tests against the canonical §6 fixtures (BUILD_SPEC §13 Phase 1).
 *
 * These figures are the contract. If the code produces different numbers, the code is wrong
 * (§0 invariant 4). Everything downstream — the agents, the notice, the shipper messages —
 * quotes what these functions return, so this file is the gate before any agent code exists.
 */

import { describe, expect, it } from "vitest";

import {
  apply_scheduling_priority,
  assess_system_impact,
  calculate_exposure,
  calculate_imbalance,
  check_segment_capacity,
  type NominationInput,
  type ShipperExposure,
  type TariffRule,
} from "../supabase/functions/_shared/tools/engines.ts";
import { formatUsd } from "../supabase/functions/_shared/numeric.ts";

// ---------------------------------------------------------------------------
// §6 fixture data
// ---------------------------------------------------------------------------

/** §6.5 */
const TARIFF_RULES: TariffRule[] = [
  { rule_type: "scheduling_priority", rule_key: "firm_primary", value_numeric: 1, citation: "GT&C §12.1 (synthetic)" },
  { rule_type: "scheduling_priority", rule_key: "firm_secondary", value_numeric: 2, citation: "GT&C §12.2 (synthetic)" },
  { rule_type: "scheduling_priority", rule_key: "interruptible", value_numeric: 3, citation: "GT&C §12.4 (synthetic)" },
  { rule_type: "proration_method", rule_key: "it_prorata", value_text: "pro_rata_by_nomination", citation: "GT&C §12.6 (synthetic)" },
  { rule_type: "tolerance", rule_key: "stage_2_pct", value_numeric: 5.0, citation: "GT&C §52.3 (synthetic)" },
  { rule_type: "ofo_penalty", rule_key: "stage_2_rate_cents_dth", value_numeric: 2500, citation: "GT&C §52.3 (synthetic)" },
];

const STAGE_2_TOLERANCE_PCT = 5.0;
const STAGE_2_RATE_CENTS = 2500;
const STAGE_2_CITATION = "GT&C §52.3 (synthetic)";

const SEG2_DESIGN_CAPACITY = 900_000;
const SEG2_DERATED_CAPACITY = 820_000;

/** §6.3 — the Timely nominations, all five traversing SEG-2. */
function timelyNominations(): NominationInput[] {
  return [
    { nomination_id: "NOM-TIMELY-LSPP", shipper_id: "LSPP", priority_rank: 1, nominated_dth: 250_000 },
    { nomination_id: "NOM-TIMELY-ABCL", shipper_id: "ABCL", priority_rank: 1, nominated_dth: 300_000 },
    { nomination_id: "NOM-TIMELY-NTGU", shipper_id: "NTGU", priority_rank: 1, nominated_dth: 180_000 },
    { nomination_id: "NOM-TIMELY-CEMK", shipper_id: "CEMK", priority_rank: 3, nominated_dth: 150_000 },
    { nomination_id: "NOM-TIMELY-SABT", shipper_id: "SABT", priority_rank: 3, nominated_dth: 100_000 },
  ];
}

/** §6.4 — the same nominations carrying their published Timely scheduled quantities. */
function nominationsWithTimelySchedule(): NominationInput[] {
  const published: Record<string, number> = {
    LSPP: 250_000,
    ABCL: 300_000,
    NTGU: 180_000,
    CEMK: 102_000,
    SABT: 68_000,
  };
  return timelyNominations().map((n) => ({
    ...n,
    previous_scheduled_dth: published[n.shipper_id] ?? null,
  }));
}

/** §6.8 — projected full-gas-day takes, from six measured hours extrapolated x4. */
const PROJECTED_TAKES: Record<string, number> = {
  LSPP: 287_500,
  ABCL: 321_000,
  NTGU: 178_200,
  CEMK: 54_000,
  SABT: 35_500,
};

/** §6.7 / §6.8 — post-recut scheduled delivery quantities, the compliance baseline. */
const POST_RECUT_SCHEDULED: Record<string, number> = {
  LSPP: 250_000,
  ABCL: 300_000,
  NTGU: 180_000,
  CEMK: 54_000,
  SABT: 36_000,
};

function bySchedulingId(result: ReturnType<typeof apply_scheduling_priority>) {
  return new Map(result.allocations.map((a) => [a.shipper_id, a]));
}

// ---------------------------------------------------------------------------
// §6.4 Published Timely allocation
// ---------------------------------------------------------------------------

describe("§6.4 Timely allocation at 900,000", () => {
  const result = apply_scheduling_priority(timelyNominations(), SEG2_DESIGN_CAPACITY, TARIFF_RULES);
  const alloc = bySchedulingId(result);

  it("schedules the firm tier in full at 730,000", () => {
    expect(alloc.get("LSPP")?.scheduled_dth).toBe(250_000);
    expect(alloc.get("ABCL")?.scheduled_dth).toBe(300_000);
    expect(alloc.get("NTGU")?.scheduled_dth).toBe(180_000);

    const firm = result.tier_totals.find((t) => t.rank === 1);
    expect(firm?.nominated_dth).toBe(730_000);
    expect(firm?.scheduled_dth).toBe(730_000);
  });

  it("prorates interruptible at 0.68 to 102,000 and 68,000", () => {
    expect(result.proration_factor_str).toBe("0.6800");
    expect(alloc.get("CEMK")?.scheduled_dth).toBe(102_000);
    expect(alloc.get("SABT")?.scheduled_dth).toBe(68_000);
  });

  it("binds in the interruptible tier and ties to 900,000", () => {
    expect(result.binding_tier).toBe(3);
    expect(result.firm_prorated).toBe(false);
    expect(result.scheduled_total_dth).toBe(900_000);
  });

  it("cites the proration method the allocation relied on", () => {
    expect(result.citation).toBe("GT&C §12.6 (synthetic)");
  });

  it("leaves no headroom on SEG-2", () => {
    const capacity = check_segment_capacity(
      SEG2_DESIGN_CAPACITY,
      result.allocations.map((a) => ({
        priority_rank: a.priority_rank,
        scheduled_dth: a.scheduled_dth,
      })),
    );
    expect(capacity.scheduled_by_tier[1]).toBe(730_000);
    expect(capacity.scheduled_by_tier[3]).toBe(170_000);
    expect(capacity.headroom_dth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §6.7 Expected recut after the derate
// ---------------------------------------------------------------------------

describe("§6.7 recut at derated 820,000", () => {
  const result = apply_scheduling_priority(
    nominationsWithTimelySchedule(),
    SEG2_DERATED_CAPACITY,
    TARIFF_RULES,
  );
  const alloc = bySchedulingId(result);

  it("leaves firm untouched at 730,000", () => {
    expect(alloc.get("LSPP")?.scheduled_dth).toBe(250_000);
    expect(alloc.get("ABCL")?.scheduled_dth).toBe(300_000);
    expect(alloc.get("NTGU")?.scheduled_dth).toBe(180_000);
    expect(result.tier_totals.find((t) => t.rank === 1)?.scheduled_dth).toBe(730_000);
    expect(result.firm_prorated).toBe(false);
  });

  it("prorates interruptible at 0.36 to 54,000 and 36,000", () => {
    expect(result.proration_factor_str).toBe("0.3600");
    expect(alloc.get("CEMK")?.scheduled_dth).toBe(54_000);
    expect(alloc.get("SABT")?.scheduled_dth).toBe(36_000);
  });

  it("reports cuts of 48,000 and 32,000 against published schedules", () => {
    expect(alloc.get("CEMK")?.cut_dth).toBe(48_000);
    expect(alloc.get("SABT")?.cut_dth).toBe(32_000);
  });

  it("reports the volume that will not flow against nominations", () => {
    expect(alloc.get("CEMK")?.unscheduled_dth).toBe(96_000);
    expect(alloc.get("SABT")?.unscheduled_dth).toBe(64_000);
  });

  it("notifies no firm shipper of a reduction", () => {
    for (const id of ["LSPP", "ABCL", "NTGU"]) {
      expect(alloc.get(id)?.cut_dth).toBe(0);
      expect(alloc.get(id)?.cut_reason).toBeNull();
    }
  });

  it("ties exactly to the derated capacity", () => {
    expect(result.scheduled_total_dth).toBe(820_000);
  });
});

// ---------------------------------------------------------------------------
// §6.8 Compliance assessment and exposure
// ---------------------------------------------------------------------------

describe("§6.8 compliance assessment under the Stage 2 OFO", () => {
  const assessed = Object.keys(POST_RECUT_SCHEDULED).map((shipper_id) => {
    const scheduled = POST_RECUT_SCHEDULED[shipper_id] ?? 0;
    const projected = PROJECTED_TAKES[shipper_id] ?? 0;
    const imbalance = calculate_imbalance(scheduled, projected, STAGE_2_TOLERANCE_PCT);
    const exposure = calculate_exposure(
      imbalance.excess_dth,
      STAGE_2_RATE_CENTS,
      1,
      STAGE_2_CITATION,
    );
    return { shipper_id, imbalance, exposure } satisfies ShipperExposure;
  });
  const row = new Map(assessed.map((a) => [a.shipper_id, a]));

  it.each([
    ["LSPP", 250_000, 287_500, 37_500, "+15.0%", 12_500, 25_000, "$625,000.00"],
    ["ABCL", 300_000, 321_000, 21_000, "+7.0%", 15_000, 6_000, "$150,000.00"],
    ["NTGU", 180_000, 178_200, -1_800, "-1.0%", 9_000, 0, "$0.00"],
    ["CEMK", 54_000, 54_000, 0, "0.0%", 2_700, 0, "$0.00"],
    ["SABT", 36_000, 35_500, -500, "-1.4%", 1_800, 0, "$0.00"],
  ])(
    "%s: %i scheduled vs %i projected",
    (id, scheduled, projected, delta, pct, tolerance, excess, exposure) => {
      const r = row.get(id as string);
      expect(r?.imbalance.scheduled_dth).toBe(scheduled);
      expect(r?.imbalance.projected_dth).toBe(projected);
      expect(r?.imbalance.imbalance_dth).toBe(delta);
      expect(r?.imbalance.imbalance_pct_str).toBe(pct);
      expect(r?.imbalance.tolerance_dth).toBe(tolerance);
      expect(r?.imbalance.excess_dth).toBe(excess);
      expect(formatUsd(r?.exposure.exposure_cents ?? -1)).toBe(exposure);
    },
  );

  it("flags exactly LSPP and ABCL as in violation", () => {
    expect(row.get("LSPP")?.imbalance.in_violation).toBe(true);
    expect(row.get("ABCL")?.imbalance.in_violation).toBe(true);
    expect(row.get("NTGU")?.imbalance.in_violation).toBe(false);
    expect(row.get("CEMK")?.imbalance.in_violation).toBe(false);
    expect(row.get("SABT")?.imbalance.in_violation).toBe(false);
  });

  it("quotes verifiable arithmetic for the largest exposure", () => {
    expect(row.get("LSPP")?.exposure.formula_string).toBe(
      "25,000 Dth × $25.00/Dth × 1 day = $625,000.00",
    );
    expect(row.get("ABCL")?.exposure.formula_string).toBe(
      "6,000 Dth × $25.00/Dth × 1 day = $150,000.00",
    );
    expect(row.get("LSPP")?.exposure.citation).toBe("GT&C §52.3 (synthetic)");
  });

  it("aggregates to $775,000.00 for the gas day", () => {
    const capacity = check_segment_capacity(
      SEG2_DERATED_CAPACITY,
      Object.entries(POST_RECUT_SCHEDULED).map(([id, scheduled_dth]) => ({
        priority_rank: (id === "CEMK" || id === "SABT" ? 3 : 1) as 1 | 3,
        scheduled_dth,
      })),
    );
    const impact = assess_system_impact("SEG-2", capacity, assessed);

    expect(impact.aggregate_exposure_str).toBe("$775,000.00");
    expect(impact.aggregate_exposure_cents).toBe(77_500_000);
    expect(impact.uncured_excess_dth).toBe(31_000);
    expect(impact.uncured_over_take_dth).toBe(31_000);
  });

  it("ranks violators by exposure and names the compliant shippers", () => {
    const capacity = check_segment_capacity(SEG2_DERATED_CAPACITY, []);
    const impact = assess_system_impact("SEG-2", capacity, assessed);

    expect(impact.violators).toEqual(["LSPP", "ABCL"]);
    expect(impact.compliant).toEqual(["NTGU", "CEMK", "SABT"]);
    expect(impact.linepack_commentary_inputs.largest_violator).toBe("LSPP");
    expect(impact.linepack_commentary_inputs.largest_violator_excess_dth).toBe(25_000);
    expect(impact.linepack_commentary_inputs.violator_count).toBe(2);
  });

  it("reports the derated segment as fully subscribed with no headroom", () => {
    const capacity = check_segment_capacity(
      SEG2_DERATED_CAPACITY,
      Object.entries(POST_RECUT_SCHEDULED).map(([id, scheduled_dth]) => ({
        priority_rank: (id === "CEMK" || id === "SABT" ? 3 : 1) as 1 | 3,
        scheduled_dth,
      })),
    );
    expect(capacity.scheduled_total_dth).toBe(820_000);
    expect(capacity.headroom_dth).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Allocation invariants beyond the hero figures
// ---------------------------------------------------------------------------

describe("allocation invariants", () => {
  it("assigns the flooring remainder to the largest nomination so the total ties", () => {
    // 100,000 headroom across three unequal IT nominations: flooring leaves 1 Dth over.
    const nominations: NominationInput[] = [
      { nomination_id: "N-A", shipper_id: "A", priority_rank: 3, nominated_dth: 100_000 },
      { nomination_id: "N-B", shipper_id: "B", priority_rank: 3, nominated_dth: 50_000 },
      { nomination_id: "N-C", shipper_id: "C", priority_rank: 3, nominated_dth: 49_999 },
    ];
    const result = apply_scheduling_priority(nominations, 100_000, TARIFF_RULES);
    const alloc = bySchedulingId(result);

    expect(result.scheduled_total_dth).toBe(100_000);
    // Largest nomination absorbs the remainder, so it lands one Dth above its floored share.
    const flooredA = Math.floor((100_000 * 100_000) / 199_999);
    expect(alloc.get("A")?.scheduled_dth).toBe(flooredA + 1);
  });

  it("prorates within firm and zeroes lower tiers when capacity is below the firm total", () => {
    const result = apply_scheduling_priority(timelyNominations(), 365_000, TARIFF_RULES);
    const alloc = bySchedulingId(result);

    expect(result.binding_tier).toBe(1);
    expect(result.firm_prorated).toBe(true);
    expect(result.proration_factor_str).toBe("0.5000");
    expect(alloc.get("LSPP")?.scheduled_dth).toBe(125_000);
    expect(alloc.get("ABCL")?.scheduled_dth).toBe(150_000);
    expect(alloc.get("NTGU")?.scheduled_dth).toBe(90_000);
    expect(alloc.get("CEMK")?.scheduled_dth).toBe(0);
    expect(alloc.get("SABT")?.scheduled_dth).toBe(0);
    expect(result.scheduled_total_dth).toBe(365_000);
    expect(result.citation).toBe("GT&C §12.1 (synthetic)");
  });

  it("allocates firm secondary after primary, then zeroes interruptible", () => {
    const nominations: NominationInput[] = [
      { nomination_id: "N-PRIMARY", shipper_id: "PRIMARY", priority_rank: 1, nominated_dth: 60_000 },
      { nomination_id: "N-SECONDARY", shipper_id: "SECONDARY", priority_rank: 2, nominated_dth: 80_000 },
      { nomination_id: "N-IT", shipper_id: "IT", priority_rank: 3, nominated_dth: 50_000 },
    ];
    const result = apply_scheduling_priority(nominations, 100_000, TARIFF_RULES);
    const alloc = bySchedulingId(result);

    expect(alloc.get("PRIMARY")?.scheduled_dth).toBe(60_000);
    expect(alloc.get("SECONDARY")?.scheduled_dth).toBe(40_000);
    expect(alloc.get("IT")?.scheduled_dth).toBe(0);
    expect(result.binding_tier).toBe(2);
    expect(result.proration_factor_str).toBe("0.5000");
    expect(result.citation).toBe("GT&C §12.2 (synthetic)");
    expect(result.scheduled_total_dth).toBe(100_000);
  });

  it("schedules everything and prorates nothing when capacity exceeds nominations", () => {
    const result = apply_scheduling_priority(timelyNominations(), 1_000_000, TARIFF_RULES);

    expect(result.binding_tier).toBeNull();
    expect(result.proration_factor_str).toBe("1.0000");
    expect(result.scheduled_total_dth).toBe(980_000);
    expect(result.allocations.every((a) => a.cut_dth === 0 && a.unscheduled_dth === 0)).toBe(true);
    expect(result.citation).toBe("GT&C §12.1 (synthetic)");
  });

  it("never returns a fractional volume", () => {
    for (const capacity of [820_000, 833_333, 777_777, 901_111]) {
      const result = apply_scheduling_priority(timelyNominations(), capacity, TARIFF_RULES);
      for (const a of result.allocations) {
        expect(Number.isInteger(a.scheduled_dth)).toBe(true);
      }
    }
  });

  it("rejects duplicate nomination ids", () => {
    const duplicated = timelyNominations();
    duplicated[1] = { ...duplicated[1]!, nomination_id: duplicated[0]!.nomination_id };
    expect(() =>
      apply_scheduling_priority(duplicated, SEG2_DESIGN_CAPACITY, TARIFF_RULES)
    ).toThrow("nomination ids must be unique");
  });

  it("rejects invalid previously scheduled quantities", () => {
    const fractional = nominationsWithTimelySchedule();
    fractional[0] = { ...fractional[0]!, previous_scheduled_dth: 249_999.5 };
    expect(() =>
      apply_scheduling_priority(fractional, SEG2_DERATED_CAPACITY, TARIFF_RULES)
    ).toThrow(TypeError);

    const aboveNomination = nominationsWithTimelySchedule();
    aboveNomination[0] = { ...aboveNomination[0]!, previous_scheduled_dth: 250_001 };
    expect(() =>
      apply_scheduling_priority(aboveNomination, SEG2_DERATED_CAPACITY, TARIFF_RULES)
    ).toThrow(RangeError);
  });

  it("fails closed when the governing tariff citation is missing", () => {
    expect(() =>
      apply_scheduling_priority(
        timelyNominations(),
        SEG2_DESIGN_CAPACITY,
        TARIFF_RULES.filter((r) => r.rule_key !== "it_prorata"),
      )
    ).toThrow("missing tariff citation");
  });
});

describe("imbalance and exposure guards", () => {
  it("rejects negative segment capacity and scheduled volume", () => {
    expect(() => check_segment_capacity(-1, [])).toThrow(RangeError);
    expect(() =>
      check_segment_capacity(100_000, [{ priority_rank: 1, scheduled_dth: -1 }])
    ).toThrow(RangeError);
  });

  it("treats an under-take beyond the band as a violation in the under direction", () => {
    const r = calculate_imbalance(100_000, 80_000, STAGE_2_TOLERANCE_PCT);
    expect(r.tolerance_dth).toBe(5_000);
    expect(r.excess_dth).toBe(15_000);
    expect(r.in_violation).toBe(true);
    expect(r.direction).toBe("under");
  });

  it("floors the tolerance band rather than rounding it up", () => {
    // 5% of 54,001 is 2,700.05 — the shipper gets 2,700, not 2,701.
    expect(calculate_imbalance(54_001, 54_001, STAGE_2_TOLERANCE_PCT).tolerance_dth).toBe(2_700);
  });

  it("scales exposure across multiple days", () => {
    const r = calculate_exposure(25_000, STAGE_2_RATE_CENTS, 3, STAGE_2_CITATION);
    expect(r.exposure_cents).toBe(187_500_000);
    expect(r.formula_string).toBe("25,000 Dth × $25.00/Dth × 3 days = $1,875,000.00");
  });

  it("rejects a negative excess rather than producing a credit", () => {
    expect(() => calculate_exposure(-1, STAGE_2_RATE_CENTS)).toThrow(RangeError);
  });
});
