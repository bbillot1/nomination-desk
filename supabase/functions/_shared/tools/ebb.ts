import {
  check_segment_capacity,
  type PriorityRank,
  type ScheduledNomination,
} from "./engines.ts";
import { centralTimeDisplay } from "../time.ts";
import { loadTopology, segments_traversed, type SegmentRow } from "./quorum.ts";
import {
  asJson,
  optionalEnum,
  requiredDate,
  requiredIdentifier,
  ToolFailure,
  type JsonValue,
  type ToolDefinition,
  type ToolFilter,
  type ToolHandler,
} from "./types.ts";

interface CycleRow {
  id: string;
  pipeline_id: string;
  gas_day: string;
  cycle_type: string;
  deadline_ct: string;
  status: string;
}

interface NominationRow {
  id: string;
  cycle_id: string;
  contract_id: string;
  shipper_id: string;
  receipt_point: string;
  delivery_point: string;
  priority_rank: number;
  nominated_dth: number;
  scheduled_dth: number | null;
  status: string;
  cut_reason: string | null;
  created_at: string | null;
}

interface NoticeRow {
  id: string;
  pipeline_id: string;
  notice_type: string;
  headline: string;
  body_text: string;
  stage: string | null;
  tolerance_pct: number | null;
  penalty_rate_cents_dth: number | null;
  affected_segment: string | null;
  derate_to_dth: number | null;
  effective_start: string | null;
  effective_end: string | null;
  status: string;
  posted_at: string | null;
  created_at: string | null;
}

interface ScenarioStateRow {
  id: number;
  gas_day: string;
  sim_clock_ct: string;
  params: JsonValue;
}

interface TariffRuleRow {
  rule_type: string;
  rule_key: string;
  value_numeric: number | null;
  value_text: string | null;
  citation: string;
}

async function singlePipelineId(context: Parameters<ToolHandler>[1]): Promise<string> {
  const pipelines = await context.db.select<{ id: string }>({
    table: "pipelines",
    columns: "id",
    order: [{ column: "id" }],
    limit: 2,
  });
  if (pipelines.length !== 1 || pipelines[0] === undefined) {
    throw new ToolFailure(
      "PIPELINE_CONTEXT_REQUIRED",
      "the active scenario must resolve to exactly one pipeline",
    );
  }
  return pipelines[0].id;
}

function priorityRank(value: number): PriorityRank {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new ToolFailure("INVALID_DATABASE_VALUE", `invalid nomination priority rank: ${value}`);
  }
  return value;
}

async function activeScenario(context: Parameters<ToolHandler>[1]): Promise<ScenarioStateRow> {
  const rows = await context.db.select<ScenarioStateRow>({
    table: "scenario_state",
    columns: "id,gas_day,sim_clock_ct,params",
    filters: [{ op: "eq", column: "id", value: 1 }],
    limit: 1,
  });
  const scenario = rows[0];
  if (scenario === undefined) {
    throw new ToolFailure("SCENARIO_NOT_FOUND", "active scenario_state row is missing");
  }
  return scenario;
}

async function cyclesForGasDay(
  gasDay: string,
  context: Parameters<ToolHandler>[1],
): Promise<CycleRow[]> {
  return context.db.select<CycleRow>({
    table: "cycles",
    columns: "id,pipeline_id,gas_day,cycle_type,deadline_ct,status",
    filters: [{ op: "eq", column: "gas_day", value: gasDay }],
    order: [{ column: "deadline_ct" }],
    limit: 20,
  });
}

async function nominationsForGasDay(
  gasDay: string,
  context: Parameters<ToolHandler>[1],
  extraFilters: { status?: string; shipperId?: string } = {},
): Promise<Array<NominationRow & { cycle_type: string; cycle_deadline_ct: string }>> {
  const cycles = await cyclesForGasDay(gasDay, context);
  if (cycles.length === 0) return [];

  const filters: ToolFilter[] = [{
    op: "in" as const,
    column: "cycle_id",
    values: cycles.map((cycle) => cycle.id),
  }];
  if (extraFilters.status !== undefined) {
    filters.push({
      op: "eq",
      column: "status",
      value: extraFilters.status,
    });
  }
  if (extraFilters.shipperId !== undefined) {
    filters.push({
      op: "eq",
      column: "shipper_id",
      value: extraFilters.shipperId,
    });
  }

  const nominations = await context.db.select<NominationRow>({
    table: "nominations",
    columns:
      "id,cycle_id,contract_id,shipper_id,receipt_point,delivery_point,priority_rank,nominated_dth,scheduled_dth,status,cut_reason,created_at",
    filters,
    order: [{ column: "created_at" }, { column: "id" }],
    limit: 500,
  });
  const cycleById = new Map(cycles.map((cycle) => [cycle.id, cycle]));

  return nominations.map((nomination) => {
    const cycle = cycleById.get(nomination.cycle_id);
    if (cycle === undefined) {
      throw new ToolFailure(
        "INVALID_DATABASE_VALUE",
        `cycle missing for nomination ${nomination.id}`,
      );
    }
    return {
      ...nomination,
      cycle_type: cycle.cycle_type,
      cycle_deadline_ct: cycle.deadline_ct,
    };
  });
}

