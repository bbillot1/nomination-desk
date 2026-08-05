import { getServiceClient } from "../_shared/db.ts";
import {
  errorResponse,
  HttpError,
  jsonBody,
  jsonResponse,
  optionsResponse,
  requireProjectCaller,
} from "../_shared/http.ts";
import { claimQueuedRun, runAgentWorkflow } from "../_shared/runtime.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  try {
    requireProjectCaller(request);
    const body = await jsonBody(request);
    const pendingActionId = body.pending_action_id;
    const decision = body.decision;
    const decidedBy = body.decided_by;
    if (typeof pendingActionId !== "string" || !pendingActionId) {
      throw new HttpError(400, "pending_action_id is required");
    }
    if (decision !== "approve" && decision !== "reject") {
      throw new HttpError(400, "decision must be approve or reject");
    }
    if (typeof decidedBy !== "string" || !decidedBy.trim()) {
      throw new HttpError(400, "decided_by is required");
    }

    const client = getServiceClient();
    const { data, error } = await client.rpc("execute_approval", {
      p_pending_action_id: pendingActionId,
      p_decision: decision,
      p_decided_by: decidedBy.trim(),
    });
    if (error) throw new Error("approval transaction failed");

    const result = data as { queued_run_id?: unknown } | null;
    const queuedRunId = typeof result?.queued_run_id === "string"
      ? result.queued_run_id
      : null;
    if (queuedRunId && await claimQueuedRun(queuedRunId)) {
      EdgeRuntime.waitUntil(runAgentWorkflow(queuedRunId));
    }

    return jsonResponse(data);
  } catch (error) {
    return errorResponse(error);
  }
});
