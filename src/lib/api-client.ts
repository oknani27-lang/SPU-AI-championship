import type {
  AiScheduleProposalResponse,
  CareRecipientProfile,
  CompletionEvidence,
  DailySummaryMetrics,
  DailySummaryRecord,
  DailyTaskOccurrence,
  DayOfWeek,
  DraftTaskInput,
  NotificationDeliveryLog,
  ProposedScheduleTask,
  RecurringTaskTemplate,
  ReminderPreference,
  RestSuggestionRecord,
  SessionState,
  SharedSchedulePayload,
  ShareLinkRecord,
  StorageMode,
  TaskDependency,
  TaskHistoryEntry,
  TaskPriority,
  TextToTaskResponse,
  UserProfile,
  WeeklyScheduleTemplate,
} from "@/types/careplan";

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function defaultThaiErrorForStatus(status: number): string {
  switch (status) {
    case 400:
      return "ข้อมูลไม่ครบถ้วนหรือไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง";
    case 401:
      return "กรุณาเข้าสู่ระบบก่อนใช้งาน";
    case 403:
      return "ไม่มีสิทธิ์ดำเนินการรายการนี้";
    case 404:
      return "ไม่พบข้อมูลที่ต้องการ";
    case 409:
      return "ไม่สามารถแก้ไขรายการนี้ได้ตามเงื่อนไขของระบบ";
    case 410:
      return "ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว";
    case 413:
      return "ขนาดไฟล์ใหญ่เกินกำหนด (สูงสุด 5 MB)";
    default:
      return "เกิดข้อผิดพลาดในการเชื่อมต่อกับเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง";
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    if (
      init?.body &&
      !(init.body instanceof FormData) &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }

    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต"
    );
  }

  let data: unknown = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const errObj =
      data && typeof data === "object"
        ? (data as { error?: string; message?: string; details?: unknown })
        : null;
    const message =
      errObj?.error ||
      errObj?.message ||
      defaultThaiErrorForStatus(response.status);
    throw new ApiError(response.status, message, errObj?.details);
  }

  return data as T;
}

// ============================================================
// Auth & Session
// ============================================================

export function getSession(): Promise<SessionState> {
  return apiRequest<SessionState>("/api/auth/session");
}

