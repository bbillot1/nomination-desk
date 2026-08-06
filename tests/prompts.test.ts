import { describe, expect, it } from "vitest";

import { communicationsPrompt } from "../supabase/functions/_shared/prompts/communications.ts";
import { exceptionPrompt } from "../supabase/functions/_shared/prompts/exception.ts";
import { schedulingPrompt } from "../supabase/functions/_shared/prompts/scheduling.ts";
import { supervisorPrompt } from "../supabase/functions/_shared/prompts/supervisor.ts";

describe("operator-readable event requirements", () => {
  it.each([
    ["scheduling", schedulingPrompt("skills")],
    ["exception", exceptionPrompt("skills")],
    ["communications", communicationsPrompt("skills")],
  ])("%s prompt forbids planning prose and Markdown", (_name, prompt) => {
    expect(prompt).toContain("never first-person plans or future intent");
    expect(prompt).toContain("Use plain text only; no Markdown");
    expect(prompt).toContain("Every summary is one plain-English sentence");
    expect(prompt).toContain("Never include run IDs, workflow IDs, trigger_ref");
  });

  it("requires Scheduling to use the deterministic CT display", () => {
    expect(schedulingPrompt("skills")).toContain("occurred_at_ct_display");
    expect(schedulingPrompt("skills")).toContain("never emit a raw ISO");
  });

  it("keeps Supervisor routing text plain and concise", () => {
    const prompt = supervisorPrompt("scada_event");
    expect(prompt).toContain("plain-text routing sentence");
    expect(prompt).toContain("no Markdown, planning narration, or future intent");
  });
});
