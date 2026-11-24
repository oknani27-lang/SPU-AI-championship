-- Created with Supabase CLI migration new; timestamp moved after legacy 8-digit migrations.
begin;
create table public.careplan_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.careplan_user_profiles(id) on delete cascade,
  endpoint text not null unique check(length(endpoint)<=2048),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.careplan_push_subscriptions enable row level security;
revoke all on public.careplan_push_subscriptions from public,anon,authenticated;
grant select,delete on public.careplan_push_subscriptions to authenticated;
grant all on public.careplan_push_subscriptions to service_role;
create policy careplan_push_owner_read on public.careplan_push_subscriptions for select to authenticated using(user_id=(select auth.uid()));
create policy careplan_push_owner_delete on public.careplan_push_subscriptions for delete to authenticated using(user_id=(select auth.uid()));
create function public.careplan_register_push(p_user_id uuid,p_endpoint text,p_p256dh text,p_auth text)
returns void language plpgsql security invoker set search_path='' as $$
declare registered uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,17));
  if (select count(*) from public.careplan_push_subscriptions where user_id=p_user_id)>=20 and not exists(select 1 from public.careplan_push_subscriptions where user_id=p_user_id and endpoint=p_endpoint) then raise exception 'Device limit reached'; end if;
  insert into public.careplan_push_subscriptions(user_id,endpoint,p256dh,auth) values(p_user_id,p_endpoint,p_p256dh,p_auth)
  on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth where public.careplan_push_subscriptions.user_id=p_user_id returning id into registered;
  if registered is null then raise exception 'Endpoint belongs to another account'; end if;
end;
$$;
revoke all on function public.careplan_register_push(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.careplan_register_push(uuid,text,text,text) to service_role;
create table public.careplan_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.careplan_push_subscriptions(id) on delete cascade,
  event_id uuid not null,
  occurrence_date date not null,
  kind text not null,
  due_at timestamptz not null,
  status text not null check(status in ('leased','pending','sent','failed')),
  lease_token uuid not null,
  lease_until timestamptz not null,
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 1,
  sent_at timestamptz,
  unique(subscription_id,event_id,occurrence_date,kind)
);
alter table public.careplan_push_deliveries enable row level security;
revoke all on public.careplan_push_deliveries from public,anon,authenticated;
grant all on public.careplan_push_deliveries to service_role;
create index careplan_push_deliveries_due on public.careplan_push_deliveries(due_at);
create function public.careplan_claim_push(p_subscription_id uuid,p_event_id uuid,p_occurrence_date date,p_kind text,p_due_at timestamptz,p_lease_token uuid)
returns table(id uuid) language sql security invoker set search_path='' as $$
  insert into public.careplan_push_deliveries(subscription_id,event_id,occurrence_date,kind,due_at,status,lease_token,lease_until)
  values(p_subscription_id,p_event_id,p_occurrence_date,p_kind,p_due_at,'leased',p_lease_token,now()+interval '2 minutes')
  on conflict(subscription_id,event_id,occurrence_date,kind) do update
    set status='leased',lease_token=excluded.lease_token,lease_until=excluded.lease_until,attempts=public.careplan_push_deliveries.attempts+1
    where public.careplan_push_deliveries.status in ('pending','leased') and public.careplan_push_deliveries.lease_until<now() and public.careplan_push_deliveries.next_attempt_at<=now() and public.careplan_push_deliveries.attempts<5
  returning public.careplan_push_deliveries.id;
$$;
revoke all on function public.careplan_claim_push(uuid,uuid,date,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.careplan_claim_push(uuid,uuid,date,text,timestamptz,uuid) to service_role;
commit;
