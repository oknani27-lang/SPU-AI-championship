import type {
  AiOperationLog,
  CareRecipientProfile,
  CompletionEvidence,
  DailySummaryMetrics,
  DailySummaryRecord,
  DailyTaskOccurrence,
  DayOfWeek,
  NotificationDeliveryLog,
  ProposedScheduleTask,
  RecurringTaskTemplate,
  ReminderPreference,
  RestSuggestionRecord,
  ShareLinkRecord,
  SharedSchedulePayload,
  StorageMode,
  TaskDependency,
  TaskHistoryEntry,
  TaskPriority,
  UserProfile,
  WeeklyScheduleTemplate,
} from "@/types/careplan";

export interface RegisterUserInput {
  email: string;
  password: string;
  full_name: string;
  care_recipient_name?: string;
  care_recipient_age?: number | null;
}

export interface RegisterUserResult {
  user: UserProfile;
  mode: StorageMode;
  access_token?: string;
  refresh_token?: string;
  requires_email_confirmation?: boolean;
}

export interface LoginUserInput {
  email: string;
  password: string;
}

export interface LoginUserResult {
  user: UserProfile;
  mode: StorageMode;
  access_token?: string;
  refresh_token?: string;
}

export interface UserBootstrapData {
  user: UserProfile;
  care_recipient: CareRecipientProfile;
  weekly_schedule: WeeklyScheduleTemplate;
  reminder_preference: ReminderPreference;
}

export interface ApproveScheduleInput {
  day_of_week: DayOfWeek;
  effective_from_date?: string;
  tasks: ProposedScheduleTask[];
}

export interface UpdateTemplatePatch {
  title?: string;
  description?: string;
  scheduled_time?: string;
  duration_minutes?: number;
  priority?: TaskPriority;
  is_fixed_time?: boolean;
  is_medically_prescribed?: boolean;
  effective_from_date?: string;
}

export interface OccurrencesForDateResult {
  date: string;
  day_of_week: DayOfWeek;
  is_rest_day: boolean;
  occurrences: DailyTaskOccurrence[];
  next_task: DailyTaskOccurrence | null;
}

export interface OccurrencesForWeekResult {
  week_start: string;
  days: Array<{
    date: string;
    day_of_week: DayOfWeek;
    is_rest_day: boolean;
    occurrences: DailyTaskOccurrence[];
  }>;
  occurrences: DailyTaskOccurrence[];
  next_task: DailyTaskOccurrence | null;
}

export interface OccurrenceDetailResult {
  occurrence: DailyTaskOccurrence;
  history: TaskHistoryEntry[];
  next_dependent: DailyTaskOccurrence | null;
}

export interface ConfirmCompletionResult {
  occurrence: DailyTaskOccurrence;
  next_dependent: DailyTaskOccurrence | null;
  notifications_created: NotificationDeliveryLog[];
}

export interface UploadEvidenceInput {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}

export interface SettingsUpdateInput {
  profile?: {
    full_name?: string;
    timezone?: string;
  };
  care_recipient?: {
    display_name?: string;
    age_years?: number | null;
    mobility_level?: "independent" | "homebound" | "bedbound";
    care_notes?: string;
    requires_supervision?: boolean;
  };
  reminder_preference?: {
    reminders_enabled?: boolean;
    repeat_interval_minutes?: number;
    quiet_hours_enabled?: boolean;
    quiet_hours_start?: string;
    quiet_hours_end?: string;
    browser_notifications_granted?: boolean;
  };
}

export interface CreateShareLinkInput {
  scope: "day" | "week";
  target_date: string;
  include_private_notes: boolean;
  expires_in_days?: number | null;
}

export interface CreateNotificationInput {
  occurrence_id: string;
  notification_type: "start_reminder" | "repeat_reminder" | "next_dependent_ready";
  dedup_key: string;
  title: string;
  body: string;
  channel: "in_app" | "browser_push" | "cron_queue";
}

export interface CarePlanStore {
  readonly mode: StorageMode;

  // Auth & Bootstrapping
  registerUser(input: RegisterUserInput): Promise<RegisterUserResult>;
  loginUser(input: LoginUserInput): Promise<LoginUserResult>;
  ensureDemoUser(options?: {
    reset?: boolean;
    email?: string;
    full_name?: string;
    seedSampleTasks?: boolean;
  }): Promise<{ user: UserProfile }>;
  getUserBootstrap(userId: string): Promise<UserBootstrapData | null>;

  // Weekly Schedule & Templates
  getSchedule(userId: string): Promise<{
    weekly_schedule: WeeklyScheduleTemplate;
    templates: RecurringTaskTemplate[];
    dependencies: TaskDependency[];
  }>;
  setRestDay(
    userId: string,
    dayOfWeek: DayOfWeek,
    isRestDay: boolean
  ): Promise<{
    weekly_schedule: WeeklyScheduleTemplate;
    medical_disclaimer: string;
  }>;
  approveScheduleTasks(
    userId: string,
    input: ApproveScheduleInput
  ): Promise<{
    templates: RecurringTaskTemplate[];
    occurrences: DailyTaskOccurrence[];
  }>;
  updateTemplateForFuture(
    userId: string,
    templateId: string,
    patch: UpdateTemplatePatch,
    referenceDate?: string
  ): Promise<{
    previous_template: RecurringTaskTemplate;
    template: RecurringTaskTemplate;
  }>;

