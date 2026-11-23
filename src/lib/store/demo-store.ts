import crypto from "crypto";
import fs from "fs";
import path from "path";
import type {
  AiOperationLog,
  CareRecipientProfile,
  CompletionEvidence,
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
  UserProfile,
  WeeklyScheduleTemplate,
} from "@/types/careplan";
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

interface StoredDemoUserAuth {
  user_id: string;
  email: string;
  password_hash: string;
  password_salt: string;
}

interface StoredPrivacyDeletionRequest {
  id: string;
  user_id: string;
  reason: string;
  status: "recorded" | "in_review" | "completed";
  requested_at: string;
}

interface StoredOccurrenceRow {
  id: string;
  user_id: string;
  template_id: string;
  weekly_schedule_id: string;
  occurrence_date: string;
  day_of_week: DayOfWeek;
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

interface DemoDbSchema {
  version: number;
  auth_users: StoredDemoUserAuth[];
  user_profiles: UserProfile[];
  care_recipients: CareRecipientProfile[];
  weekly_schedules: WeeklyScheduleTemplate[];
  templates: RecurringTaskTemplate[];
  dependencies: TaskDependency[];
  occurrences: StoredOccurrenceRow[];
  evidence: CompletionEvidence[];
  history: TaskHistoryEntry[];
  reminder_preferences: ReminderPreference[];
  notifications: NotificationDeliveryLog[];
  daily_summaries: DailySummaryRecord[];
  rest_suggestions: RestSuggestionRecord[];
  share_links: ShareLinkRecord[];
  ai_logs: AiOperationLog[];
  privacy_deletion_requests: StoredPrivacyDeletionRequest[];
}

function emptyDb(): DemoDbSchema {
  return {
    version: 1,
    auth_users: [],
    user_profiles: [],
    care_recipients: [],
    weekly_schedules: [],
    templates: [],
    dependencies: [],
    occurrences: [],
    evidence: [],
    history: [],
    reminder_preferences: [],
    notifications: [],
    daily_summaries: [],
    rest_suggestions: [],
    share_links: [],
    ai_logs: [],
    privacy_deletion_requests: [],
  };
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = hashPassword(password, salt);
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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

export const DEMO_DEFAULT_EMAIL = "napa.demo@careplan.th";
export const DEMO_DEFAULT_NAME = "คุณนภา (ผู้ดูแล)";

export class DemoFileStore implements CarePlanStore {
  public readonly mode = "demo" as const;
  private readonly baseDir: string;
  private readonly dbPath: string;
  private readonly evidenceDir: string;

  constructor(baseDir?: string) {
    const env = getServerEnv();
    this.baseDir =
      baseDir ??
      env.demoStoreDir ??
      path.join(process.cwd(), ".careplan-demo-store");
    this.dbPath = path.join(this.baseDir, "db.json");
    this.evidenceDir = path.join(this.baseDir, "evidence");
  }

  private ensureDirs(): void {
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.mkdirSync(this.evidenceDir, { recursive: true });
  }

  private readDb(): DemoDbSchema {
    this.ensureDirs();
    if (!fs.existsSync(this.dbPath)) {
      const fresh = emptyDb();
      this.writeDb(fresh);
      return fresh;
    }
    try {
      const raw = fs.readFileSync(this.dbPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<DemoDbSchema>;
      return {
        ...emptyDb(),
        ...parsed,
      };
    } catch {
      const fresh = emptyDb();
      this.writeDb(fresh);
      return fresh;
    }
  }

  private writeDb(db: DemoDbSchema): void {
    this.ensureDirs();
    const tmpPath = `${this.dbPath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), "utf8");
    fs.renameSync(tmpPath, this.dbPath);
  }

  private createBootstrapEntities(
    db: DemoDbSchema,
    user: UserProfile,
    careRecipientName = "คุณแม่",
    careRecipientAge: number | null = 72
  ): UserBootstrapData {
    const nowIso = new Date().toISOString();
    const recipient: CareRecipientProfile = {
      id: crypto.randomUUID(),
      user_id: user.id,
      display_name: careRecipientName,
      age_years: careRecipientAge,
      mobility_level: "homebound",
      care_notes:
        "ต้องรับประทานยาตามเวลาที่แพทย์กำหนด และมีผู้ดูแลใกล้ชิดอยู่เสมอ",
      requires_supervision: true,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const schedule: WeeklyScheduleTemplate = {
      id: crypto.randomUUID(),
      user_id: user.id,
      care_recipient_id: recipient.id,
      title: `ตารางดูแลประจำสัปดาห์ (${careRecipientName})`,
      timezone: THAI_TIMEZONE,
      rest_days: [7],
      is_active: true,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const pref: ReminderPreference = {
      id: crypto.randomUUID(),
      user_id: user.id,
      reminders_enabled: true,
      repeat_interval_minutes: 15,
      quiet_hours_enabled: true,
      quiet_hours_start: "22:00",
      quiet_hours_end: "06:00",
      browser_notifications_granted: false,
      updated_at: nowIso,
    };

    db.user_profiles.push(user);
    db.care_recipients.push(recipient);
    db.weekly_schedules.push(schedule);
    db.reminder_preferences.push(pref);

    return {
      user,
      care_recipient: recipient,
      weekly_schedule: schedule,
      reminder_preference: pref,
    };
  }

  private requireBootstrap(db: DemoDbSchema, userId: string): UserBootstrapData {
    const user = db.user_profiles.find((u) => u.id === userId);
    if (!user) {
      throw new UnauthorizedError("ไม่พบบัญชีผู้ใช้งาน กรุณาเข้าสู่ระบบใหม่");
    }
    const care_recipient = db.care_recipients.find((c) => c.user_id === userId);
    const weekly_schedule = db.weekly_schedules.find(
      (s) => s.user_id === userId && s.is_active
    );
    const reminder_preference = db.reminder_preferences.find(
      (r) => r.user_id === userId
    );
    if (!care_recipient || !weekly_schedule || !reminder_preference) {
      throw new NotFoundError("ข้อมูลตารางดูแลของผู้ใช้งานไม่สมบูรณ์");
    }
    return {
      user,
      care_recipient,
      weekly_schedule,
      reminder_preference,
    };
  }

  private materializeDateInMemory(
    db: DemoDbSchema,
    userId: string,
    date: string
  ): {
    dayOfWeek: DayOfWeek;
    isRestDay: boolean;
    mutated: boolean;
  } {
    const { weekly_schedule } = this.requireBootstrap(db, userId);
    const dayOfWeek = getThaiDayOfWeek(date);
    const isRestDay = weekly_schedule.rest_days.includes(dayOfWeek);

    if (isRestDay) {
      return { dayOfWeek, isRestDay: true, mutated: false };
    }

    const applicableTemplates = db.templates.filter(
      (t) =>
        t.user_id === userId &&
        t.weekly_schedule_id === weekly_schedule.id &&
        t.is_active &&
        t.day_of_week === dayOfWeek &&
        t.effective_from_date <= date &&
        (t.effective_until_date === null || t.effective_until_date >= date)
    );

    let mutated = false;
    const nowIso = new Date().toISOString();

    for (const tpl of applicableTemplates) {
      const existing = db.occurrences.find(
        (o) => o.template_id === tpl.id && o.occurrence_date === date
      );
      if (!existing) {
        const occId = crypto.randomUUID();
        const occ: StoredOccurrenceRow = {
          id: occId,
          user_id: userId,
          template_id: tpl.id,
          weekly_schedule_id: weekly_schedule.id,
          occurrence_date: date,
          day_of_week: dayOfWeek,
          title: tpl.title,
          description: tpl.description,
          scheduled_time: tpl.scheduled_time,
          scheduled_at: buildThaiDateTimeIso(date, tpl.scheduled_time),
          duration_minutes: tpl.duration_minutes,
          priority: tpl.priority,
          is_fixed_time: tpl.is_fixed_time,
          is_medically_prescribed: tpl.is_medically_prescribed,
          status: "incomplete",
          completed_at: null,
          is_delayed: false,
          is_locked: false,
          created_at: nowIso,
          updated_at: nowIso,
        };
        db.occurrences.push(occ);
        db.history.push({
          id: crypto.randomUUID(),
          user_id: userId,
          occurrence_id: occId,
          event_type: "occurrence_created",
          metadata: {
            template_id: tpl.id,
            occurrence_date: date,
            scheduled_time: tpl.scheduled_time,
          },
          created_at: nowIso,
        });
        mutated = true;
      }
    }

    return { dayOfWeek, isRestDay: false, mutated };
  }

  private hydrateOccurrence(
    db: DemoDbSchema,
    row: StoredOccurrenceRow,
    todayDate: string
  ): DailyTaskOccurrence {
    const evidence = db.evidence
      .filter((e) => e.occurrence_id === row.id && e.user_id === row.user_id)
      .sort((a, b) => a.uploaded_at.localeCompare(b.uploaded_at))
      .map((e) => ({
        ...e,
        preview_url: `/api/evidence/${e.id}`,
      }));

    // Same-day occurrences to resolve dependency links
    const sameDayOccurrences = db.occurrences.filter(
      (o) =>
        o.user_id === row.user_id &&
        o.occurrence_date === row.occurrence_date
    );

    const predecessorTemplateIds = db.dependencies
      .filter(
        (d) =>
          d.user_id === row.user_id &&
          d.successor_template_id === row.template_id
      )
      .map((d) => d.predecessor_template_id);

    const successorTemplateIds = db.dependencies
      .filter(
        (d) =>
          d.user_id === row.user_id &&
          d.predecessor_template_id === row.template_id
      )
      .map((d) => d.successor_template_id);

    const dependsOnIds = sameDayOccurrences
      .filter((o) => predecessorTemplateIds.includes(o.template_id))
      .map((o) => o.id);

    const nextDependentIds = sameDayOccurrences
      .filter((o) => successorTemplateIds.includes(o.template_id))
      .map((o) => o.id);

    const currentWeekDates = getThaiWeekDates(todayDate);
    const currentWeekEnd = currentWeekDates[6].date;

    const hasActiveIncompleteInCurrentWeek = db.occurrences.some(
      (o) =>
        o.user_id === row.user_id &&
        o.template_id === row.template_id &&
        o.status === "incomplete" &&
        o.occurrence_date <= currentWeekEnd
    );

    const canEditFutureTemplate =
      row.status === "completed" ||
      (row.occurrence_date > currentWeekEnd && !hasActiveIncompleteInCurrentWeek);

    return {
      ...row,
      can_edit_occurrence: false, // ALWAYS false for active incomplete & completed occurrences
      can_edit_future_template: canEditFutureTemplate,
      evidence,
      depends_on_occurrence_ids: dependsOnIds,
      next_dependent_occurrence_ids: nextDependentIds,
    };
  }

  private sortOccurrences(list: DailyTaskOccurrence[]): DailyTaskOccurrence[] {
    return [...list].sort((a, b) => {
      if (a.occurrence_date !== b.occurrence_date) {
        return a.occurrence_date.localeCompare(b.occurrence_date);
      }
      if (a.scheduled_time !== b.scheduled_time) {
        return a.scheduled_time.localeCompare(b.scheduled_time);
      }
      return a.created_at.localeCompare(b.created_at);
    });
  }

  // ---------------------------------------------------------------------------
  // Auth & Bootstrapping
  // ---------------------------------------------------------------------------

  async registerUser(input: RegisterUserInput): Promise<RegisterUserResult> {
    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new ValidationError("กรุณากรอกอีเมลให้ถูกต้อง");
    }
    if (!input.password || input.password.length < 6) {
      throw new ValidationError("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
    }

    const db = this.readDb();
    if (db.auth_users.some((a) => a.email === email)) {
      throw new ForbiddenRuleError("อีเมลนี้ถูกใช้งานแล้ว", "EMAIL_EXISTS");
    }

    const nowIso = new Date().toISOString();
    const userId = crypto.randomUUID();
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(input.password, salt);

    db.auth_users.push({
      user_id: userId,
      email,
      password_salt: salt,
      password_hash: passwordHash,
    });

    const user: UserProfile = {
      id: userId,
      email,
      full_name: input.full_name.trim() || "ผู้ดูแล",
      timezone: THAI_TIMEZONE,
      created_at: nowIso,
      updated_at: nowIso,
    };

    this.createBootstrapEntities(
      db,
      user,
      input.care_recipient_name?.trim() || "คุณแม่",
      input.care_recipient_age ?? 72
    );

    this.writeDb(db);
    return {
      user,
      mode: "demo",
      requires_email_confirmation: false,
    };
  }

  async loginUser(input: LoginUserInput): Promise<LoginUserResult> {
    const email = input.email.trim().toLowerCase();
    const db = this.readDb();
    const authRecord = db.auth_users.find((a) => a.email === email);
    if (
      !authRecord ||
      !verifyPassword(input.password, authRecord.password_salt, authRecord.password_hash)
    ) {
      throw new UnauthorizedError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    }

    const user = db.user_profiles.find((u) => u.id === authRecord.user_id);
    if (!user) {
      throw new UnauthorizedError("ไม่พบบัญชีผู้ใช้งาน");
    }

    return {
      user,
      mode: "demo",
    };
  }

  async ensureDemoUser(options?: {
    reset?: boolean;
    email?: string;
    full_name?: string;
    seedSampleTasks?: boolean;
  }): Promise<{ user: UserProfile }> {
    const email = (options?.email ?? DEMO_DEFAULT_EMAIL).trim().toLowerCase();
    const fullName = options?.full_name ?? DEMO_DEFAULT_NAME;
    const reset = options?.reset ?? false;
    const seedSampleTasks = options?.seedSampleTasks ?? true;

    const db = this.readDb();
    const existingAuth = db.auth_users.find((a) => a.email === email);

    if (existingAuth && !reset) {
      const existingUser = db.user_profiles.find(
        (u) => u.id === existingAuth.user_id
      );
      if (existingUser) {
        return { user: existingUser };
      }
    }

    let userId: string;
    if (existingAuth && reset) {
      userId = existingAuth.user_id;
      // Clean only this demo user's records
      db.user_profiles = db.user_profiles.filter((u) => u.id !== userId);
      db.care_recipients = db.care_recipients.filter((c) => c.user_id !== userId);
      db.weekly_schedules = db.weekly_schedules.filter((s) => s.user_id !== userId);
      db.templates = db.templates.filter((t) => t.user_id !== userId);
      db.dependencies = db.dependencies.filter((d) => d.user_id !== userId);
      db.occurrences = db.occurrences.filter((o) => o.user_id !== userId);
      db.evidence = db.evidence.filter((e) => e.user_id !== userId);
      db.history = db.history.filter((h) => h.user_id !== userId);
      db.reminder_preferences = db.reminder_preferences.filter(
        (r) => r.user_id !== userId
      );
      db.notifications = db.notifications.filter((n) => n.user_id !== userId);
      db.daily_summaries = db.daily_summaries.filter((s) => s.user_id !== userId);
      db.rest_suggestions = db.rest_suggestions.filter((r) => r.user_id !== userId);
      db.share_links = db.share_links.filter((l) => l.user_id !== userId);
      db.ai_logs = db.ai_logs.filter((l) => l.user_id !== userId);
      db.privacy_deletion_requests = db.privacy_deletion_requests.filter(
        (p) => p.user_id !== userId
      );

      const userEvidencePath = path.join(this.evidenceDir, userId);
      if (fs.existsSync(userEvidencePath)) {
        fs.rmSync(userEvidencePath, { recursive: true, force: true });
      }
    } else {
      userId = crypto.randomUUID();
      const salt = crypto.randomBytes(16).toString("hex");
      db.auth_users.push({
        user_id: userId,
        email,
        password_salt: salt,
        password_hash: hashPassword("careplan-demo-2026", salt),
      });
    }

    const nowIso = new Date().toISOString();
    const user: UserProfile = {
      id: userId,
      email,
      full_name: fullName,
      timezone: THAI_TIMEZONE,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const bootstrap = this.createBootstrapEntities(
      db,
      user,
      "คุณแม่สมใจ",
      74
    );
    bootstrap.care_recipient.care_notes =
      "อายุ 74 ปี ความดันโลหิตสูง ต้องรับประทานยาหลังอาหารเช้าและวัดความดันสม่ำเสมอ ไม่ควรปล่อยให้อยู่ลำพัง";

    if (seedSampleTasks) {
      const todayDate = getThaiTodayDate();
      const weekDates = getThaiWeekDates(todayDate);
      const mondayDate = weekDates[0].date;
      const tuesdayDate = weekDates[1].date;
      const wednesdayDate = weekDates[2].date;

      const tplMonMealId = crypto.randomUUID();
      const tplMonMedId = crypto.randomUUID();
      const tplMonWalkId = crypto.randomUUID();
      const tplTueBpId = crypto.randomUUID();
      const tplTueStretchId = crypto.randomUUID();
      const tplWedMedId = crypto.randomUUID();

      const seededTemplates: RecurringTaskTemplate[] = [
        {
          id: tplMonMealId,
          user_id: userId,
          weekly_schedule_id: bootstrap.weekly_schedule.id,
          day_of_week: 1,
          title: "เตรียมอาหารเช้าอ่อนๆ ให้คุณแม่",
          description: "ข้าวต้มปลาและน้ำอุ่น ลดเค็มตามคำแนะนำแพทย์",
          scheduled_time: "08:00",
          duration_minutes: 40,
          priority: "high",
          is_fixed_time: true,
          is_medically_prescribed: false,
          effective_from_date: mondayDate,
          effective_until_date: null,
          version: 1,
          is_active: true,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          id: tplMonMedId,
          user_id: userId,
          weekly_schedule_id: bootstrap.weekly_schedule.id,
          day_of_week: 1,
          title: "จัดยาความดันหลังอาหารเช้า",
          description: "ยาความดันตามใบสั่งแพทย์ 1 เม็ด พร้อมน้ำดื่มสะอาด",
          scheduled_time: "09:00",
          duration_minutes: 15,
          priority: "medical_critical",
          is_fixed_time: true,
          is_medically_prescribed: true,
          effective_from_date: mondayDate,
          effective_until_date: null,
          version: 1,
          is_active: true,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          id: tplMonWalkId,
          user_id: userId,
          weekly_schedule_id: bootstrap.weekly_schedule.id,
          day_of_week: 1,
          title: "พาคุณแม่ยืดเหยียดและเดินเบาๆ ในบ้าน",
          description: "ประคองเดินในห้องโถง 15-20 นาที ป้องกันข้อติด",
          scheduled_time: "14:00",
          duration_minutes: 30,
          priority: "medium",
          is_fixed_time: false,
          is_medically_prescribed: false,
          effective_from_date: mondayDate,
          effective_until_date: null,
          version: 1,
          is_active: true,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          id: tplTueBpId,
          user_id: userId,
          weekly_schedule_id: bootstrap.weekly_schedule.id,
          day_of_week: 2,
          title: "วัดความดันโลหิตและจดบันทึก",
          description: "วัดหลังพักนั่ง 5 นาที และบันทึกค่าลงสมุดประจำตัว",
          scheduled_time: "08:30",
          duration_minutes: 20,
          priority: "medical_critical",
          is_fixed_time: true,
          is_medically_prescribed: true,
          effective_from_date: tuesdayDate,
          effective_until_date: null,
          version: 1,
          is_active: true,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          id: tplTueStretchId,
          user_id: userId,
          weekly_schedule_id: bootstrap.weekly_schedule.id,
          day_of_week: 2,
          title: "นวดผ่อนคลายไหล่และแขนขา",
          description: "นวดเบาๆ ช่วยระบบไหลเวียนโลหิต",
          scheduled_time: "11:00",
          duration_minutes: 30,
          priority: "low",
          is_fixed_time: false,
          is_medically_prescribed: false,
          effective_from_date: tuesdayDate,
          effective_until_date: null,
          version: 1,
          is_active: true,
          created_at: nowIso,
          updated_at: nowIso,
        },
        {
          id: tplWedMedId,
          user_id: userId,
          weekly_schedule_id: bootstrap.weekly_schedule.id,
          day_of_week: 3,
          title: "จัดยาและตรวจเช็กสต็อกยาประจำสัปดาห์",
          description: "ตรวจสอบจำนวนยาในกล่องแยกมื้อให้ครบถ้วน",
          scheduled_time: "09:00",
          duration_minutes: 25,
          priority: "medical_critical",
          is_fixed_time: true,
          is_medically_prescribed: true,
          effective_from_date: wednesdayDate,
          effective_until_date: null,
          version: 1,
          is_active: true,
          created_at: nowIso,
          updated_at: nowIso,
        },
      ];

      db.templates.push(...seededTemplates);
      db.dependencies.push({
        id: crypto.randomUUID(),
        user_id: userId,
        weekly_schedule_id: bootstrap.weekly_schedule.id,
        predecessor_template_id: tplMonMealId,
        successor_template_id: tplMonMedId,
        created_at: nowIso,
      });

      // Materialize today if it is not a rest day
      this.materializeDateInMemory(db, userId, todayDate);
    }

    this.writeDb(db);
    return { user };
  }

  async getUserBootstrap(userId: string): Promise<UserBootstrapData | null> {
    const db = this.readDb();
    const user = db.user_profiles.find((u) => u.id === userId);
    if (!user) return null;
    const care_recipient = db.care_recipients.find((c) => c.user_id === userId);
    const weekly_schedule = db.weekly_schedules.find(
      (s) => s.user_id === userId && s.is_active
    );
    const reminder_preference = db.reminder_preferences.find(
      (r) => r.user_id === userId
    );
    if (!care_recipient || !weekly_schedule || !reminder_preference) {
      return null;
    }
    return { user, care_recipient, weekly_schedule, reminder_preference };
  }

  // ---------------------------------------------------------------------------
  // Weekly Schedule & Templates
  // ---------------------------------------------------------------------------

  async getSchedule(userId: string): Promise<{
    weekly_schedule: WeeklyScheduleTemplate;
    templates: RecurringTaskTemplate[];
    dependencies: TaskDependency[];
  }> {
    const db = this.readDb();
    const { weekly_schedule } = this.requireBootstrap(db, userId);

    const templates = db.templates
      .filter(
        (t) =>
          t.user_id === userId &&
          t.weekly_schedule_id === weekly_schedule.id &&
          t.is_active
      )
      .sort((a, b) => {
        if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });

    const dependencies = db.dependencies.filter(
      (d) =>
        d.user_id === userId && d.weekly_schedule_id === weekly_schedule.id
    );

    return { weekly_schedule, templates, dependencies };
  }

  async setRestDay(
    userId: string,
    dayOfWeek: DayOfWeek,
    isRestDay: boolean
  ): Promise<{
    weekly_schedule: WeeklyScheduleTemplate;
    medical_disclaimer: string;
  }> {
    const db = this.readDb();
    const { weekly_schedule } = this.requireBootstrap(db, userId);

    const nextSet = new Set<DayOfWeek>(weekly_schedule.rest_days);
    if (isRestDay) {
      nextSet.add(dayOfWeek);
    } else {
      nextSet.delete(dayOfWeek);
    }
    weekly_schedule.rest_days = Array.from(nextSet).sort((a, b) => a - b);
    weekly_schedule.updated_at = new Date().toISOString();

    this.writeDb(db);
    return {
      weekly_schedule,
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

    const db = this.readDb();
    const { weekly_schedule } = this.requireBootstrap(db, userId);
    const todayDate = getThaiTodayDate();

    let effectiveFromDate = input.effective_from_date;
    if (effectiveFromDate) {
      if (!isValidDateString(effectiveFromDate)) {
        throw new ValidationError("รูปแบบวันที่ effective_from_date ไม่ถูกต้อง");
      }
    } else {
      const currentWeek = getThaiWeekDates(todayDate);
      const dayEntry = currentWeek.find((d) => d.day_of_week === input.day_of_week);
      effectiveFromDate = dayEntry?.date ?? todayDate;
    }

    const nowIso = new Date().toISOString();
    const tempIdToTemplateId = new Map<string, string>();
    const createdTemplates: RecurringTaskTemplate[] = [];

    for (const task of input.tasks) {
      if (!task.title.trim()) {
        throw new ValidationError("ชื่องานต้องไม่ว่างเปล่า");
      }
      if (!isValidHHMM(task.scheduled_time)) {
        throw new ValidationError(`เวลาไม่ถูกต้อง: ${task.scheduled_time}`);
      }
      const id = crypto.randomUUID();
      tempIdToTemplateId.set(task.temp_id, id);

      const tpl: RecurringTaskTemplate = {
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
        created_at: nowIso,
        updated_at: nowIso,
      };
      db.templates.push(tpl);
      createdTemplates.push(tpl);
    }

    // Save dependencies between approved tasks
    for (const task of input.tasks) {
      if (!task.depends_on_temp_id) continue;
      const predId = tempIdToTemplateId.get(task.depends_on_temp_id);
      const succId = tempIdToTemplateId.get(task.temp_id);
      if (predId && succId && predId !== succId) {
        db.dependencies.push({
          id: crypto.randomUUID(),
          user_id: userId,
          weekly_schedule_id: weekly_schedule.id,
          predecessor_template_id: predId,
          successor_template_id: succId,
          created_at: nowIso,
        });
      }
    }

    // Materialize for the target effective date (only if matching day_of_week)
    const targetDayDate =
      getThaiDayOfWeek(effectiveFromDate) === input.day_of_week
        ? effectiveFromDate
        : getThaiWeekDates(effectiveFromDate).find(
            (d) => d.day_of_week === input.day_of_week
          )?.date ?? effectiveFromDate;

    this.materializeDateInMemory(db, userId, targetDayDate);
    this.writeDb(db);

    const createdIds = new Set(createdTemplates.map((t) => t.id));
    const occurrences = this.sortOccurrences(
      db.occurrences
        .filter(
          (o) =>
            o.user_id === userId &&
            o.occurrence_date === targetDayDate &&
            createdIds.has(o.template_id)
        )
        .map((row) => this.hydrateOccurrence(db, row, todayDate))
    );

    return {
      templates: createdTemplates,
      occurrences,
    };
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
    const db = this.readDb();
    this.requireBootstrap(db, userId);

    const oldTpl = db.templates.find((t) => t.id === templateId);
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
    const currentWeekDayDate =
      currentWeek.find((d) => d.day_of_week === oldTpl.day_of_week)?.date ??
      todayDate;

    // Ensure current week's occurrence is materialized if effective on currentWeekDayDate
    if (
      oldTpl.effective_from_date <= currentWeekDayDate &&
      (oldTpl.effective_until_date === null ||
        oldTpl.effective_until_date >= currentWeekDayDate)
    ) {
      this.materializeDateInMemory(db, userId, currentWeekDayDate);
    }

    // STRICT RULE (Feature 6): Reject if any active incomplete occurrence exists
    // for today / current week (or earlier) for this template!
    const currentWeekEnd = currentWeek[6].date;
    const blockingIncomplete = db.occurrences.find(
      (o) =>
        o.user_id === userId &&
        o.template_id === oldTpl.id &&
        o.status === "incomplete" &&
        o.occurrence_date <= currentWeekEnd
    );

    if (blockingIncomplete) {
      throw new ForbiddenRuleError(
        "ต้องยืนยันการทำงานรอบปัจจุบันให้เสร็จก่อน จึงจะแก้ไขแผนสำหรับสัปดาห์ถัดไปได้",
        "ACTIVE_INCOMPLETE_OCCURRENCE_BLOCKS_EDIT",
        {
          blocking_occurrence_id: blockingIncomplete.id,
          occurrence_date: blockingIncomplete.occurrence_date,
        }
      );
    }

    // Determine the latest completed occurrence (or currentWeekDayDate) as the cutoff
    const completedForTemplate = db.occurrences
      .filter(
        (o) =>
          o.user_id === userId &&
          o.template_id === oldTpl.id &&
          o.status === "completed"
      )
      .sort((a, b) => b.occurrence_date.localeCompare(a.occurrence_date));

    const latestCompleted = completedForTemplate[0] ?? null;
    const anchorDate = latestCompleted?.occurrence_date ?? currentWeekDayDate;
    const defaultNextEffective = addDays(anchorDate, 7);

    let nextEffectiveFrom = defaultNextEffective;
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

    const nowIso = new Date().toISOString();
    // Close old template without mutating any past occurrences or evidence
    oldTpl.effective_until_date =
      anchorDate >= oldTpl.effective_from_date
        ? anchorDate
        : oldTpl.effective_from_date;
    oldTpl.updated_at = nowIso;

    // Create versioned future template
    const newTpl: RecurringTaskTemplate = {
      id: crypto.randomUUID(),
      user_id: oldTpl.user_id,
      weekly_schedule_id: oldTpl.weekly_schedule_id,
      day_of_week: oldTpl.day_of_week,
      title: patch.title !== undefined ? patch.title.trim() : oldTpl.title,
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
      created_at: nowIso,
      updated_at: nowIso,
    };

    if (!newTpl.title) {
      throw new ValidationError("ชื่องานต้องไม่ว่างเปล่า");
    }

    db.templates.push(newTpl);

    // Carry over dependencies to the new template version so future weeks stay linked
    const existingDeps = db.dependencies.filter(
      (d) =>
        d.user_id === userId &&
        (d.predecessor_template_id === oldTpl.id ||
          d.successor_template_id === oldTpl.id)
    );
    for (const dep of existingDeps) {
      const nextPred =
        dep.predecessor_template_id === oldTpl.id
          ? newTpl.id
          : dep.predecessor_template_id;
      const nextSucc =
        dep.successor_template_id === oldTpl.id
          ? newTpl.id
          : dep.successor_template_id;
      if (
        nextPred !== nextSucc &&
        !db.dependencies.some(
          (d) =>
            d.predecessor_template_id === nextPred &&
            d.successor_template_id === nextSucc
        )
      ) {
        db.dependencies.push({
          id: crypto.randomUUID(),
          user_id: userId,
          weekly_schedule_id: dep.weekly_schedule_id,
          predecessor_template_id: nextPred,
          successor_template_id: nextSucc,
          created_at: nowIso,
        });
      }
    }

    // Record history entry on latest completed occurrence if available
    if (latestCompleted) {
      db.history.push({
        id: crypto.randomUUID(),
        user_id: userId,
        occurrence_id: latestCompleted.id,
        event_type: "future_template_updated",
        metadata: {
          previous_template_id: oldTpl.id,
          new_template_id: newTpl.id,
          new_version: newTpl.version,
          effective_from_date: newTpl.effective_from_date,
        },
        created_at: nowIso,
      });
    }

    this.writeDb(db);
    return {
      previous_template: oldTpl,
      template: newTpl,
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

    const db = this.readDb();
    const { dayOfWeek, isRestDay, mutated } = this.materializeDateInMemory(
      db,
      userId,
      date
    );
    if (mutated) {
      this.writeDb(db);
    }

    const todayDate = getThaiTodayDate();
    const occurrences = this.sortOccurrences(
      db.occurrences
        .filter((o) => o.user_id === userId && o.occurrence_date === date)
        .map((row) => this.hydrateOccurrence(db, row, todayDate))
    );

    const nextTask =
      occurrences.find((o) => o.status === "incomplete") ?? null;

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

    const db = this.readDb();
    const weekDates = getThaiWeekDates(weekStart);
    const todayDate = getThaiTodayDate();

    let anyMutated = false;
    const days: OccurrencesForWeekResult["days"] = [];
    const allOccurrences: DailyTaskOccurrence[] = [];

    for (const entry of weekDates) {
      const { isRestDay, mutated } = this.materializeDateInMemory(
        db,
        userId,
        entry.date
      );
      if (mutated) anyMutated = true;

      const dayOccurrences = this.sortOccurrences(
        db.occurrences
          .filter(
            (o) => o.user_id === userId && o.occurrence_date === entry.date
          )
          .map((row) => this.hydrateOccurrence(db, row, todayDate))
      );

      days.push({
        date: entry.date,
        day_of_week: entry.day_of_week,
        is_rest_day: isRestDay,
        occurrences: dayOccurrences,
      });
      allOccurrences.push(...dayOccurrences);
    }

    if (anyMutated) {
      this.writeDb(db);
    }

    const nextTask =
      allOccurrences.find((o) => o.status === "incomplete") ?? null;

    return {
      week_start: weekDates[0].date,
      days,
      occurrences: allOccurrences,
      next_task: nextTask,
    };
  }

  async getOccurrenceDetail(
    userId: string,
    occurrenceId: string
  ): Promise<OccurrenceDetailResult> {
    const db = this.readDb();
    const row = db.occurrences.find((o) => o.id === occurrenceId);
    if (!row) {
      throw new NotFoundError("ไม่พบรายการงานที่ต้องการ");
    }
    if (row.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์เข้าถึงรายการงานของผู้อื่น");
    }

    const todayDate = getThaiTodayDate();
    const occurrence = this.hydrateOccurrence(db, row, todayDate);
    const history = db.history
      .filter((h) => h.occurrence_id === occurrenceId && h.user_id === userId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));

    const nextDependentId = occurrence.next_dependent_occurrence_ids[0] ?? null;
    const nextDependentRow = nextDependentId
      ? db.occurrences.find((o) => o.id === nextDependentId)
      : null;

    return {
      occurrence,
      history,
      next_dependent: nextDependentRow
        ? this.hydrateOccurrence(db, nextDependentRow, todayDate)
        : null,
    };
  }

  async rejectOccurrenceEdit(
    userId: string,
    occurrenceId: string
  ): Promise<never> {
    const db = this.readDb();
    const row = db.occurrences.find((o) => o.id === occurrenceId);
    if (!row) {
      throw new NotFoundError("ไม่พบรายการงานที่ต้องการ");
    }
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
      "ไม่สามารถแก้ไขงานที่ยังไม่เสร็จสิ้นในรอบปัจจุบันได้ กรุณายืนยันการทำงานรอบนี้ให้เสร็จก่อนจึงแก้ไขแผนสำหรับสัปดาห์ถัดไป (Active incomplete tasks cannot be edited)",
      "ACTIVE_INCOMPLETE_OCCURRENCE_LOCKED"
    );
  }

  async rejectOccurrenceDelete(
    userId: string,
    occurrenceId: string
  ): Promise<never> {
    const db = this.readDb();
    const row = db.occurrences.find((o) => o.id === occurrenceId);
    if (!row) {
      throw new NotFoundError("ไม่พบรายการงานที่ต้องการ");
    }
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
    const db = this.readDb();
    const row = db.occurrences.find((o) => o.id === occurrenceId);
    if (!row) {
      throw new NotFoundError("ไม่พบรายการงานที่ต้องการอัปโหลดหลักฐาน");
    }
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
      throw new ValidationError(
        "ขนาดไฟล์รูปภาพต้องไม่เกิน 5 MB",
        "FILE_TOO_LARGE"
      );
    }

    const evidenceId = crypto.randomUUID();
    const safeName = sanitizeFileName(input.fileName);
    const ext = path.extname(safeName) || extensionFromMime(input.mimeType);
    const diskFileName = `${evidenceId}${ext}`;
    const relativeStoragePath = `${userId}/${occurrenceId}/${diskFileName}`;
    const fullDiskPath = path.join(this.evidenceDir, userId, occurrenceId, diskFileName);

    fs.mkdirSync(path.dirname(fullDiskPath), { recursive: true });
    fs.writeFileSync(fullDiskPath, input.bytes);

    const nowIso = new Date().toISOString();
    const evidence: CompletionEvidence = {
      id: evidenceId,
      user_id: userId,
      occurrence_id: occurrenceId,
      storage_path: relativeStoragePath,
      file_name: safeName,
      mime_type: input.mimeType,
      file_size_bytes: input.bytes.length,
      uploaded_at: nowIso,
      locked_at: null,
      preview_url: `/api/evidence/${evidenceId}`,
    };

    db.evidence.push(evidence);
    db.history.push({
      id: crypto.randomUUID(),
      user_id: userId,
      occurrence_id: occurrenceId,
      event_type: "photo_uploaded",
      metadata: {
        evidence_id: evidenceId,
        file_name: safeName,
        mime_type: input.mimeType,
        file_size_bytes: input.bytes.length,
      },
      created_at: nowIso,
    });

    this.writeDb(db);
    return { evidence };
  }

  async getEvidenceFile(
    userId: string,
    evidenceId: string
  ): Promise<{ evidence: CompletionEvidence; bytes: Buffer }> {
    const db = this.readDb();
    const evidence = db.evidence.find((e) => e.id === evidenceId);
    if (!evidence) {
      throw new NotFoundError("ไม่พบไฟล์หลักฐานรูปภาพ");
    }
    if (evidence.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์เข้าถึงรูปภาพหลักฐานของผู้อื่น");
    }

    // Prevent any path traversal
    const resolvedBase = path.resolve(this.evidenceDir);
    const resolvedFile = path.resolve(this.evidenceDir, evidence.storage_path);
    if (!resolvedFile.startsWith(resolvedBase + path.sep)) {
      throw new ForbiddenError("เส้นทางไฟล์ไม่ถูกต้อง");
    }
    if (!fs.existsSync(resolvedFile)) {
      throw new NotFoundError("ไม่พบไฟล์รูปภาพในพื้นที่จัดเก็บส่วนตัว");
    }

    const bytes = fs.readFileSync(resolvedFile);
    return {
      evidence: {
        ...evidence,
        preview_url: `/api/evidence/${evidence.id}`,
      },
      bytes,
    };
  }

  async confirmOccurrenceCompletion(
    userId: string,
    occurrenceId: string,
    completedAt: Date = new Date()
  ): Promise<ConfirmCompletionResult> {
    const db = this.readDb();
    const row = db.occurrences.find((o) => o.id === occurrenceId);
    if (!row) {
      throw new NotFoundError("ไม่พบรายการงานที่ต้องการยืนยัน");
    }
    if (row.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์ยืนยันรายการงานของผู้อื่น");
    }
    if (row.status === "completed" || row.is_locked) {
      throw new ForbiddenRuleError(
        "รายการงานนี้ได้รับการยืนยันเสร็จสิ้นและล็อกถาวรแล้ว",
        "ALREADY_COMPLETED"
      );
    }

    // STRICT RULE: Must have >= 1 uploaded private photo evidence (never judged by AI)
    const attachedEvidence = db.evidence.filter(
      (e) => e.occurrence_id === occurrenceId && e.user_id === userId
    );
    if (attachedEvidence.length < 1) {
      throw new ValidationError(
        "ต้องอัปโหลดรูปภาพหลักฐานอย่างน้อย 1 รูปก่อนจึงจะยืนยันการทำงานเสร็จสิ้นได้",
        "PHOTO_EVIDENCE_REQUIRED"
      );
    }

    const completedAtIso = completedAt.toISOString();
    const scheduledMs = Date.parse(row.scheduled_at);
    const isDelayed = completedAt.getTime() > scheduledMs + 15 * 60 * 1000;

    // Atomically lock occurrence and all attached evidence
    row.status = "completed";
    row.completed_at = completedAtIso;
    row.is_delayed = isDelayed;
    row.is_locked = true;
    row.updated_at = completedAtIso;

    for (const ev of attachedEvidence) {
      if (!ev.locked_at) {
        ev.locked_at = completedAtIso;
      }
    }

    db.history.push({
      id: crypto.randomUUID(),
      user_id: userId,
      occurrence_id: occurrenceId,
      event_type: "completed_confirmed",
      metadata: {
        completed_at: completedAtIso,
        is_delayed: isDelayed,
        evidence_count: attachedEvidence.length,
      },
      created_at: completedAtIso,
    });

    // Find next dependent occurrences on the same day and emit next_dependent_ready notification
    const successorTemplateIds = db.dependencies
      .filter(
        (d) =>
          d.user_id === userId && d.predecessor_template_id === row.template_id
      )
      .map((d) => d.successor_template_id);

    const nextDependentRows = db.occurrences
      .filter(
        (o) =>
          o.user_id === userId &&
          o.occurrence_date === row.occurrence_date &&
          successorTemplateIds.includes(o.template_id) &&
          o.status === "incomplete"
      )
      .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

    const notificationsCreated: NotificationDeliveryLog[] = [];
    for (const depRow of nextDependentRows) {
      const dedupKey = `dep:${row.id}:${depRow.id}`;
      const alreadyExists = db.notifications.some(
        (n) => n.user_id === userId && n.dedup_key === dedupKey
      );
      if (!alreadyExists) {
        const notif: NotificationDeliveryLog = {
          id: crypto.randomUUID(),
          user_id: userId,
          occurrence_id: depRow.id,
          notification_type: "next_dependent_ready",
          dedup_key: dedupKey,
          title: `พร้อมสำหรับงานถัดไป: ${depRow.title}`,
          body: `คุณยืนยัน "${row.title}" เสร็จแล้ว งานถัดไปที่เกี่ยวข้องคือ "${depRow.title}" เวลา ${depRow.scheduled_time} น.`,
          channel: "in_app",
          delivered_at: completedAtIso,
          read_at: null,
        };
        db.notifications.push(notif);
        notificationsCreated.push(notif);

        db.history.push({
          id: crypto.randomUUID(),
          user_id: userId,
          occurrence_id: depRow.id,
          event_type: "dependent_notified",
          metadata: {
            predecessor_occurrence_id: row.id,
            notification_id: notif.id,
          },
          created_at: completedAtIso,
        });
      }
    }

    this.writeDb(db);

    const todayDate = getThaiTodayDate();
    const hydrated = this.hydrateOccurrence(db, row, todayDate);
    const nextDependent = nextDependentRows[0]
      ? this.hydrateOccurrence(db, nextDependentRows[0], todayDate)
      : null;

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
    const db = this.readDb();
    this.requireBootstrap(db, userId);

    const clampedLimit = Math.max(1, Math.min(200, limit));
    const todayDate = getThaiTodayDate();

    const completedOccurrences = db.occurrences
      .filter((o) => o.user_id === userId && o.status === "completed")
      .sort((a, b) =>
        (b.completed_at ?? b.updated_at).localeCompare(
          a.completed_at ?? a.updated_at
        )
      )
      .slice(0, clampedLimit)
      .map((row) => this.hydrateOccurrence(db, row, todayDate));

    const historyEvents = db.history
      .filter((h) => h.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, clampedLimit);

    return {
      completed_occurrences: completedOccurrences,
      history_events: historyEvents,
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
    const occResult = await this.getOccurrencesForDate(userId, date);
    const metrics = computeDailyMetrics(date, occResult.occurrences);
    const db = this.readDb();
    const summary =
      db.daily_summaries.find(
        (s) => s.user_id === userId && s.summary_date === date
      ) ?? null;

    return { summary, metrics };
  }

  async saveDailySummary(
    userId: string,
    input: Omit<DailySummaryRecord, "id" | "user_id" | "generated_at">
  ): Promise<DailySummaryRecord> {
    const db = this.readDb();
    this.requireBootstrap(db, userId);
    const nowIso = new Date().toISOString();

    const existingIdx = db.daily_summaries.findIndex(
      (s) => s.user_id === userId && s.summary_date === input.summary_date
    );

    const record: DailySummaryRecord = {
      id: existingIdx >= 0 ? db.daily_summaries[existingIdx].id : crypto.randomUUID(),
      user_id: userId,
      summary_date: input.summary_date,
      metrics: input.metrics,
      encouraging_message: input.encouraging_message,
      tone_category: input.tone_category,
      ai_provider: input.ai_provider,
      used_fallback: input.used_fallback,
      generated_at: nowIso,
    };

    if (existingIdx >= 0) {
      db.daily_summaries[existingIdx] = record;
    } else {
      db.daily_summaries.push(record);
    }

    this.writeDb(db);
    return record;
  }

  async getRestSuggestions(
    userId: string,
    date: string
  ): Promise<RestSuggestionRecord[]> {
    const db = this.readDb();
    this.requireBootstrap(db, userId);
    return db.rest_suggestions
      .filter((r) => r.user_id === userId && r.suggestion_date === date)
      .sort((a, b) => a.gap_start.localeCompare(b.gap_start));
  }

  async replaceRestSuggestions(
    userId: string,
    date: string,
    suggestions: Array<
      Omit<RestSuggestionRecord, "id" | "user_id" | "created_at" | "updated_at">
    >
  ): Promise<RestSuggestionRecord[]> {
    const db = this.readDb();
    this.requireBootstrap(db, userId);
    const nowIso = new Date().toISOString();

    // Preserve already accepted/dismissed? Replace fresh set for that date cleanly
    db.rest_suggestions = db.rest_suggestions.filter(
      (r) => !(r.user_id === userId && r.suggestion_date === date)
    );

    const created: RestSuggestionRecord[] = suggestions.map((s) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      suggestion_date: date,
      gap_start: s.gap_start,
      gap_end: s.gap_end,
      duration_minutes: s.duration_minutes,
      activity_title: s.activity_title,
      description: s.description,
      supervision_safety_note: s.supervision_safety_note,
      status: s.status ?? "suggested",
      created_at: nowIso,
      updated_at: nowIso,
    }));

    db.rest_suggestions.push(...created);
    this.writeDb(db);
    return created;
  }

  async updateRestSuggestionStatus(
    userId: string,
    suggestionId: string,
    status: "accepted" | "dismissed" | "ignored"
  ): Promise<RestSuggestionRecord> {
    const db = this.readDb();
    const record = db.rest_suggestions.find((r) => r.id === suggestionId);
    if (!record) {
      throw new NotFoundError("ไม่พบคำแนะนำเวลาพักผ่อนนี้");
    }
    if (record.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์แก้ไขคำแนะนำของผู้อื่น");
    }

    record.status = status;
    record.updated_at = new Date().toISOString();
    this.writeDb(db);
    return record;
  }

  async logAiOperation(
    userId: string,
    entry: Omit<AiOperationLog, "id" | "user_id" | "created_at">
  ): Promise<AiOperationLog> {
    const db = this.readDb();
    const log: AiOperationLog = {
      id: crypto.randomUUID(),
      user_id: userId,
      operation_type: entry.operation_type,
      provider: entry.provider,
      model: entry.model,
      used_fallback: entry.used_fallback,
      status: entry.status,
      latency_ms: Math.max(0, Math.round(entry.latency_ms)),
      created_at: new Date().toISOString(),
    };
    db.ai_logs.push(log);
    this.writeDb(db);
    return log;
  }

  // ---------------------------------------------------------------------------
  // Smart Reminders
  // ---------------------------------------------------------------------------

  async getReminders(userId: string): Promise<{
    preference: ReminderPreference;
    notifications: NotificationDeliveryLog[];
  }> {
    const db = this.readDb();
    const { reminder_preference } = this.requireBootstrap(db, userId);
    const notifications = db.notifications
      .filter((n) => n.user_id === userId)
      .sort((a, b) => b.delivered_at.localeCompare(a.delivered_at))
      .slice(0, 100);

    return {
      preference: reminder_preference,
      notifications,
    };
  }

  async listAllActiveUserIds(): Promise<string[]> {
    const db = this.readDb();
    return db.user_profiles.map((u) => u.id);
  }

  async createNotificationIfAbsent(
    userId: string,
    input: CreateNotificationInput
  ): Promise<NotificationDeliveryLog | null> {
    const db = this.readDb();
    const exists = db.notifications.some(
      (n) => n.user_id === userId && n.dedup_key === input.dedup_key
    );
    if (exists) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const notif: NotificationDeliveryLog = {
      id: crypto.randomUUID(),
      user_id: userId,
      occurrence_id: input.occurrence_id,
      notification_type: input.notification_type,
      dedup_key: input.dedup_key,
      title: input.title,
      body: input.body,
      channel: input.channel,
      delivered_at: nowIso,
      read_at: null,
    };
    db.notifications.push(notif);
    db.history.push({
      id: crypto.randomUUID(),
      user_id: userId,
      occurrence_id: input.occurrence_id,
      event_type: "reminder_sent",
      metadata: {
        notification_type: input.notification_type,
        dedup_key: input.dedup_key,
      },
      created_at: nowIso,
    });

    this.writeDb(db);
    return notif;
  }

  async markNotificationRead(
    userId: string,
    notificationId: string
  ): Promise<NotificationDeliveryLog> {
    const db = this.readDb();
    const notif = db.notifications.find((n) => n.id === notificationId);
    if (!notif) {
      throw new NotFoundError("ไม่พบการแจ้งเตือนนี้");
    }
    if (notif.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์จัดการการแจ้งเตือนของผู้อื่น");
    }
    if (!notif.read_at) {
      notif.read_at = new Date().toISOString();
      this.writeDb(db);
    }
    return notif;
  }

  // ---------------------------------------------------------------------------
  // Share Links
  // ---------------------------------------------------------------------------

  async listShareLinks(userId: string): Promise<ShareLinkRecord[]> {
    const db = this.readDb();
    this.requireBootstrap(db, userId);
    return db.share_links
      .filter((l) => l.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async createShareLink(
    userId: string,
    input: CreateShareLinkInput
  ): Promise<ShareLinkRecord> {
    if (!isValidDateString(input.target_date)) {
      throw new ValidationError("รูปแบบวันที่ target_date ไม่ถูกต้อง");
    }

    const db = this.readDb();
    const { weekly_schedule } = this.requireBootstrap(db, userId);
    const now = new Date();
    const nowIso = now.toISOString();

    let expiresAt: string | null = null;
    if (
      input.expires_in_days !== undefined &&
      input.expires_in_days !== null
    ) {
      if (input.expires_in_days <= 0 || input.expires_in_days > 365) {
        throw new ValidationError("จำนวนวันหมดอายุต้องอยู่ระหว่าง 1 ถึง 365 วัน");
      }
      expiresAt = new Date(
        now.getTime() + input.expires_in_days * 24 * 60 * 60 * 1000
      ).toISOString();
    }

    const token = crypto.randomBytes(24).toString("base64url");
    const link: ShareLinkRecord = {
      id: crypto.randomUUID(),
      user_id: userId,
      weekly_schedule_id: weekly_schedule.id,
      token,
      scope: input.scope,
      target_date: input.target_date,
      include_private_notes: Boolean(input.include_private_notes),
      expires_at: expiresAt,
      revoked_at: null,
      created_at: nowIso,
    };

    db.share_links.push(link);
    this.writeDb(db);
    return link;
  }

  async revokeShareLink(
    userId: string,
    linkId: string
  ): Promise<ShareLinkRecord> {
    const db = this.readDb();
    const link = db.share_links.find((l) => l.id === linkId);
    if (!link) {
      throw new NotFoundError("ไม่พบลิงก์แชร์ที่ต้องการยกเลิก");
    }
    if (link.user_id !== userId) {
      throw new ForbiddenError("คุณไม่มีสิทธิ์ยกเลิกลิงก์แชร์ของผู้อื่น");
    }

    if (!link.revoked_at) {
      link.revoked_at = new Date().toISOString();
      this.writeDb(db);
    }
    return link;
  }

  async getPublicSharedSchedule(
    token: string,
    now: Date = new Date()
  ): Promise<SharedSchedulePayload> {
    const db = this.readDb();
    const link = db.share_links.find((l) => l.token === token);
    if (!link) {
      throw new NotFoundError("ไม่พบลิงก์ตารางดูแลนี้");
    }
    if (link.revoked_at !== null) {
      throw new GoneError("ลิงก์แชร์นี้ถูกยกเลิกโดยเจ้าของตารางแล้ว", "SHARE_LINK_REVOKED");
    }
    if (link.expires_at !== null && Date.parse(link.expires_at) <= now.getTime()) {
      throw new GoneError("ลิงก์แชร์นี้หมดอายุแล้ว", "SHARE_LINK_EXPIRED");
    }

    const schedule = db.weekly_schedules.find(
      (s) => s.id === link.weekly_schedule_id
    );
    const recipient = db.care_recipients.find(
      (c) => c.user_id === link.user_id
    );
    if (!schedule || !recipient) {
      throw new NotFoundError("ไม่พบข้อมูลตารางดูแลที่เชื่อมกับลิงก์นี้");
    }

    const targetDates =
      link.scope === "day"
        ? [{ day_of_week: getThaiDayOfWeek(link.target_date), date: link.target_date }]
        : getThaiWeekDates(link.target_date);

    const days: SharedSchedulePayload["days"] = targetDates.map((entry) => {
      const isRestDay = schedule.rest_days.includes(entry.day_of_week);
      if (isRestDay) {
        return {
          day_of_week: entry.day_of_week,
          date: entry.date,
          is_rest_day: true,
          tasks: [],
        };
      }

      // Use active templates effective for that date (public read-only view does not leak private evidence photos)
      const dayTemplates = db.templates
        .filter(
          (t) =>
            t.user_id === link.user_id &&
            t.weekly_schedule_id === schedule.id &&
            t.is_active &&
            t.day_of_week === entry.day_of_week &&
            t.effective_from_date <= entry.date &&
            (t.effective_until_date === null ||
              t.effective_until_date >= entry.date)
        )
        .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

      return {
        day_of_week: entry.day_of_week,
        date: entry.date,
        is_rest_day: false,
        tasks: dayTemplates.map((t) => ({
          title: t.title,
          scheduled_time: t.scheduled_time,
          duration_minutes: t.duration_minutes,
          priority: t.priority,
          is_medically_prescribed: t.is_medically_prescribed,
          ...(link.include_private_notes && t.description
            ? { notes: t.description }
            : {}),
        })),
      };
    });

    return {
      token: link.token,
      scope: link.scope,
      target_date: link.target_date,
      schedule_title: schedule.title,
      care_recipient_label: recipient.display_name,
      timezone: schedule.timezone,
      rest_days: schedule.rest_days,
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
    const db = this.readDb();
    const { user, care_recipient, reminder_preference } = this.requireBootstrap(
      db,
      userId
    );
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
    const db = this.readDb();
    const { user, care_recipient, reminder_preference } = this.requireBootstrap(
      db,
      userId
    );
    const nowIso = new Date().toISOString();

    if (patch.profile) {
      if (patch.profile.full_name !== undefined) {
        const trimmed = patch.profile.full_name.trim();
        if (!trimmed) {
          throw new ValidationError("ชื่อผู้ดูแลต้องไม่ว่างเปล่า");
        }
        user.full_name = trimmed;
      }
      if (patch.profile.timezone !== undefined) {
        user.timezone = patch.profile.timezone.trim() || THAI_TIMEZONE;
      }
      user.updated_at = nowIso;
    }

    if (patch.care_recipient) {
      if (patch.care_recipient.display_name !== undefined) {
        const trimmed = patch.care_recipient.display_name.trim();
        if (!trimmed) {
          throw new ValidationError("ชื่อผู้สูงอายุต้องไม่ว่างเปล่า");
        }
        care_recipient.display_name = trimmed;
      }
      if (patch.care_recipient.age_years !== undefined) {
        care_recipient.age_years = patch.care_recipient.age_years;
      }
      if (patch.care_recipient.mobility_level !== undefined) {
        care_recipient.mobility_level = patch.care_recipient.mobility_level;
      }
      if (patch.care_recipient.care_notes !== undefined) {
        care_recipient.care_notes = patch.care_recipient.care_notes;
      }
      if (patch.care_recipient.requires_supervision !== undefined) {
        care_recipient.requires_supervision =
          patch.care_recipient.requires_supervision;
      }
      care_recipient.updated_at = nowIso;
    }

    if (patch.reminder_preference) {
      const rp = patch.reminder_preference;
      if (rp.reminders_enabled !== undefined) {
        reminder_preference.reminders_enabled = rp.reminders_enabled;
      }
      if (rp.repeat_interval_minutes !== undefined) {
        if (rp.repeat_interval_minutes < 5 || rp.repeat_interval_minutes > 120) {
          throw new ValidationError("ช่วงเวลาแจ้งเตือนซ้ำต้องอยู่ระหว่าง 5 ถึง 120 นาที");
        }
        reminder_preference.repeat_interval_minutes = rp.repeat_interval_minutes;
      }
      if (rp.quiet_hours_enabled !== undefined) {
        reminder_preference.quiet_hours_enabled = rp.quiet_hours_enabled;
      }
      if (rp.quiet_hours_start !== undefined) {
        if (!isValidHHMM(rp.quiet_hours_start)) {
          throw new ValidationError("เวลาเริ่มต้นช่วงงดรบกวนไม่ถูกต้อง");
        }
        reminder_preference.quiet_hours_start = rp.quiet_hours_start;
      }
      if (rp.quiet_hours_end !== undefined) {
        if (!isValidHHMM(rp.quiet_hours_end)) {
          throw new ValidationError("เวลาสิ้นสุดช่วงงดรบกวนไม่ถูกต้อง");
        }
        reminder_preference.quiet_hours_end = rp.quiet_hours_end;
      }
      if (rp.browser_notifications_granted !== undefined) {
        reminder_preference.browser_notifications_granted =
          rp.browser_notifications_granted;
      }
      reminder_preference.updated_at = nowIso;
    }

    this.writeDb(db);
    return {
      profile: user,
      care_recipient,
      reminder_preference,
    };
  }

  async createPrivacyDeletionRequest(
    userId: string,
    reason = ""
  ): Promise<{
    request_id: string;
    status: "recorded";
    message: string;
  }> {
    const db = this.readDb();
    this.requireBootstrap(db, userId);

    const requestId = crypto.randomUUID();
    db.privacy_deletion_requests.push({
      id: requestId,
      user_id: userId,
      reason: reason.trim(),
      status: "recorded",
      requested_at: new Date().toISOString(),
    });
    this.writeDb(db);

    return {
      request_id: requestId,
      status: "recorded",
      message:
        "ระบบบันทึกคำขอลบข้อมูลส่วนบุคคลตามหลัก PDPA/GDPR เรียบร้อยแล้ว โดยไม่เป็นการแก้ไขประวัติหลักฐานการทำงานตามปกติ",
    };
  }
}
