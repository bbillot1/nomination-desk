import { describe, expect, it } from "vitest";

import {
  buildPositionViews,
  buildSegmentViews,
} from "../src/lib/desk-data";
import type {
  ContractRow,
  NominationRow,
  PendingActionRow,
  PointRow,
  SegmentRow,
  ShipperRow,
} from "../src/lib/database.types";

function nomination(overrides: Partial<NominationRow> = {}): NominationRow {
  return {
    contract_id: "CON-LSPP",
    created_at: null,
    cut_reason: null,
    cycle_id: "CYCLE-TIMELY",
    delivery_point: "DP-LSPP",
    id: "NOM-LSPP",
    nominated_dth: 250_000,
    priority_rank: 1,
    receipt_point: "RP-WAHA",
    scheduled_dth: 250_000,
    shipper_id: "LSPP",
    status: "scheduled",
    ...overrides,
  };
}

function shipper(overrides: Partial<ShipperRow> = {}): ShipperRow {
  return {
    contact_email: null,
    duns: null,
    id: "LSPP",
    name: "Lone Star Power Partners",
    shipper_type: "power_gen",
    ...overrides,
  };
}

function contract(overrides: Partial<ContractRow> = {}): ContractRow {
  return {
    contract_number: "FT-001",
    effective_end: "2030-01-01",
    effective_start: "2026-01-01",
    id: "CON-LSPP",
    mdq_dth: 250_000,
    pipeline_id: "ETX-NTX",
    primary_delivery_point: "DP-LSPP",
    primary_receipt_point: "RP-WAHA",
    service_type: "FT",
    shipper_id: "LSPP",
    storage_point: "RP-BETH",
    storage_rights_dth: 40_000,
    ...overrides,
  };
}

function allocationAction(
  status: PendingActionRow["status"],
  allocations: Array<Record<string, number | string>>,
): PendingActionRow {
  return {
    action_type: "apply_allocation",
    created_at: "2026-08-05T16:00:00Z",
    decided_at: status === "executed" ? "2026-08-05T16:01:00Z" : null,
    decided_by: status === "executed" ? "control-room-scheduler" : null,
    dollar_impact_cents: null,
    executed_at: status === "executed" ? "2026-08-05T16:01:00Z" : null,
    id: "ACTION-1",
    payload: {
      segment_id: "SEG-2",
      derated_capacity_dth: 820_000,
      allocations,
    },
    rationale: "Apply the deterministic recut.",
    result: null,
    run_id: "RUN-1",
    status,
    title: "Apply SEG-2 allocation",
  };
}

describe("Phase 4 position derivation", () => {
  it("shows a staged recut without changing the authoritative schedule", () => {
    const positions = buildPositionViews({
      nominations: [
        nomination({
          contract_id: "CON-CEMK",
          id: "NOM-CEMK",
          nominated_dth: 150_000,
          priority_rank: 3,
          scheduled_dth: 102_000,
          shipper_id: "CEMK",
        }),
      ],
      shippers: [shipper({ id: "CEMK", name: "Cardinal Energy Marketing" })],
      contracts: [
        contract({
          id: "CON-CEMK",
          service_type: "IT",
          shipper_id: "CEMK",
        }),
      ],
      flows: [],
      noticeTerms: { tolerancePct: 5, penaltyRateCentsDth: 2_500 },
      actions: [
        allocationAction("pending", [{
          nomination_id: "NOM-CEMK",
          scheduled_dth: 54_000,
          cut_dth: 48_000,
        }]),
      ],
    });

    expect(positions[0]).toMatchObject({
      scheduledDth: 102_000,
      proposedScheduledDth: 54_000,
      exposureCents: null,
      status: "pending_recut",
    });
  });

  it("computes the canonical exposure only after allocation approval", () => {
    const measured = [11_979, 11_979, 11_979, 11_979, 11_979, 11_980];
    const positions = buildPositionViews({
      nominations: [nomination()],
      shippers: [shipper()],
      contracts: [contract()],
      flows: measured.map((volume_dth, flow_hour) => ({
        flow_hour,
        shipper_id: "LSPP",
        volume_dth,
      })),
      noticeTerms: { tolerancePct: 5, penaltyRateCentsDth: 2_500 },
      actions: [
        allocationAction("executed", [{
          nomination_id: "NOM-LSPP",
          scheduled_dth: 250_000,
          cut_dth: 0,
        }]),
      ],
    });

    expect(positions[0]).toMatchObject({
      projectedDth: 287_500,
      varianceDth: 37_500,
      toleranceDth: 12_500,
      excessDth: 25_000,
      exposureCents: 62_500_000,
      status: "at_risk",
    });
  });

  it("uses the active scenario's Stage 3 terms instead of hero constants", () => {
    const measured = [11_979, 11_979, 11_979, 11_979, 11_979, 11_980];
    const [positionView] = buildPositionViews({
      nominations: [nomination()],
      shippers: [shipper()],
      contracts: [contract()],
      flows: measured.map((volume_dth, flow_hour) => ({
        flow_hour,
        shipper_id: "LSPP",
        volume_dth,
      })),
      noticeTerms: { tolerancePct: 3, penaltyRateCentsDth: 5_000 },
      actions: [
        allocationAction("executed", [{
          nomination_id: "NOM-LSPP",
          scheduled_dth: 250_000,
          cut_dth: 0,
        }]),
      ],
    });

    expect(positionView).toMatchObject({
      toleranceDth: 7_500,
      excessDth: 30_000,
      exposureCents: 150_000_000,
    });
  });
});

describe("Phase 4 segment derivation", () => {
  const points: PointRow[] = [
    {
      corridor_seq: 1,
      id: "RP-WAHA",
      meter_id: null,
      name: "Waha Hub",
      pipeline_id: "ETX-NTX",
      point_type: "receipt",
    },
    {
      corridor_seq: 2,
      id: "MIDLAND",
      meter_id: null,
      name: "Midland Junction",
      pipeline_id: "ETX-NTX",
      point_type: "junction",
    },
    {
      corridor_seq: 3,
      id: "ABILENE",
      meter_id: null,
      name: "Abilene Junction",
      pipeline_id: "ETX-NTX",
      point_type: "junction",
    },
    {
      corridor_seq: 4,
      id: "DP-LSPP",
      meter_id: null,
      name: "LSPP Generation",
      pipeline_id: "ETX-NTX",
      point_type: "delivery",
    },
  ];
  const segment: SegmentRow = {
    design_capacity_dth: 900_000,
    from_point: "MIDLAND",
    id: "SEG-2",
    name: "Midland — Abilene",
    operating_capacity_dth: 820_000,
    pipeline_id: "ETX-NTX",
    seq: 2,
    to_point: "ABILENE",
  };

  it("turns red immediately when the physical derate creates oversubscription", () => {
    const [view] = buildSegmentViews(
      [segment],
      points,
      [nomination({ scheduled_dth: 900_000 })],
    );
    expect(view).toMatchObject({
      scheduledDth: 900_000,
      operatingCapacityDth: 820_000,
      headroomDth: -80_000,
      state: "oversubscribed",
    });
  });

  it("returns to fully subscribed when the approved recut reaches capacity", () => {
    const [view] = buildSegmentViews(
      [segment],
      points,
      [nomination({ scheduled_dth: 820_000 })],
    );
    expect(view).toMatchObject({
      scheduledDth: 820_000,
      headroomDth: 0,
      state: "full",
    });
  });
});
