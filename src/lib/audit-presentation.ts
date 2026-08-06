import type { Json } from "./database.types";
import type { WorkflowEvent } from "./events";
import {
  formatCentralDateTime,
  formatDth,
  formatMoneyCents,
  titleCase,
} from "./format";

export type EventViewMode = "operator" | "technical";

export interface SummaryToken {
  kind: "text" | "strong" | "code";
  text: string;
}

export interface EventTimelineItem {
  key: string;
  event: WorkflowEvent;
  pairedEvent?: WorkflowEvent;
  summary: string;
  displayType: string;
  failed: boolean;
}

export interface AuditFact {
  label: string;
  value: string;
}

export interface ProviderTelemetry {
  model: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

const TOOL_LABELS: Record<string, string> = {
  get_scada_events: "Read SCADA incident",
  get_actual_flows: "Read measured flow",
  project_daily_total: "Projected full gas-day flow",
  get_segment_state: "Read segment capacity and schedules",
  get_open_cycles: "Read open nomination cycle",
  get_nominations: "Read gas-day nominations",
  get_notices: "Read active notices",
  get_proposed_notice_terms: "Read synthetic notice terms",
  get_contract: "Verified contract rights",
  get_shipper: "Read shipper contact",
  get_network_topology: "Verified network topology",
  get_tariff_rule: "Read tariff rule",
  check_segment_capacity: "Checked segment capacity",
  apply_scheduling_priority: "Calculated tariff-priority recut",
  calculate_imbalance: "Calculated shipper imbalance",
  calculate_exposure: "Calculated projected exposure",
  assess_system_impact: "Assessed system impact",
  assess_flow_order_compliance: "Assessed flow-order compliance",
  stage_allocation: "Staged allocation for approval",
  draft_ebb_notice: "Staged EBB notice for approval",
  draft_shipper_message: "Staged shipper messages for approval",
  escalate_to_human: "Escalated for operator review",
  delegate_to_specialist: "Routed work to specialist",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && !Array.isArray(value) && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function numberValue(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(record: Record<string, unknown> | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function displaySummarySource(summary: string): string {
  return summary
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+-\s+(?=\*\*)/g, " · ")
    .replace(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})\b/g,
      (value) => formatCentralDateTime(value),
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip internal IDs that operators should not see; Technical view keeps the raw summary. */
export function operatorEventSummary(summary: string): string {
  return displaySummarySource(summary)
    .replace(
      /(?:\*\*|`)?\b(?:run(?:_id)?|workflow(?:_id)?|parent_run_id|trigger_ref)\b\s*[:=]?\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\*\*|`)?/gi,
      "",
    )
    .replace(
      /(?:\*\*|`)?\btrigger_type\b\s*[:=]?\s*[a-z][a-z0-9_]*(?:\*\*|`)?/gi,
      "",
    )
    .replace(
      /(?:\*\*|`)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\*\*|`)?/gi,
      "",
    )
    .replace(/\s*,(?:\s*,)+/g, ",")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/,\s+/g, ", ")
    .replace(/^[,;\s]+|[,;\s]+$/g, "")
    .replace(/,\s*([.])/g, "$1")
    .trim();
}

export function parseSummaryTokens(summary: string): SummaryToken[] {
  const source = displaySummarySource(summary);
  const tokens: SummaryToken[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ kind: "text", text: source.slice(cursor, index) });
    const token = match[0];
    if (token.startsWith("**")) {
      tokens.push({ kind: "strong", text: token.slice(2, -2).trim() });
    } else {
      tokens.push({ kind: "code", text: token.slice(1, -1).trim() });
    }
    cursor = index + token.length;
  }

  if (cursor < source.length) tokens.push({ kind: "text", text: source.slice(cursor) });
  if (tokens.length === 0 && source) tokens.push({ kind: "text", text: source });
  return tokens.filter((token) => token.text.length > 0);
}

