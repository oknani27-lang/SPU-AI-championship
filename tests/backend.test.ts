import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDailySummary,
  buildRestSuggestions,
  parseTextToTasks,
  proposeDailySchedule,
} from "@/lib/ai/service";
import {
  createSignedSessionToken,
  verifySignedSessionToken,
} from "@/lib/auth";
import {
  ForbiddenError,
  ForbiddenRuleError,
  GoneError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { processRemindersForUser } from "@/lib/reminders";
import { DemoFileStore } from "@/lib/store/demo-store";
import { computeDailyMetrics } from "@/lib/store/types";
import {
  addDays,
  buildThaiDateTimeIso,
  formatThaiTime,
  getThaiDayOfWeek,
  getThaiTodayDate,
  getThaiWeekDates,
  isWithinQuietHours,
} from "@/lib/timezone";

const SAMPLE_JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9,
]);

describe("CarePlan Backend, Domain Invariants, AI & Smart Reminders", () => {
  let tmpDir: string;
  let store: DemoFileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "careplan-test-"));
    store = new DemoFileStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // =========================================================================
  // 1. Thailand Timezone (Asia/Bangkok) Accuracy
  // =========================================================================
  it("computes Thailand timezone dates, weekdays, and quiet hours accurately across UTC boundaries", () => {
    // 2026-11-22T18:30:00Z (Sunday UTC) is 2026-11-23 01:30 (Monday Asia/Bangkok)
    const utcBoundary = new Date("2026-11-22T18:30:00Z");
    expect(getThaiTodayDate(utcBoundary)).toBe("2026-11-23");
    expect(formatThaiTime(utcBoundary)).toBe("01:30");
    expect(getThaiDayOfWeek("2026-11-23")).toBe(1); // Monday
    expect(getThaiDayOfWeek("2026-11-29")).toBe(7); // Sunday

    const week = getThaiWeekDates("2026-11-25"); // Wednesday
    expect(week).toHaveLength(7);
    expect(week[0]).toEqual({ day_of_week: 1, date: "2026-11-23" });
    expect(week[6]).toEqual({ day_of_week: 7, date: "2026-11-29" });
    expect(addDays("2026-11-23", 7)).toBe("2026-11-30");

    expect(buildThaiDateTimeIso("2026-11-23", "08:00")).toBe(
      "2026-11-23T08:00:00+07:00"
    );

    // Overnight quiet hours 22:00..06:00 Bangkok
    expect(
      isWithinQuietHours(new Date("2026-11-23T23:15:00+07:00"), "22:00", "06:00")
    ).toBe(true);
    expect(
      isWithinQuietHours(new Date("2026-11-23T05:59:00+07:00"), "22:00", "06:00")
    ).toBe(true);
    expect(
      isWithinQuietHours(new Date("2026-11-23T08:00:00+07:00"), "22:00", "06:00")
    ).toBe(false);
  });

  // =========================================================================
  // 2. Weekly Recurrence Across Next Week, Different Weekday Tasks & Rest Days
  // =========================================================================
  it("persists different tasks per weekday, auto-materializes next week, and honors rest days with medical disclaimer", async () => {
    const { user } = await store.registerUser({
      email: "caregiver1@example.com",
      password: "password123",
      full_name: "คุณสุมาลี",
      care_recipient_name: "คุณพ่อประเสริฐ",
      care_recipient_age: 78,
    });

    const monday = "2026-11-23";
    const tuesday = "2026-11-24";
    const sunday = "2026-11-29";
    const nextMonday = "2026-11-30";

    await store.approveScheduleTasks(user.id, {
      day_of_week: 1,
      effective_from_date: monday,
      tasks: [
        {
          temp_id: "m1",
          title: "เตรียมอาหารเช้า",
          description: "โจ๊กหมูไม่ใส่ผงชูรส",
          scheduled_time: "08:00",
          duration_minutes: 30,
          priority: "high",
          is_fixed_time: true,
          is_medically_prescribed: false,
          depends_on_temp_id: null,
          rationale: "มื้อเช้าตรงเวลา",
        },
      ],
    });

    await store.approveScheduleTasks(user.id, {
      day_of_week: 2,
      effective_from_date: tuesday,
      tasks: [
        {
          temp_id: "t1",
          title: "วัดความดันโลหิต",
          description: "วัดก่อนทานข้าวเช้า",
          scheduled_time: "07:30",
          duration_minutes: 15,
          priority: "medical_critical",
          is_fixed_time: true,
          is_medically_prescribed: true,
          depends_on_temp_id: null,
          rationale: "ตามคำสั่งแพทย์",
        },
      ],
    });

    // Reload store from disk to verify persistence across reloads
    const reloadedStore = new DemoFileStore(tmpDir);

    const monData = await reloadedStore.getOccurrencesForDate(user.id, monday);
    expect(monData.is_rest_day).toBe(false);
    expect(monData.occurrences.map((o) => o.title)).toEqual(["เตรียมอาหารเช้า"]);

    const tueData = await reloadedStore.getOccurrencesForDate(user.id, tuesday);
    expect(tueData.occurrences.map((o) => o.title)).toEqual(["วัดความดันโลหิต"]);

    // Next week Monday automatically materializes from recurring Monday template!
    const nextMonData = await reloadedStore.getOccurrencesForDate(
      user.id,
      nextMonday
    );
    expect(nextMonData.occurrences).toHaveLength(1);
    expect(nextMonData.occurrences[0].title).toBe("เตรียมอาหารเช้า");
    expect(nextMonData.occurrences[0].occurrence_date).toBe(nextMonday);

    // Rest day (Sunday = 7 by default, plus toggling Saturday = 6)
    const restRes = await reloadedStore.setRestDay(user.id, 7, true);
    expect(restRes.weekly_schedule.rest_days).toContain(7);
    expect(restRes.medical_disclaimer).toContain("ไม่ถือเป็นการงดยา");

    const sunData = await reloadedStore.getOccurrencesForDate(user.id, sunday);
    expect(sunData.is_rest_day).toBe(true);
    expect(sunData.occurrences).toHaveLength(0);
  });

  // =========================================================================
  // 3. AI Schedule Generator (Structured Output, Medical Lock, Dependencies, Fallback)
  // =========================================================================
  it("generates chronologically valid AI schedule preserving medical times, dependencies, missing info questions, and honest fallback", async () => {
    const { response } = await proposeDailySchedule({
      day_of_week: 1,
      forceFallback: true,
      tasks: [
        {
          temp_id: "med",
          title: "จัดยาความดันหลังอาหารเช้า",
          preferred_time: "09:00",
          duration_minutes: 15,
          priority: "medical_critical",
          is_fixed_time: true,
          is_medically_prescribed: true,
          depends_on_temp_id: "meal",
        },
        {
          temp_id: "meal",
          title: "เตรียมอาหารเช้าให้แม่",
          preferred_time: "08:00",
          duration_minutes: 40,
          priority: "high",
          is_fixed_time: true,
        },
        {
          temp_id: "walk",
          title: "พาเดินออกกำลังกายเบาๆ",
          // Missing preferred_time and duration_minutes intentionally
        },
      ],
    });

    expect(response.used_fallback).toBe(true);
    expect(response.medical_safety_note).toContain("ไม่ใช่คำแนะนำทางการแพทย์");
    expect(response.proposed_tasks).toHaveLength(3);

    const meal = response.proposed_tasks.find((t) => t.temp_id === "meal")!;
    const med = response.proposed_tasks.find((t) => t.temp_id === "med")!;
    const walk = response.proposed_tasks.find((t) => t.temp_id === "walk")!;

    // Medical prescribed time NEVER moved
    expect(med.scheduled_time).toBe("09:00");
    expect(med.is_medically_prescribed).toBe(true);
    expect(meal.scheduled_time).toBe("08:00");
    // Chronological order: meal (08:00) -> med (09:00) -> walk (after 09:15)
    expect(response.proposed_tasks[0].temp_id).toBe("meal");
    expect(response.proposed_tasks[1].temp_id).toBe("med");
    expect(walk.scheduled_time >= "09:25").toBe(true);

    // Missing info questions & assumptions detected
    expect(response.assumptions.length).toBeGreaterThan(0);
    expect(response.missing_info_questions.some((q) => q.includes("พาเดิน"))).toBe(
      true
    );
  });

  // =========================================================================
  // 4. Text-to-Task Thai Parser (Typed Text Only — No Voice)
  // =========================================================================
  it("parses Thai caregiving text into accurate days, 24h times, and medical flags", async () => {
    const sample =
      "วันจันทร์ 8 โมงเตรียมอาหารให้แม่ 9 โมงจัดยา แล้วบ่ายสองพาไปหาหมอ";
    const { response } = await parseTextToTasks({
      text: sample,
      default_day_of_week: 1,
      forceFallback: true,
    });

    expect(response.used_fallback).toBe(true);
    expect(response.extracted_tasks).toHaveLength(3);

    expect(response.extracted_tasks[0]).toMatchObject({
      day_of_week: 1,
      preferred_time: "08:00",
      is_medically_prescribed: false,
    });
    expect(response.extracted_tasks[0].title).toContain("เตรียมอาหารให้แม่");

    expect(response.extracted_tasks[1]).toMatchObject({
      day_of_week: 1,
      preferred_time: "09:00",
      is_medically_prescribed: true,
      priority: "medical_critical",
    });
    expect(response.extracted_tasks[1].title).toContain("จัดยา");

    expect(response.extracted_tasks[2]).toMatchObject({
      day_of_week: 1,
      preferred_time: "14:00",
      is_medically_prescribed: true,
      priority: "medical_critical",
    });
    expect(response.extracted_tasks[2].title).toContain("พาไปหาหมอ");

    // Additional Thai time expressions + missing time detection
    const { response: multi } = await parseTextToTasks({
      text: "วันอังคาร ตี 5 เตรียมน้ำอุ่น\nเที่ยงป้อนข้าว\n6 โมงเย็นเช็ดตัว\n2 ทุ่มฉีดอินซูลิน\nวันพุธ ตัดเล็บให้แม่",
      default_day_of_week: 1,
      forceFallback: true,
    });

    expect(multi.extracted_tasks.map((t) => t.preferred_time)).toEqual([
      "05:00",
      "12:00",
      "18:00",
      "20:00",
      null,
    ]);
    expect(multi.extracted_tasks[3].is_medically_prescribed).toBe(true);
    expect(multi.extracted_tasks[4].day_of_week).toBe(3);
    expect(multi.missing_info_questions.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // 5. Photo-Verified Completion, Immutability, Active Edit Lock & Future Template Edit
  // =========================================================================
  it("enforces photo-required completion, immutability, active-task lock, and post-completion future template versioning", async () => {
    const { user } = await store.registerUser({
      email: "napa@example.com",
      password: "password123",
      full_name: "คุณนภา",
    });

    const monday = "2026-11-23";
    const nextMonday = "2026-11-30";

    const { templates, occurrences } = await store.approveScheduleTasks(user.id, {
      day_of_week: 1,
      effective_from_date: monday,
      tasks: [
        {
          temp_id: "meal",
          title: "เตรียมอาหารเช้าให้แม่",
          description: "ข้าวต้มปลา",
          scheduled_time: "08:00",
          duration_minutes: 30,
          priority: "high",
          is_fixed_time: true,
          is_medically_prescribed: false,
          depends_on_temp_id: null,
          rationale: "มื้อเช้า",
        },
        {
          temp_id: "med",
          title: "จัดยาหลังอาหาร",
          description: "ยาความดัน 1 เม็ด",
          scheduled_time: "09:00",
          duration_minutes: 15,
          priority: "medical_critical",
          is_fixed_time: true,
          is_medically_prescribed: true,
          depends_on_temp_id: "meal",
          rationale: "ต่อจากอาหารเช้า",
        },
      ],
    });

    const mealTemplate = templates[0];
    const mealOcc = occurrences.find((o) => o.template_id === mealTemplate.id)!;
    expect(mealOcc.can_edit_occurrence).toBe(false);

    // (A) Active incomplete occurrence CANNOT be edited or deleted (409)
    await expect(
      store.rejectOccurrenceEdit(user.id, mealOcc.id)
    ).rejects.toThrow(ForbiddenRuleError);
    await expect(
      store.rejectOccurrenceDelete(user.id, mealOcc.id)
    ).rejects.toThrow(ForbiddenRuleError);

    // (B) Future-week template edit BLOCKED while current occurrence is incomplete (409)
    await expect(
      store.updateTemplateForFuture(
        user.id,
        mealTemplate.id,
        { scheduled_time: "07:45", title: "เตรียมอาหารเช้า (ปรับเวลาใหม่)" },
        monday
      )
    ).rejects.toThrow(ForbiddenRuleError);

    // (C) Completion WITHOUT photo -> MUST FAIL (400 ValidationError)
    await expect(
      store.confirmOccurrenceCompletion(
        user.id,
        mealOcc.id,
        new Date("2026-11-23T08:05:00+07:00")
      )
    ).rejects.toThrow(ValidationError);

    // (D) Invalid MIME upload -> MUST FAIL (400)
    await expect(
      store.uploadCompletionEvidence(user.id, mealOcc.id, {
        fileName: "malware.exe",
        mimeType: "application/octet-stream",
        bytes: Buffer.from("not-an-image"),
      })
    ).rejects.toThrow(ValidationError);

    // (E) Valid private photo upload -> SUCCEEDS
    const { evidence } = await store.uploadCompletionEvidence(
      user.id,
      mealOcc.id,
      {
        fileName: "breakfast-proof.jpg",
        mimeType: "image/jpeg",
        bytes: SAMPLE_JPEG_BYTES,
      }
    );
    expect(evidence.preview_url).toBe(`/api/evidence/${evidence.id}`);
    expect(evidence.locked_at).toBeNull();

    // (F) Confirm completion WITH photo -> SUCCEEDS, locks occurrence & evidence, notifies dependent task!
    const confirmed = await store.confirmOccurrenceCompletion(
      user.id,
      mealOcc.id,
      new Date("2026-11-23T08:10:00+07:00")
    );
    expect(confirmed.occurrence.status).toBe("completed");
    expect(confirmed.occurrence.is_locked).toBe(true);
    expect(confirmed.occurrence.is_delayed).toBe(false);
    expect(confirmed.occurrence.evidence[0].locked_at).not.toBeNull();
    expect(confirmed.next_dependent?.title).toBe("จัดยาหลังอาหาร");
    expect(confirmed.notifications_created).toHaveLength(1);
    expect(confirmed.notifications_created[0].notification_type).toBe(
      "next_dependent_ready"
    );

    // (G) Completed occurrence & evidence are IMMUTABLE (409)
    await expect(
      store.rejectOccurrenceEdit(user.id, mealOcc.id)
    ).rejects.toThrow(ForbiddenRuleError);
    await expect(
      store.rejectOccurrenceDelete(user.id, mealOcc.id)
    ).rejects.toThrow(ForbiddenRuleError);
    await expect(
      store.uploadCompletionEvidence(user.id, mealOcc.id, {
        fileName: "second.jpg",
        mimeType: "image/jpeg",
        bytes: SAMPLE_JPEG_BYTES,
      })
    ).rejects.toThrow(ForbiddenRuleError);

    // (H) NOW future-week template editing SUCCEEDS and leaves past occurrence & evidence untouched!
    const updated = await store.updateTemplateForFuture(
      user.id,
      mealTemplate.id,
      { title: "เตรียมอาหารเช้าสูตรลดโซเดียม", scheduled_time: "07:45" },
      monday
    );
    expect(updated.template.version).toBe(2);
    expect(updated.template.effective_from_date).toBe(nextMonday);

    // Past occurrence & evidence remain 100% UNCHANGED
    const pastDetail = await store.getOccurrenceDetail(user.id, mealOcc.id);
    expect(pastDetail.occurrence.title).toBe("เตรียมอาหารเช้าให้แม่");
    expect(pastDetail.occurrence.scheduled_time).toBe("08:00");
    expect(pastDetail.occurrence.evidence).toHaveLength(1);

    // Next week Monday automatically uses the updated version 2 template!
    const nextWeekMon = await store.getOccurrencesForDate(user.id, nextMonday);
    const nextMeal = nextWeekMon.occurrences.find(
      (o) => o.template_id === updated.template.id
    )!;
    expect(nextMeal.title).toBe("เตรียมอาหารเช้าสูตรลดโซเดียม");
    expect(nextMeal.scheduled_time).toBe("07:45");
  });

  // =========================================================================
  // 6. Smart Reminder Engine (Start, 15-min Repeat, Dedup, Quiet Hours, Stop on Complete)
  // =========================================================================
  it("triggers start & 15-min repeat reminders, prevents duplicates, respects quiet hours, and stops after completion", async () => {
    const { user } = await store.registerUser({
      email: "rem@example.com",
      password: "password123",
      full_name: "คุณเมตตา",
    });

    const monday = "2026-11-23";
    const { occurrences } = await store.approveScheduleTasks(user.id, {
      day_of_week: 1,
      effective_from_date: monday,
      tasks: [
        {
          temp_id: "t1",
          title: "จัดยาเช้า",
          description: "",
          scheduled_time: "08:00",
          duration_minutes: 15,
          priority: "medical_critical",
          is_fixed_time: true,
          is_medically_prescribed: true,
          depends_on_temp_id: null,
          rationale: "ตรงเวลา",
        },
      ],
    });
    const occ = occurrences[0];

    // Before start time (07:50): 0 reminders
    const before = await processRemindersForUser(store, user.id, {
      date: monday,
      now: new Date("2026-11-23T07:50:00+07:00"),
    });
    expect(before.delivered).toHaveLength(0);

    // At start time (08:00): emits start_reminder
    const atStart = await processRemindersForUser(store, user.id, {
      date: monday,
      now: new Date("2026-11-23T08:00:00+07:00"),
    });
    expect(atStart.delivered).toHaveLength(1);
    expect(atStart.delivered[0].notification_type).toBe("start_reminder");

    // Calling again at 08:05: duplicate prevented!
    const dupCheck = await processRemindersForUser(store, user.id, {
      date: monday,
      now: new Date("2026-11-23T08:05:00+07:00"),
    });
    expect(dupCheck.delivered).toHaveLength(0);

    // At +15 min (08:15): emits repeat_reminder slot 1
    const repeat1 = await processRemindersForUser(store, user.id, {
      date: monday,
      now: new Date("2026-11-23T08:15:00+07:00"),
    });
    expect(repeat1.delivered).toHaveLength(1);
    expect(repeat1.delivered[0].notification_type).toBe("repeat_reminder");
    expect(repeat1.delivered[0].dedup_key).toBe(`repeat:${occ.id}:1`);

    // Calling again at 08:20 (same 15-min slot): duplicate prevented!
    const repeat1Dup = await processRemindersForUser(store, user.id, {
      date: monday,
      now: new Date("2026-11-23T08:20:00+07:00"),
    });
    expect(repeat1Dup.delivered).toHaveLength(0);

    // Quiet hours check (23:00 Bangkok): skipped respectfully
    const quiet = await processRemindersForUser(store, user.id, {
      date: monday,
      now: new Date("2026-11-23T23:00:00+07:00"),
    });
    expect(quiet.delivered).toHaveLength(0);
    expect(quiet.skipped_reason).toContain("ช่วงเวลางดรบกวน");

    // Complete task with photo -> reminders MUST STOP immediately!
    await store.uploadCompletionEvidence(user.id, occ.id, {
      fileName: "med.jpg",
      mimeType: "image/jpeg",
      bytes: SAMPLE_JPEG_BYTES,
    });
    await store.confirmOccurrenceCompletion(
      user.id,
      occ.id,
      new Date("2026-11-23T08:25:00+07:00")
    );

    // At +30 min (08:30): NO repeat reminder because task is completed!
    const afterComplete = await processRemindersForUser(store, user.id, {
      date: monday,
      now: new Date("2026-11-23T08:30:00+07:00"),
    });
    expect(afterComplete.delivered).toHaveLength(0);
  });

  // =========================================================================
  // 7. Cross-User Authorization Isolation & Signed Cookie Verification
  // =========================================================================
  it("strictly denies cross-user access to occurrences, private photo evidence, templates, and share links", async () => {
    const { user: userA } = await store.registerUser({
      email: "usera@example.com",
      password: "password123",
      full_name: "ผู้ดูแล A",
    });
    const { user: userB } = await store.registerUser({
      email: "userb@example.com",
      password: "password123",
      full_name: "ผู้ดูแล B",
    });

    const monday = "2026-11-23";
    const { templates, occurrences } = await store.approveScheduleTasks(
      userA.id,
      {
        day_of_week: 1,
        effective_from_date: monday,
        tasks: [
          {
            temp_id: "a1",
            title: "งานส่วนตัวของ A",
            description: "โน้ตลับของ A",
            scheduled_time: "08:00",
            duration_minutes: 30,
            priority: "high",
            is_fixed_time: true,
            is_medically_prescribed: false,
            depends_on_temp_id: null,
            rationale: "งาน A",
          },
        ],
      }
    );

    const occA = occurrences[0];
    const { evidence } = await store.uploadCompletionEvidence(
      userA.id,
      occA.id,
      {
        fileName: "private-a.jpg",
        mimeType: "image/jpeg",
        bytes: SAMPLE_JPEG_BYTES,
      }
    );
    const shareA = await store.createShareLink(userA.id, {
      scope: "day",
      target_date: monday,
      include_private_notes: false,
    });

    // User B attempts to access/mutate User A's resources -> ALL rejected with ForbiddenError (403)
    await expect(
      store.getOccurrenceDetail(userB.id, occA.id)
    ).rejects.toThrow(ForbiddenError);
    await expect(
      store.uploadCompletionEvidence(userB.id, occA.id, {
        fileName: "evil.jpg",
        mimeType: "image/jpeg",
        bytes: SAMPLE_JPEG_BYTES,
      })
    ).rejects.toThrow(ForbiddenError);
    await expect(
      store.confirmOccurrenceCompletion(userB.id, occA.id)
    ).rejects.toThrow(ForbiddenError);
    await expect(
      store.getEvidenceFile(userB.id, evidence.id)
    ).rejects.toThrow(ForbiddenError);
    await expect(
      store.updateTemplateForFuture(userB.id, templates[0].id, {
        title: "Hacked",
      })
    ).rejects.toThrow(ForbiddenError);
    await expect(
      store.revokeShareLink(userB.id, shareA.id)
    ).rejects.toThrow(ForbiddenError);

    // Owner A can retrieve private evidence bytes cleanly
    const ownerFile = await store.getEvidenceFile(userA.id, evidence.id);
    expect(ownerFile.bytes.equals(SAMPLE_JPEG_BYTES)).toBe(true);

    // Signed session cookie resists tampering
    const validCookie = createSignedSessionToken({
      mode: "demo",
      demo_user_id: userA.id,
      issued_at: Date.now(),
    });
    expect(verifySignedSessionToken(validCookie)?.mode).toBe("demo");
    expect(verifySignedSessionToken(`${validCookie}tampered`)).toBeNull();
  });

  // =========================================================================
  // 8. Share Links (Public No-Login View, Private Notes Stripping, Expiry 410, Revocation 410)
  // =========================================================================
  it("supports public share links, strips private notes by default, and enforces expiry and revocation (410)", async () => {
    const { user } = await store.registerUser({
      email: "share@example.com",
      password: "password123",
      full_name: "คุณสายใจ",
    });

    const monday = "2026-11-23";
    await store.approveScheduleTasks(user.id, {
      day_of_week: 1,
      effective_from_date: monday,
      tasks: [
        {
          temp_id: "s1",
          title: "จัดยาเช้า",
          description: "บันทึกส่วนตัว: ความดันเมื่อวาน 145/90",
          scheduled_time: "08:30",
          duration_minutes: 15,
          priority: "medical_critical",
          is_fixed_time: true,
          is_medically_prescribed: true,
          depends_on_temp_id: null,
          rationale: "ยาเช้า",
        },
      ],
    });

    // Share WITHOUT private notes
    const linkNoNotes = await store.createShareLink(user.id, {
      scope: "day",
      target_date: monday,
      include_private_notes: false,
      expires_in_days: 7,
    });
    expect(linkNoNotes.token.length).toBeGreaterThanOrEqual(32);

    const publicPayload = await store.getPublicSharedSchedule(linkNoNotes.token);
    expect(publicPayload.days).toHaveLength(1);
    expect(publicPayload.days[0].tasks[0].title).toBe("จัดยาเช้า");
    expect(publicPayload.days[0].tasks[0].notes).toBeUndefined();

    // Share WITH private notes opted in
    const linkWithNotes = await store.createShareLink(user.id, {
      scope: "week",
      target_date: monday,
      include_private_notes: true,
      expires_in_days: 1,
    });
    const publicWeek = await store.getPublicSharedSchedule(linkWithNotes.token);
    expect(publicWeek.days).toHaveLength(7);
    expect(publicWeek.days[0].tasks[0].notes).toContain("ความดันเมื่อวาน");

    // Expired link -> 410 GoneError
    const futureDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await expect(
      store.getPublicSharedSchedule(linkWithNotes.token, futureDate)
    ).rejects.toThrow(GoneError);

    // Revoked link -> 410 GoneError
    await store.revokeShareLink(user.id, linkNoNotes.id);
    await expect(
      store.getPublicSharedSchedule(linkNoNotes.token)
    ).rejects.toThrow(GoneError);

    // Unknown token -> 404 NotFoundError
    await expect(
      store.getPublicSharedSchedule("nonexistent-token-1234567890123456")
    ).rejects.toThrow(NotFoundError);
  });

  // =========================================================================
  // 9. Daily Summary Exact Verified Metrics & Empathetic Tones + Rest Suggestions
  // =========================================================================
  it("computes exact daily metrics, empathetic summaries, optional rest suggestions with safety notes, and records privacy deletion requests", async () => {
    const { user } = await store.registerUser({
      email: "summary@example.com",
      password: "password123",
      full_name: "คุณวรรณา",
    });

    const monday = "2026-11-23";
    const { occurrences } = await store.approveScheduleTasks(user.id, {
      day_of_week: 1,
      effective_from_date: monday,
      tasks: [
        {
          temp_id: "r1",
          title: "อาหารเช้า",
          description: "",
          scheduled_time: "08:00",
          duration_minutes: 30,
          priority: "high",
          is_fixed_time: true,
          is_medically_prescribed: false,
          depends_on_temp_id: null,
          rationale: "เช้า",
        },
        {
          temp_id: "r2",
          title: "อาหารกลางวัน",
          description: "",
          scheduled_time: "12:00",
          duration_minutes: 40,
          priority: "high",
          is_fixed_time: true,
          is_medically_prescribed: false,
          depends_on_temp_id: null,
          rationale: "กลางวัน",
        },
        {
          temp_id: "r3",
          title: "เช็ดตัวตอนเย็น",
          description: "",
          scheduled_time: "17:00",
          duration_minutes: 30,
          priority: "medium",
          is_fixed_time: false,
          is_medically_prescribed: false,
          depends_on_temp_id: null,
          rationale: "เย็น",
        },
      ],
    });

    // Complete 1 task on-time, 0 delayed, 2 incomplete -> incomplete_support
    await store.uploadCompletionEvidence(user.id, occurrences[0].id, {
      fileName: "1.jpg",
      mimeType: "image/jpeg",
      bytes: SAMPLE_JPEG_BYTES,
    });
    await store.confirmOccurrenceCompletion(
      user.id,
      occurrences[0].id,
      new Date("2026-11-23T08:05:00+07:00")
    );

    const dayData1 = await store.getOccurrencesForDate(user.id, monday);
    const metrics1 = computeDailyMetrics(monday, dayData1.occurrences);
    expect(metrics1).toEqual({
      date: monday,
      total_tasks: 3,
      completed_tasks: 1,
      incomplete_tasks: 2,
      on_time_completions: 1,
      delayed_completions: 0,
      progress_percent: 33,
    });

    const { summaryInput: sumIncomplete } = await buildDailySummary({
      date: monday,
      metrics: metrics1,
      isRestDay: false,
      caregiverName: "คุณวรรณา",
      careRecipientName: "คุณแม่",
      forceFallback: true,
    });
    expect(sumIncomplete.tone_category).toBe("incomplete_support");
    expect(sumIncomplete.encouraging_message).toContain("ครอบครัว");

    // Complete remaining 2 tasks with 1 delayed (> 15 min after 12:00) -> delayed_empathy
    await store.uploadCompletionEvidence(user.id, occurrences[1].id, {
      fileName: "2.jpg",
      mimeType: "image/jpeg",
      bytes: SAMPLE_JPEG_BYTES,
    });
    await store.confirmOccurrenceCompletion(
      user.id,
      occurrences[1].id,
      new Date("2026-11-23T12:35:00+07:00") // +35 min -> delayed!
    );

    await store.uploadCompletionEvidence(user.id, occurrences[2].id, {
      fileName: "3.jpg",
      mimeType: "image/jpeg",
      bytes: SAMPLE_JPEG_BYTES,
    });
    await store.confirmOccurrenceCompletion(
      user.id,
      occurrences[2].id,
      new Date("2026-11-23T17:05:00+07:00") // on-time
    );

    const dayData2 = await store.getOccurrencesForDate(user.id, monday);
    const metrics2 = computeDailyMetrics(monday, dayData2.occurrences);
    expect(metrics2).toEqual({
      date: monday,
      total_tasks: 3,
      completed_tasks: 3,
      incomplete_tasks: 0,
      on_time_completions: 2,
      delayed_completions: 1,
      progress_percent: 100,
    });

    const { summaryInput: sumDelayed } = await buildDailySummary({
      date: monday,
      metrics: metrics2,
      isRestDay: false,
      caregiverName: "คุณวรรณา",
      careRecipientName: "คุณแม่",
      forceFallback: true,
    });
    expect(sumDelayed.tone_category).toBe("delayed_empathy");

    // On-time praise check
    const { summaryInput: sumOnTime } = await buildDailySummary({
      date: monday,
      metrics: { ...metrics2, on_time_completions: 3, delayed_completions: 0 },
      isRestDay: false,
      caregiverName: "คุณวรรณา",
      careRecipientName: "คุณแม่",
      forceFallback: true,
    });
    expect(sumOnTime.tone_category).toBe("on_time_praise");

    // Rest suggestions: gaps between 08:30-12:00 and 12:40-17:00!
    const settings = await store.getSettings(user.id);
    const { suggestions: draftRest } = await buildRestSuggestions({
      date: monday,
      occurrences: dayData2.occurrences,
      careRecipient: settings.care_recipient,
      forceFallback: true,
    });
    expect(draftRest.length).toBeGreaterThanOrEqual(2);
    for (const s of draftRest) {
      expect(s.supervision_safety_note).toContain("ตามลำพัง");
    }

    const savedRest = await store.replaceRestSuggestions(
      user.id,
      monday,
      draftRest
    );
    const dismissed = await store.updateRestSuggestionStatus(
      user.id,
      savedRest[0].id,
      "dismissed"
    );
    expect(dismissed.status).toBe("dismissed");

    // Dismissing a rest suggestion NEVER changes completion score
    const afterRestMetrics = (await store.getDailySummary(user.id, monday))
      .metrics;
    expect(afterRestMetrics.progress_percent).toBe(100);

    // Privacy deletion request records cleanly without deleting completed task evidence
    const privacyRes = await store.createPrivacyDeletionRequest(
      user.id,
      "ขอใช้สิทธิ์ PDPA"
    );
    expect(privacyRes.status).toBe("recorded");
    const historyCheck = await store.getHistory(user.id);
    expect(historyCheck.completed_occurrences).toHaveLength(3);
  });
});
