-- ============================================================================
-- CarePlan — Additive Migration: Apple Calendar-Style Custom Events
-- Preserves all existing tables and migrations (no DROP TABLE statements).
-- ============================================================================

create table if not exists public.careplan_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text not null default '',
  start_date date not null,
  end_date date not null,
  start_time text not null default '09:00' check (start_time ~ '^\d{2}:\d{2}$'),
  end_time text not null default '10:00' check (end_time ~ '^\d{2}:\d{2}$'),
  is_all_day boolean not null default false,
  recurrence text not null default 'never'
    check (recurrence in ('never', 'daily', 'weekly', 'monthly')),
  until_date date null,
  excluded_dates text[] not null default '{}',
  reminder_minutes integer null check (reminder_minutes is null or reminder_minutes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint careplan_calendar_events_date_order check (end_date >= start_date)
);

create index if not exists idx_careplan_calendar_events_user_start
  on public.careplan_calendar_events (user_id, start_date);

alter table public.careplan_calendar_events enable row level security;

drop policy if exists "careplan_calendar_events_owner_all" on public.careplan_calendar_events;
create policy "careplan_calendar_events_owner_all"
  on public.careplan_calendar_events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
