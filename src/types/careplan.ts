export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7; // 1 = Monday ... 7 = Sunday

export const THAI_DAY_NAMES: Record<DayOfWeek, { short: string; full: string; en: string }> = {
  1: { short: "จ.", full: "วันจันทร์", en: "Monday" },
  2: { short: "อ.", full: "วันอังคาร", en: "Tuesday" },
  3: { short: "พ.", full: "วันพุธ", en: "Wednesday" },
  4: { short: "พฤ.", full: "วันพฤหัสบดี", en: "Thursday" },
  5: { short: "ศ.", full: "วันศุกร์", en: "Friday" },
  6: { short: "ส.", full: "วันเสาร์", en: "Saturday" },
  7: { short: "อา.", full: "วันอาทิตย์", en: "Sunday" },
};

export const ALL_DAYS: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 7];

export type TaskPriority = "low" | "medium" | "high" | "medical_critical";
export type TaskStatus = "incomplete" | "completed";
export type StorageMode = "supabase" | "demo";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  timezone: string; // default "Asia/Bangkok"
  created_at: string;
  updated_at: string;
}

export interface CareRecipientProfile {
  id: string;
  user_id: string;
  display_name: string; // e.g., "คุณแม่"
  age_years: number | null;
  mobility_level: "independent" | "homebound" | "bedbound";
  care_notes: string;
  requires_supervision: boolean;
  created_at: string;
  updated_at: string;
}