const getNominations: ToolHandler = async (input, context) => {
  const gasDay = requiredDate(input, "gas_day");
  const status = optionalEnum(
    input,
    "status",
    ["submitted", "scheduled", "cut", "superseded"] as const,
  );
  const shipperId = input.shipper_id === undefined
    ? undefined
    : requiredIdentifier(input, "shipper_id");
  const nominations = await nominationsForGasDay(gasDay, context, { status, shipperId });
  return { ok: true, data: asJson({ gas_day: gasDay, nominations }) };
};

const getOpenCycles: ToolHandler = async (input, context) => {
  const gasDay = requiredDate(input, "gas_day");
  const scenario = await activeScenario(context);
  const simTime = Date.parse(scenario.sim_clock_ct);
  if (!Number.isFinite(simTime)) {
    throw new ToolFailure("INVALID_DATABASE_VALUE", "scenario sim_clock_ct is invalid");
  }

  const cycles = (await cyclesForGasDay(gasDay, context))
    .filter((cycle) => cycle.status === "open")
    .map((cycle) => {
      const deadline = Date.parse(cycle.deadline_ct);
      if (!Number.isFinite(deadline)) {
        throw new ToolFailure(
          "INVALID_DATABASE_VALUE",
          `cycle deadline is invalid: ${cycle.id}`,
        );
      }
      return {
        ...cycle,
        deadline_ct_display: centralTimeDisplay(deadline),
        sim_minutes_remaining: Math.max(0, Math.floor((deadline - simTime) / 60_000)),
      };
    });

  return {
    ok: true,
    data: asJson({ gas_day: gasDay, sim_clock_ct: scenario.sim_clock_ct, cycles }),
  };
};

const getNotices: ToolHandler = async (input, context) => {
  const pipelineId = requiredIdentifier(input, "pipeline_id");
  const status = optionalEnum(input, "status", ["draft", "posted"] as const);
  const filters = [{ op: "eq" as const, column: "pipeline_id", value: pipelineId }];
  if (status !== undefined) filters.push({ op: "eq", column: "status", value: status });

  const notices = await context.db.select<NoticeRow>({
    table: "notices",
    columns:
      "id,pipeline_id,notice_type,headline,body_text,stage,tolerance_pct,penalty_rate_cents_dth,affected_segment,derate_to_dth,effective_start,effective_end,status,posted_at,created_at",
    filters,
    order: [{ column: "created_at", ascending: false }],
    limit: 100,
  });
  return {
    ok: true,
    data: asJson({
      pipeline_id: pipelineId,
      notices: notices.map((notice) => ({ ...notice, body_text_is_untrusted: true })),
    }),
  };
};

function proposedNoticeParams(params: JsonValue): {
  stage: string;
  tolerance_pct: number;
  penalty_rate_cents_dth: number;
} {
  if (params === null || Array.isArray(params) || typeof params !== "object") {
    throw new ToolFailure("INVALID_DATABASE_VALUE", "scenario params must be an object");
  }
  const notice = params.notice;
  if (notice === null || Array.isArray(notice) || typeof notice !== "object") {
    throw new ToolFailure("INVALID_DATABASE_VALUE", "scenario params.notice must be an object");
  }
  const { stage, tolerance_pct, penalty_rate_cents_dth } = notice;
  if (
    typeof stage !== "string" ||
    typeof tolerance_pct !== "number" ||
    typeof penalty_rate_cents_dth !== "number" ||
    !Number.isInteger(penalty_rate_cents_dth)
  ) {
    throw new ToolFailure("INVALID_DATABASE_VALUE", "proposed notice terms are invalid");
  }
  return { stage, tolerance_pct, penalty_rate_cents_dth };
}

