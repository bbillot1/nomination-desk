import { dth, floorDiv, sumExact } from "../numeric.ts";
import { centralTimeDisplay } from "../time.ts";
import {
  asJson,
  optionalBoolean,
  requiredDate,
  requiredIdentifier,
  ToolFailure,
  type ToolDefinition,
  type ToolFilter,
  type ToolHandler,
} from "./types.ts";

interface ScadaEventRow {
  id: string;
  pipeline_id: string;
  event_type: string;
  asset: string;
  segment_id: string | null;
  detail: unknown;
  occurred_at: string;
  acknowledged: boolean | null;
}

export interface ActualFlowRow {
  id: number;
  point_id: string;
  shipper_id: string;
  gas_day: string;
  flow_hour: number;
  volume_dth: number;
}

export const GAS_DAY_TIME_CONVENTION =
  "flow_hour 0 begins 09:00 CT on gas_day; flow_hour 23 ends 09:00 CT the following day";

const getScadaEvents: ToolHandler = async (input, context) => {
  const pipelineId = requiredIdentifier(input, "pipeline_id");
  const unacknowledgedOnly = optionalBoolean(input, "unacknowledged_only") ?? false;
  const filters: ToolFilter[] = [{
    op: "eq",
    column: "pipeline_id",
    value: pipelineId,
  }];
  if (unacknowledgedOnly) {
    filters.push({ op: "eq", column: "acknowledged", value: false });
  }

  const events = await context.db.select<ScadaEventRow>({
    table: "scada_events",
    columns:
      "id,pipeline_id,event_type,asset,segment_id,detail,occurred_at,acknowledged",
    filters,
    order: [{ column: "occurred_at", ascending: false }],
    limit: 100,
  });

  return {
    ok: true,
    data: asJson({
      pipeline_id: pipelineId,
      events: events.map((event) => ({
        ...event,
        occurred_at_ct_display: centralTimeDisplay(event.occurred_at),
        detail_is_untrusted: true,
      })),
    }),
  };
};

const getActualFlows: ToolHandler = async (input, context) => {
  const gasDay = requiredDate(input, "gas_day");
  const shipperId = input.shipper_id === undefined
    ? undefined
    : requiredIdentifier(input, "shipper_id");
  const filters: ToolFilter[] = [{ op: "eq", column: "gas_day", value: gasDay }];
  if (shipperId !== undefined) {
    filters.push({ op: "eq", column: "shipper_id", value: shipperId });
  }

  const rows = await context.db.select<ActualFlowRow>({
    table: "actual_flows",
    columns: "id,point_id,shipper_id,gas_day,flow_hour,volume_dth",
    filters,
    order: [{ column: "shipper_id" }, { column: "flow_hour" }, { column: "point_id" }],
    limit: 500,
  });

  const measuredByShipper = new Map<string, number>();
  for (const row of rows) {
    dth(row.volume_dth);
    measuredByShipper.set(
      row.shipper_id,
      (measuredByShipper.get(row.shipper_id) ?? 0) + row.volume_dth,
    );
  }

  return {
    ok: true,
    data: asJson({
      gas_day: gasDay,
      time_convention: GAS_DAY_TIME_CONVENTION,
      rows,
      measured_totals_dth: Object.fromEntries(measuredByShipper),
    }),
  };
};

export interface DailyProjection {
  gas_day: string;
  shipper_id: string;
  measured_total_dth: number;
  measured_hours: number;
  measured_through_flow_hour: number;
  projected_dth: number;
  method: string;
  time_convention: string;
}

export async function calculateDailyProjection(
  gasDay: string,
  shipperId: string,
  rows: readonly ActualFlowRow[],
): Promise<DailyProjection> {
  if (rows.length === 0) {
    throw new ToolFailure(
      "NO_MEASUREMENTS",
      `no measured flows for shipper ${shipperId} on ${gasDay}`,
    );
  }

  const hours = [...new Set(rows.map((row) => row.flow_hour))].sort((a, b) => a - b);
  if (hours[0] !== 0 || hours.some((hour, index) => hour !== index)) {
    throw new ToolFailure(
      "INCOMPLETE_MEASUREMENTS",
      `measured flow hours must be contiguous from flow_hour 0 for ${shipperId}`,
    );
  }

  const measuredTotal = sumExact(rows.map((row) => dth(row.volume_dth)));
  const projected = floorDiv(measuredTotal * 24, hours.length);

  return {
    gas_day: gasDay,
    shipper_id: shipperId,
    measured_total_dth: measuredTotal,
    measured_hours: hours.length,
    measured_through_flow_hour: hours[hours.length - 1] ?? 0,
    projected_dth: projected,
    method: `run-rate extrapolation over ${hours.length} measured hours`,
    time_convention: GAS_DAY_TIME_CONVENTION,
  };
}

const projectDailyTotal: ToolHandler = async (input, context) => {
  const gasDay = requiredDate(input, "gas_day");
  const shipperId = requiredIdentifier(input, "shipper_id");
  const rows = await context.db.select<ActualFlowRow>({
    table: "actual_flows",
    columns: "id,point_id,shipper_id,gas_day,flow_hour,volume_dth",
    filters: [
      { op: "eq", column: "gas_day", value: gasDay },
      { op: "eq", column: "shipper_id", value: shipperId },
    ],
    order: [{ column: "flow_hour" }, { column: "point_id" }],
    limit: 100,
  });

  return { ok: true, data: asJson(await calculateDailyProjection(gasDay, shipperId, rows)) };
};

export const definitions: ToolDefinition[] = [
  {
    name: "get_scada_events",
    description:
      "Read SCADA incidents for a pipeline, including asset, segment, derate detail, and occurrence time.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pipeline_id: { type: "string", description: "Pipeline identifier" },
        unacknowledged_only: {
          type: "boolean",
          description: "When true, return only unacknowledged events",
        },
      },
      required: ["pipeline_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_actual_flows",
    description:
      "Read gas-day-aligned delivery-meter measurements and deterministic measured totals.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        gas_day: { type: "string", description: "Gas day in YYYY-MM-DD format" },
        shipper_id: { type: "string", description: "Optional shipper filter" },
      },
      required: ["gas_day"],
      additionalProperties: false,
    },
  },
  {
    name: "project_daily_total",
    description:
      "Project one shipper's full gas-day takes from contiguous measured hours using integer run-rate extrapolation.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        gas_day: { type: "string", description: "Gas day in YYYY-MM-DD format" },
        shipper_id: { type: "string", description: "Shipper identifier" },
      },
      required: ["gas_day", "shipper_id"],
      additionalProperties: false,
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  get_scada_events: getScadaEvents,
  get_actual_flows: getActualFlows,
  project_daily_total: projectDailyTotal,
};
