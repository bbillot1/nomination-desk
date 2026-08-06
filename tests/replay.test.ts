import { beforeAll, describe, expect, it } from "vitest";

import {
  loadReplayCapture,
  replayFrame,
  replayStages,
} from "../src/lib/replay";

beforeAll(async () => {
  await loadReplayCapture();
});

function position(stageIndex: number, shipperId: string) {
  return replayFrame(stageIndex).snapshot.positions.find(
    (candidate) => candidate.shipperId === shipperId,
  );
}

describe("verified hero replay", () => {
  it("starts from the published Timely baseline with no active workflow", () => {
    const frame = replayFrame(0);
    const segment = frame.snapshot.segments.find((candidate) => candidate.id === "SEG-2");

    expect(frame.stage).toBe("baseline");
    expect(frame.events).toEqual([]);
    expect(frame.snapshot.actions).toEqual([]);
    expect(position(0, "CEMK")?.scheduledDth).toBe(102_000);
    expect(position(0, "SABT")?.scheduledDth).toBe(68_000);
    expect(segment).toMatchObject({
      scheduledDth: 900_000,
      operatingCapacityDth: 900_000,
      state: "full",
    });
  });

  it("shows the physical oversubscription before any allocation is approved", () => {
    const frame = replayFrame(1);
    const segment = frame.snapshot.segments.find((candidate) => candidate.id === "SEG-2");

    expect(frame.stage).toBe("incident_posted");
    expect(segment).toMatchObject({
      scheduledDth: 900_000,
      operatingCapacityDth: 820_000,
      headroomDth: -80_000,
      state: "oversubscribed",
    });
  });

  it("keeps the authoritative schedule unchanged while the recut is pending", () => {
    const frame = replayFrame(2);

    expect(frame.snapshot.actions).toHaveLength(1);
    expect(frame.snapshot.actions[0]?.status).toBe("pending");
    expect(position(2, "CEMK")).toMatchObject({
      scheduledDth: 102_000,
      proposedScheduledDth: 54_000,
      status: "pending_recut",
    });
  });

  it("applies the canonical positions only after the recorded approval", () => {
    const frame = replayFrame(3);

    expect(frame.stage).toBe("recut_applied");
    expect(position(3, "CEMK")?.scheduledDth).toBe(54_000);
    expect(position(3, "SABT")?.scheduledDth).toBe(36_000);
    expect(frame.snapshot.actions[0]?.status).toBe("executed");
    expect(frame.snapshot.hasRunningWork).toBe(true);
  });

  it("stages communications as drafts, then resolves with the full audit chain", () => {
    const pending = replayFrame(4);
    const resolved = replayFrame(replayStages.length - 1);

    expect(pending.snapshot.latestNotice?.status).toBe("draft");
    expect(pending.snapshot.latestNotice?.effective_start).toBeNull();
    expect(pending.snapshot.actions.filter((action) => action.status === "pending")).toHaveLength(2);

    expect(resolved.stage).toBe("resolved");
    expect(resolved.events).toHaveLength(37);
    expect(resolved.events.some((event) => event.event_type === "error")).toBe(false);
    expect(resolved.snapshot.actions.every((action) => action.status === "executed")).toBe(true);
    expect(resolved.snapshot.latestNotice?.status).toBe("posted");
  });
});
