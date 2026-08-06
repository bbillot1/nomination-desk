-- Nomination Desk schema (BUILD_SPEC §5).
--
-- Intentional topology extensions are documented in docs/schema-deviations.md:
--   1. points.point_type accepts 'junction'.
--   2. points.corridor_seq records downstream position.

-- ============ SCENARIO STATE ============

create table scenario_state (
  id             int primary key default 1 check (id = 1),
  seed           text not null,
  gas_day        date not null,
  sim_clock_ct   timestamptz not null,
  phase          text not null default 'baseline'
    check (phase in ('baseline','incident_posted','recut_pending','recut_applied',
                     'comms_pending','resolved','needs_review')),
  params         jsonb not null,
  answer_key     jsonb not null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- ============ OPERATIONS SOR DOMAIN ============

create table pipelines (
  id          text primary key,
  name        text not null,
  kind        text not null check (kind in ('interstate','intrastate')),
  operator    text not null,
  tariff_ref  text
);

create table points (
  id           text primary key,
  pipeline_id  text not null references pipelines(id),
  name         text not null,
  point_type   text not null check (point_type in ('receipt','delivery','storage','junction')),
  corridor_seq int not null,
  meter_id     text
);

create table segments (
  id                     text primary key,
  pipeline_id            text not null references pipelines(id),
  name                   text not null,
  from_point             text not null references points(id),
  to_point               text not null references points(id),
  design_capacity_dth    bigint not null,
  operating_capacity_dth bigint not null,
  seq                    int not null
);

create table shippers (
  id            text primary key,
  name          text not null,
  duns          text,
  shipper_type  text not null,
  contact_email text
);

create table contracts (
  id                     text primary key,
  shipper_id             text not null references shippers(id),
  pipeline_id            text not null references pipelines(id),
  contract_number        text not null,
  service_type           text not null check (service_type in ('FT','IT')),
  mdq_dth                bigint,
  primary_receipt_point  text references points(id),
  primary_delivery_point text references points(id),
  storage_rights_dth     bigint default 0,
  storage_point          text references points(id),
  effective_start        date not null,
  effective_end          date not null
);

create table tariff_rules (
  id            text primary key,
  pipeline_id   text not null references pipelines(id),
  rule_type     text not null,
  rule_key      text not null,
  value_numeric numeric,
  value_text    text,
  citation      text not null
);

-- ============ EBB DOMAIN ============

create table cycles (
  id          text primary key,
  pipeline_id text not null references pipelines(id),
  gas_day     date not null,
  cycle_type  text not null check (cycle_type in ('timely','evening','id1','id2','id3')),
  deadline_ct timestamptz not null,
  status      text not null default 'closed' check (status in ('open','closed','scheduled'))
);

create table nominations (
  id             text primary key,
  cycle_id       text not null references cycles(id),
  contract_id    text not null references contracts(id),
  shipper_id     text not null references shippers(id),
  receipt_point  text not null references points(id),
  delivery_point text not null references points(id),
  priority_rank  int  not null check (priority_rank in (1,2,3)),
  nominated_dth  bigint not null,
  scheduled_dth  bigint,
  status         text not null default 'scheduled'
    check (status in ('submitted','scheduled','cut','superseded')),
  cut_reason     text,
  created_at     timestamptz default now()
);

create table notices (
  id               text primary key,
  pipeline_id      text not null references pipelines(id),
  notice_type      text not null
    check (notice_type in ('ofo','efo','capacity_constraint','maintenance')),
  headline         text not null,
  body_text        text not null,
  stage            text,
  tolerance_pct    numeric,
  penalty_rate_cents_dth bigint,
  affected_segment text references segments(id),
  derate_to_dth    bigint,
  effective_start  timestamptz,
  effective_end    timestamptz,
  status           text not null default 'draft' check (status in ('draft','posted')),
  posted_at        timestamptz,
  created_at       timestamptz default now(),
  constraint notices_posting_consistent check (
    (status = 'draft'  and posted_at is null and effective_start is null) or
    (status = 'posted' and posted_at is not null and effective_start is not null)
  )
);

-- ============ SCADA / HISTORIAN DOMAIN ============

create table scada_events (
  id          text primary key,
  pipeline_id text not null references pipelines(id),
  event_type  text not null,
  asset       text not null,
  segment_id  text references segments(id),
  detail      jsonb not null,
  occurred_at timestamptz not null,
  acknowledged boolean default false
);

-- Gas-day aligned: flow_hour 0 = 09:00 CT on gas_day, flow_hour 23 = 08:00 CT next day.
-- Measured at DELIVERY meters: rows record each shipper's takes at its delivery point.
create table actual_flows (
  id         bigserial primary key,
  point_id   text not null references points(id),
  shipper_id text not null references shippers(id),
  gas_day    date not null,
  flow_hour  int  not null check (flow_hour between 0 and 23),
  volume_dth bigint not null,
  unique (gas_day, shipper_id, point_id, flow_hour)
);
create index on actual_flows (gas_day, shipper_id, point_id);

-- ============ AGENT DOMAIN ============

create table agent_runs (
  id            text primary key,
  workflow_id   text not null,
  parent_run_id text references agent_runs(id),
  trigger_type  text not null
    check (trigger_type in ('scada_event','approval_continuation','manual')),
  trigger_ref   text,
  status        text not null default 'running'
    check (status in ('queued','running','awaiting_approval','complete','failed')),
  gas_day       date,
  started_at    timestamptz default now(),
  ended_at      timestamptz,
  error_text    text
);
create index on agent_runs (workflow_id);
create unique index agent_runs_workflow_trigger on agent_runs (workflow_id, trigger_type)
  where status <> 'failed';

-- APPEND ONLY. No updates, no deletes.
create table agent_events (
  id          bigserial primary key,
  run_id      text not null references agent_runs(id),
  workflow_id text not null,
  seq         int not null,
  agent_name  text not null
    check (agent_name in ('supervisor','scheduling','exception','communications')),
  event_type  text not null
    check (event_type in ('analysis_summary','tool_call','tool_result','decision',
                          'escalation','error')),
  summary     text not null,
  detail      jsonb,
  tool_name   text,
  tool_input  jsonb,
  tool_output jsonb,
  citation    text,
  skill_used  text,
  created_at  timestamptz default now(),
  unique (run_id, seq)
);
create index on agent_events (workflow_id);

create or replace function agent_events_append_only()
returns trigger
language plpgsql
as $fn$
begin
  raise exception 'agent_events is append-only; % is not permitted', tg_op;
end;
$fn$;

create trigger agent_events_no_mutation
  before update or delete on agent_events
  for each row execute function agent_events_append_only();

create table pending_actions (
  id            text primary key,
  run_id        text not null references agent_runs(id),
  action_type   text not null
    check (action_type in ('apply_allocation','post_ebb_notice','send_shipper_message',
                           'acknowledge_escalation')),
  title         text not null,
  rationale     text not null,
  payload       jsonb not null,
  dollar_impact_cents bigint,
  status        text not null default 'pending'
    check (status in ('pending','executing','executed','rejected','failed')),
  decided_by    text,
  decided_at    timestamptz,
  executed_at   timestamptz,
  result        jsonb,
  created_at    timestamptz default now()
);
create index on pending_actions (run_id);
create index on pending_actions (status);

create table skills (
  id                  text primary key,
  name                text not null,
  trigger_description text not null,
  body_md             text not null,
  version             text not null,
  author              text
);
