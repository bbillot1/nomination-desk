-- Transactional staging, approval, and simulation primitives for Phase 3.
-- All functions are callable only by the service-role database role.

create or replace function public.stage_pending_action(
  p_id text,
  p_run_id text,
  p_action_type text,
  p_title text,
  p_rationale text,
  p_payload jsonb,
  p_dollar_impact_cents bigint default null
)
returns text
language sql
security invoker
set search_path = ''
as $$
  insert into public.pending_actions (
    id, run_id, action_type, title, rationale, payload, dollar_impact_cents
  ) values (
    p_id, p_run_id, p_action_type, p_title, p_rationale, p_payload, p_dollar_impact_cents
  )
  returning id;
$$;

create or replace function public.stage_ebb_notice(
  p_notice jsonb,
  p_pending_action_id text,
  p_run_id text,
  p_title text,
  p_rationale text,
  p_dollar_impact_cents bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_notice_id text := p_notice->>'id';
begin
  if v_notice_id is null or v_notice_id = '' then
    raise exception 'notice id is required';
  end if;

  insert into public.notices (
    id, pipeline_id, notice_type, headline, body_text, stage, tolerance_pct,
    penalty_rate_cents_dth, affected_segment, derate_to_dth, status
  ) values (
    v_notice_id,
    p_notice->>'pipeline_id',
    p_notice->>'notice_type',
    p_notice->>'headline',
    p_notice->>'body_text',
    p_notice->>'stage',
    (p_notice->>'tolerance_pct')::numeric,
    (p_notice->>'penalty_rate_cents_dth')::bigint,
    p_notice->>'affected_segment',
    (p_notice->>'derate_to_dth')::bigint,
    'draft'
  );

  insert into public.pending_actions (
    id, run_id, action_type, title, rationale, payload, dollar_impact_cents
  ) values (
    p_pending_action_id,
    p_run_id,
    'post_ebb_notice',
    p_title,
    p_rationale,
    jsonb_build_object('notice_id', v_notice_id),
    p_dollar_impact_cents
  );

  return jsonb_build_object(
    'notice_id', v_notice_id,
    'pending_action_id', p_pending_action_id
  );
end;
$$;

create or replace function public.execute_approval(
  p_pending_action_id text,
  p_decision text,
  p_decided_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_action public.pending_actions%rowtype;
  v_workflow_id text;
  v_allocation jsonb;
  v_result jsonb;
  v_queued_run_id text;
  v_notice_id text;
  v_seq int;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject';
  end if;
  if p_decided_by is null or btrim(p_decided_by) = '' then
    raise exception 'decided_by is required';
  end if;

  select * into v_action
  from public.pending_actions
  where id = p_pending_action_id
  for update;

  if not found then
    raise exception 'pending action not found';
  end if;

  select workflow_id into v_workflow_id
  from public.agent_runs
  where id = v_action.run_id;

  -- Idempotent terminal result. Also surface a queued continuation if the first HTTP request
  -- committed but ended before it could claim the outbox row.
  if v_action.status <> 'pending' then
    if v_action.action_type = 'apply_allocation' then
      select id into v_queued_run_id
      from public.agent_runs
      where workflow_id = v_workflow_id
        and trigger_type = 'approval_continuation'
        and status <> 'failed'
      order by started_at desc
      limit 1;
    end if;
    return coalesce(v_action.result, '{}'::jsonb) || jsonb_build_object(
      'pending_action_id', v_action.id,
      'status', v_action.status,
      'queued_run_id', v_queued_run_id
    );
  end if;

  if p_decision = 'reject' then
    v_result := jsonb_build_object('decision', 'rejected', 'executed', false);
    update public.pending_actions
    set status = 'rejected',
        decided_by = p_decided_by,
        decided_at = now(),
        result = v_result
    where id = v_action.id;

    -- A rejected action stops this bounded workflow. Reject siblings so none can later
    -- execute against a needs-review scenario.
    update public.pending_actions
    set status = 'rejected',
        decided_by = p_decided_by,
        decided_at = now(),
        result = jsonb_build_object('decision', 'cancelled_after_sibling_rejection')
    where run_id = v_action.run_id
      and id <> v_action.id
      and status = 'pending';

    update public.scenario_state set phase = 'needs_review', updated_at = now() where id = 1;
  else
    update public.pending_actions
    set status = 'executing', decided_by = p_decided_by, decided_at = now()
    where id = v_action.id;

    case v_action.action_type
      when 'apply_allocation' then
        if jsonb_array_length(v_action.payload->'allocations') = 0 then
          raise exception 'allocation payload is empty';
        end if;

        for v_allocation in
          select value from jsonb_array_elements(v_action.payload->'allocations')
        loop
          update public.nominations
          set scheduled_dth = (v_allocation->>'scheduled_dth')::bigint,
              status = case
                when (v_allocation->>'cut_dth')::bigint > 0 then 'cut'
                else 'scheduled'
              end,
              cut_reason = nullif(v_allocation->>'cut_reason', '')
          where id = v_allocation->>'nomination_id';
          if not found then
            raise exception 'allocation nomination not found';
          end if;
        end loop;

        update public.scenario_state
        set phase = 'recut_applied', updated_at = now()
        where id = 1 and phase = 'recut_pending';
        if not found then
          raise exception 'scenario is not awaiting recut approval';
        end if;

        select id into v_queued_run_id
        from public.agent_runs
        where workflow_id = v_workflow_id
          and trigger_type = 'approval_continuation'
          and status <> 'failed'
        limit 1;

        if v_queued_run_id is null then
          v_queued_run_id := extensions.gen_random_uuid()::text;
          insert into public.agent_runs (
            id, workflow_id, parent_run_id, trigger_type, trigger_ref, status, gas_day
          )
          select
            v_queued_run_id, v_workflow_id, v_action.run_id,
            'approval_continuation', v_action.id, 'queued', gas_day
          from public.scenario_state where id = 1;
        end if;

        v_result := jsonb_build_object(
          'decision', 'approved',
          'executed', true,
          'queued_run_id', v_queued_run_id
        );

      when 'post_ebb_notice' then
        v_notice_id := v_action.payload->>'notice_id';
        update public.notices
        set status = 'posted',
            posted_at = (select sim_clock_ct from public.scenario_state where id = 1),
            effective_start = (select sim_clock_ct from public.scenario_state where id = 1)
        where id = v_notice_id and status = 'draft';
        if not found then
          raise exception 'draft notice not found';
        end if;
        v_result := jsonb_build_object(
          'decision', 'approved', 'executed', true, 'notice_id', v_notice_id
        );

      when 'send_shipper_message' then
        v_result := jsonb_build_object(
          'decision', 'approved',
          'executed', true,
          'delivered', true,
          'recipient_count', jsonb_array_length(v_action.payload->'recipients')
        );

      when 'acknowledge_escalation' then
        update public.scenario_state set phase = 'needs_review', updated_at = now() where id = 1;
        v_result := jsonb_build_object(
          'decision', 'approved', 'executed', true, 'acknowledged', true
        );

      else
        raise exception 'unsupported action type';
    end case;

    update public.pending_actions
    set status = 'executed',
        executed_at = now(),
        result = v_result
    where id = v_action.id;

    if v_action.action_type in ('post_ebb_notice', 'send_shipper_message')
       and not exists (
         select 1 from public.pending_actions
         where run_id = v_action.run_id
           and action_type in ('post_ebb_notice', 'send_shipper_message')
           and status <> 'executed'
       ) then
      update public.scenario_state set phase = 'resolved', updated_at = now() where id = 1;
    end if;
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
  from public.agent_events where run_id = v_action.run_id;

  insert into public.agent_events (
    run_id, workflow_id, seq, agent_name, event_type, summary, detail
  ) values (
    v_action.run_id,
    v_workflow_id,
    v_seq,
    'supervisor',
    'decision',
    case when p_decision = 'approve'
      then 'Human approved and executed the pending action.'
      else 'Human rejected the pending action; the scenario requires review.'
    end,
    jsonb_build_object(
      'pending_action_id', v_action.id,
      'action_type', v_action.action_type,
      'decision', p_decision,
      'decided_by', p_decided_by
    )
  );

  if not exists (
    select 1 from public.pending_actions
    where run_id = v_action.run_id and status in ('pending', 'executing')
  ) then
    update public.agent_runs
    set status = 'complete', ended_at = now()
    where id = v_action.run_id and status = 'awaiting_approval';
  end if;

  return v_result || jsonb_build_object(
    'pending_action_id', v_action.id,
    'status', case when p_decision = 'approve' then 'executed' else 'rejected' end
  );
end;
$$;

create or replace function public.simulate_trip_compressor()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scenario public.scenario_state%rowtype;
  v_event_id text := extensions.gen_random_uuid()::text;
  v_derated_capacity bigint;
  v_occurred_at timestamptz;
begin
  select * into v_scenario from public.scenario_state where id = 1 for update;
  if v_scenario.phase <> 'baseline' then
    raise exception 'scenario must be at baseline';
  end if;

  v_derated_capacity := (v_scenario.params->>'derated_capacity_dth')::bigint;
  v_occurred_at := (
    v_scenario.gas_day + (v_scenario.params->>'incident_time_ct')::time
  ) at time zone 'America/Chicago';

  insert into public.scada_events (
    id, pipeline_id, event_type, asset, segment_id, detail, occurred_at, acknowledged
  ) values (
    v_event_id,
    'ETX-NTX',
    'compressor_trip',
    'Midland Station Unit 2',
    'SEG-2',
    jsonb_build_object('derated_capacity_dth', v_derated_capacity),
    v_occurred_at,
    false
  );

  update public.segments
  set operating_capacity_dth = v_derated_capacity
  where id = 'SEG-2';

  update public.scenario_state
  set sim_clock_ct = v_occurred_at,
      phase = 'incident_posted',
      updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'scada_event_id', v_event_id,
    'gas_day', v_scenario.gas_day,
    'segment_id', 'SEG-2',
    'derated_capacity_dth', v_derated_capacity,
    'occurred_at', v_occurred_at
  );
end;
$$;

create or replace function public.reset_hero_scenario()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gas_day date;
begin
  select gas_day into v_gas_day from public.scenario_state where id = 1;

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
  set scheduled_dth = case shipper_id
        when 'LSPP' then 250000
        when 'ABCL' then 300000
        when 'NTGU' then 180000
        when 'CEMK' then 102000
        when 'SABT' then 68000
      end,
      status = 'scheduled',
      cut_reason = null
  where shipper_id in ('LSPP', 'ABCL', 'NTGU', 'CEMK', 'SABT');

  update public.scenario_state
  set phase = 'baseline',
      sim_clock_ct = (v_gas_day + time '16:00') at time zone 'America/Chicago',
      updated_at = now()
  where id = 1;

  return jsonb_build_object('phase', 'baseline', 'gas_day', v_gas_day);
end;
$$;

revoke all on function public.stage_pending_action(
  text, text, text, text, text, jsonb, bigint
) from public, anon, authenticated;
revoke all on function public.stage_ebb_notice(
  jsonb, text, text, text, text, bigint
) from public, anon, authenticated;
revoke all on function public.execute_approval(text, text, text)
  from public, anon, authenticated;
revoke all on function public.simulate_trip_compressor()
  from public, anon, authenticated;
revoke all on function public.reset_hero_scenario()
  from public, anon, authenticated;

grant execute on function public.stage_pending_action(
  text, text, text, text, text, jsonb, bigint
) to service_role;
grant execute on function public.stage_ebb_notice(
  jsonb, text, text, text, text, bigint
) to service_role;
grant execute on function public.execute_approval(text, text, text)
  to service_role;
grant execute on function public.simulate_trip_compressor()
  to service_role;
grant execute on function public.reset_hero_scenario()
  to service_role;
