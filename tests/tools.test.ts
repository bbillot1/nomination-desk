import { describe, expect, it } from "vitest";

import {
  definitions,
  dispatchTool,
  selectDefinitions,
  type JsonPrimitive,
  type NoticeDraft,
  type PendingActionDraft,
  type ToolActionStore,
  type ToolDatabase,
  type ToolResult,
  type ToolSelectRequest,
} from "../supabase/functions/_shared/tools/index.ts";
import {
  is_downstream_of,
  segments_traversed,
  type NetworkTopology,
} from "../supabase/functions/_shared/tools/quorum.ts";

const GAS_DAY = "2026-08-04";

type Row = Record<string, unknown>;

class MemoryToolDatabase implements ToolDatabase {
  constructor(private readonly tables: Record<string, Row[]>) {}

  async select<T>(request: ToolSelectRequest): Promise<T[]> {
    let rows = [...(this.tables[request.table] ?? [])];
    for (const filter of request.filters ?? []) {
      rows = rows.filter((row) => {
        const value = row[filter.column];
        switch (filter.op) {
          case "eq":
            return value === filter.value;
          case "in":
            return filter.values.includes(value as JsonPrimitive);
          case "is":
            return value === filter.value;
        }
      });
    }
    for (const order of [...(request.order ?? [])].reverse()) {
      rows.sort((a, b) => {
        const left = a[order.column];
        const right = b[order.column];
        const direction = order.ascending === false ? -1 : 1;
        return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
      });
    }
    return rows.slice(0, request.limit ?? 500).map((row) => ({ ...row })) as T[];
  }
}

class MemoryActionStore implements ToolActionStore {
  staged: Array<{ runId: string; draft: PendingActionDraft }> = [];
  notices: Array<{ runId: string; notice: NoticeDraft }> = [];

  async stage(runId: string, draft: PendingActionDraft) {
    this.staged.push({ runId, draft });
    return { pending_action_id: `ACTION-${this.staged.length}` };
  }

  async stageNotice(
    runId: string,
    notice: NoticeDraft,
    action: Omit<PendingActionDraft, "action_type" | "payload">,
  ) {
    this.notices.push({ runId, notice });
    this.staged.push({
      runId,
      draft: {
        ...action,
        action_type: "post_ebb_notice",
        payload: { notice_id: notice.id },
      },
    });
    return {
      notice_id: notice.id,
      pending_action_id: `ACTION-${this.staged.length}`,
    };
  }
}

