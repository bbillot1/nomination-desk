/**
 * Shared tool contracts.
 *
 * Tool modules are deliberately independent of Supabase's query-builder types. They depend on
 * the narrow ToolDatabase interface below, which makes every handler directly testable with
 * an in-memory database while the production adapter uses Supabase.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { [key: string]: JsonValue | undefined }
  | JsonValue[];

export type ToolTable =
  | "actual_flows"
  | "contracts"
  | "cycles"
  | "nominations"
  | "notices"
  | "pipelines"
  | "points"
  | "scada_events"
  | "scenario_state"
  | "segments"
  | "shippers"
  | "tariff_rules";

export type ToolFilter =
  | { op: "eq"; column: string; value: JsonPrimitive }
  | { op: "in"; column: string; values: JsonPrimitive[] }
  | { op: "is"; column: string; value: null | boolean };

export interface ToolOrder {
  column: string;
  ascending?: boolean;
}

export interface ToolSelectRequest {
  table: ToolTable;
  columns?: string;
  filters?: ToolFilter[];
  order?: ToolOrder[];
  /** Hard server-side cap. The production adapter defaults to 500 when omitted. */
  limit?: number;
}

export interface ToolDatabase {
  select<T>(request: ToolSelectRequest): Promise<T[]>;
}

export type PendingActionType =
  | "apply_allocation"
  | "post_ebb_notice"
  | "send_shipper_message"
  | "acknowledge_escalation";

export interface PendingActionDraft {
  action_type: PendingActionType;
  title: string;
  rationale: string;
  payload: JsonValue;
  dollar_impact_cents?: number | null;
}

export interface NoticeDraft {
  id: string;
  pipeline_id: string;
  notice_type: "ofo" | "efo" | "capacity_constraint" | "maintenance";
  headline: string;
  body_text: string;
  stage?: string | null;
  tolerance_pct?: number | null;
  penalty_rate_cents_dth?: number | null;
  affected_segment?: string | null;
  derate_to_dth?: number | null;
}

export interface ToolActionStore {
  stage(runId: string, draft: PendingActionDraft): Promise<{ pending_action_id: string }>;
  stageNotice(
    runId: string,
    notice: NoticeDraft,
    action: Omit<PendingActionDraft, "action_type" | "payload">,
  ): Promise<{ notice_id: string; pending_action_id: string }>;
}

export interface ToolContext {
  db: ToolDatabase;
  runId?: string;
  actions?: ToolActionStore;
}

export interface ToolErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
}

export type ToolResult<T extends JsonValue = JsonValue> =
  | { ok: true; data: T; citation?: string }
  | { ok: false; error: ToolErrorDetail };

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, JsonValue>;
  required?: string[];
  additionalProperties: false;
}

/** Anthropic tool-use definition shape; also straightforward to adapt to MCP. */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  /** Strict tool use guarantees schema-valid model inputs on supported Claude models. */
  strict?: boolean;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolResult>;

export class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ToolFailure";
  }
}

export function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolFailure("INVALID_INPUT", `${key} must be a non-empty string`);
  }
  return value;
}

export function optionalString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ToolFailure("INVALID_INPUT", `${key} must be a non-empty string when provided`);
  }
  return value;
}

export function optionalBoolean(
  input: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ToolFailure("INVALID_INPUT", `${key} must be a boolean when provided`);
  }
  return value;
}

export function requiredNumber(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolFailure("INVALID_INPUT", `${key} must be a finite number`);
  }
  return value;
}

export function requiredInteger(input: Record<string, unknown>, key: string): number {
  const value = requiredNumber(input, key);
  if (!Number.isInteger(value)) {
    throw new ToolFailure("INVALID_INPUT", `${key} must be an integer`);
  }
  return value;
}

export function optionalNumber(
  input: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolFailure("INVALID_INPUT", `${key} must be a finite number when provided`);
  }
  return value;
}

export function requiredArray(input: Record<string, unknown>, key: string): unknown[] {
  const value = input[key];
  if (!Array.isArray(value)) {
    throw new ToolFailure("INVALID_INPUT", `${key} must be an array`);
  }
  return value;
}

export function requiredDate(input: Record<string, unknown>, key: string): string {
  const value = requiredString(input, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))) {
    throw new ToolFailure("INVALID_INPUT", `${key} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

export function requiredIdentifier(input: Record<string, unknown>, key: string): string {
  const value = requiredString(input, key);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
    throw new ToolFailure(
      "INVALID_INPUT",
      `${key} may contain only letters, numbers, underscores, and hyphens`,
    );
  }
  return value;
}

export function optionalEnum<const T extends string>(
  input: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = optionalString(input, key);
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) {
    throw new ToolFailure("INVALID_INPUT", `${key} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function requiredObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new ToolFailure("INVALID_INPUT", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

export function requiredActionContext(context: ToolContext): {
  runId: string;
  actions: ToolActionStore;
} {
  if (!context.runId || !context.actions) {
    throw new ToolFailure("ACTION_CONTEXT_MISSING", "this staging tool requires an active run");
  }
  return { runId: context.runId, actions: context.actions };
}
