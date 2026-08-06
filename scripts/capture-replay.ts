import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";

import { fetchDeskSnapshot } from "../src/lib/desk-data";
import type { Database } from "../src/lib/database.types";
import { fetchWorkflowEvents } from "../src/lib/events";

const env = loadEnv("development", process.cwd(), "VITE_");
const url = env.VITE_SUPABASE_URL;
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !publishableKey) {
  throw new Error("browser-safe Vite Supabase configuration is required");
}

const client = createClient<Database>(url, publishableKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
const snapshot = await fetchDeskSnapshot(client);
if (snapshot.scenario.phase !== "resolved" || !snapshot.workflowId) {
  throw new Error("capture requires a resolved workflow");
}
if (
  snapshot.actions.length !== 3 ||
  snapshot.actions.some((action) => action.status !== "executed")
) {
  throw new Error("capture requires exactly three executed hero actions");
}

const events = await fetchWorkflowEvents(client, snapshot.workflowId);
if (events.length === 0 || events.some((event) => event.event_type === "error")) {
  throw new Error("capture requires a non-empty, error-free workflow");
}

const outputPath = resolve("src/replay/hero-capture.json");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify({
    schema_version: 1,
    label: "Verified hero workflow",
    captured_at: new Date().toISOString(),
    source_workflow_id: snapshot.workflowId,
    snapshot,
    events,
  }, null, 2)}\n`,
  { encoding: "utf8", mode: 0o644 },
);

console.log(JSON.stringify({
  output: "src/replay/hero-capture.json",
  events: events.length,
  actions: snapshot.actions.length,
  phase: snapshot.scenario.phase,
}));