const tables: Record<string, Row[]> = {
  pipelines: [{
    id: "ETX-NTX",
    name: "North Texas Corridor",
    kind: "intrastate",
    operator: "Synthetic Operator",
    tariff_ref: "GT&C (synthetic)",
  }],
  scenario_state: [{
    id: 1,
    gas_day: GAS_DAY,
    sim_clock_ct: "2026-08-04T21:00:00.000Z",
    params: {
      derated_capacity_dth: 820_000,
      notice: {
        stage: "Stage 2",
        tolerance_pct: 5,
        penalty_rate_cents_dth: 2_500,
      },
    },
    answer_key: {
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
  }],
  points: [
    { id: "RP-WAHA", pipeline_id: "ETX-NTX", name: "Waha Hub", point_type: "receipt", corridor_seq: 1, meter_id: "MTR-WAHA" },
    { id: "RP-MIDL", pipeline_id: "ETX-NTX", name: "Midland Junction", point_type: "receipt", corridor_seq: 2, meter_id: "MTR-MIDL" },
    { id: "JCT-ABIL", pipeline_id: "ETX-NTX", name: "Abilene Junction", point_type: "junction", corridor_seq: 3, meter_id: null },
    { id: "JCT-DFWS", pipeline_id: "ETX-NTX", name: "DFW South", point_type: "junction", corridor_seq: 4, meter_id: null },
    { id: "RP-BETH", pipeline_id: "ETX-NTX", name: "Bethel Storage", point_type: "storage", corridor_seq: 3, meter_id: "MTR-BETH" },
    { id: "DP-LSPP-GEN", pipeline_id: "ETX-NTX", name: "Lone Star Generating Station", point_type: "delivery", corridor_seq: 3, meter_id: "MTR-LSPP" },
    { id: "DP-ABIL-DC", pipeline_id: "ETX-NTX", name: "Abilene Data Center", point_type: "delivery", corridor_seq: 3, meter_id: "MTR-ABDC" },
    { id: "DP-DFW-LDC", pipeline_id: "ETX-NTX", name: "DFW City Gate", point_type: "delivery", corridor_seq: 4, meter_id: "MTR-DFWG" },
    { id: "DP-INDL", pipeline_id: "ETX-NTX", name: "Industrial Tap", point_type: "delivery", corridor_seq: 3, meter_id: "MTR-INDL" },
  ],
  segments: [
    { id: "SEG-1", pipeline_id: "ETX-NTX", name: "Waha to Midland", from_point: "RP-WAHA", to_point: "RP-MIDL", design_capacity_dth: 1_200_000, operating_capacity_dth: 1_200_000, seq: 1 },
    { id: "SEG-2", pipeline_id: "ETX-NTX", name: "Midland to Abilene", from_point: "RP-MIDL", to_point: "JCT-ABIL", design_capacity_dth: 900_000, operating_capacity_dth: 900_000, seq: 2 },
    { id: "SEG-3", pipeline_id: "ETX-NTX", name: "Abilene to DFW", from_point: "JCT-ABIL", to_point: "JCT-DFWS", design_capacity_dth: 1_400_000, operating_capacity_dth: 1_400_000, seq: 3 },
  ],
  shippers: [
    { id: "LSPP", name: "Lone Star Power Partners", shipper_type: "power_gen", duns: "00-000-0001", contact_email: "gasdesk@lonestarpower.example" },
    { id: "ABCL", name: "Abilene Compute LLC", shipper_type: "data_center", duns: "00-000-0002", contact_email: "ops@abilenecompute.example" },
  ],
  contracts: [{
    id: "CTR-LSPP-FT1",
    shipper_id: "LSPP",
    pipeline_id: "ETX-NTX",
    contract_number: "FT-2024-0117",
    service_type: "FT",
    mdq_dth: 250_000,
    primary_receipt_point: "RP-WAHA",
    primary_delivery_point: "DP-LSPP-GEN",
    storage_rights_dth: 40_000,
    storage_point: "RP-BETH",
    effective_start: "2025-08-04",
    effective_end: "2027-08-04",
  }],
  tariff_rules: [
    { id: "TR-SP-FP", pipeline_id: "ETX-NTX", rule_type: "scheduling_priority", rule_key: "firm_primary", value_numeric: 1, value_text: null, citation: "GT&C §12.1 (synthetic)" },
    { id: "TR-SP-FS", pipeline_id: "ETX-NTX", rule_type: "scheduling_priority", rule_key: "firm_secondary", value_numeric: 2, value_text: null, citation: "GT&C §12.2 (synthetic)" },
    { id: "TR-SP-IT", pipeline_id: "ETX-NTX", rule_type: "scheduling_priority", rule_key: "interruptible", value_numeric: 3, value_text: null, citation: "GT&C §12.4 (synthetic)" },
    { id: "TR-PM-IT", pipeline_id: "ETX-NTX", rule_type: "proration_method", rule_key: "it_prorata", value_numeric: null, value_text: "pro_rata_by_nomination", citation: "GT&C §12.6 (synthetic)" },
    { id: "TR-TOL-S2", pipeline_id: "ETX-NTX", rule_type: "tolerance", rule_key: "stage_2_pct", value_numeric: 5, value_text: null, citation: "GT&C §52.3 (synthetic)" },
    { id: "TR-PEN-S2", pipeline_id: "ETX-NTX", rule_type: "ofo_penalty", rule_key: "stage_2_rate_cents_dth", value_numeric: 2_500, value_text: null, citation: "GT&C §52.3 (synthetic)" },
  ],
  cycles: [
    { id: "CYC-TIMELY", pipeline_id: "ETX-NTX", gas_day: GAS_DAY, cycle_type: "timely", deadline_ct: "2026-08-03T18:00:00.000Z", status: "closed" },
    { id: "CYC-ID3", pipeline_id: "ETX-NTX", gas_day: GAS_DAY, cycle_type: "id3", deadline_ct: "2026-08-05T00:00:00.000Z", status: "open" },
  ],
  nominations: [
    { id: "N-LSPP", cycle_id: "CYC-TIMELY", contract_id: "CTR-LSPP-FT1", shipper_id: "LSPP", receipt_point: "RP-WAHA", delivery_point: "DP-LSPP-GEN", priority_rank: 1, nominated_dth: 250_000, scheduled_dth: 250_000, status: "scheduled", cut_reason: null, created_at: "2026-08-03T17:30:00.000Z" },
    { id: "N-ABCL", cycle_id: "CYC-TIMELY", contract_id: "CTR-ABCL-FT1", shipper_id: "ABCL", receipt_point: "RP-WAHA", delivery_point: "DP-ABIL-DC", priority_rank: 1, nominated_dth: 300_000, scheduled_dth: 300_000, status: "scheduled", cut_reason: null, created_at: "2026-08-03T17:30:00.000Z" },
    { id: "N-NTGU", cycle_id: "CYC-TIMELY", contract_id: "CTR-NTGU-FT1", shipper_id: "NTGU", receipt_point: "RP-MIDL", delivery_point: "DP-DFW-LDC", priority_rank: 1, nominated_dth: 180_000, scheduled_dth: 180_000, status: "scheduled", cut_reason: null, created_at: "2026-08-03T17:30:00.000Z" },
    { id: "N-CEMK", cycle_id: "CYC-TIMELY", contract_id: "CTR-CEMK-IT1", shipper_id: "CEMK", receipt_point: "RP-WAHA", delivery_point: "DP-INDL", priority_rank: 3, nominated_dth: 150_000, scheduled_dth: 102_000, status: "scheduled", cut_reason: null, created_at: "2026-08-03T17:45:00.000Z" },
    { id: "N-SABT", cycle_id: "CYC-TIMELY", contract_id: "CTR-SABT-IT1", shipper_id: "SABT", receipt_point: "RP-MIDL", delivery_point: "DP-INDL", priority_rank: 3, nominated_dth: 100_000, scheduled_dth: 68_000, status: "scheduled", cut_reason: null, created_at: "2026-08-03T17:45:00.000Z" },
    { id: "N-OLD", cycle_id: "CYC-TIMELY", contract_id: "CTR-OLD", shipper_id: "OLD", receipt_point: "RP-WAHA", delivery_point: "DP-INDL", priority_rank: 3, nominated_dth: 999_999, scheduled_dth: 999_999, status: "superseded", cut_reason: null, created_at: "2026-08-03T17:00:00.000Z" },
  ],
  actual_flows: [
    { id: 1, point_id: "DP-LSPP-GEN", shipper_id: "LSPP", gas_day: GAS_DAY, flow_hour: 0, volume_dth: 10_500 },
    { id: 2, point_id: "DP-LSPP-GEN", shipper_id: "LSPP", gas_day: GAS_DAY, flow_hour: 1, volume_dth: 11_000 },
    { id: 3, point_id: "DP-LSPP-GEN", shipper_id: "LSPP", gas_day: GAS_DAY, flow_hour: 2, volume_dth: 11_500 },
    { id: 4, point_id: "DP-LSPP-GEN", shipper_id: "LSPP", gas_day: GAS_DAY, flow_hour: 3, volume_dth: 12_250 },
    { id: 5, point_id: "DP-LSPP-GEN", shipper_id: "LSPP", gas_day: GAS_DAY, flow_hour: 4, volume_dth: 13_000 },
    { id: 6, point_id: "DP-LSPP-GEN", shipper_id: "LSPP", gas_day: GAS_DAY, flow_hour: 5, volume_dth: 13_625 },
  ],
  scada_events: [{
    id: "SCADA-1",
    pipeline_id: "ETX-NTX",
    event_type: "compressor_trip",
    asset: "Midland Station Unit 2",
    segment_id: "SEG-2",
    detail: { derated_capacity_dth: 820_000 },
    occurred_at: "2026-08-04T21:15:00.000Z",
    acknowledged: false,
  }],
  notices: [{
    id: "NOTICE-1",
    pipeline_id: "ETX-NTX",
    notice_type: "ofo",
    headline: "Stage 2 OFO",
    body_text: "Synthetic notice",
    stage: "Stage 2",
    tolerance_pct: 5,
    penalty_rate_cents_dth: 2_500,
    affected_segment: "SEG-2",
    derate_to_dth: 820_000,
    effective_start: null,
    effective_end: null,
    status: "draft",
    posted_at: null,
    created_at: "2026-08-04T21:15:00.000Z",
  }],
};

const actionStore = new MemoryActionStore();
const context = {
  db: new MemoryToolDatabase(tables),
  actions: actionStore,
  runId: "RUN-TEST",
};

async function expectOk(name: string, input: Record<string, unknown>) {
  const result = await dispatchTool(name, input, context);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

describe("Phase 2 registry", () => {
  it("registers one handler for every definition", () => {
    expect(definitions).toHaveLength(22);
    expect(new Set(definitions.map((definition) => definition.name)).size).toBe(22);
    expect(definitions.every((definition) => definition.strict === true)).toBe(true);
  });

  it("selects restricted tool subsets and rejects unknown names", () => {
    expect(selectDefinitions(["get_contract", "get_shipper"]).map((d) => d.name))
      .toEqual(["get_contract", "get_shipper"]);
    expect(() => selectDefinitions(["not_registered"])).toThrow("unknown tool definitions");
  });

  it("returns structured errors without stack traces", async () => {
    const unknown = await dispatchTool("not_registered", {}, context);
    expect(unknown).toEqual({
      ok: false,
      error: { code: "UNKNOWN_TOOL", message: "tool is not registered: not_registered", retryable: false },
    });

    const invalid = await dispatchTool("get_shipper", {}, context);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.code).toBe("INVALID_INPUT");
      expect(invalid.error.message).not.toContain(" at ");
    }
  });

  it("sanitizes unexpected database failures", async () => {
    const failingContext = {
      db: {
        select: async () => {
          throw new Error("relation private_internal_table does not exist");
        },
      } satisfies ToolDatabase,
    };
    const result = await dispatchTool("get_shipper", { shipper_id: "LSPP" }, failingContext);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "INTERNAL_TOOL_ERROR",
        message: "The tool failed unexpectedly. No action was taken.",
        retryable: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("private_internal_table");
  });

  it("rejects malformed dates at the tool boundary", async () => {
    const result = await dispatchTool("get_nominations", { gas_day: "tomorrow" }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

describe("Quorum tools", () => {
  it("reads contract terms and storage rights", async () => {
    const result = await expectOk("get_contract", { shipper_id: "LSPP" });
    const data = result.data as unknown as { contracts: Array<{ storage_rights_dth: number; storage_point: string }> };
    expect(data.contracts[0]).toMatchObject({ storage_rights_dth: 40_000, storage_point: "RP-BETH" });
  });

  it("reads shipper contact data", async () => {
    const result = await expectOk("get_shipper", { shipper_id: "LSPP" });
    expect(result.data).toMatchObject({ id: "LSPP", shipper_type: "power_gen" });
  });

  it("returns explicit downstream relationships", async () => {
    const result = await expectOk("get_network_topology", {
      pipeline_id: "ETX-NTX",
      receipt_point: "RP-WAHA",
      delivery_point: "DP-LSPP-GEN",
      point_id: "RP-BETH",
      segment_id: "SEG-2",
    });
    const data = result.data as unknown as {
      segments: Array<{ id: string; downstream_point_ids: string[] }>;
      segments_traversed: string[];
      is_downstream_of: boolean;
    };
    expect(data.segments.find((segment) => segment.id === "SEG-2")?.downstream_point_ids)
      .toContain("RP-BETH");
    expect(data.segments_traversed).toEqual(["SEG-1", "SEG-2"]);
    expect(data.is_downstream_of).toBe(true);
  });

  it("passes the Phase 2 topology gate", () => {
    const topology: NetworkTopology = {
      pipeline_id: "ETX-NTX",
      points: tables.points as unknown as NetworkTopology["points"],
      segments: tables.segments as unknown as NetworkTopology["segments"],
    };
    expect(is_downstream_of(topology, "RP-BETH", "SEG-2")).toBe(true);
    expect(segments_traversed(topology, "RP-WAHA", "DP-LSPP-GEN").map((s) => s.id))
      .toEqual(["SEG-1", "SEG-2"]);
  });

  it("returns tariff values with citations", async () => {
    const result = await expectOk("get_tariff_rule", {
      pipeline_id: "ETX-NTX",
      rule_type: "tolerance",
      rule_key: "stage_2_pct",
    });
    expect(result.citation).toBe("GT&C §52.3 (synthetic)");
  });
});

describe("Historian tools", () => {
  it("filters unacknowledged SCADA events", async () => {
    const result = await expectOk("get_scada_events", {
      pipeline_id: "ETX-NTX",
      unacknowledged_only: true,
    });
    const data = result.data as unknown as { events: unknown[] };
    expect(data.events).toHaveLength(1);
  });

  it("returns measured rows, totals, and gas-day convention", async () => {
    const result = await expectOk("get_actual_flows", { gas_day: GAS_DAY, shipper_id: "LSPP" });
    const data = result.data as unknown as {
      rows: unknown[];
      measured_totals_dth: Record<string, number>;
      time_convention: string;
    };
    expect(data.rows).toHaveLength(6);
    expect(data.measured_totals_dth.LSPP).toBe(71_875);
    expect(data.time_convention).toContain("09:00 CT");
  });

  it("projects the canonical LSPP daily take", async () => {
    const result = await expectOk("project_daily_total", { gas_day: GAS_DAY, shipper_id: "LSPP" });
    expect(result.data).toMatchObject({
      measured_total_dth: 71_875,
      measured_hours: 6,
      projected_dth: 287_500,
      method: "run-rate extrapolation over 6 measured hours",
    });
  });
});

describe("EBB tools", () => {
  it("reads gas-day nominations with cycle context", async () => {
    const result = await expectOk("get_nominations", { gas_day: GAS_DAY, shipper_id: "CEMK" });
    const data = result.data as unknown as { nominations: Array<{ scheduled_dth: number; cycle_type: string }> };
    expect(data.nominations).toEqual([
      expect.objectContaining({ scheduled_dth: 102_000, cycle_type: "timely" }),
    ]);
  });

  it("uses simulated time for cycle minutes remaining", async () => {
    const result = await expectOk("get_open_cycles", { gas_day: GAS_DAY });
    const data = result.data as unknown as {
      cycles: Array<{
        cycle_type: string;
        deadline_ct_display: string;
        sim_minutes_remaining: number;
      }>;
    };
    expect(data.cycles).toEqual([
      expect.objectContaining({
        cycle_type: "id3",
        deadline_ct_display: "2026-08-04 19:00 CT",
        sim_minutes_remaining: 180,
      }),
    ]);
  });

  it("reads EBB notices", async () => {
    const result = await expectOk("get_notices", { pipeline_id: "ETX-NTX", status: "draft" });
    const data = result.data as unknown as { notices: unknown[] };
    expect(data.notices).toHaveLength(1);
  });

  it("joins proposed notice values to exact tariff citations", async () => {
    const result = await expectOk("get_proposed_notice_terms", {});
    expect(result.data).toMatchObject({
      stage: "Stage 2",
      tolerance: {
        rule_key: "stage_2_pct",
        value_pct: 5,
        citation: "GT&C §52.3 (synthetic)",
      },
      penalty: {
        rule_key: "stage_2_rate_cents_dth",
        rate_cents_dth: 2_500,
        citation: "GT&C §52.3 (synthetic)",
      },
    });
  });

  it("calculates segment state from traversing nominations", async () => {
    const result = await expectOk("get_segment_state", { segment_id: "SEG-2" });
    expect(result.data).toMatchObject({
      gas_day: GAS_DAY,
      operating_capacity_dth: 900_000,
      scheduled_by_tier: { 1: 730_000, 2: 0, 3: 170_000 },
      scheduled_total_dth: 900_000,
      headroom_dth: 0,
    });
    const data = result.data as unknown as {
      traversing_nominations: Array<{ shipper_id: string }>;
    };
    expect(data.traversing_nominations.map((row) => row.shipper_id)).not.toContain("OLD");
  });

  it("rejects proposed notice terms that disagree with tariff data", async () => {
    const mismatchContext = {
      db: new MemoryToolDatabase({
        ...tables,
        scenario_state: [{
          ...tables.scenario_state![0]!,
          params: {
            notice: {
              stage: "Stage 2",
              tolerance_pct: 4,
              penalty_rate_cents_dth: 2_500,
            },
          },
        }],
      }),
    };
    const result = await dispatchTool("get_proposed_notice_terms", {}, mismatchContext);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOTICE_TARIFF_MISMATCH");
  });

  it("rejects flow projections with missing measured hours", async () => {
    const gapContext = {
      db: new MemoryToolDatabase({
        ...tables,
        actual_flows: tables.actual_flows!.filter((row) => row.flow_hour !== 1),
      }),
    };
    const result = await dispatchTool(
      "project_daily_total",
      { gas_day: GAS_DAY, shipper_id: "LSPP" },
      gapContext,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INCOMPLETE_MEASUREMENTS");
  });
});

describe("Engine tool wrappers", () => {
  it("checks capacity", async () => {
    const result = await expectOk("check_segment_capacity", {
      operating_capacity_dth: 900_000,
      nominations: [
        { priority_rank: 1, scheduled_dth: 730_000 },
        { priority_rank: 3, scheduled_dth: 170_000 },
      ],
    });
    expect(result.data).toMatchObject({ scheduled_total_dth: 900_000, headroom_dth: 0 });
  });

  it("applies scheduling priority with recut cut semantics", async () => {
    const result = await expectOk("apply_scheduling_priority", {
      pipeline_id: "ETX-NTX",
      nominations: [
        { nomination_id: "N-FIRM", shipper_id: "FIRM", priority_rank: 1, nominated_dth: 730_000, previous_scheduled_dth: 730_000 },
        { nomination_id: "N-CEMK", shipper_id: "CEMK", priority_rank: 3, nominated_dth: 150_000, previous_scheduled_dth: 102_000 },
        { nomination_id: "N-SABT", shipper_id: "SABT", priority_rank: 3, nominated_dth: 100_000, previous_scheduled_dth: 68_000 },
      ],
      operating_capacity_dth: 820_000,
    });
    const data = result.data as unknown as { allocations: Array<{ shipper_id: string; cut_dth: number }> };
    expect(data.allocations.find((row) => row.shipper_id === "CEMK")?.cut_dth).toBe(48_000);
    expect(data.allocations.find((row) => row.shipper_id === "SABT")?.cut_dth).toBe(32_000);
  });

  it("calculates imbalance", async () => {
    const result = await expectOk("calculate_imbalance", {
      pipeline_id: "ETX-NTX",
      scheduled_dth: 250_000,
      projected_dth: 287_500,
      tolerance_rule_key: "stage_2_pct",
    });
    expect(result.data).toMatchObject({ excess_dth: 25_000, in_violation: true, direction: "over" });
  });

  it("calculates exposure with formula and citation", async () => {
    const result = await expectOk("calculate_exposure", {
      pipeline_id: "ETX-NTX",
      excess_dth: 25_000,
      penalty_rule_key: "stage_2_rate_cents_dth",
    });
    expect(result.data).toMatchObject({
      exposure_cents: 62_500_000,
      formula_string: "25,000 Dth × $25.00/Dth × 1 day = $625,000.00",
    });
  });

  it("assesses system impact", async () => {
    const result = await expectOk("assess_system_impact", {
      segment_id: "SEG-2",
      capacity: {
        operating_capacity_dth: 820_000,
        scheduled_by_tier: { 1: 730_000, 2: 0, 3: 90_000 },
        scheduled_total_dth: 820_000,
        headroom_dth: 0,
        shortfall_dth: 0,
      },
      shipper_exposures: [{
        shipper_id: "LSPP",
        imbalance: {
          scheduled_dth: 250_000,
          projected_dth: 287_500,
          imbalance_dth: 37_500,
          imbalance_pct_str: "+15.0%",
          tolerance_dth: 12_500,
          excess_dth: 25_000,
          in_violation: true,
          direction: "over",
        },
        exposure: {
          excess_dth: 25_000,
          penalty_rate_cents_dth: 2_500,
          days: 1,
          exposure_cents: 62_500_000,
          formula_string: "25,000 Dth × $25.00/Dth × 1 day = $625,000.00",
          citation: "GT&C §52.3 (synthetic)",
        },
      }],
    });
    expect(result.data).toMatchObject({
      uncured_excess_dth: 25_000,
      aggregate_exposure_cents: 62_500_000,
      violators: ["LSPP"],
    });
  });

  it("rejects fractional Dth before entering an engine", async () => {
    const result = await dispatchTool("calculate_imbalance", {
      pipeline_id: "ETX-NTX",
      scheduled_dth: 250_000.5,
      projected_dth: 287_500,
      tolerance_rule_key: "stage_2_pct",
    }, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

describe("Gated staging tools", () => {
  it("stages an allocation without mutating nominations", async () => {
    const before = structuredClone(tables.nominations);
    const result = await expectOk("stage_allocation", {
      segment_id: "SEG-2",
      derated_capacity_dth: 820_000,
      allocations: [
        {
          nomination_id: "N-CEMK",
          scheduled_dth: 54_000,
          cut_dth: 48_000,
          cut_reason: "Tier 3 prorated",
        },
        {
          nomination_id: "N-SABT",
          scheduled_dth: 36_000,
          cut_dth: 32_000,
          cut_reason: "Tier 3 prorated",
        },
      ],
      proration_factor_str: "0.3600",
      citation: "GT&C §12.6 (synthetic)",
    });
    expect(result.data).toMatchObject({ status: "pending" });
    expect(actionStore.staged.at(-1)?.draft.action_type).toBe("apply_allocation");
    expect(tables.nominations).toEqual(before);
  });

  it("atomically stages a draft EBB notice and pending action", async () => {
    const result = await expectOk("draft_ebb_notice", {
      pipeline_id: "ETX-NTX",
      notice_type: "ofo",
      headline: "Stage 2 OFO — SEG-2",
      body_text:
        "Transportation capacity headroom is zero. This notice is effective upon posting. ID3 deadline: 2026-08-04 19:00 CT.",
      stage: "Stage 2",
      tolerance_pct: 5,
      penalty_rate_cents_dth: 2_500,
      affected_segment: "SEG-2",
      derate_to_dth: 820_000,
      rationale: "Protect system integrity before ID3.",
    });
    expect(result.data).toMatchObject({ status: "pending" });
    expect(actionStore.notices.at(-1)?.notice).toMatchObject({
      affected_segment: "SEG-2",
    });
  });

  it("stages one batched message action and blocks the compliant shipper", async () => {
    const result = await expectOk("draft_shipper_message", {
      recipients: [
        {
          shipper_id: "LSPP",
          subject: "Projected exposure",
          body: "25,000 Dth excess creates $625,000.00 exposure; RP-BETH is available downstream.",
          evidence_refs: ["GT&C §52.3 (synthetic)"],
        },
        {
          shipper_id: "ABCL",
          subject: "Projected exposure",
          body: "6,000 Dth excess creates $150,000.00 exposure; reduce takes or self-supply downstream.",
          evidence_refs: ["GT&C §52.3 (synthetic)"],
        },
        {
          shipper_id: "CEMK",
          subject: "SEG-2 allocation cut",
          body: "Your 48,000 Dth cut leaves 54,000 Dth scheduled at factor 0.3600 per GT&C §12.6.",
          evidence_refs: ["GT&C §12.6 (synthetic)"],
        },
        {
          shipper_id: "SABT",
          subject: "SEG-2 allocation cut",
          body: "Your 32,000 Dth cut leaves 36,000 Dth scheduled at factor 0.3600 per GT&C §12.6.",
          evidence_refs: ["GT&C §12.6 (synthetic)"],
        },
      ],
      rationale: "Notify affected shippers.",
      dollar_impact_cents: 77_500_000,
    });
    expect(result.data).toMatchObject({ status: "pending", recipient_count: 4 });

    const blocked = await dispatchTool("draft_shipper_message", {
      recipients: [{
        shipper_id: "NTGU",
        subject: "No action",
        body: "You are compliant.",
        evidence_refs: ["engine-result"],
      }],
      rationale: "Should be blocked.",
      dollar_impact_cents: 0,
    }, context);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("COMPLIANT_SHIPPER_MESSAGE_BLOCKED");
  });

  it("validates generated Stage 3 actions from the active answer key", async () => {
    const generatedTables = structuredClone(tables);
    generatedTables.scenario_state = [{
      id: 1,
      gas_day: GAS_DAY,
      sim_clock_ct: "2026-08-04T21:00:00.000Z",
      params: {
        derated_capacity_dth: 860_000,
        notice: {
          stage: "Stage 3",
          tolerance_pct: 3,
          penalty_rate_cents_dth: 5_000,
        },
      },
      answer_key: {
        recut: {
          proration_factor: "0.5000",
          scheduled_dth: { CEMK: 60_000, SABT: 70_000 },
          cuts_dth: { CEMK: 20_000, SABT: 10_000 },
        },
        exposure_cents: {
          LSPP: 100_000_000,
          ABCL: 0,
          NTGU: 0,
          CEMK: 0,
          SABT: 0,
        },
        violators: ["LSPP"],
        compliant: ["ABCL", "NTGU", "CEMK", "SABT"],
      },
    }];
    const generatedContext = {
      db: new MemoryToolDatabase(generatedTables),
      actions: actionStore,
      runId: "RUN-GENERATED",
    };

    const allocation = await dispatchTool("stage_allocation", {
      segment_id: "SEG-2",
      derated_capacity_dth: 860_000,
      allocations: [
        {
          nomination_id: "N-CEMK",
          scheduled_dth: 60_000,
          cut_dth: 20_000,
          cut_reason: "Tier 3 prorated",
        },
        {
          nomination_id: "N-SABT",
          scheduled_dth: 70_000,
          cut_dth: 10_000,
          cut_reason: "Tier 3 prorated",
        },
      ],
      proration_factor_str: "0.5000",
      citation: "GT&C §12.6 (synthetic)",
    }, generatedContext);
    expect(allocation.ok).toBe(true);

    const notice = await dispatchTool("draft_ebb_notice", {
      pipeline_id: "ETX-NTX",
      notice_type: "ofo",
      headline: "Stage 3 OFO — SEG-2",
      body_text:
        "Transportation capacity headroom is zero. This notice is effective upon posting. ID3 deadline: 2026-08-04 19:00 CT.",
      stage: "Stage 3",
      tolerance_pct: 3,
      penalty_rate_cents_dth: 5_000,
      affected_segment: "SEG-2",
      derate_to_dth: 860_000,
      rationale: "Stage the generated notice.",
    }, generatedContext);
    expect(notice.ok).toBe(true);

    const messages = await dispatchTool("draft_shipper_message", {
      recipients: [
        {
          shipper_id: "LSPP",
          subject: "Projected exposure",
          body: "Projected exposure is $1,000,000.00; RP-BETH is available downstream.",
          evidence_refs: ["GT&C §52.4 (synthetic)"],
        },
        {
          shipper_id: "CEMK",
          subject: "SEG-2 allocation cut",
          body: "Your 20,000 Dth cut leaves 60,000 Dth at factor 0.5000 per GT&C §12.6.",
          evidence_refs: ["GT&C §12.6 (synthetic)"],
        },
        {
          shipper_id: "SABT",
          subject: "SEG-2 allocation cut",
          body: "Your 10,000 Dth cut leaves 70,000 Dth at factor 0.5000 per GT&C §12.6.",
          evidence_refs: ["GT&C §12.6 (synthetic)"],
        },
      ],
      rationale: "Notify only generated-scenario affected shippers.",
      dollar_impact_cents: 100_000_000,
    }, generatedContext);
    expect(messages.ok).toBe(true);
    if (messages.ok) expect(messages.data).toMatchObject({ recipient_count: 3 });
  });

  it("stages a stop-the-line escalation", async () => {
    const result = await expectOk("escalate_to_human", {
      title: "URGENT — firm proration",
      rationale: "Operating capacity is below firm demand.",
      options: [{ label: "Review allocation", description: "Confirm firm proration." }],
      context: { summary: "Firm capacity is constrained.", segment_id: "SEG-2" },
    });
    expect(result.data).toMatchObject({ status: "pending", escalation: true });
    expect(actionStore.staged.at(-1)?.draft.action_type).toBe("acknowledge_escalation");
  });
});

describe("Trusted workflow tools", () => {
  it("assesses compliance without model-echoed nested tool inputs", async () => {
    const singleShipperContext = {
      db: new MemoryToolDatabase({
        ...tables,
        nominations: [tables.nominations![0]!],
      }),
    };
    const result = await dispatchTool("assess_flow_order_compliance", {
      pipeline_id: "ETX-NTX",
      segment_id: "SEG-2",
    }, singleShipperContext);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toMatchObject({
        assessments: [{
          shipper_id: "LSPP",
          projection: { projected_dth: 287_500 },
          imbalance: { excess_dth: 25_000, in_violation: true },
          exposure: { exposure_cents: 62_500_000 },
        }],
        system_impact: {
          violators: ["LSPP"],
          aggregate_exposure_cents: 62_500_000,
        },
      });
      expect(result.citation).toBe("GT&C §52.3 (synthetic)");
    }
  });
});
