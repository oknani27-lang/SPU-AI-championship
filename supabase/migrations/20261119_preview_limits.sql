-- Required for Preview: shared request budgets and expiring concurrency leases.
-- No chat/user records are modified. Apply once after the chat migration.
begin;
create schema if not exists bizplan_private;
revoke all on schema bizplan_private from public, anon, authenticated;
create table bizplan_private.request_limits (
  scope text not null,
  bucket timestamptz not null,
  count integer not null check(count >= 0),
  primary key(scope,bucket)
);
create table bizplan_private.ai_leases (
  id uuid primary key,
  ip text not null,
  user_id uuid not null,
  session_id uuid not null,
  expires_at timestamptz not null
);
alter table bizplan_private.request_limits enable row level security;
alter table bizplan_private.ai_leases enable row level security;
revoke all on bizplan_private.request_limits,bizplan_private.ai_leases from public,anon,authenticated;
create function public.bizplan_auth_limit(p_ip text) returns boolean
language plpgsql security definer set search_path='' as $$
declare n integer; t timestamptz := date_trunc('minute',now());
begin
  if p_ip !~ '^[a-f0-9]{64}$' then return false; end if;
  perform pg_advisory_xact_lock(61429001);
  delete from bizplan_private.request_limits where bucket < now()-interval '2 days';
  select count into n from bizplan_private.request_limits where scope='auth:'||p_ip and bucket=t;
  if coalesce(n,0)>=20 then return false; end if;
  insert into bizplan_private.request_limits values('auth:'||p_ip,t,1) on conflict(scope,bucket) do update set count=bizplan_private.request_limits.count+1;
  return true;
end; $$;
create function public.bizplan_reserve_ai(p_ip text,p_user uuid,p_session uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare t timestamptz:=date_trunc('minute',now()); d timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'; n integer;
begin
  if p_ip !~ '^[a-f0-9]{64}$' or p_user is null or p_session is null then return false; end if;
  perform pg_advisory_xact_lock(61429001);
  if not exists(select 1 from public.chat_sessions where id=p_session and user_id=p_user) then return false; end if;
  delete from bizplan_private.ai_leases where expires_at < now();
  delete from bizplan_private.request_limits where bucket < now()-interval '2 days';
  if (select count(*) from bizplan_private.ai_leases)>=2 or exists(select 1 from bizplan_private.ai_leases where ip=p_ip or (user_id=p_user and session_id=p_session)) then return false; end if;
  if coalesce((select count from bizplan_private.request_limits where scope='ai-minute:'||p_ip and bucket=t),0)>=5 or
     coalesce((select count from bizplan_private.request_limits where scope='ai-day:'||p_ip and bucket=d),0)>=30 or
     coalesce((select count from bizplan_private.request_limits where scope='ai-global' and bucket=d),0)>=100 then return false; end if;
  insert into bizplan_private.request_limits values('ai-minute:'||p_ip,t,1),('ai-day:'||p_ip,d,1),('ai-global',d,1)
  on conflict(scope,bucket) do update set count=bizplan_private.request_limits.count+1;
  insert into bizplan_private.ai_leases values(p_lease,p_ip,p_user,p_session,now()+interval '120 seconds');
  return true;
end; $$;
create function public.bizplan_release_ai(p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin delete from bizplan_private.ai_leases where id=p_lease; return true; end; $$;
revoke all on function public.bizplan_auth_limit(text), public.bizplan_reserve_ai(text,uuid,uuid,uuid),public.bizplan_release_ai(uuid) from public,anon,authenticated;
grant execute on function public.bizplan_auth_limit(text), public.bizplan_reserve_ai(text,uuid,uuid,uuid),public.bizplan_release_ai(uuid) to service_role;
commit;
