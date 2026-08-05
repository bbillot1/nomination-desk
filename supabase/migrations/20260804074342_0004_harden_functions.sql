-- Resolve both security advisor warnings found after the initial schema migration.

-- Pin the search_path on the append-only guard so it cannot be influenced by a caller.
create or replace function agent_events_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  raise exception 'agent_events is append-only; % is not permitted', tg_op;
end;
$fn$;

-- Hosted Supabase creates the `ensure_rls` event trigger backed by rls_auto_enable(). It is
-- a useful platform safeguard, but must not be reachable through the REST API. Local images
-- may omit it, so make the revoke conditional while preserving the hosted outcome.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end;
$$;
