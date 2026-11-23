import crypto from "crypto";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AiOperationLog,
  CalendarEventOccurrence,
  CalendarEventRecord,
  CareRecipientProfile,
  CompletionEvidence,
  CreateCalendarEventInput,
  DailySummaryMetrics,
  DailySummaryRecord,
  DailyTaskOccurrence,
  DayOfWeek,
  NotificationDeliveryLog,
  RecurringTaskTemplate,
  ReminderPreference,
  RestSuggestionRecord,
  ShareLinkRecord,
  SharedSchedulePayload,
  TaskDependency,
  TaskHistoryEntry,
  UpdateCalendarEventInput,
  UserProfile,
  WeeklyScheduleTemplate,
} from "@/types/careplan";
import {
  diffCalendarDays,
  expandCalendarEventsForRange,
  normalizeCalendarEventInput,
} from "@/lib/calendar-events";
import { getServerEnv } from "@/lib/env";
import {
  ForbiddenError,
  ForbiddenRuleError,
  GoneError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import {
  THAI_TIMEZONE,
  addDays,
  buildThaiDateTimeIso,
  getThaiDayOfWeek,
  getThaiTodayDate,
  getThaiWeekDates,
  isValidDateString,
  isValidHHMM,
} from "@/lib/timezone";
import {
  ALLOWED_EVIDENCE_MIME_TYPES,
  MAX_EVIDENCE_BYTES,
  REST_DAY_MEDICAL_DISCLAIMER,
  computeDailyMetrics,
  type ApproveScheduleInput,
  type CarePlanStore,
  type ConfirmCompletionResult,
  type CreateNotificationInput,
  type CreateShareLinkInput,
  type LoginUserInput,
  type LoginUserResult,
  type OccurrenceDetailResult,
  type OccurrencesForDateResult,
  type OccurrencesForWeekResult,
  type RegisterUserInput,
  type RegisterUserResult,
  type SettingsUpdateInput,
  type UpdateTemplatePatch,
  type UploadEvidenceInput,
  type UserBootstrapData,
} from "@/lib/store/types";

const EVIDENCE_BUCKET = "careplan-evidence";

interface DbOccurrenceRow {
  id: string;
  user_id: string;
  template_id: string;
  weekly_schedule_id: string;
  occurrence_date: string;
  day_of_week: number;
  title: string;
  description: string;
  scheduled_time: string;
  scheduled_at: string;
  duration_minutes: number;
  priority: DailyTaskOccurrence["priority"];
  is_fixed_time: boolean;
  is_medically_prescribed: boolean;
  status: DailyTaskOccurrence["status"];
  completed_at: string | null;
  is_delayed: boolean;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name || "evidence.jpg");
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "evidence.jpg";
}

function extensionFromMime(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/heic":
    case "image/heif":
      return ".heic";
    default:
      return ".jpg";
  }
}

export class SupabaseStore implements CarePlanStore {
  public readonly mode = "supabase" as const;
  private readonly adminClient: SupabaseClient;
  private readonly authClient: SupabaseClient;

