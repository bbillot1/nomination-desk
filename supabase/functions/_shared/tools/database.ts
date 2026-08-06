import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ToolFailure,
  type NoticeDraft,
  type PendingActionDraft,
  type ToolActionStore,
  type ToolDatabase,
  type ToolSelectRequest,
} from "./types.ts";

interface FilterableQuery {
  eq(column: string, value: unknown): FilterableQuery;
  in(column: string, values: readonly unknown[]): FilterableQuery;
  is(column: string, value: null | boolean): FilterableQuery;
  order(column: string, options: { ascending: boolean }): FilterableQuery;
  limit(count: number): FilterableQuery;
}

interface SelectResponse {
  data: unknown[] | null;
  error: { message: string; code?: string } | null;
}

/**
 * Production ToolDatabase adapter.
 *
 * The table names, filters, and selected columns originate in our own handler code, never in
 * model input. Model-provided values are passed through PostgREST's parameterized filters.
 */
export class SupabaseToolDatabase implements ToolDatabase {
  constructor(private readonly client: SupabaseClient) {}

  async select<T>(request: ToolSelectRequest): Promise<T[]> {
    let query = this.client
      .from(request.table)
      .select(request.columns ?? "*") as unknown as FilterableQuery;

    for (const filter of request.filters ?? []) {
      switch (filter.op) {
        case "eq":
          query = query.eq(filter.column, filter.value);
          break;
        case "in":
          query = query.in(filter.column, filter.values);
          break;
        case "is":
          query = query.is(filter.column, filter.value);
          break;
      }
    }

    for (const order of request.order ?? []) {
      query = query.order(order.column, { ascending: order.ascending ?? true });
    }
    query = query.limit(request.limit ?? 500);

    const response = await (query as unknown as Promise<SelectResponse>);
    if (response.error !== null) {
      const retryable = ["PGRST000", "PGRST001", "PGRST002", "PGRST301"].includes(
        response.error.code ?? "",
      );
      throw new ToolFailure(
        retryable ? "DATABASE_UNAVAILABLE" : "DATABASE_QUERY_FAILED",
        retryable
          ? "The database is temporarily unavailable."
          : "The database query could not be completed.",
        retryable,
      );
    }

    return (response.data ?? []) as T[];
  }
}

/** Transaction-backed staging adapter. No model-facing tool receives the Supabase client. */
export class SupabaseActionStore implements ToolActionStore {
  constructor(private readonly client: SupabaseClient) {}

  async stage(
    runId: string,
    draft: PendingActionDraft,
  ): Promise<{ pending_action_id: string }> {
    const pendingActionId = crypto.randomUUID();
    const { data, error } = await this.client.rpc("stage_pending_action", {
      p_id: pendingActionId,
      p_run_id: runId,
      p_action_type: draft.action_type,
      p_title: draft.title,
      p_rationale: draft.rationale,
      p_payload: draft.payload,
      p_dollar_impact_cents: draft.dollar_impact_cents ?? null,
    });
    if (error) throw new ToolFailure("STAGING_FAILED", "The action could not be staged.");
    return { pending_action_id: typeof data === "string" ? data : pendingActionId };
  }

  async stageNotice(
    runId: string,
    notice: NoticeDraft,
    action: Omit<PendingActionDraft, "action_type" | "payload">,
  ): Promise<{ notice_id: string; pending_action_id: string }> {
    const pendingActionId = crypto.randomUUID();
    const { data, error } = await this.client.rpc("stage_ebb_notice", {
      p_notice: notice,
      p_pending_action_id: pendingActionId,
      p_run_id: runId,
      p_title: action.title,
      p_rationale: action.rationale,
      p_dollar_impact_cents: action.dollar_impact_cents ?? null,
    });
    if (error) throw new ToolFailure("STAGING_FAILED", "The EBB notice could not be staged.");
    const result = data as { notice_id?: unknown; pending_action_id?: unknown } | null;
    return {
      notice_id: typeof result?.notice_id === "string" ? result.notice_id : notice.id,
      pending_action_id: typeof result?.pending_action_id === "string"
        ? result.pending_action_id
        : pendingActionId,
    };
  }
}
