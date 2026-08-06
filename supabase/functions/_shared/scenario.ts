import { applyBps, sumExact } from "./numeric.ts";
import {
  apply_scheduling_priority,
  calculate_exposure,
  calculate_imbalance,
  type NominationInput,
  type TariffRule,
} from "./tools/engines.ts";

export const SCENARIO_SHIPPERS = ["LSPP", "ABCL", "NTGU", "CEMK", "SABT"] as const;
export type ScenarioShipper = (typeof SCENARIO_SHIPPERS)[number];

export interface ScenarioParameters {
  derated_capacity_dth: number;
  incident_time_ct: "16:15";
  notice: {
    stage: "Stage 2" | "Stage 3";
    tolerance_pct: 5 | 3;
    penalty_rate_cents_dth: 2_500 | 5_000;
  };
  it_nominations_dth: {
    CEMK: number;
    SABT: number;
  };
  flow_deviation_bps: Record<ScenarioShipper, number>;
}

export interface ScenarioAnswerKey {
  timely: {
    proration_factor: string;
    scheduled_dth: { CEMK: number; SABT: number };
  };
  recut: {
    proration_factor: string;
    scheduled_dth: { CEMK: number; SABT: number };
    cuts_dth: { CEMK: number; SABT: number };
  };
  exposure_cents: Record<ScenarioShipper, number>;
  violators: ScenarioShipper[];
  compliant: ScenarioShipper[];
}

export interface ScenarioNomination {
  id: string;
  shipper_id: ScenarioShipper;
  nominated_dth: number;
  scheduled_dth: number;
  status: "scheduled";
}

export interface ScenarioFlow {
  point_id: string;
  shipper_id: ScenarioShipper;
  flow_hour: number;
  volume_dth: number;
}

export interface ScenarioValidation {
  firm_within_derate: boolean;
  material_it_cut: boolean;
  has_violator: boolean;
  has_compliant_shipper: boolean;
  allocation_and_exposure_tie: boolean;
  timing_invariant: boolean;
}

export interface GeneratedScenario {
  seed: string;
  params: ScenarioParameters;
  answer_key: ScenarioAnswerKey;
  nominations: ScenarioNomination[];
  actual_flows: ScenarioFlow[];
  projected_dth: Record<ScenarioShipper, number>;
  validation: ScenarioValidation;
}

interface FixedNomination {
  id: string;
  shipper_id: ScenarioShipper;
  priority_rank: 1 | 3;
  nominated_dth: number;
  delivery_point: string;
}

const FIXED_FIRM: readonly FixedNomination[] = [
  {
    id: "NOM-TIMELY-LSPP",
    shipper_id: "LSPP",
    priority_rank: 1,
    nominated_dth: 250_000,
    delivery_point: "DP-LSPP-GEN",
  },
  {
    id: "NOM-TIMELY-ABCL",
    shipper_id: "ABCL",
    priority_rank: 1,
    nominated_dth: 300_000,
    delivery_point: "DP-ABIL-DC",
  },
  {
    id: "NOM-TIMELY-NTGU",
    shipper_id: "NTGU",
    priority_rank: 1,
    nominated_dth: 180_000,
    delivery_point: "DP-DFW-LDC",
  },
];

const TARIFF_RULES: readonly TariffRule[] = [
  {
    rule_type: "scheduling_priority",
    rule_key: "firm_primary",
    value_numeric: 1,
    citation: "GT&C §12.1 (synthetic)",
  },
  {
    rule_type: "scheduling_priority",
    rule_key: "firm_secondary",
    value_numeric: 2,
    citation: "GT&C §12.2 (synthetic)",
  },
  {
    rule_type: "scheduling_priority",
    rule_key: "interruptible",
    value_numeric: 3,
    citation: "GT&C §12.4 (synthetic)",
  },
  {
    rule_type: "proration_method",
    rule_key: "it_prorata",
    value_text: "pro_rata_by_nomination",
    citation: "GT&C §12.6 (synthetic)",
  },
];

const FLOW_WEIGHTS: Record<ScenarioShipper, readonly number[]> = {
  LSPP: [14, 15, 16, 17, 18, 20],
  ABCL: [15, 16, 16, 17, 18, 18],
  NTGU: [1, 1, 1, 1, 1, 1],
  CEMK: [1, 1, 1, 1, 1, 1],
  SABT: [1, 1, 1, 1, 1, 1],
};

function seedHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function drawStep(
  random: () => number,
  minimum: number,
  maximum: number,
  step: number,
): number {
  const count = Math.floor((maximum - minimum) / step) + 1;
  return minimum + Math.floor(random() * count) * step;
}

