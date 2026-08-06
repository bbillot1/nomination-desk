import {
  claimQueuedRun,
  createAgentRun,
  runAgentWorkflow,
} from "../_shared/runtime.ts";
import {
  errorResponse,
  HttpError,
  jsonBody,
  jsonResponse,
  optionsResponse,
  requireProjectCaller,
} from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  try {
    requireProjectCaller(request);
    const body = await jsonBody(request);
    const resumeRunId = body.resume_run_id;

    if (typeof resumeRunId === "string") {
      const claimed = await claimQueuedRun(resumeRunId);
      if (!claimed) return jsonResponse({ run_id: resumeRunId, status: "already_claimed" });
      EdgeRuntime.waitUntil(runAgentWorkflow(resumeRunId));
      return jsonResponse({ run_id: resumeRunId, status: "running" }, 202);
    }

    const triggerType = body.trigger_type;
    const gasDay = body.gas_day;
    if (triggerType !== "scada_event" && triggerType !== "manual") {
      throw new HttpError(400, "trigger_type must be scada_event or manual");
    }
    if (typeof gasDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(gasDay)) {
      throw new HttpError(400, "gas_day must be YYYY-MM-DD");
    }
    const triggerRef = body.trigger_ref;
    if (triggerRef !== undefined && triggerRef !== null && typeof triggerRef !== "string") {
      throw new HttpError(400, "trigger_ref must be a string");
    }

    const run = await createAgentRun({
      triggerType,
      triggerRef: triggerRef as string | null | undefined,
      gasDay,
    });
    EdgeRuntime.waitUntil(runAgentWorkflow(run.run_id));
    return jsonResponse(run, 202);
  } catch (error) {
    return errorResponse(error);
  }
});
