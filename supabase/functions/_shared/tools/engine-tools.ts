import {
  apply_scheduling_priority,
  assess_system_impact,
  calculate_exposure,
  calculate_imbalance,
  check_segment_capacity,
  type ImbalanceResult,
  type NominationInput,
  type PriorityRank,
  type SegmentCapacityResult,
  type ShipperExposure,
  type TariffRule,
} from "./engines.ts";
import {
  asJson,
  optionalNumber,
  requiredArray,
  requiredIdentifier,
  requiredInteger,
  requiredObject,
  ToolFailure,
  type ToolDefinition,
  type ToolHandler,
} from "./types.ts";

function parsePriority(value: unknown, label: string): PriorityRank {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new ToolFailure("INVALID_INPUT", `${label} must be 1, 2, or 3`);
  }
  return value;
}

function parseNomination(value: unknown, index: number): NominationInput {
  const row = requiredObject(value, `nominations[${index}]`);
  const previous = row.previous_scheduled_dth;
  if (previous !== undefined && previous !== null && typeof previous !== "number") {
    throw new ToolFailure(
      "INVALID_INPUT",
      `nominations[${index}].previous_scheduled_dth must be a number or null`,
    );
  }
  return {
    nomination_id: requiredIdentifier(row, "nomination_id"),
    shipper_id: requiredIdentifier(row, "shipper_id"),
    priority_rank: parsePriority(row.priority_rank, `nominations[${index}].priority_rank`),
    nominated_dth: requiredInteger(row, "nominated_dth"),
    previous_scheduled_dth: previous as number | null | undefined,
  };
}

async function loadTariffRules(
  pipelineId: string,
  context: Parameters<ToolHandler>[1],
): Promise<TariffRule[]> {
  const rules = await context.db.select<TariffRule>({
    table: "tariff_rules",
    columns: "rule_type,rule_key,value_numeric,value_text,citation",
    filters: [{ op: "eq", column: "pipeline_id", value: pipelineId }],
    order: [{ column: "rule_type" }, { column: "rule_key" }],
    limit: 100,
  });
  if (rules.length === 0) {
    throw new ToolFailure("TARIFF_RULE_NOT_FOUND", `no tariff rules found for ${pipelineId}`);
  }
  return rules;
}

async function loadNumericTariffRule(
  pipelineId: string,
  ruleType: string,
  ruleKey: string,
  context: Parameters<ToolHandler>[1],
): Promise<{ value: number; citation: string }> {
  const rows = await context.db.select<TariffRule>({
    table: "tariff_rules",
    columns: "rule_type,rule_key,value_numeric,value_text,citation",
    filters: [
      { op: "eq", column: "pipeline_id", value: pipelineId },
      { op: "eq", column: "rule_type", value: ruleType },
      { op: "eq", column: "rule_key", value: ruleKey },
    ],
    limit: 1,
  });
  const rule = rows[0];
  if (rule?.value_numeric === null || rule?.value_numeric === undefined) {
    throw new ToolFailure(
      "TARIFF_RULE_NOT_FOUND",
      `numeric tariff rule not found: ${pipelineId}/${ruleType}/${ruleKey}`,
    );
  }
  if (!rule.citation) {
    throw new ToolFailure("MISSING_CITATION", `tariff citation missing for ${ruleKey}`);
  }
  return { value: rule.value_numeric, citation: rule.citation };
}

const checkCapacity: ToolHandler = async (input) => {
  const operatingCapacity = requiredInteger(input, "operating_capacity_dth");
  const rows = requiredArray(input, "nominations").map((value, index) => {
    const row = requiredObject(value, `nominations[${index}]`);
    const scheduled = row.scheduled_dth;
    if (scheduled !== null && (typeof scheduled !== "number" || !Number.isInteger(scheduled))) {
      throw new ToolFailure(
        "INVALID_INPUT",
        `nominations[${index}].scheduled_dth must be a number or null`,
      );
    }
    return {
      priority_rank: parsePriority(row.priority_rank, `nominations[${index}].priority_rank`),
      scheduled_dth: scheduled,
    };
  });
  return { ok: true, data: asJson(check_segment_capacity(operatingCapacity, rows)) };
};

