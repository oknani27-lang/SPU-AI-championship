-- CarePlan initial hosted setup for project ngkwsavxyyaeygduzvqc
-- Run ONCE in the Supabase SQL Editor on the intended project.
-- These are the existing four CarePlan migrations in dependency order.
-- Do not include the unrelated chat/preview migrations.


-- SOURCE: 20261123_careplan_schema.sql
-- =============================================================================
-- CarePlan — AI Weekly Care Scheduler Database Schema Migration
-- SPU AI Championship MVP
--
-- IMPORTANT SAFETY GUARANTEES:
-- 1. All tables are prefixed with `careplan_` so legacy tables are NEVER touched
--    or dropped.
-- 2. Default timezone is Thailand (`Asia/Bangkok`, UTC+7).
-- 3. Strict Row Level Security (RLS) on EVERY table (owner-only isolation).
-- 4. Private Storage Bucket `careplan-evidence` (`public = false`) with
--    owner-only folder access (`storage.foldername(name)[1] = auth.uid()::text`).
-- 5. Database triggers enforce domain invariants:
--    - Active incomplete occurrences cannot have core fields edited or deleted.
--    - Completed occurrences (`is_locked = true`) are 100% immutable.
--    - Locked completion evidence (`locked_at IS NOT NULL`) is 100% immutable.
--    - `careplan_task_history` is strictly append-only.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Helper trigger: automatically update `updated_at`
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.careplan_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. careplan_user_profiles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT 'ผู้ดูแล',
  timezone text NOT NULL DEFAULT 'Asia/Bangkok',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 2. careplan_care_recipients
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_care_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'คุณแม่',
  age_years integer CHECK (age_years IS NULL OR (age_years >= 0 AND age_years <= 130)),
  mobility_level text NOT NULL DEFAULT 'homebound'
    CHECK (mobility_level IN ('independent', 'homebound', 'bedbound')),
  care_notes text NOT NULL DEFAULT '',
  requires_supervision boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_careplan_care_recipients_user
  ON public.careplan_care_recipients(user_id);

-- -----------------------------------------------------------------------------
-- 3. careplan_weekly_schedules
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_weekly_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  care_recipient_id uuid NOT NULL REFERENCES public.careplan_care_recipients(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'ตารางดูแลประจำสัปดาห์',
  timezone text NOT NULL DEFAULT 'Asia/Bangkok',
  rest_days smallint[] NOT NULL DEFAULT ARRAY[7]::smallint[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_careplan_weekly_schedules_user
  ON public.careplan_weekly_schedules(user_id);

-- -----------------------------------------------------------------------------
-- 4. careplan_recurring_task_templates
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_recurring_task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  weekly_schedule_id uuid NOT NULL REFERENCES public.careplan_weekly_schedules(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text NOT NULL DEFAULT '',
  scheduled_time text NOT NULL CHECK (scheduled_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes >= 5 AND duration_minutes <= 720),
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'medical_critical')),
  is_fixed_time boolean NOT NULL DEFAULT false,
  is_medically_prescribed boolean NOT NULL DEFAULT false,
  effective_from_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Bangkok')::date),
  effective_until_date date NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until_date IS NULL OR effective_until_date >= effective_from_date)
);

CREATE INDEX IF NOT EXISTS idx_careplan_templates_user_day
  ON public.careplan_recurring_task_templates(user_id, weekly_schedule_id, day_of_week);

-- -----------------------------------------------------------------------------
-- 5. careplan_task_dependencies
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  weekly_schedule_id uuid NOT NULL REFERENCES public.careplan_weekly_schedules(id) ON DELETE CASCADE,
  predecessor_template_id uuid NOT NULL REFERENCES public.careplan_recurring_task_templates(id) ON DELETE CASCADE,
  successor_template_id uuid NOT NULL REFERENCES public.careplan_recurring_task_templates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (predecessor_template_id, successor_template_id),
  CHECK (predecessor_template_id <> successor_template_id)
);

CREATE INDEX IF NOT EXISTS idx_careplan_dependencies_user
  ON public.careplan_task_dependencies(user_id, weekly_schedule_id);

