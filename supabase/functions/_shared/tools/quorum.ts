import {
  asJson,
  requiredIdentifier,
  requiredString,
  ToolFailure,
  type ToolDefinition,
  type ToolHandler,
} from "./types.ts";

export interface PointRow {
  id: string;
  pipeline_id: string;
  name: string;
  point_type: string;
  corridor_seq: number;
  meter_id: string | null;
}

export interface SegmentRow {
  id: string;
  pipeline_id: string;
  name: string;
  from_point: string;
  to_point: string;
  design_capacity_dth: number;
  operating_capacity_dth: number;
  seq: number;
}

interface ContractRow {
  id: string;
  shipper_id: string;
  pipeline_id: string;
  contract_number: string;
  service_type: string;
  mdq_dth: number | null;
  primary_receipt_point: string | null;
  primary_delivery_point: string | null;
  storage_rights_dth: number | null;
  storage_point: string | null;
  effective_start: string;
  effective_end: string;
}

interface ShipperRow {
  id: string;
  name: string;
  shipper_type: string;
  duns: string | null;
  contact_email: string | null;
}

interface TariffRuleRow {
  id: string;
  pipeline_id: string;
  rule_type: string;
  rule_key: string;
  value_numeric: number | null;
  value_text: string | null;
  citation: string;
}

export interface NetworkTopology {
  pipeline_id: string;
  points: PointRow[];
  segments: SegmentRow[];
}

function pointById(topology: NetworkTopology, pointId: string): PointRow {
  const point = topology.points.find((candidate) => candidate.id === pointId);
  if (point === undefined) {
    throw new ToolFailure("POINT_NOT_FOUND", `point not found on ${topology.pipeline_id}: ${pointId}`);
  }
  return point;
}

function segmentById(topology: NetworkTopology, segmentId: string): SegmentRow {
  const segment = topology.segments.find((candidate) => candidate.id === segmentId);
  if (segment === undefined) {
    throw new ToolFailure(
      "SEGMENT_NOT_FOUND",
      `segment not found on ${topology.pipeline_id}: ${segmentId}`,
    );
  }
  return segment;
}

/**
 * Ordered segments consumed by a nomination path.
 *
 * Points attached to a junction share that junction's corridor_seq. A delivery at seq 3
 * therefore traverses segments ending at seq 3, including SEG-2.
 */