export interface WeeklyScheduleTemplate {
  id: string;
  user_id: string;
  care_recipient_id: string;
  title: string;
  timezone: string;
  rest_days: DayOfWeek[]; // e.g. [7] for Sunday rest day (app tasks paused; does NOT cancel medical care)
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecurringTaskTemplate {
  id: string;
  user_id: string;
  weekly_schedule_id: string;
  day_of_week: DayOfWeek;
  title: string;
  description: string;
  scheduled_time: string; // "HH:mm" in Thailand timezone e.g. "08:00"
  duration_minutes: number; // approximate duration
  priority: TaskPriority;
  is_fixed_time: boolean;
  is_medically_prescribed: boolean;
  effective_from_date: string; // "YYYY-MM-DD" in Asia/Bangkok
  effective_until_date: string | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TaskDependency {
  id: string;
  user_id: string;
  weekly_schedule_id: string;
  predecessor_template_id: string;
  successor_template_id: string;
  created_at: string;
}

export interface CompletionEvidence {
  id: string;
  user_id: string;
  occurrence_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  uploaded_at: string;
  locked_at: string | null;
  preview_url?: string; // server-generated authorized URL (never public bucket)
}

export interface DailyTaskOccurrence {
  id: string;
  user_id: string;
  template_id: string;
  weekly_schedule_id: string;
  occurrence_date: string; // "YYYY-MM-DD" in Asia/Bangkok
  day_of_week: DayOfWeek;
  title: string;
  description: string;
  scheduled_time: string; // "HH:mm"
  scheduled_at: string; // ISO-8601 timestamptz
  duration_minutes: number;
  priority: TaskPriority;
  is_fixed_time: boolean;
  is_medically_prescribed: boolean;
  status: TaskStatus;
  completed_at: string | null;
  is_delayed: boolean;
  is_locked: boolean; // true once completed (immutable)
  can_edit_occurrence: boolean; // ALWAYS false for active incomplete & completed occurrences
  can_edit_future_template: boolean; // true only once current occurrence is completed (or for future dates)
  evidence: CompletionEvidence[];
  depends_on_occurrence_ids: string[];
  next_dependent_occurrence_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface TaskHistoryEntry {
  id: string;
  user_id: string;
  occurrence_id: string;
  event_type:
    | "occurrence_created"
    | "photo_uploaded"
    | "completed_confirmed"
    | "reminder_sent"
    | "dependent_notified"
    | "future_template_updated";
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ReminderPreference {
  id: string;
  user_id: string;
  reminders_enabled: boolean;
  repeat_interval_minutes: number; // default 15
  quiet_hours_enabled: boolean;
  quiet_hours_start: string; // "22:00"
  quiet_hours_end: string; // "06:00"
  browser_notifications_granted: boolean;
  updated_at: string;
}

export interface NotificationDeliveryLog {
  id: string;
  user_id: string;
  occurrence_id: string;
  notification_type: "start_reminder" | "repeat_reminder" | "next_dependent_ready";
  dedup_key: string;
  title: string;
  body: string;
  channel: "in_app" | "browser_push" | "cron_queue";
  delivered_at: string;
  read_at: string | null;
}

export interface DailySummaryMetrics {
  date: string;
  total_tasks: number;
  completed_tasks: number;
  incomplete_tasks: number;
  on_time_completions: number;
  delayed_completions: number;
  progress_percent: number;
}

export interface DailySummaryRecord {
  id: string;
  user_id: string;
  summary_date: string; // "YYYY-MM-DD"
  metrics: DailySummaryMetrics;
  encouraging_message: string;
  tone_category: "on_time_praise" | "delayed_empathy" | "incomplete_support" | "rest_day";
  ai_provider: string;
  used_fallback: boolean;
  generated_at: string;
}

export interface RestSuggestionRecord {
  id: string;
  user_id: string;
  suggestion_date: string; // "YYYY-MM-DD"
  gap_start: string; // "HH:mm"
  gap_end: string; // "HH:mm"
  duration_minutes: number;
  activity_title: string;
  description: string;
  supervision_safety_note: string;
  status: "suggested" | "accepted" | "dismissed" | "ignored";
  created_at: string;
  updated_at: string;
}

export interface ShareLinkRecord {
  id: string;
  user_id: string;
  weekly_schedule_id: string;
  token: string;
  scope: "day" | "week";
  target_date: string; // "YYYY-MM-DD"
  include_private_notes: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface SharedSchedulePayload {
  token: string;
  scope: "day" | "week";
  target_date: string;
  schedule_title: string;
  care_recipient_label: string;
  timezone: string;
  rest_days: DayOfWeek[];
  include_private_notes: boolean;
  expires_at: string | null;
  days: Array<{
    day_of_week: DayOfWeek;
    date: string;
    is_rest_day: boolean;
    tasks: Array<{
      title: string;
      scheduled_time: string;
      duration_minutes: number;
      priority: TaskPriority;
      is_medically_prescribed: boolean;
      notes?: string;
    }>;
  }>;
}

export interface AiOperationLog {
  id: string;
  user_id: string;
  operation_type: "schedule_generator" | "text_to_task" | "daily_summary" | "rest_suggestions";
  provider: string;
  model: string;
  used_fallback: boolean;
  status: "success" | "fallback" | "error";
  latency_ms: number;
  created_at: string;
}

// ============================================================
// AI Request / Response DTOs
// ============================================================

export interface DraftTaskInput {
  temp_id: string;
  title: string;
  description?: string;
  preferred_time?: string; // "HH:mm" optional
  duration_minutes?: number;
  priority?: TaskPriority;
  is_fixed_time?: boolean;
  is_medically_prescribed?: boolean;
  depends_on_temp_id?: string | null;
}

export interface ProposedScheduleTask {
  temp_id: string;
  title: string;
  description: string;
  scheduled_time: string; // "HH:mm"
  duration_minutes: number;
  priority: TaskPriority;
  is_fixed_time: boolean;
  is_medically_prescribed: boolean;
  depends_on_temp_id: string | null;
  rationale: string;
}

export interface AiScheduleProposalResponse {
  day_of_week: DayOfWeek;
  proposed_tasks: ProposedScheduleTask[];
  assumptions: string[];
  missing_info_questions: string[];
  medical_safety_note: string;
  summary_note: string;
  used_fallback: boolean;
  provider: string;
}

export interface TextToTaskExtractedItem {
  temp_id: string;
  day_of_week: DayOfWeek;
  title: string;
  description: string;
  preferred_time: string | null;
  duration_minutes: number;
  priority: TaskPriority;
  is_fixed_time: boolean;
  is_medically_prescribed: boolean;
  assumption_note?: string;
}

export interface TextToTaskResponse {
  raw_text: string;
  extracted_tasks: TextToTaskExtractedItem[];
  missing_info_questions: string[];
  used_fallback: boolean;
  provider: string;
}

export interface SessionState {
  authenticated: boolean;
  mode: StorageMode;
  supabase_configured: boolean;
  gemini_configured: boolean;
  user: UserProfile | null;
  care_recipient: CareRecipientProfile | null;
  weekly_schedule: WeeklyScheduleTemplate | null;
  reminder_preference: ReminderPreference | null;
}

// ============================================================
// Phase 7 — Apple Calendar-Style Custom Calendar Events
// ============================================================

export type CalendarEventRecurrence = "never" | "daily" | "weekly" | "monthly";

export interface CalendarEventRecord {
  id: string;
  user_id: string;
  title: string;
  description: string;
  start_date: string; // "YYYY-MM-DD" in Asia/Bangkok
  end_date: string; // "YYYY-MM-DD" in Asia/Bangkok
  start_time: string; // "HH:mm" (ignored when is_all_day = true)
  end_time: string; // "HH:mm"
  is_all_day: boolean;
  recurrence: CalendarEventRecurrence;
  until_date: string | null; // optional end date for recurrence ("YYYY-MM-DD")
  excluded_dates: string[]; // single occurrences deleted or split out
  reminder_minutes: number | null; // e.g., 0, 15, 30, 60, null = none
  created_at: string;
  updated_at: string;
}

export interface CalendarEventOccurrence {
  occurrence_key: string; // `${event_id}:${occurrence_date}`
  event_id: string;
  occurrence_date: string; // "YYYY-MM-DD"
  end_date: string; // "YYYY-MM-DD"
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  recurrence: CalendarEventRecurrence;
  reminder_minutes: number | null;
  is_recurring_instance: boolean;
}

export interface CreateCalendarEventInput {
  title: string;
  description?: string;
  start_date: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  is_all_day?: boolean;
  recurrence?: CalendarEventRecurrence;
  until_date?: string | null;
  reminder_minutes?: number | null;
}

export interface UpdateCalendarEventInput {
  title?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  is_all_day?: boolean;
  recurrence?: CalendarEventRecurrence;
  until_date?: string | null;
  reminder_minutes?: number | null;
  edit_scope?: "all" | "single" | "future";
  occurrence_date?: string; // required for "single" or "future" edits
}
