import { getServiceClient } from "../_shared/db.ts";
import {
  errorResponse,
  HttpError,
  jsonBody,
  jsonResponse,
  optionsResponse,
  requireProjectCaller,
} from "../_shared/http.ts";
import { createAgentRun, runAgentWorkflow } from "../_shared/runtime.ts";
import {
  generateScenario,
  randomScenarioSeed,
} from "../_shared/scenario.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  try {
    requireProjectCaller(request);
    const body = await jsonBody(request);
    const action = body.action;
    if (typeof action !== "string") throw new HttpError(400, "action is required");
    const client = getServiceClient();

    if (action === "reset") {
      const { count, error: countError } = await client
        .from("agent_runs")
        .select("id", { count: "exact", head: true })
        .in("status", ["running", "queued"]);
      if (countError) throw new Error("could not check active runs");
      if ((count ?? 0) > 0) throw new HttpError(409, "an agent run is still active");
      const { data, error } = await client.rpc("reset_hero_scenario");
      if (error) throw new Error("scenario reset failed");
      return jsonResponse(data);
    }

    if (action === "trip_compressor") {
      const { data, error } = await client.rpc("simulate_trip_compressor");
      if (error) throw new HttpError(409, "scenario is not ready for compressor trip");
      const incident = data as {
        scada_event_id?: unknown;
        gas_day?: unknown;
      } | null;
      if (
        typeof incident?.scada_event_id !== "string" ||
        typeof incident.gas_day !== "string"
      ) {
        throw new Error("simulation returned invalid incident");
      }

      const run = await createAgentRun({
        triggerType: "scada_event",
        triggerRef: incident.scada_event_id,
        gasDay: incident.gas_day,
      });
      EdgeRuntime.waitUntil(runAgentWorkflow(run.run_id));
      return jsonResponse({ ...incident, ...run }, 202);
    }

    if (action === "advance_clock") {
      const { data: scenario, error: readError } = await client
        .from("scenario_state")
        .select("sim_clock_ct")
        .eq("id", 1)
        .single();
      if (readError || !scenario) throw new Error("scenario clock unavailable");
      const next = new Date(Date.parse(scenario.sim_clock_ct) + 15 * 60_000).toISOString();
      const { error: updateError } = await client
        .from("scenario_state")
        .update({ sim_clock_ct: next, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (updateError) throw new Error("scenario clock update failed");
      return jsonResponse({ sim_clock_ct: next });
    }

    if (action === "new_scenario" || action === "restore_hero") {
      const { count, error: countError } = await client
        .from("agent_runs")
        .select("id", { count: "exact", head: true })
        .in("status", ["running", "queued"]);
      if (countError) throw new Error("could not check active runs");
      if ((count ?? 0) > 0) throw new HttpError(409, "an agent run is still active");

      const requestedSeed = body.seed;
      if (requestedSeed !== undefined && typeof requestedSeed !== "string") {
        throw new HttpError(400, "seed must be a string");
      }
      const restoringHero = action === "restore_hero" || requestedSeed === "hero";
      const seed = restoringHero ? "hero" : requestedSeed ?? randomScenarioSeed();
      let generated;
      try {
        generated = generateScenario(seed);
      } catch {
        throw new HttpError(400, "scenario seed is invalid");
      }
      const { data, error } = restoringHero
        ? await client.rpc("restore_hero_scenario", {
            p_params: generated.params,
            p_answer_key: generated.answer_key,
            p_nominations: generated.nominations,
            p_actual_flows: generated.actual_flows,
          })
        : await client.rpc("load_generated_scenario", {
            p_seed: generated.seed,
            p_params: generated.params,
            p_answer_key: generated.answer_key,
            p_nominations: generated.nominations,
            p_actual_flows: generated.actual_flows,
          });
      if (error) throw new Error("scenario could not be loaded");
      return jsonResponse(data);
    }

    throw new HttpError(400, "unsupported simulation action");
  } catch (error) {
    return errorResponse(error);
  }
});