const applyPriority: ToolHandler = async (input, context) => {
  const pipelineId = requiredIdentifier(input, "pipeline_id");
  const nominations = requiredArray(input, "nominations").map(parseNomination);
  const rules = await loadTariffRules(pipelineId, context);
  const capacity = requiredInteger(input, "operating_capacity_dth");
  const result = apply_scheduling_priority(nominations, capacity, rules);
  return { ok: true, data: asJson(result), citation: result.citation };
};

const imbalance: ToolHandler = async (input, context) => {
  const pipelineId = requiredIdentifier(input, "pipeline_id");
  const ruleKey = requiredIdentifier(input, "tolerance_rule_key");
  const rule = await loadNumericTariffRule(pipelineId, "tolerance", ruleKey, context);
  return {
    ok: true,
    data: asJson(calculate_imbalance(
      requiredInteger(input, "scheduled_dth"),
      requiredInteger(input, "projected_dth"),
      rule.value,
    )),
    citation: rule.citation,
  };
};

const exposure: ToolHandler = async (input, context) => {
  const pipelineId = requiredIdentifier(input, "pipeline_id");
  const ruleKey = requiredIdentifier(input, "penalty_rule_key");
  const rule = await loadNumericTariffRule(pipelineId, "ofo_penalty", ruleKey, context);
  const days = optionalNumber(input, "days") ?? 1;
  if (!Number.isInteger(days)) {
    throw new ToolFailure("INVALID_INPUT", "days must be an integer");
  }
  const result = calculate_exposure(
    requiredInteger(input, "excess_dth"),
    requiredInteger({ penalty_rate_cents_dth: rule.value }, "penalty_rate_cents_dth"),
    days,
    rule.citation,
  );
  return { ok: true, data: asJson(result), citation: rule.citation };
};

function parseCapacity(value: unknown): SegmentCapacityResult {
  const row = requiredObject(value, "capacity");
  const tiers = requiredObject(row.scheduled_by_tier, "capacity.scheduled_by_tier");
  return {
    operating_capacity_dth: requiredInteger(row, "operating_capacity_dth"),
    scheduled_by_tier: {
      1: requiredInteger(tiers, "1"),
      2: requiredInteger(tiers, "2"),
      3: requiredInteger(tiers, "3"),
    },
    scheduled_total_dth: requiredInteger(row, "scheduled_total_dth"),
    headroom_dth: requiredInteger(row, "headroom_dth"),
    shortfall_dth: requiredInteger(row, "shortfall_dth"),
  };
}

function parseShipperExposure(value: unknown, index: number): ShipperExposure {
  const row = requiredObject(value, `shipper_exposures[${index}]`);
  const imbalanceRow = requiredObject(row.imbalance, `shipper_exposures[${index}].imbalance`);
  const exposureRow = requiredObject(row.exposure, `shipper_exposures[${index}].exposure`);
  const imbalanceValue = imbalanceRow as unknown as ImbalanceResult;
  if (
    !Number.isInteger(imbalanceValue.excess_dth) ||
    typeof imbalanceValue.in_violation !== "boolean" ||
    !["over", "under", "balanced"].includes(imbalanceValue.direction)
  ) {
    throw new ToolFailure("INVALID_INPUT", `shipper_exposures[${index}].imbalance is invalid`);
  }
  const exposureValue = exposureRow as unknown as ShipperExposure["exposure"];
  if (!Number.isInteger(exposureValue.exposure_cents)) {
    throw new ToolFailure("INVALID_INPUT", `shipper_exposures[${index}].exposure is invalid`);
  }
  return {
    shipper_id: requiredIdentifier(row, "shipper_id"),
    imbalance: imbalanceValue,
    exposure: exposureValue,
  };
}

const systemImpact: ToolHandler = async (input) => {
  const result = assess_system_impact(
    requiredIdentifier(input, "segment_id"),
    parseCapacity(input.capacity),
    requiredArray(input, "shipper_exposures").map(parseShipperExposure),
  );
  return { ok: true, data: asJson(result) };
};

