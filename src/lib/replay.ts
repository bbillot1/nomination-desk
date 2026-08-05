import type { DeskSnapshot, PositionView, SegmentView } from "./desk-data";
import type {
  AgentRunRow,
  Json,
  PendingActionRow,
} from "./database.types";
import type { WorkflowEvent } from "./events";

export const replayStages = [
  { id: "baseline", label: "Baseline ready" },
  { id: "incident_posted", label: "Compressor trip" },
  { id: "recut_pending", label: "Recut awaiting approval" },
  { id: "recut_applied", label: "Allocation approved" },
  { id: "comms_pending", label: "Communications awaiting approval" },
  { id: "resolved", label: "Workflow resolved" },
] as const;

export type ReplayStage = (typeof replayStages)[number]["id"];

interface ReplayCapture {
  schema_version: number;
  label: string;
  captured_at: string;
  source_workflow_id: string;
  snapshot: DeskSnapshot;
  events: WorkflowEvent[];
}

export interface ReplayFrame {
  stage: ReplayStage;
  label: string;
  index: number;
  snapshot: DeskSnapshot;
  events: WorkflowEvent[];
}

let capture: ReplayCapture | null = null;

function requiredCapture(): ReplayCapture {
  if (!capture) throw new Error("replay capture is not loaded");
  return capture;
}

export async function loadReplayCapture(): Promise<ReplayFrame> {
  const module = await import("../replay/hero-capture.json");
  capture = module.default as unknown as ReplayCapture;
  return replayFrame(0);
}

function jsonObject(value: Json | null): Record<string, Json | undefined> | null {
  return value !== null && !Array.isArray(value) && typeof value === "object" ? value : null;
}

function humanDecision(event: WorkflowEvent, actionType?: string): boolean {
  if (event.event_type !== "decision" || !event.summary.startsWith("Human approved")) return false;
  if (!actionType) return true;
  return jsonObject(event.detail)?.action_type === actionType;
}

function pendingAction(action: PendingActionRow): PendingActionRow {
  return {
    ...action,
    status: "pending",
    decided_by: null,
    decided_at: null,
    executed_at: null,
    result: null,
  };
}

function runAtStatus(run: AgentRunRow, status: string): AgentRunRow {
  return {
    ...run,
    status,
    ended_at: status === "complete" ? run.ended_at : null,
    error_text: null,
  };
}

function timelySchedules(): Record<string, number> {
  const capture = requiredCapture();
  const answerKey = jsonObject(capture.snapshot.scenario.answer_key);
  const timely = jsonObject(answerKey?.timely ?? null);
  const scheduled = jsonObject(timely?.scheduled_dth ?? null);
  const result: Record<string, number> = {};
  if (!scheduled) return result;
  for (const [shipperId, value] of Object.entries(scheduled)) {
    if (typeof value === "number") result[shipperId] = value;
  }
  return result;
}

function preRecutPositions(showProposal: boolean): PositionView[] {
  const capture = requiredCapture();
  const timely = timelySchedules();
  return capture.snapshot.positions.map((position) => {
    const scheduledDth = timely[position.shipperId] ?? position.scheduledDth;
    const hasRecut = position.shipperId === "CEMK" || position.shipperId === "SABT";
    return {
      ...position,
      scheduledDth,
      proposedScheduledDth: showProposal && hasRecut ? position.scheduledDth : null,
      recutDeltaDth: null,
      varianceDth: null,
      toleranceDth: null,
      excessDth: null,
      exposureCents: null,
      status: showProposal && hasRecut ? "pending_recut" : "normal",
    };
  });
}

function preRecutSegments(derated: boolean): SegmentView[] {
  const capture = requiredCapture();
  return capture.snapshot.segments.map((segment) => {
    if (segment.id !== "SEG-2") return segment;
    const operatingCapacityDth = derated ? 820_000 : 900_000;
    const scheduledDth = 900_000;
    const headroomDth = operatingCapacityDth - scheduledDth;
    return {
      ...segment,
      operatingCapacityDth,
      scheduledDth,
      headroomDth,
      utilizationPct: (scheduledDth * 100) / operatingCapacityDth,
      isDerated: derated,
      state: derated ? "oversubscribed" : "full",
    };
  });
}

function stageTime(stage: ReplayStage): string {
  const capture = requiredCapture();
  const incident = capture.snapshot.latestScadaEvent?.occurred_at ??
    capture.snapshot.scenario.sim_clock_ct;
  if (stage === "baseline") {
    return new Date(Date.parse(incident) - 15 * 60_000).toISOString();
  }
  return incident;
}

