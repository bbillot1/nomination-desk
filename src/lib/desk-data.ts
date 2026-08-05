import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AgentRunRow,
  ContractRow,
  CycleRow,
  Database,
  Json,
  NominationRow,
  NoticeRow,
  PendingActionRow,
  PointRow,
  ScenarioStateRow,
  ScadaEventRow,
  SegmentRow,
  ShipperRow,
} from "./database.types";

export interface PositionView {
  nominationId: string;
  shipperId: string;
  shipperName: string;
  shipperType: string;
  serviceType: string;
  priorityRank: number;
  nominatedDth: number;
  scheduledDth: number;
  proposedScheduledDth: number | null;
  recutDeltaDth: number | null;
  projectedDth: number | null;
  varianceDth: number | null;
  toleranceDth: number | null;
  excessDth: number | null;
  exposureCents: number | null;
  status: "normal" | "pending_recut" | "cut" | "at_risk";
}

export interface SegmentView {
  id: string;
  name: string;
  path: string;
  designCapacityDth: number;
  operatingCapacityDth: number;
  scheduledDth: number;
  headroomDth: number;
  utilizationPct: number;
  isDerated: boolean;
  state: "normal" | "watch" | "full" | "oversubscribed";
}

export interface DeskSnapshot {
  scenario: ScenarioStateRow;
  positions: PositionView[];
  segments: SegmentView[];
  openCycle: CycleRow | null;
  cycleMinutesRemaining: number | null;
  actions: PendingActionRow[];
  latestNotice: NoticeRow | null;
  runs: AgentRunRow[];
  latestScadaEvent: ScadaEventRow | null;
  workflowId: string | null;
  hasRunningWork: boolean;
}

interface AllocationChange {
  scheduledDth: number;
  cutDth: number;
}

function jsonObject(value: Json | null): Record<string, Json | undefined> | null {
  return value !== null && !Array.isArray(value) && typeof value === "object" ? value : null;
}

function numberField(
  value: Record<string, Json | undefined>,
  field: string,
): number | null {
  const candidate = value[field];
  return typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null;
}

function allocationChanges(action: PendingActionRow | undefined): Map<string, AllocationChange> {
  const changes = new Map<string, AllocationChange>();
  const payload = jsonObject(action?.payload ?? null);
  const allocations = payload?.allocations;
  if (!Array.isArray(allocations)) return changes;

  for (const value of allocations) {
    const allocation = jsonObject(value);
    if (!allocation) continue;
    const nominationId = allocation.nomination_id;
    const scheduledDth = numberField(allocation, "scheduled_dth");
    const cutDth = numberField(allocation, "cut_dth");
    if (typeof nominationId !== "string" || scheduledDth === null || cutDth === null) continue;
    changes.set(nominationId, { scheduledDth, cutDth });
  }
  return changes;
}

