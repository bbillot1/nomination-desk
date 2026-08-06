/**
 * Read-only browser types generated from the connected Supabase schema on 2026-08-05.
 *
 * The application uses only Row types. Browser roles have no write grants and all operator
 * mutations must pass through the gated Edge Functions.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface ActualFlowRow {
  flow_hour: number;
  gas_day: string;
  id: number;
  point_id: string;
  shipper_id: string;
  volume_dth: number;
}

export interface AgentEventRow {
  agent_name: string;
  citation: string | null;
  created_at: string | null;
  detail: Json | null;
  event_type: string;
  id: number;
  run_id: string;
  seq: number;
  skill_used: string | null;
  summary: string;
  tool_input: Json | null;
  tool_name: string | null;
  tool_output: Json | null;
  workflow_id: string;
}

export interface AgentRunRow {
  ended_at: string | null;
  error_text: string | null;
  gas_day: string | null;
  id: string;
  parent_run_id: string | null;
  started_at: string | null;
  status: string;
  trigger_ref: string | null;
  trigger_type: string;
  workflow_id: string;
}

export interface ContractRow {
  contract_number: string;
  effective_end: string;
  effective_start: string;
  id: string;
  mdq_dth: number | null;
  pipeline_id: string;
  primary_delivery_point: string | null;
  primary_receipt_point: string | null;
  service_type: string;
  shipper_id: string;
  storage_point: string | null;
  storage_rights_dth: number | null;
}

export interface CycleRow {
  cycle_type: string;
  deadline_ct: string;
  gas_day: string;
  id: string;
  pipeline_id: string;
  status: string;
}

export interface NominationRow {
  contract_id: string;
  created_at: string | null;
  cut_reason: string | null;
  cycle_id: string;
  delivery_point: string;
  id: string;
  nominated_dth: number;
  priority_rank: number;
  receipt_point: string;
  scheduled_dth: number | null;
  shipper_id: string;
  status: string;
}

export interface NoticeRow {
  affected_segment: string | null;
  body_text: string;
  created_at: string | null;
  derate_to_dth: number | null;
  effective_end: string | null;
  effective_start: string | null;
  headline: string;
  id: string;
  notice_type: string;
  penalty_rate_cents_dth: number | null;
  pipeline_id: string;
  posted_at: string | null;
  stage: string | null;
  status: string;
  tolerance_pct: number | null;
}

export interface PendingActionRow {
  action_type: string;
  created_at: string | null;
  decided_at: string | null;
  decided_by: string | null;
  dollar_impact_cents: number | null;
  executed_at: string | null;
  id: string;
  payload: Json;
  rationale: string;
  result: Json | null;
  run_id: string;
  status: string;
  title: string;
}

export interface PointRow {
  corridor_seq: number;
  id: string;
  meter_id: string | null;
  name: string;
  pipeline_id: string;
  point_type: string;
}

export interface ScenarioStateRow {
  answer_key: Json;
  created_at: string | null;
  gas_day: string;
  id: number;
  params: Json;
  phase: string;
  seed: string;
  sim_clock_ct: string;
  updated_at: string | null;
}

export interface ScadaEventRow {
  acknowledged: boolean | null;
  asset: string;
  detail: Json;
  event_type: string;
  id: string;
  occurred_at: string;
  pipeline_id: string;
  segment_id: string | null;
}

export interface SegmentRow {
  design_capacity_dth: number;
  from_point: string;
  id: string;
  name: string;
  operating_capacity_dth: number;
  pipeline_id: string;
  seq: number;
  to_point: string;
}

export interface ShipperRow {
  contact_email: string | null;
  duns: string | null;
  id: string;
  name: string;
  shipper_type: string;
}

export interface TariffRuleRow {
  citation: string;
  id: string;
  pipeline_id: string;
  rule_key: string;
  rule_type: string;
  value_numeric: number | null;
  value_text: string | null;
}

type ReadonlyTable<Row extends object> = {
  Row: Row & Record<string, unknown>;
  Insert: Row & Record<string, unknown>;
  Update: Partial<Row> & Record<string, unknown>;
  Relationships: [];
};

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      actual_flows: ReadonlyTable<ActualFlowRow>;
      agent_events: ReadonlyTable<AgentEventRow>;
      agent_runs: ReadonlyTable<AgentRunRow>;
      contracts: ReadonlyTable<ContractRow>;
      cycles: ReadonlyTable<CycleRow>;
      nominations: ReadonlyTable<NominationRow>;
      notices: ReadonlyTable<NoticeRow>;
      pending_actions: ReadonlyTable<PendingActionRow>;
      points: ReadonlyTable<PointRow>;
      scenario_state: ReadonlyTable<ScenarioStateRow>;
      scada_events: ReadonlyTable<ScadaEventRow>;
      segments: ReadonlyTable<SegmentRow>;
      shippers: ReadonlyTable<ShipperRow>;
      tariff_rules: ReadonlyTable<TariffRuleRow>;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

export type TableName = keyof Database["public"]["Tables"];
export type Tables<Name extends TableName> = Database["public"]["Tables"][Name]["Row"];