function eventsForStage(stage: ReplayStage): WorkflowEvent[] {
  const capture = requiredCapture();
  const [initialRun, continuationRun] = capture.snapshot.runs;
  const initial = initialRun
    ? capture.events.filter((event) => event.run_id === initialRun.id)
    : [];
  const continuation = continuationRun
    ? capture.events.filter((event) => event.run_id === continuationRun.id)
    : [];

  if (stage === "baseline") return [];
  if (stage === "incident_posted") return initial.slice(0, Math.min(4, initial.length));
  if (stage === "recut_pending") return initial.filter((event) => !humanDecision(event));
  if (stage === "recut_applied") return [
    ...initial,
    ...continuation.slice(0, Math.min(4, continuation.length)),
  ];
  if (stage === "comms_pending") {
    return capture.events.filter((event) =>
      !humanDecision(event, "post_ebb_notice") &&
      !humanDecision(event, "send_shipper_message")
    );
  }
  return capture.events;
}

export function replayFrame(index: number): ReplayFrame {
  const capture = requiredCapture();
  const boundedIndex = Math.max(0, Math.min(replayStages.length - 1, index));
  const definition = replayStages[boundedIndex]!;
  const stage = definition.id;
  const finalSnapshot = structuredClone(capture.snapshot);
  const [initialRun, continuationRun] = finalSnapshot.runs;
  const applyAction = finalSnapshot.actions.find(
    (action) => action.action_type === "apply_allocation",
  );
  const communicationActions = finalSnapshot.actions.filter(
    (action) => action.action_type !== "apply_allocation",
  );

  let positions = finalSnapshot.positions;
  let segments = finalSnapshot.segments;
  let actions = finalSnapshot.actions;
  let runs = finalSnapshot.runs;
  let latestNotice = finalSnapshot.latestNotice;
  let latestScadaEvent = finalSnapshot.latestScadaEvent;
  let hasRunningWork = false;

  if (stage === "baseline") {
    positions = preRecutPositions(false);
    segments = preRecutSegments(false);
    actions = [];
    runs = [];
    latestNotice = null;
    latestScadaEvent = null;
  } else if (stage === "incident_posted") {
    positions = preRecutPositions(false);
    segments = preRecutSegments(true);
    actions = [];
    runs = initialRun ? [runAtStatus(initialRun, "running")] : [];
    latestNotice = null;
    hasRunningWork = true;
  } else if (stage === "recut_pending") {
    positions = preRecutPositions(true);
    segments = preRecutSegments(true);
    actions = applyAction ? [pendingAction(applyAction)] : [];
    runs = initialRun ? [runAtStatus(initialRun, "awaiting_approval")] : [];
    latestNotice = null;
  } else if (stage === "recut_applied") {
    actions = applyAction ? [applyAction] : [];
    runs = [
      ...(initialRun ? [runAtStatus(initialRun, "complete")] : []),
      ...(continuationRun ? [runAtStatus(continuationRun, "running")] : []),
    ];
    latestNotice = null;
    hasRunningWork = true;
  } else if (stage === "comms_pending") {
    actions = [
      ...(applyAction ? [applyAction] : []),
      ...communicationActions.map(pendingAction),
    ];
    runs = [
      ...(initialRun ? [runAtStatus(initialRun, "complete")] : []),
      ...(continuationRun ? [runAtStatus(continuationRun, "awaiting_approval")] : []),
    ];
    latestNotice = finalSnapshot.latestNotice
      ? {
          ...finalSnapshot.latestNotice,
          status: "draft",
          posted_at: null,
          effective_start: null,
        }
      : null;
  }

  const snapshot: DeskSnapshot = {
    ...finalSnapshot,
    scenario: {
      ...finalSnapshot.scenario,
      phase: stage,
      sim_clock_ct: stageTime(stage),
    },
    positions,
    segments,
    actions,
    runs,
    latestNotice,
    latestScadaEvent,
    cycleMinutesRemaining: stage === "baseline" ? 180 : 165,
    hasRunningWork,
  };

  return {
    stage,
    label: definition.label,
    index: boundedIndex,
    snapshot,
    events: eventsForStage(stage),
  };
}

export function replayMetadata() {
  const capture = requiredCapture();
  return {
    label: capture.label,
    capturedAt: capture.captured_at,
    sourceWorkflowId: capture.source_workflow_id,
    stageCount: replayStages.length,
    eventCount: capture.events.length,
  };
}
