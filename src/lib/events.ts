import type {
  RealtimeChannel,
  RealtimeChannelSendResponse,
  SupabaseClient,
} from "@supabase/supabase-js";

import type { AgentEventRow, Database } from "./database.types";

export interface WorkflowEvent extends AgentEventRow {
  run_started_at?: string | null;
}

export type RealtimeState = "connecting" | "live" | "degraded" | "closed";

export function workflowEventKey(event: Pick<AgentEventRow, "run_id" | "seq">): string {
  return `${event.run_id}:${event.seq}`;
}

export function sortWorkflowEvents(events: WorkflowEvent[]): WorkflowEvent[] {
  return [...events].sort((left, right) => {
    const leftRun = left.run_started_at ?? left.created_at ?? "";
    const rightRun = right.run_started_at ?? right.created_at ?? "";
    const runOrder = leftRun.localeCompare(rightRun);
    if (runOrder !== 0) return runOrder;
    if (left.run_id === right.run_id) return left.seq - right.seq;
    return (left.created_at ?? "").localeCompare(right.created_at ?? "");
  });
}

export function mergeWorkflowEvents(
  current: WorkflowEvent[],
  incoming: WorkflowEvent[],
): WorkflowEvent[] {
  const byKey = new Map<string, WorkflowEvent>();
  for (const event of current) byKey.set(workflowEventKey(event), event);
  for (const event of incoming) {
    const existing = byKey.get(workflowEventKey(event));
    byKey.set(workflowEventKey(event), {
      ...existing,
      ...event,
      run_started_at: event.run_started_at ?? existing?.run_started_at,
    });
  }
  return sortWorkflowEvents([...byKey.values()]);
}

export async function fetchWorkflowEvents(
  client: SupabaseClient<Database>,
  workflowId: string,
): Promise<WorkflowEvent[]> {
  const [runsResult, eventsResult] = await Promise.all([
    client
      .from("agent_runs")
      .select("id,started_at")
      .eq("workflow_id", workflowId)
      .order("started_at"),
    client
      .from("agent_events")
      .select("*")
      .eq("workflow_id", workflowId),
  ]);
  if (runsResult.error) throw new Error(`agent run backlog: ${runsResult.error.message}`);
  if (eventsResult.error) throw new Error(`agent event backlog: ${eventsResult.error.message}`);

  const runStartedAt = new Map(
    (runsResult.data ?? []).map((run) => [run.id, run.started_at]),
  );
  return sortWorkflowEvents(
    (eventsResult.data ?? []).map((event) => ({
      ...event,
      run_started_at: runStartedAt.get(event.run_id) ?? event.created_at,
    })),
  );
}

function subscribeReady(
  channel: RealtimeChannel,
  onStatus: (state: RealtimeState) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      onStatus("degraded");
      reject(new Error("Realtime subscription timed out"));
    }, 10_000);

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        onStatus("live");
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          resolve();
        }
        return;
      }
      if (status === "CLOSED") onStatus("closed");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        onStatus("degraded");
        if (!settled) {
          settled = true;
          window.clearTimeout(timeout);
          reject(new Error(`Realtime subscription failed: ${status.toLowerCase()}`));
        }
      }
    });
  });
}

/**
 * Subscribe first, then load the backlog. Any insert racing the fetch is merged by
 * `(run_id, seq)`, so reloads and continuation runs remain gapless and duplicate-free.
 */
export async function subscribeWorkflowEvents(
  client: SupabaseClient<Database>,
  workflowId: string,
  onEvents: (events: WorkflowEvent[]) => void,
  onStatus: (state: RealtimeState) => void,
): Promise<() => Promise<RealtimeChannelSendResponse>> {
  let events: WorkflowEvent[] = [];
  const channel = client
    .channel(`workflow-events:${workflowId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "agent_events",
        filter: `workflow_id=eq.${workflowId}`,
      },
      (payload) => {
        events = mergeWorkflowEvents(events, [payload.new as WorkflowEvent]);
        onEvents(events);
      },
    );

  try {
    await subscribeReady(channel, onStatus);
    const backlog = await fetchWorkflowEvents(client, workflowId);
    events = mergeWorkflowEvents(events, backlog);
    onEvents(events);
  } catch (error) {
    await client.removeChannel(channel);
    throw error;
  }

  return () => client.removeChannel(channel);
}

const MUTABLE_TABLES = [
  "agent_runs",
  "pending_actions",
  "notices",
  "nominations",
  "segments",
  "scenario_state",
] as const;

export function subscribeDeskChanges(
  client: SupabaseClient<Database>,
  onChange: () => void,
  onStatus: (state: RealtimeState) => void,
): RealtimeChannel {
  let channel = client.channel("desk-state");
  for (const table of MUTABLE_TABLES) {
    channel = channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table },
        onChange,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table },
        onChange,
      );
  }
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") onStatus("live");
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onStatus("degraded");
    else if (status === "CLOSED") onStatus("closed");
    else onStatus("connecting");
  });
  return channel;
}
