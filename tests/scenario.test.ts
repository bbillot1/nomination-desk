import { describe, expect, it } from "vitest";

import {
  generateScenario,
  scenarioPasses,
  SCENARIO_SHIPPERS,
} from "../supabase/functions/_shared/scenario.ts";

const seeds = Array.from(
  { length: 25 },
  (_, index) => `SCN-${(index + 1).toString(16).padStart(4, "0").toUpperCase()}`,
);

describe("deterministic scenario generator", () => {
  it("generates the same complete fixture for the same seed", () => {
    expect(generateScenario("SCN-4F7A")).toEqual(generateScenario("SCN-4F7A"));
  });

  it("bypasses random generation for the canonical hero seed", () => {
    const hero = generateScenario("hero");
    expect(hero.answer_key).toMatchObject({
      timely: {
        proration_factor: "0.6800",
        scheduled_dth: { CEMK: 102_000, SABT: 68_000 },
      },
      recut: {
        proration_factor: "0.3600",
        scheduled_dth: { CEMK: 54_000, SABT: 36_000 },
        cuts_dth: { CEMK: 48_000, SABT: 32_000 },
      },
      exposure_cents: { LSPP: 62_500_000, ABCL: 15_000_000 },
    });
    expect(hero.actual_flows).toHaveLength(30);
    expect(scenarioPasses(hero.validation)).toBe(true);
  });

  it.each(seeds)("%s passes every engine-level gate", (seed) => {
    const scenario = generateScenario(seed);

    expect(scenarioPasses(scenario.validation)).toBe(true);
    expect(scenario.validation).toEqual({
      firm_within_derate: true,
      material_it_cut: true,
      has_violator: true,
      has_compliant_shipper: true,
      allocation_and_exposure_tie: true,
      timing_invariant: true,
    });
    expect(scenario.params.derated_capacity_dth).toBeGreaterThanOrEqual(780_000);
    expect(scenario.params.derated_capacity_dth).toBeLessThanOrEqual(860_000);
    expect(scenario.params.derated_capacity_dth % 10_000).toBe(0);

    for (const shipperId of ["CEMK", "SABT"] as const) {
      const nominated = scenario.params.it_nominations_dth[shipperId];
      expect(nominated).toBeGreaterThanOrEqual(80_000);
      expect(nominated).toBeLessThanOrEqual(180_000);
      expect(nominated % 10_000).toBe(0);
    }

    expect(scenario.params.flow_deviation_bps.LSPP).toBeGreaterThanOrEqual(800);
    expect(scenario.params.flow_deviation_bps.LSPP).toBeLessThanOrEqual(1_800);
    expect(scenario.params.flow_deviation_bps.ABCL).toBeGreaterThanOrEqual(400);
    expect(scenario.params.flow_deviation_bps.ABCL).toBeLessThanOrEqual(1_000);
    expect(Math.abs(scenario.params.flow_deviation_bps.NTGU)).toBeLessThanOrEqual(300);
    expect(Math.abs(scenario.params.flow_deviation_bps.CEMK)).toBeLessThanOrEqual(100);
    expect(Math.abs(scenario.params.flow_deviation_bps.SABT)).toBeLessThanOrEqual(100);

    expect(scenario.nominations).toHaveLength(5);
    expect(scenario.actual_flows).toHaveLength(30);
    expect(
      730_000 +
        scenario.answer_key.recut.scheduled_dth.CEMK +
        scenario.answer_key.recut.scheduled_dth.SABT,
    ).toBe(scenario.params.derated_capacity_dth);
    expect(
      Math.max(
        scenario.answer_key.recut.cuts_dth.CEMK,
        scenario.answer_key.recut.cuts_dth.SABT,
      ),
    ).toBeGreaterThanOrEqual(5_000);

    for (const shipperId of SCENARIO_SHIPPERS) {
      const rows = scenario.actual_flows.filter((row) => row.shipper_id === shipperId);
      expect(rows.map((row) => row.flow_hour)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(rows.reduce((total, row) => total + row.volume_dth, 0) * 4).toBe(
        scenario.projected_dth[shipperId],
      );
      expect(Number.isSafeInteger(scenario.answer_key.exposure_cents[shipperId])).toBe(true);
    }
  });

  it("rejects seeds outside the human-readable contract", () => {
    expect(() => generateScenario("SCN-!")).toThrow(/SCN-/);
  });
});