const getProposedNoticeTerms: ToolHandler = async (_input, context) => {
  const scenario = await activeScenario(context);
  const pipelineId = await singlePipelineId(context);
  const proposed = proposedNoticeParams(scenario.params);
  const stageMatch = /^Stage\s+(\d+)$/i.exec(proposed.stage);
  if (stageMatch?.[1] === undefined) {
    throw new ToolFailure("INVALID_DATABASE_VALUE", `unsupported notice stage: ${proposed.stage}`);
  }
  const stageKey = `stage_${stageMatch[1]}`;
  const toleranceKey = `${stageKey}_pct`;
  const penaltyKey = `${stageKey}_rate_cents_dth`;
  const rules = await context.db.select<TariffRuleRow>({
    table: "tariff_rules",
    columns: "rule_type,rule_key,value_numeric,value_text,citation",
    filters: [
      { op: "eq", column: "pipeline_id", value: pipelineId },
      {
        op: "in",
        column: "rule_key",
        values: [toleranceKey, penaltyKey],
      },
    ],
    limit: 2,
  });
  const toleranceRule = rules.find((rule) => rule.rule_key === toleranceKey);
  const penaltyRule = rules.find((rule) => rule.rule_key === penaltyKey);
  if (toleranceRule === undefined || penaltyRule === undefined) {
    throw new ToolFailure("TARIFF_RULE_NOT_FOUND", `notice rules missing for ${proposed.stage}`);
  }
  if (
    toleranceRule.value_numeric !== proposed.tolerance_pct ||
    penaltyRule.value_numeric !== proposed.penalty_rate_cents_dth
  ) {
    throw new ToolFailure(
      "NOTICE_TARIFF_MISMATCH",
      `scenario notice terms do not match tariff rows for ${proposed.stage}`,
    );
  }

  return {
    ok: true,
    data: asJson({
      stage: proposed.stage,
      pipeline_id: pipelineId,
      tolerance: {
        rule_key: toleranceKey,
        value_pct: proposed.tolerance_pct,
        citation: toleranceRule.citation,
      },
      penalty: {
        rule_key: penaltyKey,
        rate_cents_dth: proposed.penalty_rate_cents_dth,
        citation: penaltyRule.citation,
      },
    }),
    citation: toleranceRule.citation === penaltyRule.citation
      ? toleranceRule.citation
      : `${toleranceRule.citation}; ${penaltyRule.citation}`,
  };
};

const getSegmentState: ToolHandler = async (input, context) => {
  const segmentId = requiredIdentifier(input, "segment_id");
  const segmentRows = await context.db.select<SegmentRow>({
    table: "segments",
    columns:
      "id,pipeline_id,name,from_point,to_point,design_capacity_dth,operating_capacity_dth,seq",
    filters: [{ op: "eq", column: "id", value: segmentId }],
    limit: 1,
  });
  const segment = segmentRows[0];
  if (segment === undefined) {
    throw new ToolFailure("SEGMENT_NOT_FOUND", `segment not found: ${segmentId}`);
  }

  const scenario = await activeScenario(context);
  const topology = await loadTopology(segment.pipeline_id, context);
  const nominations = await nominationsForGasDay(scenario.gas_day, context);
  const traversing = nominations
    .filter((nomination) => nomination.status === "scheduled" || nomination.status === "cut")
    .filter((nomination) =>
      segments_traversed(topology, nomination.receipt_point, nomination.delivery_point)
        .some((candidate) => candidate.id === segmentId)
    );
  const scheduled: ScheduledNomination[] = traversing.map((nomination) => ({
    priority_rank: priorityRank(nomination.priority_rank),
    scheduled_dth: nomination.scheduled_dth,
  }));
  const capacity = check_segment_capacity(segment.operating_capacity_dth, scheduled);

  return {
    ok: true,
    data: asJson({
      segment,
      gas_day: scenario.gas_day,
      ...capacity,
      traversing_nominations: traversing.map((nomination) => ({
        nomination_id: nomination.id,
        shipper_id: nomination.shipper_id,
        priority_rank: nomination.priority_rank,
        scheduled_dth: nomination.scheduled_dth,
      })),
    }),
  };
};

export const definitions: ToolDefinition[] = [
  {
    name: "get_nominations",
    description:
      "Read nominations for a gas day, optionally filtered by status or shipper, including priority and scheduled volume.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        gas_day: { type: "string", description: "Gas day in YYYY-MM-DD format" },
        status: {
          type: "string",
          enum: ["submitted", "scheduled", "cut", "superseded"],
          description: "Optional nomination status",
        },
        shipper_id: { type: "string", description: "Optional shipper identifier" },
      },
      required: ["gas_day"],
      additionalProperties: false,
    },
  },
  {
    name: "get_open_cycles",
    description:
      "Read open nomination cycles and deterministic minutes remaining against the simulated clock.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { gas_day: { type: "string", description: "Gas day in YYYY-MM-DD format" } },
      required: ["gas_day"],
      additionalProperties: false,
    },
  },
  {
    name: "get_notices",
    description: "Read public EBB notices for a pipeline, optionally filtered by draft/posted status.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pipeline_id: { type: "string", description: "Pipeline identifier" },
        status: {
          type: "string",
          enum: ["draft", "posted"],
          description: "Optional draft or posted status",
        },
      },
      required: ["pipeline_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_proposed_notice_terms",
    description:
      "Read proposed flow-order stage, tolerance, penalty, and citations from scenario parameters joined to tariff rules.",
    strict: true,
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_segment_state",
    description:
      "Read operating capacity, scheduled totals by priority tier, headroom, and nominations traversing one segment.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { segment_id: { type: "string", description: "Segment identifier" } },
      required: ["segment_id"],
      additionalProperties: false,
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  get_nominations: getNominations,
  get_open_cycles: getOpenCycles,
  get_notices: getNotices,
  get_proposed_notice_terms: getProposedNoticeTerms,
  get_segment_state: getSegmentState,
};