  constructor() {
    const env = getServerEnv();
    if (!env.supabaseUrl || !env.supabasePublishableKey || !env.supabaseSecretKey) {
      throw new Error("Supabase environment variables are not fully configured");
    }

    this.adminClient = createClient(env.supabaseUrl, env.supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    this.authClient = createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  public async verifyAccessToken(
    accessToken: string
  ): Promise<{ id: string; email: string } | null> {
    const { data, error } = await this.authClient.auth.getUser(accessToken);
    if (error || !data.user) {
      return null;
    }
    return {
      id: data.user.id,
      email: data.user.email ?? "",
    };
  }

  public async isSchemaReady(): Promise<boolean> {
    const { error } = await this.adminClient
      .from("careplan_user_profiles")
      .select("id")
      .limit(1);
    return !error;
  }

  private async ensureUserBootstrap(
    userId: string,
    email: string,
    fullName = "ผู้ดูแล",
    careRecipientName = "คุณแม่",
    careRecipientAge: number | null = 72
  ): Promise<UserBootstrapData> {
    const existing = await this.getUserBootstrap(userId);
    if (existing) {
      return existing;
    }

    const { data: profile, error: profileErr } = await this.adminClient
      .from("careplan_user_profiles")
      .upsert(
        {
          id: userId,
          email,
          full_name: fullName,
          timezone: THAI_TIMEZONE,
        },
        { onConflict: "id" }
      )
      .select("*")
      .single<UserProfile>();

    if (profileErr || !profile) {
      throw new Error(`Failed to initialize user profile: ${profileErr?.message}`);
    }

    const { data: recipient, error: recErr } = await this.adminClient
      .from("careplan_care_recipients")
      .insert({
        user_id: userId,
        display_name: careRecipientName,
        age_years: careRecipientAge,
        mobility_level: "homebound",
        care_notes:
          "ต้องรับประทานยาตามเวลาที่แพทย์กำหนด และมีผู้ดูแลใกล้ชิดอยู่เสมอ",
        requires_supervision: true,
      })
      .select("*")
      .single<CareRecipientProfile>();

    if (recErr || !recipient) {
      throw new Error(`Failed to initialize care recipient: ${recErr?.message}`);
    }

    const { data: schedule, error: schedErr } = await this.adminClient
      .from("careplan_weekly_schedules")
      .insert({
        user_id: userId,
        care_recipient_id: recipient.id,
        title: `ตารางดูแลประจำสัปดาห์ (${careRecipientName})`,
        timezone: THAI_TIMEZONE,
        rest_days: [7],
        is_active: true,
      })
      .select("*")
      .single<WeeklyScheduleTemplate>();

    if (schedErr || !schedule) {
      throw new Error(`Failed to initialize weekly schedule: ${schedErr?.message}`);
    }

    const { data: pref, error: prefErr } = await this.adminClient
      .from("careplan_reminder_preferences")
      .upsert(
        {
          user_id: userId,
          reminders_enabled: true,
          repeat_interval_minutes: 15,
          quiet_hours_enabled: true,
          quiet_hours_start: "22:00",
          quiet_hours_end: "06:00",
          browser_notifications_granted: false,
        },
        { onConflict: "user_id" }
      )
      .select("*")
      .single<ReminderPreference>();

    if (prefErr || !pref) {
      throw new Error(`Failed to initialize reminder preferences: ${prefErr?.message}`);
    }

    return {
      user: profile,
      care_recipient: recipient,
      weekly_schedule: {
        ...schedule,
        rest_days: (schedule.rest_days ?? []).map((d) => Number(d) as DayOfWeek),
      },
      reminder_preference: pref,
    };
  }

  private async requireBootstrap(userId: string): Promise<UserBootstrapData> {
    const data = await this.getUserBootstrap(userId);
    if (!data) {
      throw new UnauthorizedError("ไม่พบบัญชีผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่");
    }
    return data;
  }

  private async hydrateOccurrences(
    userId: string,
    rows: DbOccurrenceRow[]
  ): Promise<DailyTaskOccurrence[]> {
    if (rows.length === 0) return [];

    const occurrenceIds = rows.map((r) => r.id);
    const dates = Array.from(new Set(rows.map((r) => r.occurrence_date)));
    const templateIds = Array.from(new Set(rows.map((r) => r.template_id)));

    const [evidenceRes, depsRes, sameDayRes] = await Promise.all([
      this.adminClient
        .from("careplan_completion_evidence")
        .select("*")
        .eq("user_id", userId)
        .in("occurrence_id", occurrenceIds)
        .order("uploaded_at", { ascending: true }),
      this.adminClient
        .from("careplan_task_dependencies")
        .select("*")
        .eq("user_id", userId),
      this.adminClient
        .from("careplan_daily_task_occurrences")
        .select("id, template_id, occurrence_date, status")
        .eq("user_id", userId)
        .in("occurrence_date", dates),
    ]);

    const evidenceList = (evidenceRes.data ?? []) as CompletionEvidence[];
    const dependencies = (depsRes.data ?? []) as TaskDependency[];
    const sameDayRows = (sameDayRes.data ?? []) as Array<{
      id: string;
      template_id: string;
      occurrence_date: string;
      status: string;
    }>;

    const todayDate = getThaiTodayDate();
    const currentWeekEnd = getThaiWeekDates(todayDate)[6].date;

    // Check active incomplete occurrences in current week for these templates
    const { data: activeIncRows } = await this.adminClient
      .from("careplan_daily_task_occurrences")
      .select("template_id")
      .eq("user_id", userId)
      .eq("status", "incomplete")
      .lte("occurrence_date", currentWeekEnd)
      .in("template_id", templateIds);

    const blockedTemplateIds = new Set(
      ((activeIncRows ?? []) as Array<{ template_id: string }>).map(
        (r) => r.template_id
      )
    );

    return rows.map((row) => {
      const ev = evidenceList
        .filter((e) => e.occurrence_id === row.id)
        .map((e) => ({
          ...e,
          preview_url: `/api/evidence/${e.id}`,
        }));

      const daySiblings = sameDayRows.filter(
        (s) => s.occurrence_date === row.occurrence_date
      );
      const predTemplateIds = dependencies
        .filter((d) => d.successor_template_id === row.template_id)
        .map((d) => d.predecessor_template_id);
      const succTemplateIds = dependencies
        .filter((d) => d.predecessor_template_id === row.template_id)
        .map((d) => d.successor_template_id);

      const dependsOnIds = daySiblings
        .filter((s) => predTemplateIds.includes(s.template_id))
        .map((s) => s.id);
      const nextDepIds = daySiblings
        .filter((s) => succTemplateIds.includes(s.template_id))
        .map((s) => s.id);

      const canEditFuture =
        row.status === "completed" ||
        (row.occurrence_date > currentWeekEnd &&
          !blockedTemplateIds.has(row.template_id));

      return {
        ...row,
        day_of_week: Number(row.day_of_week) as DayOfWeek,
        can_edit_occurrence: false,
        can_edit_future_template: canEditFuture,
        evidence: ev,
        depends_on_occurrence_ids: dependsOnIds,
        next_dependent_occurrence_ids: nextDepIds,
      };
    });
  }

  private async materializeDate(
    userId: string,
    date: string
  ): Promise<{ dayOfWeek: DayOfWeek; isRestDay: boolean }> {
    const { weekly_schedule } = await this.requireBootstrap(userId);
    const dayOfWeek = getThaiDayOfWeek(date);
    const isRestDay = weekly_schedule.rest_days.includes(dayOfWeek);

    if (isRestDay) {
      return { dayOfWeek, isRestDay: true };
    }

    const { data: templates } = await this.adminClient
      .from("careplan_recurring_task_templates")
      .select("*")
      .eq("user_id", userId)
      .eq("weekly_schedule_id", weekly_schedule.id)
      .eq("day_of_week", dayOfWeek)
      .eq("is_active", true)
      .lte("effective_from_date", date);

    const effectiveTemplates = ((templates ?? []) as RecurringTaskTemplate[]).filter(
      (t) => t.effective_until_date === null || t.effective_until_date >= date
    );

    if (effectiveTemplates.length === 0) {
      return { dayOfWeek, isRestDay: false };
    }

    const { data: existingRows } = await this.adminClient
      .from("careplan_daily_task_occurrences")
      .select("template_id")
      .eq("user_id", userId)
      .eq("occurrence_date", date);

    const existingSet = new Set(
      ((existingRows ?? []) as Array<{ template_id: string }>).map(
        (r) => r.template_id
      )
    );

    const toInsert = effectiveTemplates
      .filter((t) => !existingSet.has(t.id))
      .map((t) => ({
        user_id: userId,
        template_id: t.id,
        weekly_schedule_id: weekly_schedule.id,
        occurrence_date: date,
        day_of_week: dayOfWeek,
        title: t.title,
        description: t.description,
        scheduled_time: t.scheduled_time,
        scheduled_at: buildThaiDateTimeIso(date, t.scheduled_time),
        duration_minutes: t.duration_minutes,
        priority: t.priority,
        is_fixed_time: t.is_fixed_time,
        is_medically_prescribed: t.is_medically_prescribed,
        status: "incomplete",
        is_delayed: false,
        is_locked: false,
      }));

    if (toInsert.length > 0) {
      const { data: inserted } = await this.adminClient
        .from("careplan_daily_task_occurrences")
        .upsert(toInsert, {
          onConflict: "template_id,occurrence_date",
          ignoreDuplicates: true,
        })
        .select("id, template_id, occurrence_date, scheduled_time");

      const insertedRows = (inserted ?? []) as Array<{
        id: string;
        template_id: string;
        occurrence_date: string;
        scheduled_time: string;
      }>;

      if (insertedRows.length > 0) {
        await this.adminClient.from("careplan_task_history").insert(
          insertedRows.map((row) => ({
            user_id: userId,
            occurrence_id: row.id,
            event_type: "occurrence_created",
            metadata: {
              template_id: row.template_id,
              occurrence_date: row.occurrence_date,
              scheduled_time: row.scheduled_time,
            },
          }))
        );
      }
    }

    return { dayOfWeek, isRestDay: false };
  }

  // ---------------------------------------------------------------------------
  // Auth & Bootstrapping
  // ---------------------------------------------------------------------------

  async registerUser(input: RegisterUserInput): Promise<RegisterUserResult> {
    const email = input.email.trim().toLowerCase();
    const { data, error } = await this.authClient.auth.signUp({
      email,
      password: input.password,
      options: {
        data: { full_name: input.full_name.trim() || "ผู้ดูแล" },
      },
    });

    if (error || !data.user) {
      throw new ValidationError(error?.message ?? "ไม่สามารถสมัครสมาชิกได้");
    }

    const bootstrap = await this.ensureUserBootstrap(
      data.user.id,
      email,
      input.full_name.trim() || "ผู้ดูแล",
      input.care_recipient_name?.trim() || "คุณแม่",
      input.care_recipient_age ?? 72
    );

    return {
      user: bootstrap.user,
      mode: "supabase",
      access_token: data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      requires_email_confirmation: !data.session,
    };
  }

  async loginUser(input: LoginUserInput): Promise<LoginUserResult> {
    const email = input.email.trim().toLowerCase();
    const { data, error } = await this.authClient.auth.signInWithPassword({
      email,
      password: input.password,
    });

    if (error || !data.user || !data.session) {
      throw new UnauthorizedError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    }

    const fullName =
      typeof data.user.user_metadata?.full_name === "string"
        ? data.user.user_metadata.full_name
        : "ผู้ดูแล";

    const bootstrap = await this.ensureUserBootstrap(
      data.user.id,
      email,
      fullName
    );

    return {
      user: bootstrap.user,
      mode: "supabase",
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    };
  }

  async ensureDemoUser(): Promise<{ user: UserProfile }> {
    throw new ForbiddenRuleError(
      "โหมดสาธิตใช้พื้นที่จัดเก็บเฉพาะ Demo Store กรุณาเรียกผ่าน DemoFileStore"
    );
  }

  async getUserBootstrap(userId: string): Promise<UserBootstrapData | null> {
    const [profileRes, recipientRes, schedRes, prefRes] = await Promise.all([
      this.adminClient
        .from("careplan_user_profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle<UserProfile>(),
      this.adminClient
        .from("careplan_care_recipients")
        .select("*")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle<CareRecipientProfile>(),
      this.adminClient
        .from("careplan_weekly_schedules")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle<WeeklyScheduleTemplate>(),
      this.adminClient
        .from("careplan_reminder_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle<ReminderPreference>(),
    ]);

    if (
      !profileRes.data ||
      !recipientRes.data ||
      !schedRes.data ||
      !prefRes.data
    ) {
      return null;
    }

    return {
      user: profileRes.data,
      care_recipient: recipientRes.data,
      weekly_schedule: {
        ...schedRes.data,
        rest_days: (schedRes.data.rest_days ?? []).map(
          (d) => Number(d) as DayOfWeek
        ),
      },
      reminder_preference: prefRes.data,
    };
  }

  // ---------------------------------------------------------------------------
  // Weekly Schedule & Templates
  // ---------------------------------------------------------------------------

  async getSchedule(userId: string): Promise<{
    weekly_schedule: WeeklyScheduleTemplate;
    templates: RecurringTaskTemplate[];
    dependencies: TaskDependency[];
  }> {
    const { weekly_schedule } = await this.requireBootstrap(userId);
    const [tplRes, depRes] = await Promise.all([
      this.adminClient
        .from("careplan_recurring_task_templates")
        .select("*")
        .eq("user_id", userId)
        .eq("weekly_schedule_id", weekly_schedule.id)
        .eq("is_active", true)
        .order("day_of_week", { ascending: true })
        .order("scheduled_time", { ascending: true }),
      this.adminClient
        .from("careplan_task_dependencies")
        .select("*")
        .eq("user_id", userId)
        .eq("weekly_schedule_id", weekly_schedule.id),
    ]);

    const templates = ((tplRes.data ?? []) as RecurringTaskTemplate[]).map(
      (t) => ({
        ...t,
        day_of_week: Number(t.day_of_week) as DayOfWeek,
      })
    );

    return {
      weekly_schedule,
      templates,
      dependencies: (depRes.data ?? []) as TaskDependency[],
    };
  }

  async setRestDay(
    userId: string,
    dayOfWeek: DayOfWeek,
    isRestDay: boolean
  ): Promise<{
    weekly_schedule: WeeklyScheduleTemplate;
    medical_disclaimer: string;
  }> {
    const { weekly_schedule } = await this.requireBootstrap(userId);
    const nextSet = new Set<DayOfWeek>(weekly_schedule.rest_days);
    if (isRestDay) nextSet.add(dayOfWeek);
    else nextSet.delete(dayOfWeek);

    const restDays = Array.from(nextSet).sort((a, b) => a - b);
    const { data, error } = await this.adminClient
      .from("careplan_weekly_schedules")
      .update({ rest_days: restDays })
      .eq("id", weekly_schedule.id)
      .eq("user_id", userId)
      .select("*")
      .single<WeeklyScheduleTemplate>();

    if (error || !data) {
      throw new Error(`Failed to update rest day: ${error?.message}`);
    }

    return {
      weekly_schedule: {
        ...data,
        rest_days: (data.rest_days ?? []).map((d) => Number(d) as DayOfWeek),
      },
      medical_disclaimer: REST_DAY_MEDICAL_DISCLAIMER,
    };
  }

  async approveScheduleTasks(
    userId: string,
    input: ApproveScheduleInput
  ): Promise<{
    templates: RecurringTaskTemplate[];
    occurrences: DailyTaskOccurrence[];
  }> {
    if (!input.tasks || input.tasks.length === 0) {
      throw new ValidationError("ต้องมีอย่างน้อย 1 รายการงานเพื่อบันทึกตาราง");
    }

    const { weekly_schedule } = await this.requireBootstrap(userId);
    const todayDate = getThaiTodayDate();

    let effectiveFromDate = input.effective_from_date;
    if (effectiveFromDate) {
      if (!isValidDateString(effectiveFromDate)) {
        throw new ValidationError("รูปแบบวันที่ effective_from_date ไม่ถูกต้อง");
      }
    } else {
      const currentWeek = getThaiWeekDates(todayDate);
      effectiveFromDate =
        currentWeek.find((d) => d.day_of_week === input.day_of_week)?.date ??
        todayDate;
    }

    const tempIdToId = new Map<string, string>();
    const rowsToInsert = input.tasks.map((task) => {
      if (!task.title.trim()) {
        throw new ValidationError("ชื่องานต้องไม่ว่างเปล่า");
      }
      if (!isValidHHMM(task.scheduled_time)) {
        throw new ValidationError(`เวลาไม่ถูกต้อง: ${task.scheduled_time}`);
      }
      const id = crypto.randomUUID();
      tempIdToId.set(task.temp_id, id);
      return {
        id,
        user_id: userId,
        weekly_schedule_id: weekly_schedule.id,
        day_of_week: input.day_of_week,
        title: task.title.trim(),
        description: (task.description ?? "").trim(),
        scheduled_time: task.scheduled_time,
        duration_minutes: Math.max(5, Math.min(720, Math.round(task.duration_minutes))),
        priority: task.priority,
        is_fixed_time: Boolean(task.is_fixed_time),
        is_medically_prescribed: Boolean(task.is_medically_prescribed),
        effective_from_date: effectiveFromDate,
        effective_until_date: null,
        version: 1,
        is_active: true,
      };
    });

    const { data: insertedTemplates, error } = await this.adminClient
      .from("careplan_recurring_task_templates")
      .insert(rowsToInsert)
      .select("*");

    if (error || !insertedTemplates) {
      throw new Error(`Failed to save templates: ${error?.message}`);
    }

    const depInserts = input.tasks
      .filter((t) => Boolean(t.depends_on_temp_id))
      .map((t) => {
        const predId = tempIdToId.get(t.depends_on_temp_id!);
        const succId = tempIdToId.get(t.temp_id);
        if (!predId || !succId || predId === succId) return null;
        return {
          user_id: userId,
          weekly_schedule_id: weekly_schedule.id,
          predecessor_template_id: predId,
          successor_template_id: succId,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);

    if (depInserts.length > 0) {
      await this.adminClient
        .from("careplan_task_dependencies")
        .insert(depInserts);
    }

    const targetDate =
      getThaiDayOfWeek(effectiveFromDate) === input.day_of_week
        ? effectiveFromDate
        : getThaiWeekDates(effectiveFromDate).find(
            (d) => d.day_of_week === input.day_of_week
          )?.date ?? effectiveFromDate;

    await this.materializeDate(userId, targetDate);

    const createdIds = rowsToInsert.map((r) => r.id);
    const { data: occRows } = await this.adminClient
      .from("careplan_daily_task_occurrences")
      .select("*")
      .eq("user_id", userId)
      .eq("occurrence_date", targetDate)
      .in("template_id", createdIds)
      .order("scheduled_time", { ascending: true });

    const occurrences = await this.hydrateOccurrences(
      userId,
      (occRows ?? []) as DbOccurrenceRow[]
    );

    const templates = (insertedTemplates as RecurringTaskTemplate[]).map((t) => ({
      ...t,
      day_of_week: Number(t.day_of_week) as DayOfWeek,
    }));

    return { templates, occurrences };
  }

  async updateTemplateForFuture(
    userId: string,
    templateId: string,
    patch: UpdateTemplatePatch,
    referenceDate?: string
  ): Promise<{
    previous_template: RecurringTaskTemplate;
    template: RecurringTaskTemplate;
  }> {
    const { data: oldTpl } = await this.adminClient
      .from("careplan_recurring_task_templates")
      .select("*")
      .eq("id", templateId)
      .maybeSingle<RecurringTaskTemplate>();

    if (!oldTpl) {
      throw new NotFoundError("ไม่พบแม่แบบงานประจำที่ต้องการแก้ไข");
    }
    if (oldTpl.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์แก้ไขแม่แบบงานของผู้อื่น");
    }
    if (patch.scheduled_time !== undefined && !isValidHHMM(patch.scheduled_time)) {
      throw new ValidationError("รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น HH:mm)");
    }

    const todayDate = referenceDate ?? getThaiTodayDate();
    const currentWeek = getThaiWeekDates(todayDate);
    const currentWeekEnd = currentWeek[6].date;
    const currentWeekDayDate =
      currentWeek.find((d) => d.day_of_week === Number(oldTpl.day_of_week))
        ?.date ?? todayDate;

    if (
      oldTpl.effective_from_date <= currentWeekDayDate &&
      (oldTpl.effective_until_date === null ||
        oldTpl.effective_until_date >= currentWeekDayDate)
    ) {
      await this.materializeDate(userId, currentWeekDayDate);
    }

    const { data: blocking } = await this.adminClient
      .from("careplan_daily_task_occurrences")
      .select("id, occurrence_date")
      .eq("user_id", userId)
      .eq("template_id", oldTpl.id)
      .eq("status", "incomplete")
      .lte("occurrence_date", currentWeekEnd)
      .limit(1)
      .maybeSingle<{ id: string; occurrence_date: string }>();

    if (blocking) {
      throw new ForbiddenRuleError(
        "ต้องยืนยันการทำงานรอบปัจจุบันให้เสร็จก่อน จึงจะแก้ไขแผนสำหรับสัปดาห์ถัดไปได้",
        "ACTIVE_INCOMPLETE_OCCURRENCE_BLOCKS_EDIT",
        {
          blocking_occurrence_id: blocking.id,
          occurrence_date: blocking.occurrence_date,
        }
      );
    }

    const { data: latestCompleted } = await this.adminClient
      .from("careplan_daily_task_occurrences")
      .select("id, occurrence_date")
      .eq("user_id", userId)
      .eq("template_id", oldTpl.id)
      .eq("status", "completed")
      .order("occurrence_date", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; occurrence_date: string }>();

    const anchorDate = latestCompleted?.occurrence_date ?? currentWeekDayDate;
    let nextEffectiveFrom = addDays(anchorDate, 7);

    if (patch.effective_from_date) {
      if (!isValidDateString(patch.effective_from_date)) {
        throw new ValidationError("รูปแบบวันที่ effective_from_date ไม่ถูกต้อง");
      }
      if (patch.effective_from_date <= anchorDate) {
        throw new ForbiddenRuleError(
          "การแก้ไขแม่แบบต้องมีผลตั้งแต่วันในอนาคต (สัปดาห์ถัดไป) เท่านั้น ไม่สามารถแก้ไขย้อนหลังได้",
          "EFFECTIVE_DATE_MUST_BE_FUTURE"
        );
      }
      nextEffectiveFrom = patch.effective_from_date;
    }

    const effectiveUntil =
      anchorDate >= oldTpl.effective_from_date
        ? anchorDate
        : oldTpl.effective_from_date;

    const { data: updatedOld, error: updErr } = await this.adminClient
      .from("careplan_recurring_task_templates")
      .update({ effective_until_date: effectiveUntil })
      .eq("id", oldTpl.id)
      .eq("user_id", userId)
      .select("*")
      .single<RecurringTaskTemplate>();

    if (updErr || !updatedOld) {
      throw new Error(`Failed to close previous template: ${updErr?.message}`);
    }

    const newTitle =
      patch.title !== undefined ? patch.title.trim() : oldTpl.title;
    if (!newTitle) {
      throw new ValidationError("ชื่องานต้องไม่ว่างเปล่า");
    }

    const { data: newTpl, error: insErr } = await this.adminClient
      .from("careplan_recurring_task_templates")
      .insert({
        user_id: oldTpl.user_id,
        weekly_schedule_id: oldTpl.weekly_schedule_id,
        day_of_week: oldTpl.day_of_week,
        title: newTitle,
        description:
          patch.description !== undefined
            ? patch.description.trim()
            : oldTpl.description,
        scheduled_time: patch.scheduled_time ?? oldTpl.scheduled_time,
        duration_minutes:
          patch.duration_minutes !== undefined
            ? Math.max(5, Math.min(720, Math.round(patch.duration_minutes)))
            : oldTpl.duration_minutes,
        priority: patch.priority ?? oldTpl.priority,
        is_fixed_time: patch.is_fixed_time ?? oldTpl.is_fixed_time,
        is_medically_prescribed:
          patch.is_medically_prescribed ?? oldTpl.is_medically_prescribed,
        effective_from_date: nextEffectiveFrom,
        effective_until_date: null,
        version: oldTpl.version + 1,
        is_active: true,
      })
      .select("*")
      .single<RecurringTaskTemplate>();

    if (insErr || !newTpl) {
      throw new Error(`Failed to create versioned template: ${insErr?.message}`);
    }

    if (latestCompleted) {
      await this.adminClient.from("careplan_task_history").insert({
        user_id: userId,
        occurrence_id: latestCompleted.id,
        event_type: "future_template_updated",
        metadata: {
          previous_template_id: oldTpl.id,
          new_template_id: newTpl.id,
          new_version: newTpl.version,
          effective_from_date: newTpl.effective_from_date,
        },
      });
    }

    return {
      previous_template: {
        ...updatedOld,
        day_of_week: Number(updatedOld.day_of_week) as DayOfWeek,
      },
      template: {
        ...newTpl,
        day_of_week: Number(newTpl.day_of_week) as DayOfWeek,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Occurrences, Evidence & Immutable Completion
  // ---------------------------------------------------------------------------

  async getOccurrencesForDate(
    userId: string,
    date: string
  ): Promise<OccurrencesForDateResult> {
    if (!isValidDateString(date)) {
      throw new ValidationError("รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)");
    }

    const { dayOfWeek, isRestDay } = await this.materializeDate(userId, date);

    const { data } = await this.adminClient
      .from("careplan_daily_task_occurrences")
      .select("*")
      .eq("user_id", userId)
      .eq("occurrence_date", date)
      .order("scheduled_time", { ascending: true });

    const occurrences = await this.hydrateOccurrences(
      userId,
      (data ?? []) as DbOccurrenceRow[]
    );
    const nextTask = occurrences.find((o) => o.status === "incomplete") ?? null;

    return {
      date,
      day_of_week: dayOfWeek,
      is_rest_day: isRestDay,
      occurrences,
      next_task: nextTask,
    };
  }

  async getOccurrencesForWeek(
    userId: string,
    weekStart: string
  ): Promise<OccurrencesForWeekResult> {
    if (!isValidDateString(weekStart)) {
      throw new ValidationError("รูปแบบวันที่ weekStart ไม่ถูกต้อง");
    }

    const weekDates = getThaiWeekDates(weekStart);
    const days: OccurrencesForWeekResult["days"] = [];
    const allOccurrences: DailyTaskOccurrence[] = [];

    for (const entry of weekDates) {
      const res = await this.getOccurrencesForDate(userId, entry.date);
      days.push({
        date: res.date,
        day_of_week: res.day_of_week,
        is_rest_day: res.is_rest_day,
        occurrences: res.occurrences,
      });
      allOccurrences.push(...res.occurrences);
    }

    return {
      week_start: weekDates[0].date,
      days,
      occurrences: allOccurrences,
      next_task: allOccurrences.find((o) => o.status === "incomplete") ?? null,
    };
  }

  async getOccurrenceDetail(
    userId: string,
    occurrenceId: string
  ): Promise<OccurrenceDetailResult> {
    const { data: row } = await this.adminClient
      .from("careplan_daily_task_occurrences")
      .select("*")
      .eq("id", occurrenceId)
      .maybeSingle<DbOccurrenceRow>();

    if (!row) {
      throw new NotFoundError("ไม่พบรายการงานที่ต้องการ");
    }
    if (row.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์เข้าถึงรายการงานของผู้อื่น");
    }

    const [hydrated] = await this.hydrateOccurrences(userId, [row]);
    const { data: historyRows } = await this.adminClient
      .from("careplan_task_history")
      .select("*")
      .eq("user_id", userId)
      .eq("occurrence_id", occurrenceId)
      .order("created_at", { ascending: true });

    let nextDependent: DailyTaskOccurrence | null = null;
    if (hydrated.next_dependent_occurrence_ids[0]) {
      const { data: depRow } = await this.adminClient
        .from("careplan_daily_task_occurrences")
        .select("*")
        .eq("id", hydrated.next_dependent_occurrence_ids[0])
        .eq("user_id", userId)
        .maybeSingle<DbOccurrenceRow>();
      if (depRow) {
        const [hydratedDep] = await this.hydrateOccurrences(userId, [depRow]);
        nextDependent = hydratedDep;
      }
    }

    return {
      occurrence: hydrated,
      history: (historyRows ?? []) as TaskHistoryEntry[],
      next_dependent: nextDependent,
    };
  }

  async rejectOccurrenceEdit(
    userId: string,
    occurrenceId: string
  ): Promise<never> {
    const { data: row } = await this.adminClient
      .from("careplan_daily_task_occurrences")
      .select("id, user_id, status, is_locked")
      .eq("id", occurrenceId)
      .maybeSingle<{ id: string; user_id: string; status: string; is_locked: boolean }>();

    if (!row) throw new NotFoundError("ไม่พบรายการงานที่ต้องการ");
    if (row.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์เข้าถึงรายการงานของผู้อื่น");
    }
    if (row.status === "completed" || row.is_locked) {
      throw new ForbiddenRuleError(
        "งานที่ยืนยันเสร็จสิ้นแล้วถูกล็อกถาวร ไม่สามารถแก้ไขได้ (Completed tasks are immutable)",
        "COMPLETED_OCCURRENCE_IMMUTABLE"
      );
    }
    throw new ForbiddenRuleError(
      "ไม่สามารถแก้ไขงานที่ยังไม่เสร็จสิ้นในรอบปัจจุบันได้ (Active incomplete tasks cannot be edited)",
      "ACTIVE_INCOMPLETE_OCCURRENCE_LOCKED"
    );
  }

  async rejectOccurrenceDelete(
    userId: string,
    occurrenceId: string
  ): Promise<never> {
    const { data: row } = await this.adminClient
      .from("careplan_daily_task_occurrences")
      .select("id, user_id, status, is_locked")
      .eq("id", occurrenceId)
      .maybeSingle<{ id: string; user_id: string; status: string; is_locked: boolean }>();

    if (!row) throw new NotFoundError("ไม่พบรายการงานที่ต้องการ");
    if (row.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์เข้าถึงรายการงานของผู้อื่น");
    }
    if (row.status === "completed" || row.is_locked) {
      throw new ForbiddenRuleError(
        "งานที่ยืนยันเสร็จสิ้นแล้วถูกล็อกถาวร ไม่สามารถลบได้ (Completed tasks are immutable)",
        "COMPLETED_OCCURRENCE_IMMUTABLE"
      );
    }
    throw new ForbiddenRuleError(
      "ไม่สามารถลบงานที่ยังไม่เสร็จสิ้นในรอบปัจจุบันได้ (Active incomplete tasks cannot be deleted)",
      "ACTIVE_INCOMPLETE_OCCURRENCE_LOCKED"
    );
  }

  async uploadCompletionEvidence(
    userId: string,
    occurrenceId: string,
    input: UploadEvidenceInput
  ): Promise<{ evidence: CompletionEvidence }> {
    const { data: row } = await this.adminClient
      .from("careplan_daily_task_occurrences")
      .select("id, user_id, status, is_locked")
      .eq("id", occurrenceId)
      .maybeSingle<{ id: string; user_id: string; status: string; is_locked: boolean }>();

    if (!row) throw new NotFoundError("ไม่พบรายการงานที่ต้องการอัปโหลดหลักฐาน");
    if (row.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์อัปโหลดหลักฐานให้รายการงานของผู้อื่น");
    }
    if (row.status === "completed" || row.is_locked) {
      throw new ForbiddenRuleError(
        "งานนี้ยืนยันเสร็จสิ้นและถูกล็อกถาวรแล้ว ไม่สามารถเปลี่ยนแปลงหลักฐานรูปภาพได้",
        "COMPLETED_OCCURRENCE_IMMUTABLE"
      );
    }

    if (!ALLOWED_EVIDENCE_MIME_TYPES.has(input.mimeType)) {
      throw new ValidationError(
        "รองรับเฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP, GIF, HEIC) เท่านั้น",
        "INVALID_IMAGE_MIME"
      );
    }
    if (input.bytes.length === 0) {
      throw new ValidationError("ไฟล์รูปภาพว่างเปล่า กรุณาอัปโหลดใหม่", "EMPTY_FILE");
    }
    if (input.bytes.length > MAX_EVIDENCE_BYTES) {
      throw new ValidationError("ขนาดไฟล์รูปภาพต้องไม่เกิน 5 MB", "FILE_TOO_LARGE");
    }

    const evidenceId = crypto.randomUUID();
    const safeName = sanitizeFileName(input.fileName);
    const ext = path.extname(safeName) || extensionFromMime(input.mimeType);
    const storagePath = `${userId}/${occurrenceId}/${evidenceId}${ext}`;

    const { error: uploadErr } = await this.adminClient.storage
      .from(EVIDENCE_BUCKET)
      .upload(storagePath, input.bytes, {
        contentType: input.mimeType,
        upsert: false,
      });

    if (uploadErr) {
      throw new Error(`Failed to upload evidence to private bucket: ${uploadErr.message}`);
    }

    const { data: inserted, error: dbErr } = await this.adminClient
      .from("careplan_completion_evidence")
      .insert({
        id: evidenceId,
        user_id: userId,
        occurrence_id: occurrenceId,
        storage_path: storagePath,
        file_name: safeName,
        mime_type: input.mimeType,
        file_size_bytes: input.bytes.length,
      })
      .select("*")
      .single<CompletionEvidence>();

    if (dbErr || !inserted) {
      throw new Error(`Failed to record evidence metadata: ${dbErr?.message}`);
    }

    await this.adminClient.from("careplan_task_history").insert({
      user_id: userId,
      occurrence_id: occurrenceId,
      event_type: "photo_uploaded",
      metadata: {
        evidence_id: evidenceId,
        file_name: safeName,
        mime_type: input.mimeType,
        file_size_bytes: input.bytes.length,
      },
    });

    return {
      evidence: {
        ...inserted,
        preview_url: `/api/evidence/${inserted.id}`,
      },
    };
  }

  async getEvidenceFile(
    userId: string,
    evidenceId: string
  ): Promise<{ evidence: CompletionEvidence; bytes: Buffer }> {
    const { data: evidence } = await this.adminClient
      .from("careplan_completion_evidence")
      .select("*")
      .eq("id", evidenceId)
      .maybeSingle<CompletionEvidence>();

    if (!evidence) {
      throw new NotFoundError("ไม่พบไฟล์หลักฐานรูปภาพ");
    }
    if (evidence.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์เข้าถึงรูปภาพหลักฐานของผู้อื่น");
    }

    const { data: blob, error } = await this.adminClient.storage
      .from(EVIDENCE_BUCKET)
      .download(evidence.storage_path);

    if (error || !blob) {
      throw new NotFoundError("ไม่พบไฟล์รูปภาพในพื้นที่จัดเก็บส่วนตัว");
    }

    const arrayBuffer = await blob.arrayBuffer();
    return {
      evidence: {
        ...evidence,
        preview_url: `/api/evidence/${evidence.id}`,
      },
      bytes: Buffer.from(arrayBuffer),
    };
  }

  async confirmOccurrenceCompletion(
    userId: string,
    occurrenceId: string,
    completedAt: Date = new Date()
  ): Promise<ConfirmCompletionResult> {
    const { data: confirmedRow, error } = await this.adminClient
      .rpc("careplan_confirm_occurrence_completion", {
        p_user_id: userId,
        p_occurrence_id: occurrenceId,
        p_completed_at: completedAt.toISOString(),
      })
      .single<DbOccurrenceRow>();

    if (error || !confirmedRow) {
      const msg = error?.message ?? "";
      if (msg.includes("OCCURRENCE_NOT_FOUND")) {
        throw new NotFoundError("ไม่พบรายการงานที่ต้องการยืนยัน");
      }
      if (msg.includes("FORBIDDEN_OWNER_MISMATCH")) {
        throw new ForbiddenError("คุณไม่มีสิทธิ์ยืนยันรายการงานของผู้อื่น");
      }
      if (msg.includes("PHOTO_EVIDENCE_REQUIRED")) {
        throw new ValidationError(
          "ต้องอัปโหลดรูปภาพหลักฐานอย่างน้อย 1 รูปก่อนจึงจะยืนยันการทำงานเสร็จสิ้นได้",
          "PHOTO_EVIDENCE_REQUIRED"
        );
      }
      if (msg.includes("ALREADY_COMPLETED")) {
        throw new ForbiddenRuleError(
          "รายการงานนี้ได้รับการยืนยันเสร็จสิ้นและล็อกถาวรแล้ว",
          "ALREADY_COMPLETED"
        );
      }
      throw new Error(`Failed to confirm occurrence completion: ${msg}`);
    }

    const [hydrated] = await this.hydrateOccurrences(userId, [confirmedRow]);
    const notificationsCreated: NotificationDeliveryLog[] = [];
    let nextDependent: DailyTaskOccurrence | null = null;

    if (hydrated.next_dependent_occurrence_ids.length > 0) {
      const { data: depRows } = await this.adminClient
        .from("careplan_daily_task_occurrences")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "incomplete")
        .in("id", hydrated.next_dependent_occurrence_ids)
        .order("scheduled_time", { ascending: true });

      const hydratedDeps = await this.hydrateOccurrences(
        userId,
        (depRows ?? []) as DbOccurrenceRow[]
      );
      nextDependent = hydratedDeps[0] ?? null;

      for (const dep of hydratedDeps) {
        const notif = await this.createNotificationIfAbsent(userId, {
          occurrence_id: dep.id,
          notification_type: "next_dependent_ready",
          dedup_key: `dep:${hydrated.id}:${dep.id}`,
          title: `พร้อมสำหรับงานถัดไป: ${dep.title}`,
          body: `คุณยืนยัน "${hydrated.title}" เสร็จแล้ว งานถัดไปที่เกี่ยวข้องคือ "${dep.title}" เวลา ${dep.scheduled_time} น.`,
          channel: "in_app",
        });
        if (notif) {
          notificationsCreated.push(notif);
          await this.adminClient.from("careplan_task_history").insert({
            user_id: userId,
            occurrence_id: dep.id,
            event_type: "dependent_notified",
            metadata: {
              predecessor_occurrence_id: hydrated.id,
              notification_id: notif.id,
            },
          });
        }
      }
    }

    return {
      occurrence: hydrated,
      next_dependent: nextDependent,
      notifications_created: notificationsCreated,
    };
  }

  // ---------------------------------------------------------------------------
  // History (Read-Only)
  // ---------------------------------------------------------------------------

  async getHistory(
    userId: string,
    limit = 50
  ): Promise<{
    completed_occurrences: DailyTaskOccurrence[];
    history_events: TaskHistoryEntry[];
  }> {
    const clamped = Math.max(1, Math.min(200, limit));
    const [occRes, histRes] = await Promise.all([
      this.adminClient
        .from("careplan_daily_task_occurrences")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(clamped),
      this.adminClient
        .from("careplan_task_history")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(clamped),
    ]);

    const completedOccurrences = await this.hydrateOccurrences(
      userId,
      (occRes.data ?? []) as DbOccurrenceRow[]
    );

    return {
      completed_occurrences: completedOccurrences,
      history_events: (histRes.data ?? []) as TaskHistoryEntry[],
    };
  }

  // ---------------------------------------------------------------------------
  // Daily Summaries, Rest Suggestions & AI Logs
  // ---------------------------------------------------------------------------

  async getDailySummary(
    userId: string,
    date: string
  ): Promise<{
    summary: DailySummaryRecord | null;
    metrics: DailySummaryMetrics;
  }> {
    const occ = await this.getOccurrencesForDate(userId, date);
    const metrics = computeDailyMetrics(date, occ.occurrences);

    const { data } = await this.adminClient
      .from("careplan_daily_summaries")
      .select("*")
      .eq("user_id", userId)
      .eq("summary_date", date)
      .maybeSingle<DailySummaryRecord>();

    return { summary: data ?? null, metrics };
  }

  async saveDailySummary(
    userId: string,
    input: Omit<DailySummaryRecord, "id" | "user_id" | "generated_at">
  ): Promise<DailySummaryRecord> {
    const { data, error } = await this.adminClient
      .from("careplan_daily_summaries")
      .upsert(
        {
          user_id: userId,
          summary_date: input.summary_date,
          metrics: input.metrics,
          encouraging_message: input.encouraging_message,
          tone_category: input.tone_category,
          ai_provider: input.ai_provider,
          used_fallback: input.used_fallback,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,summary_date" }
      )
      .select("*")
      .single<DailySummaryRecord>();

    if (error || !data) {
      throw new Error(`Failed to save daily summary: ${error?.message}`);
    }
    return data;
  }

  async getRestSuggestions(
    userId: string,
    date: string
  ): Promise<RestSuggestionRecord[]> {
    const { data } = await this.adminClient
      .from("careplan_rest_suggestions")
      .select("*")
      .eq("user_id", userId)
      .eq("suggestion_date", date)
      .order("gap_start", { ascending: true });

    return (data ?? []) as RestSuggestionRecord[];
  }

  async replaceRestSuggestions(
    userId: string,
    date: string,
    suggestions: Array<
      Omit<RestSuggestionRecord, "id" | "user_id" | "created_at" | "updated_at">
    >
  ): Promise<RestSuggestionRecord[]> {
    await this.adminClient
      .from("careplan_rest_suggestions")
      .delete()
      .eq("user_id", userId)
      .eq("suggestion_date", date);

    if (suggestions.length === 0) return [];

    const { data, error } = await this.adminClient
      .from("careplan_rest_suggestions")
      .insert(
        suggestions.map((s) => ({
          user_id: userId,
          suggestion_date: date,
          gap_start: s.gap_start,
          gap_end: s.gap_end,
          duration_minutes: s.duration_minutes,
          activity_title: s.activity_title,
          description: s.description,
          supervision_safety_note: s.supervision_safety_note,
          status: s.status ?? "suggested",
        }))
      )
      .select("*");

    if (error) {
      throw new Error(`Failed to save rest suggestions: ${error.message}`);
    }
    return (data ?? []) as RestSuggestionRecord[];
  }

  async updateRestSuggestionStatus(
    userId: string,
    suggestionId: string,
    status: "accepted" | "dismissed" | "ignored"
  ): Promise<RestSuggestionRecord> {
    const { data: existing } = await this.adminClient
      .from("careplan_rest_suggestions")
      .select("*")
      .eq("id", suggestionId)
      .maybeSingle<RestSuggestionRecord>();

    if (!existing) throw new NotFoundError("ไม่พบคำแนะนำเวลาพักผ่อนนี้");
    if (existing.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์แก้ไขคำแนะนำของผู้อื่น");
    }

    const { data, error } = await this.adminClient
      .from("careplan_rest_suggestions")
      .update({ status })
      .eq("id", suggestionId)
      .eq("user_id", userId)
      .select("*")
      .single<RestSuggestionRecord>();

    if (error || !data) {
      throw new Error(`Failed to update rest suggestion: ${error?.message}`);
    }
    return data;
  }

  async logAiOperation(
    userId: string,
    entry: Omit<AiOperationLog, "id" | "user_id" | "created_at">
  ): Promise<AiOperationLog> {
    const { data, error } = await this.adminClient
      .from("careplan_ai_operation_logs")
      .insert({
        user_id: userId,
        operation_type: entry.operation_type,
        provider: entry.provider,
        model: entry.model,
        used_fallback: entry.used_fallback,
        status: entry.status,
        latency_ms: Math.max(0, Math.round(entry.latency_ms)),
      })
      .select("*")
      .single<AiOperationLog>();

    if (error || !data) {
      throw new Error(`Failed to log AI operation: ${error?.message}`);
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  // Smart Reminders
  // ---------------------------------------------------------------------------

  async getReminders(userId: string): Promise<{
    preference: ReminderPreference;
    notifications: NotificationDeliveryLog[];
  }> {
    const { reminder_preference } = await this.requireBootstrap(userId);
    const { data } = await this.adminClient
      .from("careplan_notification_delivery_logs")
      .select("*")
      .eq("user_id", userId)
      .order("delivered_at", { ascending: false })
      .limit(100);

    return {
      preference: reminder_preference,
      notifications: (data ?? []) as NotificationDeliveryLog[],
    };
  }

  async listAllActiveUserIds(): Promise<string[]> {
    const { data } = await this.adminClient
      .from("careplan_user_profiles")
      .select("id");
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  async createNotificationIfAbsent(
    userId: string,
    input: CreateNotificationInput
  ): Promise<NotificationDeliveryLog | null> {
    const { data: existing } = await this.adminClient
      .from("careplan_notification_delivery_logs")
      .select("id")
      .eq("user_id", userId)
      .eq("dedup_key", input.dedup_key)
      .maybeSingle<{ id: string }>();

    if (existing) return null;

    const { data, error } = await this.adminClient
      .from("careplan_notification_delivery_logs")
      .insert({
        user_id: userId,
        occurrence_id: input.occurrence_id,
        notification_type: input.notification_type,
        dedup_key: input.dedup_key,
        title: input.title,
        body: input.body,
        channel: input.channel,
      })
      .select("*")
      .single<NotificationDeliveryLog>();

    if (error || !data) {
      // Handle race condition on unique(user_id, dedup_key)
      if (error?.code === "23505") return null;
      throw new Error(`Failed to create notification: ${error?.message}`);
    }

    await this.adminClient.from("careplan_task_history").insert({
      user_id: userId,
      occurrence_id: input.occurrence_id,
      event_type: "reminder_sent",
      metadata: {
        notification_type: input.notification_type,
        dedup_key: input.dedup_key,
      },
    });

    return data;
  }

  async markNotificationRead(
    userId: string,
    notificationId: string
  ): Promise<NotificationDeliveryLog> {
    const { data: existing } = await this.adminClient
      .from("careplan_notification_delivery_logs")
      .select("*")
      .eq("id", notificationId)
      .maybeSingle<NotificationDeliveryLog>();

    if (!existing) throw new NotFoundError("ไม่พบการแจ้งเตือนนี้");
    if (existing.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์จัดการการแจ้งเตือนของผู้อื่น");
    }

    const { data, error } = await this.adminClient
      .from("careplan_notification_delivery_logs")
      .update({ read_at: existing.read_at ?? new Date().toISOString() })
      .eq("id", notificationId)
      .eq("user_id", userId)
      .select("*")
      .single<NotificationDeliveryLog>();

    if (error || !data) {
      throw new Error(`Failed to mark notification read: ${error?.message}`);
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  // Share Links
  // ---------------------------------------------------------------------------

  async listShareLinks(userId: string): Promise<ShareLinkRecord[]> {
    const { data } = await this.adminClient
      .from("careplan_share_links")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    return (data ?? []) as ShareLinkRecord[];
  }

  async createShareLink(
    userId: string,
    input: CreateShareLinkInput
  ): Promise<ShareLinkRecord> {
    if (!isValidDateString(input.target_date)) {
      throw new ValidationError("รูปแบบวันที่ target_date ไม่ถูกต้อง");
    }

    const { weekly_schedule } = await this.requireBootstrap(userId);
    let expiresAt: string | null = null;
    if (input.expires_in_days !== undefined && input.expires_in_days !== null) {
      if (input.expires_in_days <= 0 || input.expires_in_days > 365) {
        throw new ValidationError("จำนวนวันหมดอายุต้องอยู่ระหว่าง 1 ถึง 365 วัน");
      }
      expiresAt = new Date(
        Date.now() + input.expires_in_days * 24 * 60 * 60 * 1000
      ).toISOString();
    }

    const token = crypto.randomBytes(24).toString("base64url");
    const { data, error } = await this.adminClient
      .from("careplan_share_links")
      .insert({
        user_id: userId,
        weekly_schedule_id: weekly_schedule.id,
        token,
        scope: input.scope,
        target_date: input.target_date,
        include_private_notes: Boolean(input.include_private_notes),
        expires_at: expiresAt,
      })
      .select("*")
      .single<ShareLinkRecord>();

    if (error || !data) {
      throw new Error(`Failed to create share link: ${error?.message}`);
    }
    return data;
  }

  async revokeShareLink(
    userId: string,
    linkId: string
  ): Promise<ShareLinkRecord> {
    const { data: existing } = await this.adminClient
      .from("careplan_share_links")
      .select("*")
      .eq("id", linkId)
      .maybeSingle<ShareLinkRecord>();

    if (!existing) throw new NotFoundError("ไม่พบลิงก์แชร์ที่ต้องการยกเลิก");
    if (existing.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์ยกเลิกลิงก์แชร์ของผู้อื่น");
    }

    const { data, error } = await this.adminClient
      .from("careplan_share_links")
      .update({ revoked_at: existing.revoked_at ?? new Date().toISOString() })
      .eq("id", linkId)
      .eq("user_id", userId)
      .select("*")
      .single<ShareLinkRecord>();

    if (error || !data) {
      throw new Error(`Failed to revoke share link: ${error?.message}`);
    }
    return data;
  }

  async getPublicSharedSchedule(
    token: string,
    now: Date = new Date()
  ): Promise<SharedSchedulePayload> {
    const { data: link } = await this.adminClient
      .from("careplan_share_links")
      .select("*")
      .eq("token", token)
      .maybeSingle<ShareLinkRecord>();

    if (!link) throw new NotFoundError("ไม่พบลิงก์ตารางดูแลนี้");
    if (link.revoked_at !== null) {
      throw new GoneError("ลิงก์แชร์นี้ถูกยกเลิกโดยเจ้าของตารางแล้ว", "SHARE_LINK_REVOKED");
    }
    if (link.expires_at !== null && Date.parse(link.expires_at) <= now.getTime()) {
      throw new GoneError("ลิงก์แชร์นี้หมดอายุแล้ว", "SHARE_LINK_EXPIRED");
    }

    const [schedRes, recRes, tplRes] = await Promise.all([
      this.adminClient
        .from("careplan_weekly_schedules")
        .select("*")
        .eq("id", link.weekly_schedule_id)
        .maybeSingle<WeeklyScheduleTemplate>(),
      this.adminClient
        .from("careplan_care_recipients")
        .select("*")
        .eq("user_id", link.user_id)
        .limit(1)
        .maybeSingle<CareRecipientProfile>(),
      this.adminClient
        .from("careplan_recurring_task_templates")
        .select("*")
        .eq("user_id", link.user_id)
        .eq("weekly_schedule_id", link.weekly_schedule_id)
        .eq("is_active", true)
        .order("scheduled_time", { ascending: true }),
    ]);

    if (!schedRes.data || !recRes.data) {
      throw new NotFoundError("ไม่พบข้อมูลตารางดูแลที่เชื่อมกับลิงก์นี้");
    }

    const restDays = (schedRes.data.rest_days ?? []).map(
      (d) => Number(d) as DayOfWeek
    );
    const allTemplates = ((tplRes.data ?? []) as RecurringTaskTemplate[]).map(
      (t) => ({
        ...t,
        day_of_week: Number(t.day_of_week) as DayOfWeek,
      })
    );

    const targetDates =
      link.scope === "day"
        ? [{ day_of_week: getThaiDayOfWeek(link.target_date), date: link.target_date }]
        : getThaiWeekDates(link.target_date);

    const days: SharedSchedulePayload["days"] = targetDates.map((entry) => {
      const isRestDay = restDays.includes(entry.day_of_week);
      if (isRestDay) {
        return {
          day_of_week: entry.day_of_week,
          date: entry.date,
          is_rest_day: true,
          tasks: [],
        };
      }

      const dayTasks = allTemplates
        .filter(
          (t) =>
            t.day_of_week === entry.day_of_week &&
            t.effective_from_date <= entry.date &&
            (t.effective_until_date === null ||
              t.effective_until_date >= entry.date)
        )
        .map((t) => ({
          title: t.title,
          scheduled_time: t.scheduled_time,
          duration_minutes: t.duration_minutes,
          priority: t.priority,
          is_medically_prescribed: t.is_medically_prescribed,
          ...(link.include_private_notes && t.description
            ? { notes: t.description }
            : {}),
        }));

      return {
        day_of_week: entry.day_of_week,
        date: entry.date,
        is_rest_day: false,
        tasks: dayTasks,
      };
    });

    return {
      token: link.token,
      scope: link.scope,
      target_date: link.target_date,
      schedule_title: schedRes.data.title,
      care_recipient_label: recRes.data.display_name,
      timezone: schedRes.data.timezone,
      rest_days: restDays,
      include_private_notes: link.include_private_notes,
      expires_at: link.expires_at,
      days,
    };
  }

  // ---------------------------------------------------------------------------
  // Settings & Privacy
  // ---------------------------------------------------------------------------

  async getSettings(userId: string): Promise<{
    profile: UserProfile;
    care_recipient: CareRecipientProfile;
    reminder_preference: ReminderPreference;
  }> {
    const { user, care_recipient, reminder_preference } =
      await this.requireBootstrap(userId);
    return {
      profile: user,
      care_recipient,
      reminder_preference,
    };
  }

  async updateSettings(
    userId: string,
    patch: SettingsUpdateInput
  ): Promise<{
    profile: UserProfile;
    care_recipient: CareRecipientProfile;
    reminder_preference: ReminderPreference;
  }> {
    const current = await this.requireBootstrap(userId);

    if (patch.profile) {
      const updates: Record<string, unknown> = {};
      if (patch.profile.full_name !== undefined) {
        const trimmed = patch.profile.full_name.trim();
        if (!trimmed) throw new ValidationError("ชื่อผู้ดูแลต้องไม่ว่างเปล่า");
        updates.full_name = trimmed;
      }
      if (patch.profile.timezone !== undefined) {
        updates.timezone = patch.profile.timezone.trim() || THAI_TIMEZONE;
      }
      if (Object.keys(updates).length > 0) {
        await this.adminClient
          .from("careplan_user_profiles")
          .update(updates)
          .eq("id", userId);
      }
    }

    if (patch.care_recipient) {
      const updates: Record<string, unknown> = {};
      if (patch.care_recipient.display_name !== undefined) {
        const trimmed = patch.care_recipient.display_name.trim();
        if (!trimmed) throw new ValidationError("ชื่อผู้สูงอายุต้องไม่ว่างเปล่า");
        updates.display_name = trimmed;
      }
      if (patch.care_recipient.age_years !== undefined) {
        updates.age_years = patch.care_recipient.age_years;
      }
      if (patch.care_recipient.mobility_level !== undefined) {
        updates.mobility_level = patch.care_recipient.mobility_level;
      }
      if (patch.care_recipient.care_notes !== undefined) {
        updates.care_notes = patch.care_recipient.care_notes;
      }
      if (patch.care_recipient.requires_supervision !== undefined) {
        updates.requires_supervision = patch.care_recipient.requires_supervision;
      }
      if (Object.keys(updates).length > 0) {
        await this.adminClient
          .from("careplan_care_recipients")
          .update(updates)
          .eq("id", current.care_recipient.id)
          .eq("user_id", userId);
      }
    }

    if (patch.reminder_preference) {
      const rp = patch.reminder_preference;
      const updates: Record<string, unknown> = {};
      if (rp.reminders_enabled !== undefined) {
        updates.reminders_enabled = rp.reminders_enabled;
      }
      if (rp.repeat_interval_minutes !== undefined) {
        if (rp.repeat_interval_minutes < 5 || rp.repeat_interval_minutes > 120) {
          throw new ValidationError("ช่วงเวลาแจ้งเตือนซ้ำต้องอยู่ระหว่าง 5 ถึง 120 นาที");
        }
        updates.repeat_interval_minutes = rp.repeat_interval_minutes;
      }
      if (rp.quiet_hours_enabled !== undefined) {
        updates.quiet_hours_enabled = rp.quiet_hours_enabled;
      }
      if (rp.quiet_hours_start !== undefined) {
        if (!isValidHHMM(rp.quiet_hours_start)) {
          throw new ValidationError("เวลาเริ่มต้นช่วงงดรบกวนไม่ถูกต้อง");
        }
        updates.quiet_hours_start = rp.quiet_hours_start;
      }
      if (rp.quiet_hours_end !== undefined) {
        if (!isValidHHMM(rp.quiet_hours_end)) {
          throw new ValidationError("เวลาสิ้นสุดช่วงงดรบกวนไม่ถูกต้อง");
        }
        updates.quiet_hours_end = rp.quiet_hours_end;
      }
      if (rp.browser_notifications_granted !== undefined) {
        updates.browser_notifications_granted = rp.browser_notifications_granted;
      }
      if (Object.keys(updates).length > 0) {
        await this.adminClient
          .from("careplan_reminder_preferences")
          .update(updates)
          .eq("user_id", userId);
      }
    }

    return this.getSettings(userId);
  }

  async createPrivacyDeletionRequest(
    userId: string,
    reason = ""
  ): Promise<{
    request_id: string;
    status: "recorded";
    message: string;
  }> {
    await this.requireBootstrap(userId);
    const { data, error } = await this.adminClient
      .from("careplan_privacy_deletion_requests")
      .insert({
        user_id: userId,
        reason: reason.trim(),
        status: "recorded",
      })
      .select("id")
      .single<{ id: string }>();

    if (error || !data) {
      throw new Error(`Failed to create privacy deletion request: ${error?.message}`);
    }

    return {
      request_id: data.id,
      status: "recorded",
      message:
        "ระบบบันทึกคำขอลบข้อมูลส่วนบุคคลตามหลัก PDPA/GDPR เรียบร้อยแล้ว โดยไม่เป็นการแก้ไขประวัติหลักฐานการทำงานตามปกติ",
    };
  }

  // =========================================================================
  // Calendar Events (Apple Calendar-style CRUD & Recurrence)
  // =========================================================================

  async listCalendarEvents(
    userId: string,
    rangeStart?: string,
    rangeEnd?: string
  ): Promise<{
    events: CalendarEventRecord[];
    occurrences: CalendarEventOccurrence[];
  }> {
    await this.requireBootstrap(userId);
    const { data, error } = await this.adminClient
      .from("careplan_calendar_events")
      .select("*")
      .eq("user_id", userId)
      .order("start_date", { ascending: true })
      .order("start_time", { ascending: true });

    if (error) {
      throw new Error(`Failed to load calendar events: ${error.message}`);
    }

    const events = ((data ?? []) as CalendarEventRecord[]).map((e) => ({
      ...e,
      excluded_dates: Array.isArray(e.excluded_dates) ? e.excluded_dates : [],
    }));
    const today = getThaiTodayDate();
    const start = rangeStart && isValidDateString(rangeStart) ? rangeStart : addDays(today, -31);
    const end = rangeEnd && isValidDateString(rangeEnd) ? rangeEnd : addDays(today, 62);
    return {
      events,
      occurrences: expandCalendarEventsForRange(events, start, end),
    };
  }

  async createCalendarEvent(
    userId: string,
    input: CreateCalendarEventInput
  ): Promise<CalendarEventRecord> {
    await this.requireBootstrap(userId);
    const normalized = normalizeCalendarEventInput(input);

    const { data, error } = await this.adminClient
      .from("careplan_calendar_events")
      .insert({
        user_id: userId,
        ...normalized,
        excluded_dates: [],
      })
      .select("*")
      .single<CalendarEventRecord>();

    if (error || !data) {
      throw new Error(`Failed to create calendar event: ${error?.message}`);
    }
    return { ...data, excluded_dates: data.excluded_dates ?? [] };
  }

  async updateCalendarEvent(
    userId: string,
    eventId: string,
    input: UpdateCalendarEventInput
  ): Promise<{
    event: CalendarEventRecord;
    split_event?: CalendarEventRecord;
  }> {
    await this.requireBootstrap(userId);
    const { data: existing } = await this.adminClient
      .from("careplan_calendar_events")
      .select("*")
      .eq("id", eventId)
      .maybeSingle<CalendarEventRecord>();

    if (!existing) {
      throw new NotFoundError("ไม่พบกิจกรรมในปฏิทินที่ต้องการแก้ไข");
    }
    if (existing.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์แก้ไขกิจกรรมของผู้อื่น");
    }

    const existingExcluded = Array.isArray(existing.excluded_dates)
      ? existing.excluded_dates
      : [];
    const editScope = input.edit_scope ?? "all";
    const spanDays = Math.max(0, diffCalendarDays(existing.start_date, existing.end_date));

    if (
      (editScope === "single" || editScope === "future") &&
      existing.recurrence !== "never"
    ) {
      const occDate = input.occurrence_date;
      if (!occDate || !isValidDateString(occDate)) {
        throw new ValidationError("กรุณาระบุวันที่ของรอบกิจกรรมที่ต้องการแก้ไข (occurrence_date)");
      }

      if (editScope === "single") {
        const nextStart = input.start_date ?? occDate;
        const nextEnd =
          input.end_date ?? (spanDays > 0 ? addDays(nextStart, spanDays) : nextStart);
        const normalizedSingle = normalizeCalendarEventInput({
          title: input.title ?? existing.title,
          description: input.description ?? existing.description,
          start_date: nextStart,
          end_date: nextEnd,
          start_time: input.start_time ?? existing.start_time,
          end_time: input.end_time ?? existing.end_time,
          is_all_day: input.is_all_day ?? existing.is_all_day,
          recurrence: "never",
          until_date: null,
          reminder_minutes:
            input.reminder_minutes !== undefined
              ? input.reminder_minutes
              : existing.reminder_minutes,
        });

        const nextExcluded = existingExcluded.includes(occDate)
          ? existingExcluded
          : [...existingExcluded, occDate];

        const { data: updatedOrig, error: updErr } = await this.adminClient
          .from("careplan_calendar_events")
          .update({ excluded_dates: nextExcluded })
          .eq("id", eventId)
          .eq("user_id", userId)
          .select("*")
          .single<CalendarEventRecord>();

        if (updErr || !updatedOrig) {
          throw new Error(`Failed to exclude single occurrence: ${updErr?.message}`);
        }

        const { data: splitEvent, error: insErr } = await this.adminClient
          .from("careplan_calendar_events")
          .insert({
            user_id: userId,
            ...normalizedSingle,
            excluded_dates: [],
          })
          .select("*")
          .single<CalendarEventRecord>();

        if (insErr || !splitEvent) {
          throw new Error(`Failed to insert split event: ${insErr?.message}`);
        }
        return { event: updatedOrig, split_event: splitEvent };
      }

      if (occDate > existing.start_date) {
        const nextStart = input.start_date ?? occDate;
        const nextEnd =
          input.end_date ?? (spanDays > 0 ? addDays(nextStart, spanDays) : nextStart);
        const normalizedFuture = normalizeCalendarEventInput({
          title: input.title ?? existing.title,
          description: input.description ?? existing.description,
          start_date: nextStart,
          end_date: nextEnd,
          start_time: input.start_time ?? existing.start_time,
          end_time: input.end_time ?? existing.end_time,
          is_all_day: input.is_all_day ?? existing.is_all_day,
          recurrence: input.recurrence ?? existing.recurrence,
          until_date:
            input.until_date !== undefined ? input.until_date : existing.until_date,
          reminder_minutes:
            input.reminder_minutes !== undefined
              ? input.reminder_minutes
              : existing.reminder_minutes,
        });

        const { data: updatedOrig, error: updErr } = await this.adminClient
          .from("careplan_calendar_events")
          .update({ until_date: addDays(occDate, -1) })
          .eq("id", eventId)
          .eq("user_id", userId)
          .select("*")
          .single<CalendarEventRecord>();

        if (updErr || !updatedOrig) {
          throw new Error(`Failed to close original recurring event: ${updErr?.message}`);
        }

        const { data: splitEvent, error: insErr } = await this.adminClient
          .from("careplan_calendar_events")
          .insert({
            user_id: userId,
            ...normalizedFuture,
            excluded_dates: [],
          })
          .select("*")
          .single<CalendarEventRecord>();

        if (insErr || !splitEvent) {
          throw new Error(`Failed to create future recurring event: ${insErr?.message}`);
        }
        return { event: updatedOrig, split_event: splitEvent };
      }
    }

    const nextStart = input.start_date ?? existing.start_date;
    const nextEnd =
      input.end_date ??
      (input.start_date ? addDays(nextStart, spanDays) : existing.end_date);
    const normalizedAll = normalizeCalendarEventInput({
      title: input.title ?? existing.title,
      description: input.description ?? existing.description,
      start_date: nextStart,
      end_date: nextEnd,
      start_time: input.start_time ?? existing.start_time,
      end_time: input.end_time ?? existing.end_time,
      is_all_day: input.is_all_day ?? existing.is_all_day,
      recurrence: input.recurrence ?? existing.recurrence,
      until_date:
        input.until_date !== undefined ? input.until_date : existing.until_date,
      reminder_minutes:
        input.reminder_minutes !== undefined
          ? input.reminder_minutes
          : existing.reminder_minutes,
    });

    const { data: updated, error: updErr } = await this.adminClient
      .from("careplan_calendar_events")
      .update(normalizedAll)
      .eq("id", eventId)
      .eq("user_id", userId)
      .select("*")
      .single<CalendarEventRecord>();

    if (updErr || !updated) {
      throw new Error(`Failed to update calendar event: ${updErr?.message}`);
    }
    return { event: updated };
  }

  async deleteCalendarEvent(
    userId: string,
    eventId: string,
    options?: {
      delete_scope?: "all" | "single";
      occurrence_date?: string;
    }
  ): Promise<{ deleted: true }> {
    await this.requireBootstrap(userId);
    const { data: existing } = await this.adminClient
      .from("careplan_calendar_events")
      .select("*")
      .eq("id", eventId)
      .maybeSingle<CalendarEventRecord>();

    if (!existing) {
      throw new NotFoundError("ไม่พบกิจกรรมในปฏิทินที่ต้องการลบ");
    }
    if (existing.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์ลบกิจกรรมของผู้อื่น");
    }

    if (
      options?.delete_scope === "single" &&
      existing.recurrence !== "never" &&
      options.occurrence_date
    ) {
      if (!isValidDateString(options.occurrence_date)) {
        throw new ValidationError("รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)");
      }
      const existingExcluded = Array.isArray(existing.excluded_dates)
        ? existing.excluded_dates
        : [];
      const nextExcluded = existingExcluded.includes(options.occurrence_date)
        ? existingExcluded
        : [...existingExcluded, options.occurrence_date];
      const { error } = await this.adminClient
        .from("careplan_calendar_events")
        .update({ excluded_dates: nextExcluded })
        .eq("id", eventId)
        .eq("user_id", userId);
      if (error) {
        throw new Error(`Failed to exclude single occurrence: ${error.message}`);
      }
      return { deleted: true };
    }

    const { error } = await this.adminClient
      .from("careplan_calendar_events")
      .delete()
      .eq("id", eventId)
      .eq("user_id", userId);
    if (error) {
      throw new Error(`Failed to delete calendar event: ${error.message}`);
    }
    return { deleted: true };
  }
}