export function plainEventSummary(summary: string): string {
  return parseSummaryTokens(summary).map((token) => token.text).join("").replace(/\s+/g, " ").trim();
}

export function isPlanningSummary(summary: string): boolean {
  return /^(?:i(?:'|’)ll|i will|i(?:'|’)m going to|i am going to|let me|first,?\s+i)\b/i
    .test(plainEventSummary(summary));
}

export function toolDisplayName(toolName: string | null): string {
  if (!toolName) return "Evidence step";
  return TOOL_LABELS[toolName] ?? titleCase(toolName);
}

function eventDisplayType(event: WorkflowEvent): string {
  if (event.event_type === "analysis_summary") return "Assessment";
  if (event.event_type === "decision") return "Decision";
  if (event.event_type === "escalation") return "Escalation";
  if (event.event_type === "error") return "Attention required";
  if (event.event_type === "tool_call" || event.event_type === "tool_result") return "Evidence";
  return titleCase(event.event_type);
}

function timelineItem(
  event: WorkflowEvent,
  mode: EventViewMode,
  summary = event.summary,
): EventTimelineItem {
  return {
    key: `${event.run_id}:${event.seq}`,
    event,
    summary: mode === "operator" ? operatorEventSummary(summary) : summary,
    displayType: eventDisplayType(event),
    failed: event.event_type === "error",
  };
}

export function buildEventTimeline(
  events: WorkflowEvent[],
  mode: EventViewMode,
): EventTimelineItem[] {
  if (mode === "technical") return events.map((event) => timelineItem(event, mode));

  const items: EventTimelineItem[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.event_type === "analysis_summary" && isPlanningSummary(event.summary)) continue;

    if (event.event_type === "tool_call") {
      const result = events[index + 1];
      const paired = result &&
        result.run_id === event.run_id &&
        result.tool_name === event.tool_name &&
        (result.event_type === "tool_result" || result.event_type === "error")
        ? result
        : undefined;
      const selected = paired ?? event;
      const failed = selected.event_type === "error";
      items.push({
        key: `${event.run_id}:${event.seq}-${paired?.seq ?? "open"}`,
        event: selected,
        pairedEvent: paired ? event : undefined,
        summary: `${toolDisplayName(event.tool_name)} · ${failed ? "failed" : paired ? "completed" : "started"}`,
        displayType: failed ? "Attention required" : "Evidence",
        failed,
      });
      if (paired) index += 1;
      continue;
    }

    items.push(timelineItem(event, mode));
  }
  return items;
}

export function timelineItemContains(item: EventTimelineItem, eventId: number | null): boolean {
  return eventId !== null &&
    (item.event.id === eventId || item.pairedEvent?.id === eventId);
}

export function extractProviderTelemetry(detail: Json | null): ProviderTelemetry | null {
  const provider = asRecord(asRecord(detail)?.provider);
  if (!provider) return null;
  const model = stringValue(provider, "model");
  const durationMs = numberValue(provider, "request_duration_ms");
  if (!model || durationMs === null) return null;
  return {
    model,
    durationMs,
    inputTokens: numberValue(provider, "input_tokens") ?? 0,
    outputTokens: numberValue(provider, "output_tokens") ?? 0,
    cacheCreationTokens: numberValue(provider, "cache_creation_input_tokens") ?? 0,
    cacheReadTokens: numberValue(provider, "cache_read_input_tokens") ?? 0,
  };
}

export function hasNonProviderDetail(detail: Json | null): boolean {
  const record = asRecord(detail);
  return record !== null && Object.keys(record).some((key) => key !== "provider");
}

function toolData(event: WorkflowEvent): Record<string, unknown> | null {
  const output = asRecord(event.tool_output);
  return asRecord(output?.data);
}

function addNumberFact(
  facts: AuditFact[],
  record: Record<string, unknown> | null,
  key: string,
  label: string,
  format: (value: number) => string,
): void {
  const value = numberValue(record, key);
  if (value !== null) facts.push({ label, value: format(value) });
}