function nominationInputs(params: ScenarioParameters): NominationInput[] {
  return [
    ...FIXED_FIRM.map((nomination) => ({
      nomination_id: nomination.id,
      shipper_id: nomination.shipper_id,
      priority_rank: nomination.priority_rank,
      nominated_dth: nomination.nominated_dth,
    })),
    {
      nomination_id: "NOM-TIMELY-CEMK",
      shipper_id: "CEMK",
      priority_rank: 3 as const,
      nominated_dth: params.it_nominations_dth.CEMK,
    },
    {
      nomination_id: "NOM-TIMELY-SABT",
      shipper_id: "SABT",
      priority_rank: 3 as const,
      nominated_dth: params.it_nominations_dth.SABT,
    },
  ];
}

function toMultipleOfFour(value: number): number {
  return value - value % 4;
}

function distributeMeasuredTotal(total: number, weights: readonly number[]): number[] {
  const weightTotal = sumExact(weights);
  const volumes = weights.map((weight) => Math.floor(total * weight / weightTotal));
  let remainder = total - sumExact(volumes);
  const order = weights
    .map((weight, index) => ({ index, weight }))
    .sort((left, right) => right.weight - left.weight || left.index - right.index);
  for (let index = 0; remainder > 0; index += 1) {
    const target = order[index % order.length];
    if (!target) throw new Error("flow distribution has no target hour");
    volumes[target.index] = (volumes[target.index] ?? 0) + 1;
    remainder -= 1;
  }
  return volumes;
}

function flowRows(
  projections: Record<ScenarioShipper, number>,
  deliveryPointByShipper: Record<ScenarioShipper, string>,
): ScenarioFlow[] {
  return SCENARIO_SHIPPERS.flatMap((shipperId) => {
    const measuredTotal = projections[shipperId] / 4;
    if (!Number.isInteger(measuredTotal)) {
      throw new Error(`projection for ${shipperId} is not divisible by four`);
    }
    return distributeMeasuredTotal(measuredTotal, FLOW_WEIGHTS[shipperId]).map(
      (volumeDth, flowHour) => ({
        point_id: deliveryPointByShipper[shipperId],
        shipper_id: shipperId,
        flow_hour: flowHour,
        volume_dth: volumeDth,
      }),
    );
  });
}

