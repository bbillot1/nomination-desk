-- Phase 6 deterministic scenario loading (BUILD_SPEC §12).
--
-- The generator runs the shared TypeScript engines. This RPC applies the already-validated
-- result atomically so the browser can never observe a partially loaded seed.

create or replace function public.load_generated_scenario(
  p_seed text,
  p_params jsonb,
  p_answer_key jsonb,
  p_nominations jsonb,
  p_actual_flows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gas_day date;
  v_derated_capacity bigint;
  v_cemk_nomination bigint;
  v_sabt_nomination bigint;
  v_stage text;
  v_tolerance numeric;
  v_penalty_rate bigint;
  v_row_count int;
begin
  if exists (
    select 1 from public.agent_runs where status in ('running', 'queued')
  ) then
    raise exception 'an agent run is still active';
  end if;

  if p_seed !~ '^SCN-[A-Z0-9]{4,12}$' then
    raise exception 'invalid scenario seed';
  end if;
  if jsonb_typeof(p_params) <> 'object'
    or jsonb_typeof(p_answer_key) <> 'object'
    or jsonb_typeof(p_nominations) <> 'array'
    or jsonb_typeof(p_actual_flows) <> 'array'
  then
    raise exception 'invalid generated scenario payload';
  end if;

  v_derated_capacity := (p_params ->> 'derated_capacity_dth')::bigint;
  v_cemk_nomination := (p_params #>> '{it_nominations_dth,CEMK}')::bigint;
  v_sabt_nomination := (p_params #>> '{it_nominations_dth,SABT}')::bigint;
  v_stage := p_params #>> '{notice,stage}';
  v_tolerance := (p_params #>> '{notice,tolerance_pct}')::numeric;
  v_penalty_rate := (p_params #>> '{notice,penalty_rate_cents_dth}')::bigint;

  if v_derated_capacity not between 780000 and 860000
    or v_derated_capacity % 10000 <> 0
    or v_cemk_nomination not between 80000 and 180000
    or v_cemk_nomination % 10000 <> 0
    or v_sabt_nomination not between 80000 and 180000
    or v_sabt_nomination % 10000 <> 0
    or p_params ->> 'incident_time_ct' <> '16:15'
  then
    raise exception 'generated scenario parameters are outside allowed bounds';
  end if;

  if not (
    (v_stage = 'Stage 2' and v_tolerance = 5 and v_penalty_rate = 2500)
    or (v_stage = 'Stage 3' and v_tolerance = 3 and v_penalty_rate = 5000)
  ) then
    raise exception 'generated notice terms are invalid';
  end if;
  if jsonb_array_length(p_nominations) <> 5
    or jsonb_array_length(p_actual_flows) <> 30
  then
    raise exception 'generated scenario row counts are invalid';
  end if;
  if 730000
      + (p_answer_key #>> '{recut,scheduled_dth,CEMK}')::bigint
      + (p_answer_key #>> '{recut,scheduled_dth,SABT}')::bigint
      <> v_derated_capacity
  then
    raise exception 'generated recut does not tie to derated capacity';
  end if;

  select gas_day into strict v_gas_day
  from public.scenario_state
  where id = 1;

  update public.pending_actions
  set status = 'rejected',
      decided_by = 'scenario-loader',
      decided_at = now(),
      result = jsonb_build_object('reason', 'scenario replaced')
  where status = 'pending'
    and run_id in (
      select id from public.agent_runs where status = 'awaiting_approval'
    );

  update public.agent_runs
  set status = 'complete',
      ended_at = now()
  where status = 'awaiting_approval';

  truncate table
    public.agent_events,
    public.pending_actions,
    public.agent_runs,
    public.notices,
    public.scada_events;

  update public.segments
  set operating_capacity_dth = design_capacity_dth
  where id = 'SEG-2';

  with incoming as (
    select *
    from jsonb_to_recordset(p_nominations) as nomination(
      id text,
      shipper_id text,
      nominated_dth bigint,
      scheduled_dth bigint,
      status text
    )
  )
  update public.nominations as nomination
  set nominated_dth = incoming.nominated_dth,
      scheduled_dth = incoming.scheduled_dth,
      status = 'scheduled',
      cut_reason = null
  from incoming
  where nomination.id = incoming.id
    and nomination.shipper_id = incoming.shipper_id
    and incoming.id in (
      'NOM-TIMELY-LSPP',
      'NOM-TIMELY-ABCL',
      'NOM-TIMELY-NTGU',
      'NOM-TIMELY-CEMK',
      'NOM-TIMELY-SABT'
    )
    and incoming.nominated_dth >= 0
    and incoming.scheduled_dth between 0 and incoming.nominated_dth;

  get diagnostics v_row_count = row_count;
  if v_row_count <> 5 then
    raise exception 'generated nomination rows are incomplete';
  end if;

  delete from public.actual_flows
  where gas_day = v_gas_day;

  insert into public.actual_flows (
    point_id,
    shipper_id,
    gas_day,
    flow_hour,
    volume_dth
  )
  select
    flow.point_id,
    flow.shipper_id,
    v_gas_day,
    flow.flow_hour,
    flow.volume_dth
  from jsonb_to_recordset(p_actual_flows) as flow(
    point_id text,
    shipper_id text,
    flow_hour int,
    volume_dth bigint
  )
  where flow.shipper_id in ('LSPP', 'ABCL', 'NTGU', 'CEMK', 'SABT')
    and flow.flow_hour between 0 and 5
    and flow.volume_dth >= 0;

  get diagnostics v_row_count = row_count;
  if v_row_count <> 30 then
    raise exception 'generated flow rows are incomplete';
  end if;

  update public.scenario_state
  set seed = p_seed,
      phase = 'baseline',
      sim_clock_ct = (v_gas_day + time '16:00') at time zone 'America/Chicago',
      params = p_params,
      answer_key = p_answer_key,
      updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'phase', 'baseline',
    'gas_day', v_gas_day,
    'seed', p_seed
  );
end;
$$;

-- The historic RPC name remains for API compatibility, but reset now replays whichever seed
-- is active. Generated actual-flow rows remain in place; only incident/runtime state is cleared.
create or replace function public.reset_hero_scenario()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gas_day date;
  v_seed text;
  v_params jsonb;
  v_answer_key jsonb;
begin
  if exists (
    select 1 from public.agent_runs where status in ('running', 'queued')
  ) then
    raise exception 'an agent run is still active';
  end if;

  select gas_day, seed, params, answer_key
  into strict v_gas_day, v_seed, v_params, v_answer_key
  from public.scenario_state
  where id = 1;

  update public.pending_actions
  set status = 'rejected',
      decided_by = 'scenario-reset',
      decided_at = now(),
      result = jsonb_build_object('reason', 'scenario reset')
  where status = 'pending'
    and run_id in (
      select id from public.agent_runs where status = 'awaiting_approval'
    );

  update public.agent_runs
  set status = 'complete',
      ended_at = now()
  where status = 'awaiting_approval';

  truncate table
    public.agent_events,
    public.pending_actions,
    public.agent_runs,
    public.notices,
    public.scada_events;

  update public.segments
  set operating_capacity_dth = design_capacity_dth
  where id = 'SEG-2';

  update public.nominations
  set nominated_dth = case shipper_id
        when 'LSPP' then 250000
        when 'ABCL' then 300000
        when 'NTGU' then 180000
        when 'CEMK' then (v_params #>> '{it_nominations_dth,CEMK}')::bigint
        when 'SABT' then (v_params #>> '{it_nominations_dth,SABT}')::bigint
      end,
      scheduled_dth = case shipper_id
        when 'LSPP' then 250000
        when 'ABCL' then 300000
        when 'NTGU' then 180000
        when 'CEMK' then (v_answer_key #>> '{timely,scheduled_dth,CEMK}')::bigint
        when 'SABT' then (v_answer_key #>> '{timely,scheduled_dth,SABT}')::bigint
      end,
      status = 'scheduled',
      cut_reason = null
  where shipper_id in ('LSPP', 'ABCL', 'NTGU', 'CEMK', 'SABT');

  update public.scenario_state
  set phase = 'baseline',
      sim_clock_ct = (v_gas_day + time '16:00') at time zone 'America/Chicago',
      updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'phase', 'baseline',
    'gas_day', v_gas_day,
    'seed', v_seed
  );
end;
$$;

revoke all on function public.load_generated_scenario(text, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.load_generated_scenario(text, jsonb, jsonb, jsonb, jsonb)
  to service_role;

revoke all on function public.reset_hero_scenario()
  from public, anon, authenticated;
grant execute on function public.reset_hero_scenario()
  to service_role;
