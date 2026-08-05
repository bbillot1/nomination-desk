/**
 * Live read-only smoke test for the Phase 2 tool layer.
 *
 * Required environment variables:
 *   SUPABASE_URL
 *   SUPABASE_PUBLISHABLE_KEY
 *
 * The publishable key is browser-safe and all reads remain subject to RLS. This script never
 * prints either value.
 */

import { createClient } from "@supabase/supabase-js";

import {
  dispatchTool,
  SupabaseToolDatabase,
} from "../supabase/functions/_shared/tools/index.ts";

const url = process.env.SUPABASE_URL;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");
}

const db = new SupabaseToolDatabase(createClient(url, publishableKey));
const context = { db };
const scenarios = await db.select<{ gas_day: string }>({
  table: "scenario_state",
  filters: [{ op: "eq", column: "id", value: 1 }],
});
const gasDay = scenarios[0]?.gas_day;
if (!gasDay) throw new Error("active scenario gas day is missing");

const cases: Array<[string, Record<string, unknown>]> = [
  ["get_scada_events", { pipeline_id: "ETX-NTX" }],
  ["get_actual_flows", { gas_day: gasDay }],
  ["project_daily_total", { gas_day: gasDay, shipper_id: "LSPP" }],
  ["get_nominations", { gas_day: gasDay }],
  ["get_open_cycles", { gas_day: gasDay }],
  ["get_notices", { pipeline_id: "ETX-NTX" }],
  ["get_proposed_notice_terms", {}],
  ["assess_flow_order_compliance", { pipeline_id: "ETX-NTX", segment_id: "SEG-2" }],
  ["get_segment_state", { segment_id: "SEG-2" }],
  ["get_contract", { shipper_id: "LSPP" }],
  ["get_shipper", { shipper_id: "LSPP" }],
  ["get_network_topology", {
    pipeline_id: "ETX-NTX",
    receipt_point: "RP-WAHA",
    delivery_point: "DP-LSPP-GEN",
    point_id: "RP-BETH",
    segment_id: "SEG-2",
  }],
  ["get_tariff_rule", {
    pipeline_id: "ETX-NTX",
    rule_type: "tolerance",
    rule_key: "stage_2_pct",
  }],
];

const verified: string[] = [];
const outputs = new Map<string, unknown>();

async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  const result = await dispatchTool(name, input, context);
  if (!result.ok) {
    throw new Error(`${name}: ${result.error.code} ${result.error.message}`);
  }
  if (name === "get_network_topology") {
    const topology = result.data as unknown as {
      segments: Array<{ id: string; downstream_point_ids: string[] }>;
      segments_traversed: string[];
      is_downstream_of: boolean;
    };
    const downstream = topology.segments.find((segment) => segment.id === "SEG-2")
      ?.downstream_point_ids;
    if (!downstream?.includes("RP-BETH")) {
      throw new Error("Phase 2 gate failed: RP-BETH is not downstream of SEG-2");
    }
    if (
      topology.is_downstream_of !== true ||
      topology.segments_traversed.join(",") !== "SEG-1,SEG-2"
    ) {
      throw new Error("Phase 2 gate failed: model-facing topology helpers returned bad data");
    }
  }
  verified.push(name);
  outputs.set(name, result.data);
  return result.data;
}

for (const [name, input] of cases) {
  await runTool(name, input);
}

const nominationData = outputs.get("get_nominations") as {
  nominations: Array<{
    id: string;
    shipper_id: string;
    priority_rank: number;
    nominated_dth: number;
    scheduled_dth: number | null;
  }>;
};
const engineNominations = nominationData.nominations.map((nomination) => ({
  nomination_id: nomination.id,
  shipper_id: nomination.shipper_id,
  priority_rank: nomination.priority_rank,
  nominated_dth: nomination.nominated_dth,
  previous_scheduled_dth: nomination.scheduled_dth,
}));
const recut = await runTool("apply_scheduling_priority", {
  pipeline_id: "ETX-NTX",
  nominations: engineNominations,
  operating_capacity_dth: 820_000,
}) as {
  allocations: Array<{
    priority_rank: number;
    scheduled_dth: number;
  }>;
};
const capacity = await runTool("check_segment_capacity", {
  operating_capacity_dth: 820_000,
  nominations: recut.allocations.map((allocation) => ({
    priority_rank: allocation.priority_rank,
    scheduled_dth: allocation.scheduled_dth,
  })),
});
const imbalance = await runTool("calculate_imbalance", {
  pipeline_id: "ETX-NTX",
  scheduled_dth: 250_000,
  projected_dth: 287_500,
  tolerance_rule_key: "stage_2_pct",
});
const exposure = await runTool("calculate_exposure", {
  pipeline_id: "ETX-NTX",
  excess_dth: 25_000,
  penalty_rule_key: "stage_2_rate_cents_dth",
});
await runTool("assess_system_impact", {
  segment_id: "SEG-2",
  capacity,
  shipper_exposures: [{ shipper_id: "LSPP", imbalance, exposure }],
});

console.log(JSON.stringify({
  gas_day: gasDay,
  verified_handlers: verified.length,
  topology_gate: "RP-BETH downstream of SEG-2",
}, null, 2));