const integer = { type: "integer" };
const string = { type: "string" };
const priority = { type: "integer", enum: [1, 2, 3] };
const nominationSchema = {
  type: "object",
  properties: {
    nomination_id: string,
    shipper_id: string,
    priority_rank: priority,
    nominated_dth: integer,
    previous_scheduled_dth: { type: ["integer", "null"] },
  },
  required: ["nomination_id", "shipper_id", "priority_rank", "nominated_dth"],
  additionalProperties: false,
};
const capacitySchema = {
  type: "object",
  properties: {
    operating_capacity_dth: integer,
    scheduled_by_tier: {
      type: "object",
      properties: { "1": integer, "2": integer, "3": integer },
      required: ["1", "2", "3"],
      additionalProperties: false,
    },
    scheduled_total_dth: integer,
    headroom_dth: integer,
    shortfall_dth: integer,
  },
  required: [
    "operating_capacity_dth",
    "scheduled_by_tier",
    "scheduled_total_dth",
    "headroom_dth",
    "shortfall_dth",
  ],
  additionalProperties: false,
};
const imbalanceSchema = {
  type: "object",
  properties: {
    scheduled_dth: integer,
    projected_dth: integer,
    imbalance_dth: integer,
    imbalance_pct_str: string,
    tolerance_dth: integer,
    excess_dth: integer,
    in_violation: { type: "boolean" },
    direction: { type: "string", enum: ["over", "under", "balanced"] },
  },
  required: [
    "scheduled_dth",
    "projected_dth",
    "imbalance_dth",
    "imbalance_pct_str",
    "tolerance_dth",
    "excess_dth",
    "in_violation",
    "direction",
  ],
  additionalProperties: false,
};
const exposureSchema = {
  type: "object",
  properties: {
    excess_dth: integer,
    penalty_rate_cents_dth: integer,
    days: integer,
    exposure_cents: integer,
    formula_string: string,
    citation: string,
  },
  required: [
    "excess_dth",
    "penalty_rate_cents_dth",
    "days",
    "exposure_cents",
    "formula_string",
    "citation",
  ],
  additionalProperties: false,
};

export const definitions: ToolDefinition[] = [
  {
    name: "check_segment_capacity",
    description: "Calculate scheduled totals by priority tier and headroom for one segment.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        operating_capacity_dth: integer,
        nominations: {
          type: "array",
          items: {
            type: "object",
            properties: { priority_rank: priority, scheduled_dth: { type: ["integer", "null"] } },
            required: ["priority_rank", "scheduled_dth"],
            additionalProperties: false,
          },
        },
      },
      required: ["operating_capacity_dth", "nominations"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_scheduling_priority",
    description:
      "Allocate nominations deterministically by tariff priority and return exact cuts, factor, and citation.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pipeline_id: string,
        nominations: { type: "array", items: nominationSchema },
        operating_capacity_dth: integer,
      },
      required: ["pipeline_id", "nominations", "operating_capacity_dth"],
      additionalProperties: false,
    },
  },
  {
    name: "calculate_imbalance",
    description:
      "Calculate projected gas-day imbalance, tolerance, excess, direction, and violation status.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pipeline_id: string,
        scheduled_dth: integer,
        projected_dth: integer,
        tolerance_rule_key: string,
      },
      required: ["pipeline_id", "scheduled_dth", "projected_dth", "tolerance_rule_key"],
      additionalProperties: false,
    },
  },
  {
    name: "calculate_exposure",
    description:
      "Calculate projected potential exposure in integer cents and return a verifiable formula.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pipeline_id: string,
        excess_dth: integer,
        penalty_rule_key: string,
        days: integer,
      },
      required: ["pipeline_id", "excess_dth", "penalty_rule_key"],
      additionalProperties: false,
    },
  },
  {
    name: "assess_system_impact",
    description:
      "Aggregate shipper violations into deterministic line-pack risk inputs and exposure totals.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        segment_id: string,
        capacity: capacitySchema,
        shipper_exposures: {
          type: "array",
          items: {
            type: "object",
            properties: {
              shipper_id: string,
              imbalance: imbalanceSchema,
              exposure: exposureSchema,
            },
            required: ["shipper_id", "imbalance", "exposure"],
            additionalProperties: false,
          },
        },
      },
      required: ["segment_id", "capacity", "shipper_exposures"],
      additionalProperties: false,
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  check_segment_capacity: checkCapacity,
  apply_scheduling_priority: applyPriority,
  calculate_imbalance: imbalance,
  calculate_exposure: exposure,
  assess_system_impact: systemImpact,
};