  // Occurrences, Evidence & Immutable Completion
  getOccurrencesForDate(
    userId: string,
    date: string
  ): Promise<OccurrencesForDateResult>;
  getOccurrencesForWeek(
    userId: string,
    weekStart: string
  ): Promise<OccurrencesForWeekResult>;
  getOccurrenceDetail(
    userId: string,
    occurrenceId: string
  ): Promise<OccurrenceDetailResult>;
  rejectOccurrenceEdit(userId: string, occurrenceId: string): Promise<never>;
  rejectOccurrenceDelete(userId: string, occurrenceId: string): Promise<never>;
  uploadCompletionEvidence(
    userId: string,
    occurrenceId: string,
    input: UploadEvidenceInput
  ): Promise<{ evidence: CompletionEvidence }>;
  getEvidenceFile(
    userId: string,
    evidenceId: string
  ): Promise<{ evidence: CompletionEvidence; bytes: Buffer }>;
  confirmOccurrenceCompletion(
    userId: string,
    occurrenceId: string,
    completedAt?: Date
  ): Promise<ConfirmCompletionResult>;

  // History (Read-Only)
  getHistory(
    userId: string,
    limit?: number
  ): Promise<{
    completed_occurrences: DailyTaskOccurrence[];
    history_events: TaskHistoryEntry[];
  }>;

  // Daily Summaries, Rest Suggestions & AI Logs
  getDailySummary(
    userId: string,
    date: string
  ): Promise<{
    summary: DailySummaryRecord | null;
    metrics: DailySummaryMetrics;
  }>;
  saveDailySummary(
    userId: string,
    summary: Omit<DailySummaryRecord, "id" | "user_id" | "generated_at">
  ): Promise<DailySummaryRecord>;
  getRestSuggestions(
    userId: string,
    date: string
  ): Promise<RestSuggestionRecord[]>;
  replaceRestSuggestions(
    userId: string,
    date: string,
    suggestions: Array<
      Omit<RestSuggestionRecord, "id" | "user_id" | "created_at" | "updated_at">
    >
  ): Promise<RestSuggestionRecord[]>;
  updateRestSuggestionStatus(
    userId: string,
    suggestionId: string,
    status: "accepted" | "dismissed" | "ignored"
  ): Promise<RestSuggestionRecord>;
  logAiOperation(
    userId: string,
    entry: Omit<AiOperationLog, "id" | "user_id" | "created_at">
  ): Promise<AiOperationLog>;

  // Smart Reminders
  getReminders(userId: string): Promise<{
    preference: ReminderPreference;
    notifications: NotificationDeliveryLog[];
  }>;
  listAllActiveUserIds(): Promise<string[]>;
  createNotificationIfAbsent(
    userId: string,
    input: CreateNotificationInput
  ): Promise<NotificationDeliveryLog | null>;
  markNotificationRead(
    userId: string,
    notificationId: string
  ): Promise<NotificationDeliveryLog>;

  // Share Links
  listShareLinks(userId: string): Promise<ShareLinkRecord[]>;
  createShareLink(
    userId: string,
    input: CreateShareLinkInput
  ): Promise<ShareLinkRecord>;
  revokeShareLink(userId: string, linkId: string): Promise<ShareLinkRecord>;
  getPublicSharedSchedule(
    token: string,
    now?: Date
  ): Promise<SharedSchedulePayload>;

  // Settings & Privacy
  getSettings(userId: string): Promise<{
    profile: UserProfile;
    care_recipient: CareRecipientProfile;
    reminder_preference: ReminderPreference;
  }>;
  updateSettings(
    userId: string,
    patch: SettingsUpdateInput
  ): Promise<{
    profile: UserProfile;
    care_recipient: CareRecipientProfile;
    reminder_preference: ReminderPreference;
  }>;
  createPrivacyDeletionRequest(
    userId: string,
    reason?: string
  ): Promise<{
    request_id: string;
    status: "recorded";
    message: string;
  }>;
}

export const ALLOWED_EVIDENCE_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024; // 5 MB

export const REST_DAY_MEDICAL_DISCLAIMER =
  "วันพักผ่อนใน CarePlan จะหยุดเฉพาะการสร้างตารางและแจ้งเตือนในแอปพลิเคชันเท่านั้น ไม่ถือเป็นการงดยา หรือหยุดการดูแลทางการแพทย์ที่จำเป็นสำหรับผู้สูงอายุ";

export function computeDailyMetrics(
  date: string,
  occurrences: DailyTaskOccurrence[]
): DailySummaryMetrics {
  const total = occurrences.length;
  const completed = occurrences.filter((o) => o.status === "completed");
  const onTime = completed.filter((o) => !o.is_delayed).length;
  const delayed = completed.filter((o) => o.is_delayed).length;
  const incomplete = total - completed.length;
  const progressPercent = total === 0 ? 0 : Math.round((completed.length / total) * 100);

  return {
    date,
    total_tasks: total,
    completed_tasks: completed.length,
    incomplete_tasks: incomplete,
    on_time_completions: onTime,
    delayed_completions: delayed,
    progress_percent: progressPercent,
  };
}