-- -----------------------------------------------------------------------------
-- 6. careplan_daily_task_occurrences
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_daily_task_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.careplan_recurring_task_templates(id) ON DELETE RESTRICT,
  weekly_schedule_id uuid NOT NULL REFERENCES public.careplan_weekly_schedules(id) ON DELETE RESTRICT,
  occurrence_date date NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text NOT NULL DEFAULT '',
  scheduled_time text NOT NULL CHECK (scheduled_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes >= 5 AND duration_minutes <= 720),
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'medical_critical')),
  is_fixed_time boolean NOT NULL DEFAULT false,
  is_medically_prescribed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'incomplete'
    CHECK (status IN ('incomplete', 'completed')),
  completed_at timestamptz NULL,
  is_delayed boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_careplan_occurrences_user_date
  ON public.careplan_daily_task_occurrences(user_id, occurrence_date, scheduled_time);

CREATE INDEX IF NOT EXISTS idx_careplan_occurrences_user_status
  ON public.careplan_daily_task_occurrences(user_id, status, scheduled_at);

-- -----------------------------------------------------------------------------
-- 7. careplan_completion_evidence
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_completion_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL REFERENCES public.careplan_daily_task_occurrences(id) ON DELETE RESTRICT,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 5242880),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_careplan_evidence_occurrence
  ON public.careplan_completion_evidence(user_id, occurrence_id);

