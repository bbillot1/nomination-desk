-- The hosted database enforces pg-safeupdate. Scope the hero nomination reset explicitly.
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

revoke all on function public.reset_hero_scenario()
  from public, anon, authenticated;
grant execute on function public.reset_hero_scenario()
  to service_role;