function candidate(seed: string, random: () => number): GeneratedScenario {
  const stage3 = random() >= 0.5;
  const params: ScenarioParameters = {
    derated_capacity_dth: drawStep(random, 780_000, 860_000, 10_000),
    incident_time_ct: "16:15",
    notice: stage3
      ? {
          stage: "Stage 3",
          tolerance_pct: 3,
          penalty_rate_cents_dth: 5_000,
        }
      : {
          stage: "Stage 2",
          tolerance_pct: 5,
          penalty_rate_cents_dth: 2_500,
        },
    it_nominations_dth: {
      CEMK: drawStep(random, 80_000, 180_000, 10_000),
      SABT: drawStep(random, 80_000, 180_000, 10_000),
    },
    flow_deviation_bps: {
      LSPP: drawStep(random, 800, 1_800, 10),
      ABCL: drawStep(random, 400, 1_000, 10),
      NTGU: drawStep(random, -300, 300, 10),
      CEMK: drawStep(random, -100, 100, 10),
      SABT: drawStep(random, -100, 100, 10),
    },
  };

  const inputs = nominationInputs(params);
  const timely = apply_scheduling_priority(inputs, 900_000, TARIFF_RULES);
  const timelyById = new Map(
    timely.allocations.map((allocation) => [allocation.nomination_id, allocation]),
  );
  const recut = apply_scheduling_priority(
    inputs.map((input) => ({
      ...input,
      previous_scheduled_dth: timelyById.get(input.nomination_id)?.scheduled_dth ?? null,
    })),
    params.derated_capacity_dth,
    TARIFF_RULES,
  );
  const recutByShipper = new Map(
    recut.allocations.map((allocation) => [allocation.shipper_id, allocation]),
  );

  const projections = Object.fromEntries(
    SCENARIO_SHIPPERS.map((shipperId) => {
      const scheduled = recutByShipper.get(shipperId)?.scheduled_dth;
      if (scheduled === undefined) throw new Error(`missing recut schedule for ${shipperId}`);
      return [
        shipperId,
        toMultipleOfFour(applyBps(scheduled, params.flow_deviation_bps[shipperId])),
      ];
    }),
  ) as Record<ScenarioShipper, number>;

  const exposureCents = {} as Record<ScenarioShipper, number>;
  const violators: ScenarioShipper[] = [];
  const compliant: ScenarioShipper[] = [];
  for (const shipperId of SCENARIO_SHIPPERS) {
    const scheduled = recutByShipper.get(shipperId)?.scheduled_dth;
    if (scheduled === undefined) throw new Error(`missing recut schedule for ${shipperId}`);
    const imbalance = calculate_imbalance(
      scheduled,
      projections[shipperId],
      params.notice.tolerance_pct,
    );
    const exposure = calculate_exposure(
      imbalance.excess_dth,
      params.notice.penalty_rate_cents_dth,
    );
    exposureCents[shipperId] = exposure.exposure_cents;
    (imbalance.in_violation ? violators : compliant).push(shipperId);
  }

  const timelyCemk = timelyById.get("NOM-TIMELY-CEMK");
  const timelySabt = timelyById.get("NOM-TIMELY-SABT");
  const recutCemk = recutByShipper.get("CEMK");
  const recutSabt = recutByShipper.get("SABT");
  if (!timelyCemk || !timelySabt || !recutCemk || !recutSabt) {
    throw new Error("generated IT allocations are incomplete");
  }

  const nominations: ScenarioNomination[] = inputs.map((input) => ({
    id: input.nomination_id,
    shipper_id: input.shipper_id as ScenarioShipper,
    nominated_dth: input.nominated_dth,
    scheduled_dth: timelyById.get(input.nomination_id)?.scheduled_dth ??
      (() => {
        throw new Error(`missing Timely schedule for ${input.nomination_id}`);
      })(),
    status: "scheduled",
  }));
  const deliveryPointByShipper = Object.fromEntries([
    ...FIXED_FIRM.map((nomination) => [nomination.shipper_id, nomination.delivery_point]),
    ["CEMK", "DP-INDL"],
    ["SABT", "DP-INDL"],
  ]) as Record<ScenarioShipper, string>;

  const scenario: GeneratedScenario = {
    seed,
    params,
    answer_key: {
      timely: {
        proration_factor: timely.proration_factor_str,
        scheduled_dth: {
          CEMK: timelyCemk.scheduled_dth,
          SABT: timelySabt.scheduled_dth,
        },
      },
      recut: {
        proration_factor: recut.proration_factor_str,
        scheduled_dth: {
          CEMK: recutCemk.scheduled_dth,
          SABT: recutSabt.scheduled_dth,
        },
        cuts_dth: {
          CEMK: recutCemk.cut_dth,
          SABT: recutSabt.cut_dth,
        },
      },
      exposure_cents: exposureCents,
      violators,
      compliant,
    },
    nominations,
    actual_flows: flowRows(projections, deliveryPointByShipper),
    projected_dth: projections,
    validation: {
      firm_within_derate: false,
      material_it_cut: false,
      has_violator: false,
      has_compliant_shipper: false,
      allocation_and_exposure_tie: false,
      timing_invariant: false,
    },
  };
  scenario.validation = validateGeneratedScenario(scenario);
  return scenario;
}

export function validateGeneratedScenario(scenario: GeneratedScenario): ScenarioValidation {
  const firmTotal = sumExact(
    scenario.nominations
      .filter((nomination) => nomination.shipper_id !== "CEMK" && nomination.shipper_id !== "SABT")
      .map((nomination) => nomination.nominated_dth),
  );
  const recutScheduledTotal = firmTotal +
    scenario.answer_key.recut.scheduled_dth.CEMK +
    scenario.answer_key.recut.scheduled_dth.SABT;
  const exposureValues = Object.values(scenario.answer_key.exposure_cents);
  const flowHoursByShipper = new Map<ScenarioShipper, Set<number>>();
  const measuredByShipper = new Map<ScenarioShipper, number>();
  for (const row of scenario.actual_flows) {
    const hours = flowHoursByShipper.get(row.shipper_id) ?? new Set<number>();
    hours.add(row.flow_hour);
    flowHoursByShipper.set(row.shipper_id, hours);
    measuredByShipper.set(
      row.shipper_id,
      (measuredByShipper.get(row.shipper_id) ?? 0) + row.volume_dth,
    );
  }
  const flowsTie = SCENARIO_SHIPPERS.every((shipperId) =>
    flowHoursByShipper.get(shipperId)?.size === 6 &&
    (measuredByShipper.get(shipperId) ?? -1) * 4 === scenario.projected_dth[shipperId]
  );

  return {
    firm_within_derate: firmTotal <= scenario.params.derated_capacity_dth,
    material_it_cut: Math.max(
      scenario.answer_key.recut.cuts_dth.CEMK,
      scenario.answer_key.recut.cuts_dth.SABT,
    ) >= 5_000,
    has_violator: scenario.answer_key.violators.length > 0,
    has_compliant_shipper: scenario.answer_key.compliant.length > 0,
    allocation_and_exposure_tie:
      recutScheduledTotal === scenario.params.derated_capacity_dth &&
      exposureValues.every((value) => Number.isSafeInteger(value) && value >= 0) &&
      flowsTie,
    timing_invariant:
      scenario.params.incident_time_ct === "16:15" &&
      scenario.actual_flows.length === SCENARIO_SHIPPERS.length * 6,
  };
}

