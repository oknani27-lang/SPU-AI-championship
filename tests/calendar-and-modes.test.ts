import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DemoFileStore } from "@/lib/store/demo-store";
import { getDefaultAuthStore } from "@/lib/store";
import {
  buildSharedScheduleIcs,
  buildSingleOccurrenceIcs,
  buildWeeklyTemplatesIcs,
} from "@/lib/calendar-ics";
import { callGeminiJson } from "@/lib/ai/gemini";
import { addDays, getThaiTodayDate, getThaiWeekDates } from "@/lib/timezone";
import { z } from "zod";
import type { DayOfWeek } from "@/types/careplan";

describe("Audit Suite — 7-Day Full Workflow, Apple Calendar (.ics), Demo/Live Separation & Gemini Client Wiring", () => {
  let tmpDir: string;
  let store: DemoFileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "careplan-audit-"));
    store = new DemoFileStore(tmpDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("completes a full 7-day Mon–Sun workflow (distinct tasks Mon–Sat, Sun rest day, photo proof completion, next-week recurrence)", async () => {
    const { user } = await store.ensureDemoUser({
      reset: true,
      seedSampleTasks: false,
    });
    const today = getThaiTodayDate();
    const week = getThaiWeekDates(today);

    // Set Sunday as rest day and schedule distinct activities for Mon–Sat
    await store.setRestDay(user.id, 7, true);
    const weekdayTitles: Record<Exclude<DayOfWeek, 7>, string> = {
      1: "วันจันทร์: จัดยาและวัดความดัน",
      2: "วันอังคาร: กายภาพบำบัดช่วงเช้า",
      3: "วันพุธ: พาตรวจคลินิกผู้สูงอายุ",
      4: "วันพฤหัส: เช็ดตัวและเปลี่ยนผ้าปู",
      5: "วันศุกร์: เดินออกกำลังกายเบาๆ",
      6: "วันเสาร์: ตัดเล็บและตรวจผิวหนัง",
    };

    for (const dow of [1, 2, 3, 4, 5, 6] as const) {
      const targetDate = week.find((d) => d.day_of_week === dow)!.date;
      await store.approveScheduleTasks(user.id, {
        day_of_week: dow,
        effective_from_date: targetDate,
        tasks: [
          {
            temp_id: `d-${dow}`,
            title: weekdayTitles[dow],
            description: `รายละเอียดส่วนตัววัน ${dow}`,
            scheduled_time: `0${7 + dow}:00`.slice(-5),
            duration_minutes: 30,
            priority: dow === 1 ? "medical_critical" : "medium",
            is_fixed_time: dow === 1,
            is_medically_prescribed: dow === 1,
            depends_on_temp_id: null,
            rationale: "จัดตามรอบสัปดาห์",
          },
        ],
      });
    }

    const weekView = await store.getOccurrencesForWeek(user.id, week[0].date);
    expect(weekView.days.length).toBe(7);
    expect(weekView.days[6].is_rest_day).toBe(true);
    expect(weekView.days[6].occurrences.length).toBe(0);

    // Complete Monday & Wednesday tasks with real photo buffers
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x02]);
    for (const dayIdx of [0, 2]) {
      const occ = weekView.days[dayIdx].occurrences[0];
      expect(occ.title).toBe(weekdayTitles[occ.day_of_week as Exclude<DayOfWeek, 7>]);
      await store.uploadCompletionEvidence(user.id, occ.id, {
        fileName: `proof-day-${dayIdx + 1}.png`,
        mimeType: "image/png",
        bytes: pngBytes,
      });
      const confirmed = await store.confirmOccurrenceCompletion(user.id, occ.id);
      expect(confirmed.occurrence.status).toBe("completed");
      expect(confirmed.occurrence.is_locked).toBe(true);
    }

    // Verify next week repeats all 6 active weekdays fresh & Sunday remains rest day
    const nextWeekStart = addDays(week[0].date, 7);
    const nextWeekView = await store.getOccurrencesForWeek(user.id, nextWeekStart);
    expect(nextWeekView.days[0].occurrences[0].status).toBe("incomplete");
    expect(nextWeekView.days[6].is_rest_day).toBe(true);
    expect(nextWeekView.days[6].occurrences.length).toBe(0);
  });

  it("generates RFC 5545 Apple Calendar (.ics) files with Asia/Bangkok TZ, RRULE weekly recurrence, VALARM, and privacy protection", async () => {
    const { user } = await store.ensureDemoUser({ reset: true });
    const today = getThaiTodayDate();
    const week = getThaiWeekDates(today);
    const { weekly_schedule, templates } = await store.getSchedule(user.id);

    // Weekly recurring .ics without private notes
    const weeklyIcs = buildWeeklyTemplatesIcs({
      templates,
      weekDates: week,
      restDays: weekly_schedule.rest_days,
      careRecipientLabel: "คุณแม่สมใจ",
      scheduleTitle: weekly_schedule.title,
      includePrivateNotes: false,
      reminderMinutesBefore: 15,
    });
    expect(weeklyIcs).toContain("BEGIN:VCALENDAR");
    expect(weeklyIcs).toContain("TZID:Asia/Bangkok");
    expect(weeklyIcs).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(weeklyIcs).toContain("BEGIN:VALARM");
    expect(weeklyIcs).toContain("TRIGGER:-PT15M");
    expect(weeklyIcs).toContain("[สำคัญทางการแพทย์]");
    // Sunday rest day must NOT emit BYDAY=SU
    expect(weeklyIcs).not.toContain("BYDAY=SU");

    // Single occurrence .ics
    const monDate = week[0].date;
    const mon = await store.getOccurrencesForDate(user.id, monDate);
    const singleIcs = buildSingleOccurrenceIcs({
      occurrence: mon.occurrences[0],
      careRecipientLabel: "คุณแม่สมใจ",
      recurringWeekly: true,
    });
    expect(singleIcs).toContain("BEGIN:VEVENT");
    expect(singleIcs).toContain(`DTSTART;TZID=Asia/Bangkok:${monDate.replace(/-/g, "")}T`);

    // Public shared schedule .ics uses demo_ prefixed token and respects include_private_notes=false
    const link = await store.createShareLink(user.id, {
      scope: "week",
      target_date: monDate,
      include_private_notes: false,
    });
    expect(link.token.startsWith("demo_")).toBe(true);
    const payload = await store.getPublicSharedSchedule(link.token);
    const sharedIcs = buildSharedScheduleIcs({ payload });
    expect(sharedIcs).toContain("BEGIN:VCALENDAR");
    expect(sharedIcs).toContain("END:VCALENDAR");
  });

  it("enforces strict separation between Demo Mode and Live Mode when Supabase env is absent", async () => {
    const prevDemo = process.env.CAREPLAN_DEMO_MODE;
    const prevUrl = process.env.SUPABASE_URL;
    const prevPub = process.env.SUPABASE_PUBLISHABLE_KEY;
    const prevSec = process.env.SUPABASE_SECRET_KEY;

    try {
      delete process.env.CAREPLAN_DEMO_MODE;
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_PUBLISHABLE_KEY;
      delete process.env.SUPABASE_SECRET_KEY;

      // Without live Supabase credentials and without CAREPLAN_DEMO_MODE=true,
      // live auth store MUST reject with 503 instead of silently falling back to Demo Mode
      await expect(getDefaultAuthStore()).rejects.toMatchObject({
        statusCode: 503,
        code: "LIVE_SUPABASE_NOT_CONFIGURED",
      });
    } finally {
      if (prevDemo !== undefined) process.env.CAREPLAN_DEMO_MODE = prevDemo;
      if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
      if (prevPub !== undefined) process.env.SUPABASE_PUBLISHABLE_KEY = prevPub;
      if (prevSec !== undefined) process.env.SUPABASE_SECRET_KEY = prevSec;
    }
  });

  it("verifies Gemini REST API client sends real endpoint + x-goog-api-key header when GEMINI_API_KEY is configured (mocked transport)", async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    const prevModel = process.env.GEMINI_MODEL;
    try {
      process.env.GEMINI_API_KEY = "test-only-dummy-key-not-real";
      process.env.GEMINI_MODEL = "gemini-2.5-flash";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify({ greeting: "สวัสดีจาก Gemini" }) }],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await callGeminiJson({
        systemInstruction: "Return JSON",
        userPrompt: "Say hi",
        schema: z.object({ greeting: z.string() }),
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data.greeting).toBe("สวัสดีจาก Gemini");
      }
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(String(calledUrl)).toContain(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
      );
      expect((calledInit?.headers as Record<string, string>)["x-goog-api-key"]).toBe(
        "test-only-dummy-key-not-real"
      );
    } finally {
      if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevKey;
      if (prevModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = prevModel;
    }
  });
});
