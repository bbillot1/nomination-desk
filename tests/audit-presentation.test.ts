import { describe, expect, it } from "vitest";

import {
  buildEventTimeline,
  extractKeyFacts,
  extractProviderTelemetry,
  isPlanningSummary,
  operatorEventSummary,
  parseSummaryTokens,
  plainEventSummary,
} from "../src/lib/audit-presentation";
import type { WorkflowEvent } from "../src/lib/events";

function event(overrides: Partial<WorkflowEvent> = {}): WorkflowEvent {
  return {
    agent_name: "scheduling",
    citation: null,
    created_at: "2026-08-05T16:00:00Z",
    detail: null,
    event_type: "analysis_summary",
    id: 1,
    run_id: "RUN-1",
    seq: 1,
    skill_used: "derate-response@2.0",
    summary: "Reviewed current SEG-2 capacity.",
    tool_input: null,
    tool_name: null,
    tool_output: null,
    workflow_id: "WORKFLOW-1",
    run_started_at: "2026-08-05T15:59:00Z",
    ...overrides,
  };
}

describe("safe event summary presentation", () => {
  it("parses bold and code without creating raw HTML", () => {
    expect(parseSummaryTokens("**Phase 1:** Read `SEG-2`.")).toEqual([
      { kind: "strong", text: "Phase 1:" },
      { kind: "text", text: " Read " },
      { kind: "code", text: "SEG-2" },
      { kind: "text", text: "." },
    ]);
    expect(plainEventSummary("**Phase 1:** Read `SEG-2`.")).toBe("Phase 1: Read SEG-2.");
  });

  it("identifies first-person planning prose", () => {
    expect(isPlanningSummary("I'll start by gathering the SCADA event.")).toBe(true);
    expect(isPlanningSummary("Compressor trip derated SEG-2 to 820,000 Dth.")).toBe(false);
  });

  it("converts raw ISO timestamps to operator-facing Central Time", () => {
    const summary = plainEventSummary(
      "SCADA derated SEG-2 effective 2026-08-04T21:15:00Z.",
    );
    expect(summary).toContain("16:15 CT");
    expect(summary).not.toContain("T21:15");
    expect(summary).not.toContain("Z");
  });

  it("hides run and trigger identifiers from operator summaries", () => {
    const raw =
      "Flow order compliance assessment for pipeline **ETX-NTX**, segment **SEG-2**, " +
      "gas day **2026-08-04**, **run 88013588-1eb7-4599-a542-436737e7800a**, " +
      "**trigger_type approval_continuation**, " +
      "**trigger_ref 4a622bf2-3606-461e-b3af-3ce018824206**, using post-recut scheduled " +
      "quantities from the executed allocation record under GT&C §12.6 (synthetic).";
    const cleaned = operatorEventSummary(raw);
    expect(cleaned).toContain("pipeline **ETX-NTX**");
    expect(cleaned).toContain("using post-recut scheduled quantities");
    expect(cleaned).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(cleaned).not.toContain("trigger_type");
    expect(cleaned).not.toContain("trigger_ref");
    expect(cleaned).not.toMatch(/\brun\b/i);
  });
});

describe("operator event timeline", () => {
  const planning = event({
    id: 1,
    seq: 1,
    summary: "I'll start by reading nominations.",
  });
  const call = event({
    id: 2,
    seq: 2,
    event_type: "tool_call",
    summary: "scheduling called get_nominations.",
    tool_name: "get_nominations",
  });
  const result = event({
    id: 3,
    seq: 3,
    event_type: "tool_result",
    summary: "get_nominations completed successfully.",
    tool_name: "get_nominations",
    tool_output: { ok: true, data: { nominations: [] } },
  });
  const decision = event({
    id: 4,
    seq: 4,
    event_type: "decision",
    summary: "Supervisor routed the run to scheduling.",
  });

  it("removes planning prose and groups adjacent tool calls and results", () => {
    const timeline = buildEventTimeline([planning, call, result, decision], "operator");
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      event: { id: 3 },
      pairedEvent: { id: 2 },
      summary: "Read gas-day nominations · completed",
      displayType: "Evidence",
    });
    expect(timeline[1]?.event.id).toBe(4);
  });

  it("preserves every raw event in technical view", () => {
    expect(buildEventTimeline([planning, call, result, decision], "technical")).toHaveLength(4);
  });

  it("keeps technical identifiers only in technical view", () => {
    const assessment = event({
      id: 5,
      seq: 5,
      summary:
        "Assessment for run 88013588-1eb7-4599-a542-436737e7800a after approval_continuation.",
    });
    const operator = buildEventTimeline([assessment], "operator");
    const technical = buildEventTimeline([assessment], "technical");
    expect(operator[0]?.summary).not.toContain("88013588");
    expect(technical[0]?.summary).toContain("88013588");
  });
});