export function buildPositionViews(input: {
  nominations: NominationRow[];
  shippers: ShipperRow[];
  contracts: ContractRow[];
  flows: Array<{ flow_hour: number; shipper_id: string; volume_dth: number }>;
  noticeTerms: {
    tolerancePct: number;
    penaltyRateCentsDth: number;
  };
  actions: PendingActionRow[];
}): PositionView[] {
  const shipperById = new Map(input.shippers.map((shipper) => [shipper.id, shipper]));
  const contractById = new Map(input.contracts.map((contract) => [contract.id, contract]));
  const flowByShipper = new Map<string, { total: number; hours: Set<number> }>();
  for (const flow of input.flows) {
    const measured = flowByShipper.get(flow.shipper_id) ?? { total: 0, hours: new Set() };
    measured.total += flow.volume_dth;
    measured.hours.add(flow.flow_hour);
    flowByShipper.set(flow.shipper_id, measured);
  }

  const toleranceBps = Math.round(input.noticeTerms.tolerancePct * 100);
  const allocationAction = input.actions.find(
    (action) => action.action_type === "apply_allocation",
  );
  const changes = allocationChanges(allocationAction);
  const assessmentActive = allocationAction?.status === "executed";

  return input.nominations
    .map((nomination) => {
      const shipper = shipperById.get(nomination.shipper_id);
      const contract = contractById.get(nomination.contract_id);
      const measured = flowByShipper.get(nomination.shipper_id);
      const projectedDth = measured && measured.hours.size > 0
        ? Math.trunc((measured.total * 24) / measured.hours.size)
        : null;
      const scheduledDth = nomination.scheduled_dth ?? 0;
      const varianceDth = projectedDth === null ? null : projectedDth - scheduledDth;
      const toleranceDth = Math.trunc((scheduledDth * toleranceBps) / 10_000);
      const excessDth = varianceDth === null ? null : Math.max(0, varianceDth - toleranceDth);
      const exposureCents = assessmentActive && excessDth !== null
        ? excessDth * input.noticeTerms.penaltyRateCentsDth
        : null;
      const change = changes.get(nomination.id);
      const proposedScheduledDth = allocationAction?.status === "pending" && change
        ? change.scheduledDth
        : null;
      const recutDeltaDth = allocationAction?.status === "executed" && change?.cutDth
        ? -change.cutDth
        : null;

      let status: PositionView["status"] = "normal";
      if (exposureCents !== null && exposureCents > 0) status = "at_risk";
      else if (proposedScheduledDth !== null) status = "pending_recut";
      else if (recutDeltaDth !== null || nomination.status === "cut") status = "cut";

      return {
        nominationId: nomination.id,
        shipperId: nomination.shipper_id,
        shipperName: shipper?.name ?? nomination.shipper_id,
        shipperType: shipper?.shipper_type ?? "unknown",
        serviceType: contract?.service_type ?? "—",
        priorityRank: nomination.priority_rank,
        nominatedDth: nomination.nominated_dth,
        scheduledDth,
        proposedScheduledDth,
        recutDeltaDth,
        projectedDth,
        varianceDth: assessmentActive ? varianceDth : null,
        toleranceDth: assessmentActive ? toleranceDth : null,
        excessDth: assessmentActive ? excessDth : null,
        exposureCents,
        status,
      };
    })
    .sort((left, right) =>
      left.priorityRank - right.priorityRank || left.shipperName.localeCompare(right.shipperName)
    );
}

function nominationTraversesSegment(
  nomination: NominationRow,
  segment: SegmentRow,
  pointById: Map<string, PointRow>,
): boolean {
  const receipt = pointById.get(nomination.receipt_point)?.corridor_seq;
  const delivery = pointById.get(nomination.delivery_point)?.corridor_seq;
  const from = pointById.get(segment.from_point)?.corridor_seq;
  const to = pointById.get(segment.to_point)?.corridor_seq;
  return (
    receipt !== undefined &&
    delivery !== undefined &&
    from !== undefined &&
    to !== undefined &&
    receipt <= from &&
    delivery >= to
  );
}

export function buildSegmentViews(
  segments: SegmentRow[],
  points: PointRow[],
  nominations: NominationRow[],
): SegmentView[] {
  const pointById = new Map(points.map((point) => [point.id, point]));
  return segments.map((segment) => {
    const scheduledDth = nominations.reduce(
      (total, nomination) =>
        nominationTraversesSegment(nomination, segment, pointById)
          ? total + (nomination.scheduled_dth ?? 0)
          : total,
      0,
    );
    const operating = segment.operating_capacity_dth;
    const utilizationPct = operating > 0 ? (scheduledDth * 100) / operating : 0;
    let state: SegmentView["state"] = "normal";
    if (scheduledDth > operating) state = "oversubscribed";
    else if (scheduledDth === operating) state = "full";
    else if (utilizationPct >= 90) state = "watch";

    return {
      id: segment.id,
      name: segment.name,
      path: `${pointById.get(segment.from_point)?.name ?? segment.from_point} → ${
        pointById.get(segment.to_point)?.name ?? segment.to_point
      }`,
      designCapacityDth: segment.design_capacity_dth,
      operatingCapacityDth: operating,
      scheduledDth,
      headroomDth: operating - scheduledDth,
      utilizationPct,
      isDerated: operating < segment.design_capacity_dth,
      state,
    };
  });
}