export function scenarioPasses(
  validation: ScenarioValidation,
): boolean {
  return Object.values(validation).every(Boolean);
}

function heroScenario(): GeneratedScenario {
  const projectedDth: Record<ScenarioShipper, number> = {
    LSPP: 287_500,
    ABCL: 321_000,
    NTGU: 178_200,
    CEMK: 54_000,
    SABT: 35_500,
  };
  const deliveryPointByShipper: Record<ScenarioShipper, string> = {
    LSPP: "DP-LSPP-GEN",
    ABCL: "DP-ABIL-DC",
    NTGU: "DP-DFW-LDC",
    CEMK: "DP-INDL",
    SABT: "DP-INDL",
  };
  const heroVolumes: Record<ScenarioShipper, number[]> = {
    LSPP: [10_500, 11_000, 11_500, 12_250, 13_000, 13_625],
    ABCL: [12_750, 13_000, 13_250, 13_500, 13_750, 14_000],
    NTGU: [7_425, 7_425, 7_425, 7_425, 7_425, 7_425],
    CEMK: [2_250, 2_250, 2_250, 2_250, 2_250, 2_250],
    SABT: [1_480, 1_479, 1_479, 1_479, 1_479, 1_479],
  };
  const scenario: GeneratedScenario = {
    seed: "hero",
    params: {
      derated_capacity_dth: 820_000,
      incident_time_ct: "16:15",
      notice: {
        stage: "Stage 2",
        tolerance_pct: 5,
        penalty_rate_cents_dth: 2_500,
      },
      it_nominations_dth: { CEMK: 150_000, SABT: 100_000 },
      flow_deviation_bps: {
        LSPP: 1_500,
        ABCL: 700,
        NTGU: -100,
        CEMK: 0,
        SABT: -140,
      },
    },
    answer_key: {
      timely: {
        proration_factor: "0.6800",
        scheduled_dth: { CEMK: 102_000, SABT: 68_000 },
      },
      recut: {
        proration_factor: "0.3600",
        scheduled_dth: { CEMK: 54_000, SABT: 36_000 },
        cuts_dth: { CEMK: 48_000, SABT: 32_000 },
      },
      exposure_cents: {
        LSPP: 62_500_000,
        ABCL: 15_000_000,
        NTGU: 0,
        CEMK: 0,
        SABT: 0,
      },
      violators: ["LSPP", "ABCL"],
      compliant: ["NTGU", "CEMK", "SABT"],
    },
    nominations: [
      { id: "NOM-TIMELY-LSPP", shipper_id: "LSPP", nominated_dth: 250_000, scheduled_dth: 250_000, status: "scheduled" },
      { id: "NOM-TIMELY-ABCL", shipper_id: "ABCL", nominated_dth: 300_000, scheduled_dth: 300_000, status: "scheduled" },
      { id: "NOM-TIMELY-NTGU", shipper_id: "NTGU", nominated_dth: 180_000, scheduled_dth: 180_000, status: "scheduled" },
      { id: "NOM-TIMELY-CEMK", shipper_id: "CEMK", nominated_dth: 150_000, scheduled_dth: 102_000, status: "scheduled" },
      { id: "NOM-TIMELY-SABT", shipper_id: "SABT", nominated_dth: 100_000, scheduled_dth: 68_000, status: "scheduled" },
    ],
    actual_flows: SCENARIO_SHIPPERS.flatMap((shipperId) =>
      heroVolumes[shipperId].map((volumeDth, flowHour) => ({
        point_id: deliveryPointByShipper[shipperId],
        shipper_id: shipperId,
        flow_hour: flowHour,
        volume_dth: volumeDth,
      }))
    ),
    projected_dth: projectedDth,
    validation: {
      firm_within_derate: false,
      material_it_cut: false,
      has_violator: false,
      has_compliant_shipper: false,
      allocation_and_exposure_tie: false,
      timing_invariant: false,
    },
  };
  scenario.validation = validateGeneratedScenario(scenario);
  if (!scenarioPasses(scenario.validation)) throw new Error("canonical hero scenario is invalid");
  return scenario;
}

export function generateScenario(seed: string): GeneratedScenario {
  if (seed === "hero") return heroScenario();
  if (!/^SCN-[A-Z0-9]{4,12}$/.test(seed)) {
    throw new Error("scenario seed must match SCN-[A-Z0-9]{4,12}");
  }
  const random = mulberry32(seedHash(seed));
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const generated = candidate(seed, random);
    if (scenarioPasses(generated.validation)) return generated;
  }
  throw new Error(`could not generate a valid scenario for ${seed}`);
}

export function randomScenarioSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `SCN-${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