function tierLabel(rank: number): string {
  if (rank === 1) return "Firm primary";
  if (rank === 2) return "Firm secondary";
  if (rank === 3) return "Interruptible";
  return `Tier ${rank}`;
}

export function extractKeyFacts(event: WorkflowEvent): AuditFact[] {
  const facts: AuditFact[] = [];
  const data = toolData(event);
  const tool = event.tool_name;

  if (tool === "get_scada_events") {
    const incident = asRecord(asArray(data?.events)[0]);
    const detail = asRecord(incident?.detail);
    const eventType = stringValue(incident, "event_type");
    const asset = stringValue(incident, "asset");
    if (eventType || asset) {
      facts.push({
        label: "Incident",
        value: [eventType ? titleCase(eventType) : null, asset].filter(Boolean).join(" · "),
      });
    }
    const segment = stringValue(incident, "segment_id");
    if (segment) facts.push({ label: "Affected segment", value: segment });
    addNumberFact(facts, detail, "derated_capacity_dth", "Derated capacity", (value) =>
      `${formatDth(value)} Dth`
    );
    const occurredAtDisplay = stringValue(incident, "occurred_at_ct_display");
    const occurredAt = stringValue(incident, "occurred_at");
    if (occurredAtDisplay || occurredAt) {
      facts.push({
        label: "Occurred",
        value: occurredAtDisplay ?? formatCentralDateTime(occurredAt),
      });
    }
  } else if (tool === "get_segment_state") {
    addNumberFact(facts, data, "operating_capacity_dth", "Operating capacity", (value) =>
      `${formatDth(value)} Dth`
    );
    addNumberFact(facts, data, "scheduled_total_dth", "Scheduled throughput", (value) =>
      `${formatDth(value)} Dth`
    );
    const shortfall = numberValue(data, "shortfall_dth");
    const available = numberValue(data, "headroom_dth");
    if (shortfall !== null && shortfall > 0) {
      facts.push({ label: "Capacity shortfall", value: `${formatDth(shortfall)} Dth` });
    } else if (available !== null) {
      facts.push({ label: "Available capacity", value: `${formatDth(Math.max(0, available))} Dth` });
    }
  } else if (tool === "get_open_cycles") {
    const cycle = asRecord(asArray(data?.cycles)[0]);
    const type = stringValue(cycle, "cycle_type");
    if (type) facts.push({ label: "Open cycle", value: type.toUpperCase() });
    const deadline = stringValue(cycle, "deadline_ct_display");
    if (deadline) facts.push({ label: "Deadline", value: deadline });
    addNumberFact(facts, cycle, "sim_minutes_remaining", "Time remaining", (value) =>
      `${formatDth(value)} minutes`
    );
  } else if (tool === "get_nominations") {
    const nominations = asArray(data?.nominations).map(asRecord).filter(Boolean);
    if (nominations.length > 0) {
      const nominated = nominations.reduce(
        (total, row) => total + (numberValue(row, "nominated_dth") ?? 0),
        0,
      );
      const scheduled = nominations.reduce(
        (total, row) => total + (numberValue(row, "scheduled_dth") ?? 0),
        0,
      );
      facts.push({ label: "Nominations", value: `${nominations.length} shipper positions` });
      facts.push({ label: "Total nominated", value: `${formatDth(nominated)} Dth` });
      facts.push({ label: "Total scheduled", value: `${formatDth(scheduled)} Dth` });
    }
  } else if (tool === "apply_scheduling_priority") {
    addNumberFact(facts, data, "operating_capacity_dth", "Operating capacity", (value) =>
      `${formatDth(value)} Dth`
    );
    addNumberFact(facts, data, "scheduled_total_dth", "Scheduled total", (value) =>
      `${formatDth(value)} Dth`
    );
    const factor = stringValue(data, "proration_factor_str");
    if (factor) facts.push({ label: "Proration factor", value: factor });
    const bindingTier = numberValue(data, "binding_tier");
    if (bindingTier !== null) facts.push({ label: "Binding tier", value: tierLabel(bindingTier) });
    const firmProrated = booleanValue(data, "firm_prorated");
    if (firmProrated !== null) {
      facts.push({ label: "Firm service", value: firmProrated ? "Prorated — escalation" : "Unchanged" });
    }
    for (const value of asArray(data?.allocations)) {
      const allocation = asRecord(value);
      const cut = numberValue(allocation, "cut_dth");
      const shipper = stringValue(allocation, "shipper_id");
      const scheduled = numberValue(allocation, "scheduled_dth");
      if (shipper && cut !== null && cut > 0) {
        facts.push({
          label: `${shipper} recut`,
          value: `${formatDth(cut)} Dth cut · ${formatDth(scheduled ?? 0)} Dth scheduled`,
        });
      }
    }
  } else if (tool === "assess_flow_order_compliance") {
    const terms = asRecord(data?.terms);
    const tolerance = asRecord(terms?.tolerance);
    const rate = asRecord(terms?.penalty);
    const impact = asRecord(data?.system_impact);
    const stage = stringValue(terms, "stage");
    if (stage) facts.push({ label: "Notice stage", value: stage });
    const tolerancePct = numberValue(tolerance, "value_pct");
    if (tolerancePct !== null) facts.push({ label: "Tolerance", value: `±${tolerancePct}%` });
    const rateCents = numberValue(rate, "rate_cents_dth");
    if (rateCents !== null) {
      facts.push({ label: "Synthetic tariff rate", value: `${formatMoneyCents(rateCents)}/Dth` });
    }
    addNumberFact(facts, impact, "aggregate_exposure_cents", "Aggregate projected exposure",
      formatMoneyCents);
    const violators = asArray(impact?.violators).filter((value): value is string =>
      typeof value === "string"
    );
    if (violators.length > 0) facts.push({ label: "Outside tolerance", value: violators.join(", ") });
    for (const value of asArray(data?.assessments)) {
      const assessment = asRecord(value);
      const imbalance = asRecord(assessment?.imbalance);
      const exposure = asRecord(assessment?.exposure);
      if (booleanValue(imbalance, "in_violation") !== true) continue;
      const shipper = stringValue(assessment, "shipper_id");
      const formula = stringValue(exposure, "formula_string");
      if (shipper && formula) facts.push({ label: `${shipper} exposure`, value: formula });
    }
  } else if (tool === "stage_allocation") {
    facts.push({ label: "Human gate", value: "Allocation staged and awaiting approval" });
  } else if (tool === "draft_ebb_notice") {
    facts.push({ label: "Human gate", value: "EBB notice staged and not yet posted" });
    const effective = stringValue(data, "effective");
    if (effective) facts.push({ label: "Effective", value: titleCase(effective) });
  } else if (tool === "draft_shipper_message") {
    addNumberFact(facts, data, "recipient_count", "Affected recipients", (value) =>
      `${formatDth(value)} messages`
    );
    facts.push({ label: "Human gate", value: "Messages staged and not yet delivered" });
  }

  const detail = asRecord(event.detail);
  if (event.event_type === "decision" && detail) {
    const specialist = stringValue(detail, "specialist");
    if (specialist) facts.push({ label: "Specialist", value: titleCase(specialist) });
    const actionType = stringValue(detail, "action_type");
    if (actionType) facts.push({ label: "Action", value: titleCase(actionType) });
    const decision = stringValue(detail, "decision");
    if (decision) facts.push({ label: "Decision", value: titleCase(decision) });
    const decidedBy = stringValue(detail, "decided_by");
    if (decidedBy) facts.push({ label: "Decided by", value: decidedBy });
  }

  return facts;
}

export function hasRawTechnicalData(event: WorkflowEvent): boolean {
  return hasNonProviderDetail(event.detail) ||
    event.tool_input !== null ||
    event.tool_output !== null;
}