describe("operator evidence extraction", () => {
  it("extracts compact provider telemetry", () => {
    const telemetry = extractProviderTelemetry({
      provider: {
        model: "claude-sonnet-5",
        request_duration_ms: 8_327,
        input_tokens: 2,
        output_tokens: 755,
        cache_creation_input_tokens: 2_373,
        cache_read_input_tokens: 3_652,
      },
    });
    expect(telemetry).toEqual({
      model: "claude-sonnet-5",
      durationMs: 8_327,
      inputTokens: 2,
      outputTokens: 755,
      cacheCreationTokens: 2_373,
      cacheReadTokens: 3_652,
    });
  });

  it("surfaces allocation capacity, factor, tier, and shipper cuts", () => {
    const facts = extractKeyFacts(event({
      event_type: "tool_result",
      tool_name: "apply_scheduling_priority",
      tool_output: {
        ok: true,
        data: {
          operating_capacity_dth: 820_000,
          scheduled_total_dth: 820_000,
          proration_factor_str: "0.3600",
          binding_tier: 3,
          firm_prorated: false,
          allocations: [
            { shipper_id: "CEMK", cut_dth: 48_000, scheduled_dth: 54_000 },
            { shipper_id: "SABT", cut_dth: 32_000, scheduled_dth: 36_000 },
          ],
        },
      },
    }));

    expect(facts).toEqual(expect.arrayContaining([
      { label: "Operating capacity", value: "820,000 Dth" },
      { label: "Proration factor", value: "0.3600" },
      { label: "Binding tier", value: "Interruptible" },
      { label: "Firm service", value: "Unchanged" },
      { label: "CEMK recut", value: "48,000 Dth cut · 54,000 Dth scheduled" },
      { label: "SABT recut", value: "32,000 Dth cut · 36,000 Dth scheduled" },
    ]));
  });

  it("uses the tool-provided Central Time display for SCADA evidence", () => {
    const facts = extractKeyFacts(event({
      event_type: "tool_result",
      tool_name: "get_scada_events",
      tool_output: {
        ok: true,
        data: {
          events: [{
            event_type: "compressor_trip",
            asset: "Midland Station Unit 2",
            segment_id: "SEG-2",
            occurred_at: "2026-08-04T21:15:00Z",
            occurred_at_ct_display: "2026-08-04 16:15 CT",
            detail: { derated_capacity_dth: 820_000 },
          }],
        },
      },
    }));

    expect(facts).toEqual(expect.arrayContaining([
      { label: "Incident", value: "Compressor Trip · Midland Station Unit 2" },
      { label: "Affected segment", value: "SEG-2" },
      { label: "Derated capacity", value: "820,000 Dth" },
      { label: "Occurred", value: "2026-08-04 16:15 CT" },
    ]));
  });

  it("surfaces compliance terms, aggregate exposure, and formulas", () => {
    const facts = extractKeyFacts(event({
      event_type: "tool_result",
      tool_name: "assess_flow_order_compliance",
      tool_output: {
        ok: true,
        data: {
          terms: {
            stage: "Stage 2",
            tolerance: { value_pct: 5 },
            penalty: { rate_cents_dth: 2_500 },
          },
          assessments: [{
            shipper_id: "LSPP",
            imbalance: { in_violation: true },
            exposure: {
              formula_string: "25,000 Dth × $25.00/Dth × 1 day = $625,000.00",
            },
          }],
          system_impact: {
            aggregate_exposure_cents: 77_500_000,
            violators: ["LSPP", "ABCL"],
          },
        },
      },
    }));

    expect(facts).toEqual(expect.arrayContaining([
      { label: "Notice stage", value: "Stage 2" },
      { label: "Tolerance", value: "±5%" },
      { label: "Synthetic tariff rate", value: "$25.00/Dth" },
      { label: "Aggregate projected exposure", value: "$775,000.00" },
      { label: "Outside tolerance", value: "LSPP, ABCL" },
      {
        label: "LSPP exposure",
        value: "25,000 Dth × $25.00/Dth × 1 day = $625,000.00",
      },
    ]));
  });
});
