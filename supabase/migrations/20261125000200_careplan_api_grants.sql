-- Explicit backend privileges for projects with automatic Data API grants disabled.
begin;
grant usage on schema public to service_role;
do $$
declare t record;
begin
  for t in select tablename from pg_tables
    where schemaname = 'public' and starts_with(tablename, 'careplan_')
  loop
    execute format('grant all privileges on table public.%I to service_role', t.tablename);
  end loop;
end $$;
-- This SECURITY DEFINER RPC accepts an explicit owner ID: expose it only to
-- the backend, which verifies the signed user session before supplying that ID.
revoke all on function public.careplan_confirm_occurrence_completion(uuid,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.careplan_confirm_occurrence_completion(uuid,uuid,timestamptz)
  to service_role;
notify pgrst, 'reload schema';
commit;
