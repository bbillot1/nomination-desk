import { describe, expect, it } from "vitest";

import {
  mergeWorkflowEvents,
  sortWorkflowEvents,
  workflowEventKey,
  type WorkflowEvent,
} from "../src/lib/events";

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
    skill_used: null,
    summary: "Reviewed current SEG-2 capacity.",
    tool_input: null,
    tool_name: null,
    tool_output: null,
    workflow_id: "WORKFLOW-1",
    run_started_at: "2026-08-05T15:59:00Z",
    ...overrides,
  };
}

describe("workflow event merge", () => {
  it("deduplicates a Realtime insert that also appears in the backlog", () => {
    const realtime = event({ run_started_at: undefined });
    const backlog = event({ summary: "Backlog carries the same append-only row." });

    const merged = mergeWorkflowEvents([realtime], [backlog]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      run_id: "RUN-1",
      seq: 1,
      summary: "Backlog carries the same append-only row.",
      run_started_at: "2026-08-05T15:59:00Z",
    });
  });

  it("orders the initial run before its continuation, then by sequence", () => {
    const events = sortWorkflowEvents([
      event({
        id: 4,
        run_id: "RUN-2",
        seq: 2,
        run_started_at: "2026-08-05T16:05:00Z",
      }),
      event({ id: 2, seq: 2 }),
      event({
        id: 3,
        run_id: "RUN-2",
        seq: 1,
        run_started_at: "2026-08-05T16:05:00Z",
      }),
      event({ id: 1, seq: 1 }),
    ]);

    expect(events.map(workflowEventKey)).toEqual([
      "RUN-1:1",
      "RUN-1:2",
      "RUN-2:1",
      "RUN-2:2",
    ]);
  });
});
