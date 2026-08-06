import { describe, expect, it } from "vitest";

import { normalizeEventSummary } from "../supabase/functions/_shared/events.ts";
import { centralTimeDisplay } from "../supabase/functions/_shared/time.ts";

describe("agent event summary normalization", () => {
  it("removes model-authored Markdown while preserving readable text", () => {
    expect(
      normalizeEventSummary(
        "**Phase 1 — Confirm and quantify:** SCADA confirms `SEG-2` is derated.",
      ),
    ).toBe("Phase 1 — Confirm and quantify: SCADA confirms SEG-2 is derated.");
  });

  it("turns inline Markdown list narration into one plain sentence", () => {
    expect(
      normalizeEventSummary(
        "Engine result: - **CEMK** cut 48,000 Dth - **SABT** cut 32,000 Dth.",
      ),
    ).toBe("Engine result: CEMK cut 48,000 Dth; SABT cut 32,000 Dth.");
  });

  it("keeps the concise database limit and rejects empty summaries", () => {
    expect(normalizeEventSummary("x".repeat(600))).toHaveLength(500);
    expect(() => normalizeEventSummary(" ** ** ")).toThrow(/cannot be empty/);
  });
});

describe("central timestamp display", () => {
  it("renders deterministic America/Chicago wall-clock time", () => {
    expect(centralTimeDisplay("2026-08-04T21:15:00Z")).toBe("2026-08-04 16:15 CT");
  });

  it("rejects invalid timestamps", () => {
    expect(() => centralTimeDisplay("not-a-time")).toThrow(/invalid timestamp/);
  });
});