function requireData<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${label}: no data returned`);
  return result.data;
}

export function scenarioNoticeTerms(scenario: ScenarioStateRow): {
  tolerancePct: number;
  penaltyRateCentsDth: number;
} {
  const params = jsonObject(scenario.params);
  const notice = jsonObject(params?.notice ?? null);
  const tolerancePct = notice ? numberField(notice, "tolerance_pct") : null;
  const penaltyRateCentsDth = notice
    ? numberField(notice, "penalty_rate_cents_dth")
    : null;
  if (tolerancePct === null || penaltyRateCentsDth === null) {
    throw new Error("scenario notice terms are missing");
  }
  return { tolerancePct, penaltyRateCentsDth };
}

export async function fetchDeskSnapshot(
  client: SupabaseClient<Database>,
): Promise<DeskSnapshot> {
  const scenarioResult = await client
    .from("scenario_state")
    .select("*")
    .eq("id", 1)
    .single();
  const scenario = requireData(scenarioResult, "scenario state");

  const [
    segmentsResult,
    pointsResult,
    nominationsResult,
    shippersResult,
    contractsResult,
    cyclesResult,
    flowsResult,
    noticesResult,
    runsResult,
    actionsResult,
    scadaResult,
  ] = await Promise.all([
    client.from("segments").select("*").order("seq"),
    client.from("points").select("*"),
    client.from("nominations").select("*"),
    client.from("shippers").select("*"),
    client.from("contracts").select("*"),
    client.from("cycles").select("*").eq("gas_day", scenario.gas_day).order("deadline_ct"),
    client.from("actual_flows").select("*").eq("gas_day", scenario.gas_day),
    client.from("notices").select("*").order("created_at", { ascending: false }),
    client.from("agent_runs").select("*").order("started_at", { ascending: false }),
    client.from("pending_actions").select("*").order("created_at", { ascending: false }),
    client.from("scada_events").select("*").order("occurred_at", { ascending: false }),
  ]);

  const segments = requireData(segmentsResult, "segments");
  const points = requireData(pointsResult, "points");
  const nominations = requireData(nominationsResult, "nominations");
  const shippers = requireData(shippersResult, "shippers");
  const contracts = requireData(contractsResult, "contracts");
  const cycles = requireData(cyclesResult, "cycles");
  const flows = requireData(flowsResult, "actual flows");
  const notices = requireData(noticesResult, "notices");
  const allRuns = requireData(runsResult, "agent runs");
  const allActions = requireData(actionsResult, "pending actions");
  const scadaEvents = requireData(scadaResult, "SCADA events");

  const workflowId = allRuns[0]?.workflow_id ?? null;
  const runs = workflowId
    ? allRuns.filter((run) => run.workflow_id === workflowId).reverse()
    : [];
  const runIds = new Set(runs.map((run) => run.id));
  const actions = allActions.filter((action) => runIds.has(action.run_id));
  const openCycle = cycles.find((cycle) => cycle.status === "open") ?? null;
  const cycleMinutesRemaining = openCycle
    ? Math.max(
        0,
        Math.floor(
          (Date.parse(openCycle.deadline_ct) - Date.parse(scenario.sim_clock_ct)) / 60_000,
        ),
      )
    : null;

  return {
    scenario,
    positions: buildPositionViews({
      nominations,
      shippers,
      contracts,
      flows,
      noticeTerms: scenarioNoticeTerms(scenario),
      actions,
    }),
    segments: buildSegmentViews(segments, points, nominations),
    openCycle,
    cycleMinutesRemaining,
    actions,
    latestNotice: notices[0] ?? null,
    runs,
    latestScadaEvent: scadaEvents[0] ?? null,
    workflowId,
    hasRunningWork: runs.some((run) => run.status === "running" || run.status === "queued"),
  };
}