export function registerAccount(payload: {
  email: string;
  password: string;
  full_name: string;
  care_recipient_name?: string;
  care_recipient_age?: number | null;
}): Promise<{
  user: UserProfile;
  mode: StorageMode;
  requires_email_confirmation?: boolean;
}> {
  return apiRequest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loginAccount(payload: {
  email: string;
  password: string;
}): Promise<{ user: UserProfile; mode: StorageMode }> {
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startDemoSession(
  reset = false
): Promise<{ user: UserProfile; mode: "demo" }> {
  return apiRequest(reset ? "/api/auth/demo?reset=1" : "/api/auth/demo", {
    method: "POST",
    body: JSON.stringify({ reset }),
  });
}

export function logoutAccount(): Promise<{ ok: boolean }> {
  return apiRequest("/api/auth/logout", {
    method: "POST",
  });
}

// ============================================================
// Weekly Schedule & Templates
// ============================================================

export interface ScheduleResponse {
  weekly_schedule: WeeklyScheduleTemplate;
  templates: RecurringTaskTemplate[];
  dependencies: TaskDependency[];
}

export function getSchedule(): Promise<ScheduleResponse> {
  return apiRequest<ScheduleResponse>("/api/schedule");
}

export function updateRestDay(payload: {
  day_of_week: DayOfWeek;
  is_rest_day: boolean;
}): Promise<{
  weekly_schedule: WeeklyScheduleTemplate;
  medical_disclaimer: string;
}> {
  return apiRequest("/api/schedule/rest-day", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function approveSchedule(payload: {
  day_of_week: DayOfWeek;
  effective_from_date?: string;
  tasks: ProposedScheduleTask[];
}): Promise<{
  templates: RecurringTaskTemplate[];
  occurrences: DailyTaskOccurrence[];
}> {
  return apiRequest("/api/schedule/approve", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTemplateForFuture(
  templateId: string,
  payload: {
    title?: string;
    description?: string;
    scheduled_time?: string;
    duration_minutes?: number;
    priority?: TaskPriority;
    is_fixed_time?: boolean;
    is_medically_prescribed?: boolean;
    effective_from_date?: string;
  }
): Promise<{ template: RecurringTaskTemplate; message?: string }> {
  return apiRequest(`/api/templates/${encodeURIComponent(templateId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// ============================================================
// Daily Occurrences, Photo Proof & Immutable Completion
// ============================================================

export interface OccurrencesByDateResponse {
  date: string;
  day_of_week: DayOfWeek;
  is_rest_day: boolean;
  occurrences: DailyTaskOccurrence[];
  next_task: DailyTaskOccurrence | null;
}

export function getOccurrencesByDate(
  date: string
): Promise<OccurrencesByDateResponse> {
  return apiRequest<OccurrencesByDateResponse>(
    `/api/occurrences?date=${encodeURIComponent(date)}`
  );
}

export interface OccurrencesByWeekResponse {
  week_start?: string;
  days?: Array<{
    date: string;
    day_of_week: DayOfWeek;
    is_rest_day: boolean;
    occurrences: DailyTaskOccurrence[];
  }>;
  occurrences?: DailyTaskOccurrence[];
}

export function getOccurrencesByWeek(
  weekStart: string
): Promise<OccurrencesByWeekResponse> {
  return apiRequest<OccurrencesByWeekResponse>(
    `/api/occurrences?weekStart=${encodeURIComponent(weekStart)}`
  );
}

export interface OccurrenceDetailResponse {
  occurrence: DailyTaskOccurrence;
  history: TaskHistoryEntry[];
  next_dependent: DailyTaskOccurrence | null;
}

export function getOccurrenceDetail(
  id: string
): Promise<OccurrenceDetailResponse> {
  return apiRequest<OccurrenceDetailResponse>(
    `/api/occurrences/${encodeURIComponent(id)}`
  );
}

export function uploadOccurrenceEvidence(
  occurrenceId: string,
  file: File
): Promise<{ evidence: CompletionEvidence }> {
  const formData = new FormData();
  formData.append("file", file);
  return apiRequest(
    `/api/occurrences/${encodeURIComponent(occurrenceId)}/evidence`,
    {
      method: "POST",
      body: formData,
    }
  );
}

export function confirmOccurrenceCompletion(occurrenceId: string): Promise<{
  occurrence: DailyTaskOccurrence;
  next_dependent: DailyTaskOccurrence | null;
  notifications_created: NotificationDeliveryLog[];
}> {
  return apiRequest(
    `/api/occurrences/${encodeURIComponent(occurrenceId)}/confirm`,
    {
      method: "POST",
      body: JSON.stringify({}),
    }
  );
}

// ============================================================
// History (Read-Only)
// ============================================================

export function getHistory(limit = 50): Promise<{
  completed_occurrences: DailyTaskOccurrence[];
  history_events: TaskHistoryEntry[];
}> {
  return apiRequest(`/api/history?limit=${limit}`);
}

// ============================================================
// AI Features (Server-Only Gemini + Honest Fallback)
// ============================================================

export function extractTextToTask(payload: {
  text: string;
  default_day_of_week?: DayOfWeek;
}): Promise<TextToTaskResponse> {
  return apiRequest<TextToTaskResponse>("/api/ai/text-to-task", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function generateAiSchedule(payload: {
  day_of_week: DayOfWeek;
  tasks: DraftTaskInput[];
}): Promise<AiScheduleProposalResponse> {
  return apiRequest<AiScheduleProposalResponse>("/api/ai/schedule", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDailySummary(date: string): Promise<{
  summary: DailySummaryRecord | null;
  metrics: DailySummaryMetrics;
}> {
  return apiRequest(`/api/ai/daily-summary?date=${encodeURIComponent(date)}`);
}

export function generateDailySummary(date: string): Promise<{
  summary: DailySummaryRecord;
}> {
  return apiRequest("/api/ai/daily-summary", {
    method: "POST",
    body: JSON.stringify({ date }),
  });
}

export function getRestSuggestions(date: string): Promise<{
  suggestions: RestSuggestionRecord[];
}> {
  return apiRequest(
    `/api/ai/rest-suggestions?date=${encodeURIComponent(date)}`
  );
}

export function generateRestSuggestions(date: string): Promise<{
  suggestions: RestSuggestionRecord[];
}> {
  return apiRequest("/api/ai/rest-suggestions", {
    method: "POST",
    body: JSON.stringify({ date }),
  });
}

export function updateRestSuggestionStatus(
  id: string,
  status: "accepted" | "dismissed" | "ignored"
): Promise<{ suggestion: RestSuggestionRecord }> {
  return apiRequest(`/api/ai/rest-suggestions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// ============================================================
// Smart Reminders
// ============================================================

export function getReminders(): Promise<{
  preference: ReminderPreference;
  notifications: NotificationDeliveryLog[];
}> {
  return apiRequest("/api/reminders");
}

export function processReminders(payload?: {
  simulate_now?: string;
  date?: string;
}): Promise<{
  delivered: NotificationDeliveryLog[];
  skipped_reason?: string;
}> {
  return apiRequest("/api/reminders/process", {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

export function markReminderRead(
  id: string
): Promise<{ notification?: NotificationDeliveryLog; ok?: boolean }> {
  return apiRequest(`/api/reminders/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
  });
}

// ============================================================
// Share Schedule
// ============================================================

export function getShareLinks(): Promise<{ links: ShareLinkRecord[] }> {
  return apiRequest("/api/share");
}

export function createShareLink(payload: {
  scope: "day" | "week";
  target_date: string;
  include_private_notes: boolean;
  expires_in_days?: number | null;
}): Promise<{ link: ShareLinkRecord; share_url: string }> {
  return apiRequest("/api/share", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function revokeShareLink(
  id: string
): Promise<{ link: ShareLinkRecord }> {
  return apiRequest(`/api/share/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function getPublicSharedSchedule(
  token: string
): Promise<SharedSchedulePayload> {
  return apiRequest<SharedSchedulePayload>(
    `/api/share/public/${encodeURIComponent(token)}`
  );
}

// ============================================================
// Settings & Privacy
// ============================================================

export interface SettingsResponse {
  profile: UserProfile;
  care_recipient: CareRecipientProfile;
  reminder_preference: ReminderPreference;
}

export function getSettings(): Promise<SettingsResponse> {
  return apiRequest<SettingsResponse>("/api/settings");
}

export function updateSettings(payload: {
  profile?: Partial<Pick<UserProfile, "full_name" | "timezone">>;
  care_recipient?: Partial<
    Pick<
      CareRecipientProfile,
      | "display_name"
      | "age_years"
      | "mobility_level"
      | "care_notes"
      | "requires_supervision"
    >
  >;
  reminder_preference?: Partial<
    Pick<
      ReminderPreference,
      | "reminders_enabled"
      | "repeat_interval_minutes"
      | "quiet_hours_enabled"
      | "quiet_hours_start"
      | "quiet_hours_end"
      | "browser_notifications_granted"
    >
  >;
}): Promise<SettingsResponse> {
  return apiRequest<SettingsResponse>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function submitDeletionRequest(payload: {
  reason: string;
  confirm_email: string;
}): Promise<{ request_id: string; status: string; message: string }> {
  return apiRequest("/api/privacy/deletion-request", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
