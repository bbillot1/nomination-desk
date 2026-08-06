-- Restore the frozen canonical hero through the same validated atomic loader used by generated
-- scenarios. The Edge Function supplies the reviewed §6 payload; no fixture values come from
-- browser input.
create or replace function public.restore_hero_scenario(
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
  v_result jsonb;
begin
  v_result := public.load_generated_scenario(
    'SCN-HERO',
    p_params,
    p_answer_key,
    p_nominations,
    p_actual_flows
  );

  update public.scenario_state
  set seed = 'hero',
      updated_at = now()
  where id = 1;

  return jsonb_set(v_result, '{seed}', to_jsonb('hero'::text));
end;
$$;

revoke all on function public.restore_hero_scenario(jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.restore_hero_scenario(jsonb, jsonb, jsonb, jsonb)
  to service_role;