export function segments_traversed(
  topology: NetworkTopology,
  receiptPointId: string,
  deliveryPointId: string,
): SegmentRow[] {
  const receipt = pointById(topology, receiptPointId);
  const delivery = pointById(topology, deliveryPointId);

  if (delivery.corridor_seq <= receipt.corridor_seq) {
    throw new ToolFailure(
      "INVALID_PATH",
      `delivery ${deliveryPointId} must be downstream of receipt ${receiptPointId}`,
    );
  }

  return topology.segments
    .filter((segment) => {
      const from = pointById(topology, segment.from_point);
      const to = pointById(topology, segment.to_point);
      return from.corridor_seq >= receipt.corridor_seq &&
        to.corridor_seq <= delivery.corridor_seq;
    })
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Whether a point is at or beyond the downstream boundary of a segment.
 *
 * RP-BETH and SEG-2's downstream junction both sit at seq 3, so this returns true for the
 * Phase 2 gate without relying on model inference.
 */
export function is_downstream_of(
  topology: NetworkTopology,
  pointId: string,
  segmentId: string,
): boolean {
  const point = pointById(topology, pointId);
  const segment = segmentById(topology, segmentId);
  const segmentEnd = pointById(topology, segment.to_point);
  return point.corridor_seq >= segmentEnd.corridor_seq;
}

export async function loadTopology(
  pipelineId: string,
  handler: Parameters<ToolHandler>[1],
): Promise<NetworkTopology> {
  const [points, segments] = await Promise.all([
    handler.db.select<PointRow>({
      table: "points",
      columns: "id,pipeline_id,name,point_type,corridor_seq,meter_id",
      filters: [{ op: "eq", column: "pipeline_id", value: pipelineId }],
      order: [{ column: "corridor_seq" }, { column: "id" }],
      limit: 200,
    }),
    handler.db.select<SegmentRow>({
      table: "segments",
      columns:
        "id,pipeline_id,name,from_point,to_point,design_capacity_dth,operating_capacity_dth,seq",
      filters: [{ op: "eq", column: "pipeline_id", value: pipelineId }],
      order: [{ column: "seq" }],
      limit: 100,
    }),
  ]);

  if (points.length === 0 || segments.length === 0) {
    throw new ToolFailure("PIPELINE_NOT_FOUND", `network topology not found: ${pipelineId}`);
  }

  return { pipeline_id: pipelineId, points, segments };
}

const getContract: ToolHandler = async (input, context) => {
  const shipperId = requiredIdentifier(input, "shipper_id");
  const contractId = input.contract_id === undefined
    ? undefined
    : requiredIdentifier(input, "contract_id");
  const filters = [{ op: "eq" as const, column: "shipper_id", value: shipperId }];
  if (contractId !== undefined) {
    filters.push({ op: "eq", column: "id", value: contractId });
  }

  const contracts = await context.db.select<ContractRow>({
    table: "contracts",
    columns:
      "id,shipper_id,pipeline_id,contract_number,service_type,mdq_dth,primary_receipt_point,primary_delivery_point,storage_rights_dth,storage_point,effective_start,effective_end",
    filters,
    order: [{ column: "id" }],
    limit: 20,
  });
  if (contracts.length === 0) {
    throw new ToolFailure("CONTRACT_NOT_FOUND", `no contract found for shipper ${shipperId}`);
  }

  return { ok: true, data: asJson({ shipper_id: shipperId, contracts }) };
};

const getShipper: ToolHandler = async (input, context) => {
  const shipperId = requiredIdentifier(input, "shipper_id");
  const rows = await context.db.select<ShipperRow>({
    table: "shippers",
    columns: "id,name,shipper_type,duns,contact_email",
    filters: [{ op: "eq", column: "id", value: shipperId }],
    limit: 1,
  });
  const shipper = rows[0];
  if (shipper === undefined) {
    throw new ToolFailure("SHIPPER_NOT_FOUND", `shipper not found: ${shipperId}`);
  }
  return { ok: true, data: asJson(shipper) };
};

const getNetworkTopology: ToolHandler = async (input, context) => {
  const pipelineId = requiredIdentifier(input, "pipeline_id");
  const topology = await loadTopology(pipelineId, context);
  const receiptPoint = input.receipt_point === undefined
    ? undefined
    : requiredIdentifier(input, "receipt_point");
  const deliveryPoint = input.delivery_point === undefined
    ? undefined
    : requiredIdentifier(input, "delivery_point");
  const pointId = input.point_id === undefined
    ? undefined
    : requiredIdentifier(input, "point_id");
  const segmentId = input.segment_id === undefined
    ? undefined
    : requiredIdentifier(input, "segment_id");

  if ((receiptPoint === undefined) !== (deliveryPoint === undefined)) {
    throw new ToolFailure(
      "INVALID_INPUT",
      "receipt_point and delivery_point must be provided together",
    );
  }
  if ((pointId === undefined) !== (segmentId === undefined)) {
    throw new ToolFailure("INVALID_INPUT", "point_id and segment_id must be provided together");
  }

  const segments = topology.segments.map((segment) => ({
    ...segment,
    downstream_point_ids: topology.points
      .filter((point) => is_downstream_of(topology, point.id, segment.id))
      .map((point) => point.id),
  }));

  return {
    ok: true,
    data: asJson({
      pipeline_id: pipelineId,
      points: topology.points,
      segments,
      segments_traversed: receiptPoint !== undefined && deliveryPoint !== undefined
        ? segments_traversed(topology, receiptPoint, deliveryPoint).map((segment) => segment.id)
        : null,
      is_downstream_of: pointId !== undefined && segmentId !== undefined
        ? is_downstream_of(topology, pointId, segmentId)
        : null,
      topology_rule:
        "corridor_seq increases downstream; a point is downstream when its sequence is at or beyond the segment end",
    }),
  };
};

const getTariffRule: ToolHandler = async (input, context) => {
  const pipelineId = requiredIdentifier(input, "pipeline_id");
  const ruleType = requiredString(input, "rule_type");
  const ruleKey = requiredString(input, "rule_key");
  const rows = await context.db.select<TariffRuleRow>({
    table: "tariff_rules",
    columns: "id,pipeline_id,rule_type,rule_key,value_numeric,value_text,citation",
    filters: [
      { op: "eq", column: "pipeline_id", value: pipelineId },
      { op: "eq", column: "rule_type", value: ruleType },
      { op: "eq", column: "rule_key", value: ruleKey },
    ],
    limit: 1,
  });
  const rule = rows[0];
  if (rule === undefined) {
    throw new ToolFailure("TARIFF_RULE_NOT_FOUND", `tariff rule not found: ${ruleType}/${ruleKey}`);
  }
  if (rule.citation.trim() === "") {
    throw new ToolFailure("MISSING_CITATION", `tariff rule has no citation: ${ruleType}/${ruleKey}`);
  }
  return { ok: true, data: asJson(rule), citation: rule.citation };
};

export const definitions: ToolDefinition[] = [
  {
    name: "get_contract",
    description:
      "Read operator contract terms for a shipper, including MDQ, primary points, and storage rights. Read-only.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        shipper_id: { type: "string", description: "Shipper identifier" },
        contract_id: { type: "string", description: "Optional specific contract identifier" },
      },
      required: ["shipper_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_shipper",
    description: "Read a shipper's name, type, DUNS, and contact information. Read-only.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { shipper_id: { type: "string", description: "Shipper identifier" } },
      required: ["shipper_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_network_topology",
    description:
      "Read ordered pipeline points and segments, including explicit downstream-point relationships. Never infer topology.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pipeline_id: { type: "string", description: "Pipeline identifier" },
        receipt_point: {
          type: "string",
          description: "Optional receipt; provide with delivery_point to resolve its path",
        },
        delivery_point: {
          type: "string",
          description: "Optional delivery; provide with receipt_point to resolve its path",
        },
        point_id: {
          type: "string",
          description: "Optional point; provide with segment_id for a downstream check",
        },
        segment_id: {
          type: "string",
          description: "Optional segment; provide with point_id for a downstream check",
        },
      },
      required: ["pipeline_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_tariff_rule",
    description: "Read one tariff rule and its synthetic citation. Read-only.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pipeline_id: { type: "string", description: "Pipeline identifier" },
        rule_type: { type: "string", description: "Tariff rule category" },
        rule_key: { type: "string", description: "Tariff rule key" },
      },
      required: ["pipeline_id", "rule_type", "rule_key"],
      additionalProperties: false,
    },
  },
];

export const handlers: Record<string, ToolHandler> = {
  get_contract: getContract,
  get_shipper: getShipper,
  get_network_topology: getNetworkTopology,
  get_tariff_rule: getTariffRule,
};
