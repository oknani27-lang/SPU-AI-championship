-- Apply once in Supabase SQL Editor. Stop if these table names already exist; inspect them first.
begin;
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'บทสนทนาใหม่' check (char_length(title) between 1 and 100),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(btrim(content)) > 0 and char_length(content) <= case when role = 'user' then 2000 else 4000 end),
  created_at timestamptz not null default clock_timestamp()
);
create index chat_sessions_owner_updated on public.chat_sessions(user_id, updated_at desc);
create index chat_messages_session_created on public.chat_messages(session_id, created_at, id);
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_sessions, public.chat_messages from anon, authenticated;
grant select, insert, delete on public.chat_sessions to authenticated;
grant update(title) on public.chat_sessions to authenticated;
grant select on public.chat_messages to authenticated;
grant insert(id, session_id, role, content) on public.chat_messages to authenticated;
grant all on public.chat_sessions, public.chat_messages to service_role;
create policy sessions_read on public.chat_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy sessions_create on public.chat_sessions for insert to authenticated with check (user_id = (select auth.uid()));
create policy sessions_edit on public.chat_sessions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sessions_delete on public.chat_sessions for delete to authenticated using (user_id = (select auth.uid()));
create policy messages_read on public.chat_messages for select to authenticated using (
  exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
);
create policy messages_create_user on public.chat_messages for insert to authenticated with check (
  role = 'user' and exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = (select auth.uid()))
);
-- No client UPDATE/DELETE privilege for messages, and no client assistant INSERT policy.
create function public.bizplan_complete_turn(p_user_id uuid, p_session_id uuid, p_message_id uuid, p_content text)
returns public.chat_messages
language plpgsql security definer set search_path = ''
as $$
declare result public.chat_messages; reply_id uuid;
begin
  perform 1 from public.chat_sessions where id = p_session_id and user_id = p_user_id for update;
  if not found then raise exception 'Session not owned'; end if;
  perform 1 from public.chat_messages where id = p_message_id and session_id = p_session_id and role = 'user';
  if not found then raise exception 'User message missing'; end if;
  reply_id := md5('bizplan-reply:' || p_message_id::text)::uuid;
  select * into result from public.chat_messages where id = reply_id;
  if found then
    if result.session_id <> p_session_id or result.role <> 'assistant' then raise exception 'Message conflict'; end if;
    return result;
  end if;
  insert into public.chat_messages(id, session_id, role, content) values(reply_id, p_session_id, 'assistant', p_content) returning * into result;
  update public.chat_sessions set updated_at = clock_timestamp() where id = p_session_id and user_id = p_user_id;
  return result;
end;
$$;
revoke all on function public.bizplan_complete_turn(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.bizplan_complete_turn(uuid, uuid, uuid, text) to service_role;
commit;
