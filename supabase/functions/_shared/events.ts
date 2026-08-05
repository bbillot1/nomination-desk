import type { SupabaseClient } from "@supabase/supabase-js";

export type AgentName = "supervisor" | "scheduling" | "exception" | "communications";
export type AgentEventType =
  | "analysis_summary"
  | "tool_call"
  | "tool_result"
  | "decision"
  | "escalation"
  | "error";

export interface AgentEventInput {
  agent_name: AgentName;
  event_type: AgentEventType;
  summary: string;
  detail?: unknown;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  citation?: string;
  skill_used?: string;
}

function normalizeSummary(summary: string): string {
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("agent event summary cannot be empty");
  // UI summary is intentionally concise; full evidence belongs in detail/tool fields.
  return normalized.length <= 500 ? normalized : `${normalized.slice(0, 497)}...`;
}

async function latestSequence(client: SupabaseClient, runId: string): Promise<number> {
  const { data, error } = await client
    .from("agent_events")
    .select("seq")
    .eq("run_id", runId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`could not load event sequence: ${error.message}`);
  return typeof data?.seq === "number" ? data.seq : 0;
}

/**
 * Per-run append-only event writer.
 *
 * One Edge worker owns a run. The in-memory counter is therefore the normal path; a single
 * unique-conflict recovery covers a retry or decision event that raced the worker.
 */
export class EventWriter {
  private constructor(
    private readonly client: SupabaseClient,
    readonly runId: string,
    readonly workflowId: string,
    private nextSeq: number,
  ) {}

  static async create(
    client: SupabaseClient,
    runId: string,
    workflowId: string,
  ): Promise<EventWriter> {
    return new EventWriter(client, runId, workflowId, await latestSequence(client, runId) + 1);
  }

  async write(event: AgentEventInput): Promise<number> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const seq = this.nextSeq;
      const { error } = await this.client.from("agent_events").insert({
        run_id: this.runId,
        workflow_id: this.workflowId,
        seq,
        agent_name: event.agent_name,
        event_type: event.event_type,
        summary: normalizeSummary(event.summary),
        detail: event.detail ?? null,
        tool_name: event.tool_name ?? null,
        tool_input: event.tool_input ?? null,
        tool_output: event.tool_output ?? null,
        citation: event.citation ?? null,
        skill_used: event.skill_used ?? null,
      });

      if (!error) {
        this.nextSeq += 1;
        return seq;
      }

      if (error.code === "23505" && attempt === 0) {
        this.nextSeq = await latestSequence(this.client, this.runId) + 1;
        continue;
      }
      throw new Error(`could not append agent event: ${error.message}`);
    }

    throw new Error("event sequence retry exhausted");
  }
}
