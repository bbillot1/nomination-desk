-- Row-level security and Realtime publication (BUILD_SPEC §5).
--
-- Posture: the browser reads everything and writes nothing. Edge functions hold the
-- service-role key, which bypasses RLS. Every table gets RLS enabled and a read-only
-- policy, and the client roles lose write privileges outright so a missing policy can
-- never become an accidental write path.

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public' order by tablename
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_read_all', t
    );

    execute format(
      'revoke insert, update, delete, truncate on public.%I from anon, authenticated', t
    );
  end loop;
end;
$$;

-- Future tables inherit the same write restriction even before their policies exist.
alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;

-- Full replica identity so UPDATE payloads carry complete rows and Realtime filters can
-- match on non-key columns such as agent_events.workflow_id. These tables are small.
alter table agent_runs      replica identity full;
alter table agent_events    replica identity full;
alter table pending_actions replica identity full;
alter table notices         replica identity full;
alter table nominations     replica identity full;
alter table segments        replica identity full;
alter table scenario_state  replica identity full;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'agent_runs', 'agent_events', 'pending_actions',
      'notices', 'nominations', 'segments', 'scenario_state'
    ])
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