-- -----------------------------------------------------------------------------
-- 8. careplan_task_history (Append-only immutable audit trail)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_task_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL REFERENCES public.careplan_daily_task_occurrences(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type IN (
      'occurrence_created',
      'photo_uploaded',
      'completed_confirmed',
      'reminder_sent',
      'dependent_notified',
      'future_template_updated'
    )
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_careplan_history_user_created
  ON public.careplan_task_history(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_careplan_history_occurrence
  ON public.careplan_task_history(occurrence_id, created_at ASC);

-- -----------------------------------------------------------------------------
-- 9. careplan_reminder_preferences
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_reminder_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  reminders_enabled boolean NOT NULL DEFAULT true,
  repeat_interval_minutes integer NOT NULL DEFAULT 15 CHECK (repeat_interval_minutes BETWEEN 5 AND 120),
  quiet_hours_enabled boolean NOT NULL DEFAULT true,
  quiet_hours_start text NOT NULL DEFAULT '22:00' CHECK (quiet_hours_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_hours_end text NOT NULL DEFAULT '06:00' CHECK (quiet_hours_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  browser_notifications_granted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 10. careplan_notification_delivery_logs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_notification_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL REFERENCES public.careplan_daily_task_occurrences(id) ON DELETE CASCADE,
  notification_type text NOT NULL CHECK (
    notification_type IN ('start_reminder', 'repeat_reminder', 'next_dependent_ready')
  ),
  dedup_key text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'browser_push', 'cron_queue')),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz NULL,
  UNIQUE (user_id, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_careplan_notifications_user_delivered
  ON public.careplan_notification_delivery_logs(user_id, delivered_at DESC);

-- -----------------------------------------------------------------------------
-- 11. careplan_daily_summaries
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_daily_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  summary_date date NOT NULL,
  metrics jsonb NOT NULL,
  encouraging_message text NOT NULL,
  tone_category text NOT NULL CHECK (
    tone_category IN ('on_time_praise', 'delayed_empathy', 'incomplete_support', 'rest_day')
  ),
  ai_provider text NOT NULL DEFAULT 'gemini',
  used_fallback boolean NOT NULL DEFAULT false,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_careplan_summaries_user_date
  ON public.careplan_daily_summaries(user_id, summary_date DESC);

-- -----------------------------------------------------------------------------
-- 12. careplan_rest_suggestions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_rest_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  suggestion_date date NOT NULL,
  gap_start text NOT NULL CHECK (gap_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  gap_end text NOT NULL CHECK (gap_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duration_minutes integer NOT NULL CHECK (duration_minutes >= 15),
  activity_title text NOT NULL,
  description text NOT NULL,
  supervision_safety_note text NOT NULL,
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'accepted', 'dismissed', 'ignored')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_careplan_rest_suggestions_user_date
  ON public.careplan_rest_suggestions(user_id, suggestion_date);

-- -----------------------------------------------------------------------------
-- 13. careplan_share_links
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  weekly_schedule_id uuid NOT NULL REFERENCES public.careplan_weekly_schedules(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE CHECK (length(token) >= 24),
  scope text NOT NULL CHECK (scope IN ('day', 'week')),
  target_date date NOT NULL,
  include_private_notes boolean NOT NULL DEFAULT false,
  expires_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_careplan_share_links_user
  ON public.careplan_share_links(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_careplan_share_links_token
  ON public.careplan_share_links(token);

-- -----------------------------------------------------------------------------
-- 14. careplan_ai_operation_logs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_ai_operation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  operation_type text NOT NULL CHECK (
    operation_type IN ('schedule_generator', 'text_to_task', 'daily_summary', 'rest_suggestions')
  ),
  provider text NOT NULL,
  model text NOT NULL,
  used_fallback boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('success', 'fallback', 'error')),
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_careplan_ai_logs_user_created
  ON public.careplan_ai_operation_logs(user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 15. careplan_privacy_deletion_requests
--     Records PDPA/GDPR personal data deletion requests cleanly without acting
--     as an ordinary user edit to immutable historical task evidence.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.careplan_privacy_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.careplan_user_profiles(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'in_review', 'completed')),
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_careplan_privacy_requests_user
  ON public.careplan_privacy_deletion_requests(user_id, requested_at DESC);

-- =============================================================================
-- UPDATED_AT TRIGGERS
-- =============================================================================
DROP TRIGGER IF EXISTS trg_careplan_user_profiles_updated_at ON public.careplan_user_profiles;
CREATE TRIGGER trg_careplan_user_profiles_updated_at
  BEFORE UPDATE ON public.careplan_user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.careplan_set_updated_at();

DROP TRIGGER IF EXISTS trg_careplan_care_recipients_updated_at ON public.careplan_care_recipients;
CREATE TRIGGER trg_careplan_care_recipients_updated_at
  BEFORE UPDATE ON public.careplan_care_recipients
  FOR EACH ROW EXECUTE FUNCTION public.careplan_set_updated_at();

DROP TRIGGER IF EXISTS trg_careplan_weekly_schedules_updated_at ON public.careplan_weekly_schedules;
CREATE TRIGGER trg_careplan_weekly_schedules_updated_at
  BEFORE UPDATE ON public.careplan_weekly_schedules
  FOR EACH ROW EXECUTE FUNCTION public.careplan_set_updated_at();

DROP TRIGGER IF EXISTS trg_careplan_templates_updated_at ON public.careplan_recurring_task_templates;
CREATE TRIGGER trg_careplan_templates_updated_at
  BEFORE UPDATE ON public.careplan_recurring_task_templates
  FOR EACH ROW EXECUTE FUNCTION public.careplan_set_updated_at();

DROP TRIGGER IF EXISTS trg_careplan_reminder_prefs_updated_at ON public.careplan_reminder_preferences;
CREATE TRIGGER trg_careplan_reminder_prefs_updated_at
  BEFORE UPDATE ON public.careplan_reminder_preferences
  FOR EACH ROW EXECUTE FUNCTION public.careplan_set_updated_at();

DROP TRIGGER IF EXISTS trg_careplan_rest_suggestions_updated_at ON public.careplan_rest_suggestions;
CREATE TRIGGER trg_careplan_rest_suggestions_updated_at
  BEFORE UPDATE ON public.careplan_rest_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.careplan_set_updated_at();

-- =============================================================================
-- DOMAIN INVARIANT TRIGGERS (IMMUTABILITY & ACTIVE OCCURRENCE LOCKING)
-- =============================================================================

-- 1) Protect careplan_daily_task_occurrences:
--    - DELETE is ALWAYS forbidden.
--    - Completed (`is_locked = true`) occurrences CANNOT be modified in any way.
--    - Active incomplete occurrences CANNOT have core fields modified; ONLY the
--      transactional RPC `careplan_confirm_occurrence_completion` may transition
--      status from 'incomplete' -> 'completed' and set `is_locked = true`.
CREATE OR REPLACE FUNCTION public.careplan_guard_occurrence_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CarePlan policy violation: task occurrences cannot be deleted.'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_locked = true OR OLD.status = 'completed' THEN
      RAISE EXCEPTION 'CarePlan policy violation: completed task occurrences are immutable.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Block any attempt to alter core schedule fields on an active incomplete occurrence
    IF NEW.title IS DISTINCT FROM OLD.title
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time
      OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at
      OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
      OR NEW.occurrence_date IS DISTINCT FROM OLD.occurrence_date
      OR NEW.day_of_week IS DISTINCT FROM OLD.day_of_week
      OR NEW.priority IS DISTINCT FROM OLD.priority
      OR NEW.is_fixed_time IS DISTINCT FROM OLD.is_fixed_time
      OR NEW.is_medically_prescribed IS DISTINCT FROM OLD.is_medically_prescribed
      OR NEW.template_id IS DISTINCT FROM OLD.template_id
      OR NEW.weekly_schedule_id IS DISTINCT FROM OLD.weekly_schedule_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'CarePlan policy violation: active incomplete occurrences cannot be edited.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Only allow completion transition inside the vetted confirmation RPC
    IF current_setting('careplan.allow_completion', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'CarePlan policy violation: occurrences may only be completed via careplan_confirm_occurrence_completion.'
        USING ERRCODE = 'P0001';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_careplan_guard_occurrence_mutations ON public.careplan_daily_task_occurrences;
CREATE TRIGGER trg_careplan_guard_occurrence_mutations
  BEFORE UPDATE OR DELETE ON public.careplan_daily_task_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.careplan_guard_occurrence_mutations();

-- 2) Protect careplan_completion_evidence:
--    - Once `locked_at IS NOT NULL`, UPDATE and DELETE are strictly rejected.
--    - Cannot attach new photo evidence to an already locked/completed occurrence.
CREATE OR REPLACE FUNCTION public.careplan_guard_evidence_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_locked boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT is_locked INTO v_is_locked
    FROM public.careplan_daily_task_occurrences
    WHERE id = NEW.occurrence_id;

    IF v_is_locked IS TRUE THEN
      RAISE EXCEPTION 'CarePlan policy violation: cannot attach evidence to an already completed occurrence.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'CarePlan policy violation: locked completion evidence cannot be deleted.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'CarePlan policy violation: locked completion evidence is immutable.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Only allow setting locked_at via confirmation RPC; block tampering with file metadata
    IF current_setting('careplan.allow_completion', true) IS DISTINCT FROM 'true'
      OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
      OR NEW.file_name IS DISTINCT FROM OLD.file_name
      OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
      OR NEW.file_size_bytes IS DISTINCT FROM OLD.file_size_bytes
      OR NEW.occurrence_id IS DISTINCT FROM OLD.occurrence_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION 'CarePlan policy violation: completion evidence metadata cannot be edited.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_careplan_guard_evidence_mutations ON public.careplan_completion_evidence;
CREATE TRIGGER trg_careplan_guard_evidence_mutations
  BEFORE INSERT OR UPDATE OR DELETE ON public.careplan_completion_evidence
  FOR EACH ROW EXECUTE FUNCTION public.careplan_guard_evidence_mutations();

-- 3) Protect careplan_task_history (strictly append-only)
CREATE OR REPLACE FUNCTION public.careplan_guard_history_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'CarePlan policy violation: task history is append-only and cannot be modified or deleted.'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_careplan_guard_history_append_only ON public.careplan_task_history;
CREATE TRIGGER trg_careplan_guard_history_append_only
  BEFORE UPDATE OR DELETE ON public.careplan_task_history
  FOR EACH ROW EXECUTE FUNCTION public.careplan_guard_history_append_only();

-- =============================================================================
-- TRANSACTIONAL RPC: careplan_confirm_occurrence_completion
-- =============================================================================
CREATE OR REPLACE FUNCTION public.careplan_confirm_occurrence_completion(
  p_user_id uuid,
  p_occurrence_id uuid,
  p_completed_at timestamptz DEFAULT now()
)
RETURNS public.careplan_daily_task_occurrences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_occ public.careplan_daily_task_occurrences;
  v_evidence_count integer;
  v_is_delayed boolean;
  v_effective_completed_at timestamptz := COALESCE(p_completed_at, now());
BEGIN
  -- Lock occurrence row for atomic verification
  SELECT *
  INTO v_occ
  FROM public.careplan_daily_task_occurrences
  WHERE id = p_occurrence_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OCCURRENCE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_occ.user_id <> p_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN_OWNER_MISMATCH' USING ERRCODE = '42501';
  END IF;

  IF v_occ.status = 'completed' OR v_occ.is_locked = true THEN
    RAISE EXCEPTION 'ALREADY_COMPLETED' USING ERRCODE = 'P0001';
  END IF;

  -- Verify at least one private uploaded photo evidence exists
  SELECT count(*)
  INTO v_evidence_count
  FROM public.careplan_completion_evidence
  WHERE occurrence_id = p_occurrence_id
    AND user_id = p_user_id;

  IF v_evidence_count < 1 THEN
    RAISE EXCEPTION 'PHOTO_EVIDENCE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Delayed if completed > 15 minutes after scheduled_at
  v_is_delayed := v_effective_completed_at > (v_occ.scheduled_at + interval '15 minutes');

  -- Permit vetted completion transition within this transaction only
  PERFORM set_config('careplan.allow_completion', 'true', true);

  UPDATE public.careplan_daily_task_occurrences
  SET
    status = 'completed',
    completed_at = v_effective_completed_at,
    is_delayed = v_is_delayed,
    is_locked = true,
    updated_at = now()
  WHERE id = p_occurrence_id
  RETURNING * INTO v_occ;

  UPDATE public.careplan_completion_evidence
  SET locked_at = v_effective_completed_at
  WHERE occurrence_id = p_occurrence_id
    AND user_id = p_user_id
    AND locked_at IS NULL;

  INSERT INTO public.careplan_task_history (
    user_id,
    occurrence_id,
    event_type,
    metadata
  )
  VALUES (
    p_user_id,
    p_occurrence_id,
    'completed_confirmed',
    jsonb_build_object(
      'completed_at', v_effective_completed_at,
      'is_delayed', v_is_delayed,
      'evidence_count', v_evidence_count
    )
  );

  RETURN v_occ;
END;
$$;

-- =============================================================================
-- ROW LEVEL SECURITY (RLS) — STRICT OWNER-ONLY ISOLATION ON ALL 15 TABLES
-- =============================================================================
ALTER TABLE public.careplan_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_care_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_weekly_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_recurring_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_daily_task_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_completion_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_task_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_reminder_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_notification_delivery_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_rest_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_ai_operation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.careplan_privacy_deletion_requests ENABLE ROW LEVEL SECURITY;

-- 1. careplan_user_profiles
DROP POLICY IF EXISTS careplan_user_profiles_owner_all ON public.careplan_user_profiles;
CREATE POLICY careplan_user_profiles_owner_all ON public.careplan_user_profiles
  FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 2. careplan_care_recipients
DROP POLICY IF EXISTS careplan_care_recipients_owner_all ON public.careplan_care_recipients;
CREATE POLICY careplan_care_recipients_owner_all ON public.careplan_care_recipients
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. careplan_weekly_schedules
DROP POLICY IF EXISTS careplan_weekly_schedules_owner_all ON public.careplan_weekly_schedules;
CREATE POLICY careplan_weekly_schedules_owner_all ON public.careplan_weekly_schedules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 4. careplan_recurring_task_templates
DROP POLICY IF EXISTS careplan_templates_owner_all ON public.careplan_recurring_task_templates;
CREATE POLICY careplan_templates_owner_all ON public.careplan_recurring_task_templates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 5. careplan_task_dependencies
DROP POLICY IF EXISTS careplan_dependencies_owner_all ON public.careplan_task_dependencies;
CREATE POLICY careplan_dependencies_owner_all ON public.careplan_task_dependencies
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 6. careplan_daily_task_occurrences (SELECT & INSERT only for normal owner; completion via RPC)
DROP POLICY IF EXISTS careplan_occurrences_owner_select ON public.careplan_daily_task_occurrences;
CREATE POLICY careplan_occurrences_owner_select ON public.careplan_daily_task_occurrences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS careplan_occurrences_owner_insert ON public.careplan_daily_task_occurrences;
CREATE POLICY careplan_occurrences_owner_insert ON public.careplan_daily_task_occurrences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 7. careplan_completion_evidence (SELECT & INSERT only for owner; locked immutable via trigger)
DROP POLICY IF EXISTS careplan_evidence_owner_select ON public.careplan_completion_evidence;
CREATE POLICY careplan_evidence_owner_select ON public.careplan_completion_evidence
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS careplan_evidence_owner_insert ON public.careplan_completion_evidence;
CREATE POLICY careplan_evidence_owner_insert ON public.careplan_completion_evidence
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 8. careplan_task_history (append-only SELECT & INSERT for owner)
DROP POLICY IF EXISTS careplan_history_owner_select ON public.careplan_task_history;
CREATE POLICY careplan_history_owner_select ON public.careplan_task_history
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS careplan_history_owner_insert ON public.careplan_task_history;
CREATE POLICY careplan_history_owner_insert ON public.careplan_task_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 9. careplan_reminder_preferences
DROP POLICY IF EXISTS careplan_reminder_prefs_owner_all ON public.careplan_reminder_preferences;
CREATE POLICY careplan_reminder_prefs_owner_all ON public.careplan_reminder_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 10. careplan_notification_delivery_logs
DROP POLICY IF EXISTS careplan_notifications_owner_all ON public.careplan_notification_delivery_logs;
CREATE POLICY careplan_notifications_owner_all ON public.careplan_notification_delivery_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 11. careplan_daily_summaries
DROP POLICY IF EXISTS careplan_summaries_owner_all ON public.careplan_daily_summaries;
CREATE POLICY careplan_summaries_owner_all ON public.careplan_daily_summaries
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 12. careplan_rest_suggestions
DROP POLICY IF EXISTS careplan_rest_suggestions_owner_all ON public.careplan_rest_suggestions;
CREATE POLICY careplan_rest_suggestions_owner_all ON public.careplan_rest_suggestions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 13. careplan_share_links
DROP POLICY IF EXISTS careplan_share_links_owner_all ON public.careplan_share_links;
CREATE POLICY careplan_share_links_owner_all ON public.careplan_share_links
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 14. careplan_ai_operation_logs
DROP POLICY IF EXISTS careplan_ai_logs_owner_all ON public.careplan_ai_operation_logs;
CREATE POLICY careplan_ai_logs_owner_all ON public.careplan_ai_operation_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 15. careplan_privacy_deletion_requests
DROP POLICY IF EXISTS careplan_privacy_requests_owner_all ON public.careplan_privacy_deletion_requests;
CREATE POLICY careplan_privacy_requests_owner_all ON public.careplan_privacy_deletion_requests
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =============================================================================
-- PRIVATE SUPABASE STORAGE BUCKET: careplan-evidence
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'careplan-evidence',
  'careplan-evidence',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic'];

DROP POLICY IF EXISTS careplan_evidence_storage_owner_select ON storage.objects;
CREATE POLICY careplan_evidence_storage_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'careplan-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS careplan_evidence_storage_owner_insert ON storage.objects;
CREATE POLICY careplan_evidence_storage_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'careplan-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- SOURCE: 20261124_careplan_calendar_events.sql
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


-- SOURCE: 20261125000000_calendar_doctor_atomic_changes.sql
-- Additive after the team's YYYYMMDD migrations. Generated by CLI then timestamp
-- normalized to sort after 20261124_careplan_calendar_events.sql on fresh installs.
begin;
alter table public.careplan_calendar_events add column if not exists event_type text not null default 'general' check(event_type in ('general','doctor'));
-- Historical zero-duration records are retained; every new write is validated.
alter table public.careplan_calendar_events add constraint careplan_calendar_positive_duration check(is_all_day or end_date>start_date or end_time>start_time) not valid;
alter table public.careplan_calendar_events add constraint careplan_calendar_valid_time check(start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') not valid;
grant select,insert,update,delete on public.careplan_calendar_events to authenticated,service_role;
create or replace function public.careplan_change_calendar_event(p_user_id uuid,p_event_id uuid,p_action text,p_scope text,p_occurrence_date date,p_fields jsonb,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare original public.careplan_calendar_events; changed public.careplan_calendar_events; split public.careplan_calendar_events; valid_occ boolean := false; months integer; candidate date;
begin
  if p_user_id is null or p_action is null or p_action not in ('update','delete') or p_scope is null or p_scope not in ('all','single','future') then raise exception 'Invalid calendar change'; end if;
  select * into original from public.careplan_calendar_events where id=p_event_id and user_id=p_user_id for update;
  if not found then raise exception 'Event not owned' using errcode='42501'; end if;
  if p_expected_updated_at is null or original.updated_at<>p_expected_updated_at then raise exception 'Event changed; reload before saving' using errcode='40001'; end if;
  if p_scope<>'all' and original.recurrence<>'never' then
    if p_occurrence_date is null or p_occurrence_date<original.start_date or (original.until_date is not null and p_occurrence_date>original.until_date) or p_occurrence_date::text=any(original.excluded_dates) then raise exception 'Invalid occurrence'; end if;
    if original.recurrence='daily' then valid_occ:=true;
    elsif original.recurrence='weekly' then valid_occ:=mod(p_occurrence_date-original.start_date,7)=0;
    else
      months:=(extract(year from p_occurrence_date)::int-extract(year from original.start_date)::int)*12+extract(month from p_occurrence_date)::int-extract(month from original.start_date)::int;
      candidate:=(original.start_date+make_interval(months=>months))::date;
      valid_occ:=candidate=p_occurrence_date;
    end if;
    if not valid_occ then raise exception 'Invalid occurrence'; end if;
  end if;
  if p_action='delete' then
    if original.recurrence='never' or p_scope='all' or (p_scope='future' and p_occurrence_date=original.start_date) then
      delete from public.careplan_calendar_events where id=p_event_id and user_id=p_user_id;
    elsif p_scope='single' then
      update public.careplan_calendar_events set excluded_dates=array_append(excluded_dates,p_occurrence_date::text),updated_at=clock_timestamp() where id=p_event_id and user_id=p_user_id;
    else
      update public.careplan_calendar_events set until_date=p_occurrence_date-1,updated_at=clock_timestamp() where id=p_event_id and user_id=p_user_id;
    end if;
    return jsonb_build_object('deleted',true);
  end if;
  if p_fields is null then raise exception 'Missing calendar fields'; end if;
  changed:=jsonb_populate_record(original,p_fields);
  if changed.title is null or length(trim(changed.title)) not between 1 and 200 or length(changed.description)>1000 or changed.event_type not in ('general','doctor') or changed.until_date<changed.start_date or changed.reminder_minutes<0 or changed.reminder_minutes>10080 then raise exception 'Invalid calendar fields'; end if;
  if original.recurrence<>'never' and p_scope<>'all' and (p_scope='single' or p_occurrence_date>original.start_date) then
    if p_scope='single' then
      update public.careplan_calendar_events set excluded_dates=array_append(excluded_dates,p_occurrence_date::text),updated_at=clock_timestamp() where id=p_event_id and user_id=p_user_id returning * into original;
      changed.recurrence:='never';changed.until_date:=null;
    else
      update public.careplan_calendar_events set until_date=p_occurrence_date-1,updated_at=clock_timestamp() where id=p_event_id and user_id=p_user_id returning * into original;
    end if;
    insert into public.careplan_calendar_events(user_id,title,description,event_type,start_date,end_date,start_time,end_time,is_all_day,recurrence,until_date,excluded_dates,reminder_minutes)
    values(p_user_id,changed.title,changed.description,changed.event_type,changed.start_date,changed.end_date,changed.start_time,changed.end_time,changed.is_all_day,changed.recurrence,changed.until_date,'{}',changed.reminder_minutes) returning * into split;
    return jsonb_build_object('event',to_jsonb(original),'split_event',to_jsonb(split));
  end if;
  update public.careplan_calendar_events set title=changed.title,description=changed.description,event_type=changed.event_type,start_date=changed.start_date,end_date=changed.end_date,start_time=changed.start_time,end_time=changed.end_time,is_all_day=changed.is_all_day,recurrence=changed.recurrence,until_date=changed.until_date,reminder_minutes=changed.reminder_minutes,updated_at=clock_timestamp() where id=p_event_id and user_id=p_user_id returning * into changed;
  return jsonb_build_object('event',to_jsonb(changed));
end;
$$;
-- The existing store uses a server-only admin client after validating the session.
-- This invoker RPC is NOT an authenticated-user endpoint; explicit owner filtering
-- and optimistic version checks remain mandatory inside its atomic transaction.
revoke all on function public.careplan_change_calendar_event(uuid,uuid,text,text,date,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.careplan_change_calendar_event(uuid,uuid,text,text,date,jsonb,timestamptz) to service_role;
commit;


-- SOURCE: 20261125000100_careplan_web_push.sql
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
