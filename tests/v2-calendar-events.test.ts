import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DemoFileStore } from "@/lib/store/demo-store";
import { expandCalendarEventsForRange } from "@/lib/calendar-events";
import { buildDailySummary, buildRestSuggestions, findScheduleGaps } from "@/lib/ai/service";
import { ForbiddenError } from "@/lib/errors";
import type { CalendarEventRecord, DailyTaskOccurrence } from "@/types/careplan";

const tempDirs: string[] = [];

function createTempStore(): { dir: string; store: DemoFileStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "careplan-v2-test-"));
  tempDirs.push(dir);
  return { dir, store: new DemoFileStore(dir) };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("CarePlan V2 — Calendar Events, Recurrence, Demo Seed & AI", () => {
  it("seeds V2 Demo Profile (คุณเมย์ / คุณสมใจ 72) with full 7-day non-clinical schedule & calendar events", async () => {
    const { store } = createTempStore();
    const { user } = await store.ensureDemoUser({ reset: true, seedSampleTasks: true });

    expect(user.full_name).toBe("คุณเมย์");
    expect(user.email).toBe("may.demo@careplan.th");

    const bootstrap = await store.getUserBootstrap(user.id);
    expect(bootstrap).not.toBeNull();
    expect(bootstrap!.care_recipient.display_name).toBe("คุณสมใจ");
    expect(bootstrap!.care_recipient.age_years).toBe(72);
    expect(bootstrap!.weekly_schedule.rest_days).toEqual([7]);

    const schedule = await store.getSchedule(user.id);
    const byDay = new Map<number, number>();
    for (const tpl of schedule.templates) {
      byDay.set(tpl.day_of_week, (byDay.get(tpl.day_of_week) ?? 0) + 1);
    }

    // Mon 5, Tue 3, Wed 2, Thu 2, Fri 2, Sat 2, Sun 0 (Rest Day)
    expect(byDay.get(1)).toBe(5);
    expect(byDay.get(2)).toBe(3);
    expect(byDay.get(3)).toBe(2);
    expect(byDay.get(4)).toBe(2);
    expect(byDay.get(5)).toBe(2);
    expect(byDay.get(6)).toBe(2);
    expect(byDay.get(7)).toBeUndefined();

    // Neutral non-clinical medication label (Phase 12)
    const medTasks = schedule.templates.filter((t) => t.is_medically_prescribed);
    expect(medTasks.length).toBeGreaterThanOrEqual(3);
    for (const m of medTasks) {
      expect(m.title).toBe("ช่วยเตรียมยาตามรายการที่แพทย์กำหนด");
    }

    // Seeded sample calendar events
    const cal = await store.listCalendarEvents(user.id);
    expect(cal.events.length).toBe(2);
  });

  it("expands never/daily/weekly/monthly recurrences accurately including month-end clamping", () => {
    const baseEvent = (overrides: Partial<CalendarEventRecord>): CalendarEventRecord => ({
      id: "ev-1",
      user_id: "u-1",
      title: "ทดสอบ",
      description: "",
      start_date: "2026-01-31",
      end_date: "2026-01-31",
      start_time: "10:00",
      end_time: "11:00",
      is_all_day: false,
      recurrence: "monthly",
      until_date: null,
      excluded_dates: [],
      reminder_minutes: 15,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...overrides,
    });

    // Monthly clamping: Jan 31 -> Feb 28 -> Mar 31
    const monthlyOccs = expandCalendarEventsForRange(
      [baseEvent({ recurrence: "monthly", start_date: "2026-01-31", end_date: "2026-01-31" })],
      "2026-01-01",
      "2026-04-01"
    );
    expect(monthlyOccs.map((o) => o.occurrence_date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);

    // Weekly with excluded_date and until_date
    const weeklyOccs = expandCalendarEventsForRange(
      [
        baseEvent({
          id: "ev-w",
          recurrence: "weekly",
          start_date: "2026-11-02",
          end_date: "2026-11-02",
          excluded_dates: ["2026-11-09"],
          until_date: "2026-11-20",
        }),
      ],
      "2026-11-01",
      "2026-11-30"
    );
    expect(weeklyOccs.map((o) => o.occurrence_date)).toEqual([
      "2026-11-02",
      "2026-11-16",
    ]);
  });

  it("persists Calendar Event CRUD and supports single/future recurring edits and cross-user isolation", async () => {
    const { dir, store } = createTempStore();
    const { user } = await store.ensureDemoUser({ reset: true, seedSampleTasks: false });

    // Create weekly recurring event
    const created = await store.createCalendarEvent(user.id, {
      title: "นัดกายภาพบำบัด",
      description: "คลินิกใกล้บ้าน",
      start_date: "2026-11-02",
      end_date: "2026-11-02",
      start_time: "10:00",
      end_time: "11:00",
      recurrence: "weekly",
      reminder_minutes: 30,
    });

    // Edit single occurrence (2026-11-09) -> moves to 13:00
    const singleEdit = await store.updateCalendarEvent(user.id, created.id, {
      title: "นัดกายภาพบำบัด (เลื่อนเป็นบ่าย)",
      start_time: "13:00",
      end_time: "14:00",
      edit_scope: "single",
      occurrence_date: "2026-11-09",
    });
    expect(singleEdit.event.excluded_dates).toContain("2026-11-09");
    expect(singleEdit.split_event).toBeDefined();
    expect(singleEdit.split_event!.recurrence).toBe("never");
    expect(singleEdit.split_event!.start_date).toBe("2026-11-09");
    expect(singleEdit.split_event!.start_time).toBe("13:00");

    // Edit future occurrences from 2026-11-16
    const futureEdit = await store.updateCalendarEvent(user.id, created.id, {
      title: "นัดกายภาพบำบัด (เวลาใหม่)",
      start_time: "15:00",
      end_time: "16:00",
      edit_scope: "future",
      occurrence_date: "2026-11-16",
    });
    expect(futureEdit.event.until_date).toBe("2026-11-15");
    expect(futureEdit.split_event!.start_date).toBe("2026-11-16");
    expect(futureEdit.split_event!.recurrence).toBe("weekly");

    // Verify persistence across fresh DemoFileStore instance
    const freshStore = new DemoFileStore(dir);
    const listed = await freshStore.listCalendarEvents(user.id, "2026-11-01", "2026-11-30");
    const nov2 = listed.occurrences.find((o) => o.occurrence_date === "2026-11-02");
    const nov9 = listed.occurrences.find((o) => o.occurrence_date === "2026-11-09");
    const nov16 = listed.occurrences.find((o) => o.occurrence_date === "2026-11-16");
    const nov23 = listed.occurrences.find((o) => o.occurrence_date === "2026-11-23");

    expect(nov2?.start_time).toBe("10:00");
    expect(nov9?.start_time).toBe("13:00");
    expect(nov16?.start_time).toBe("15:00");
    expect(nov23?.start_time).toBe("15:00");

    // Cross-user isolation
    const other = await freshStore.registerUser({
      email: "other@careplan.th",
      password: "password123",
      full_name: "ผู้อื่น",
    });
    await expect(
      freshStore.deleteCalendarEvent(other.user.id, created.id)
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Delete single occurrence of future series (2026-11-23)
    await freshStore.deleteCalendarEvent(user.id, futureEdit.split_event!.id, {
      delete_scope: "single",
      occurrence_date: "2026-11-23",
    });
    const afterDelete = await freshStore.listCalendarEvents(
      user.id,
      "2026-11-01",
      "2026-11-30"
    );
    expect(
      afterDelete.occurrences.find((o) => o.occurrence_date === "2026-11-23")
    ).toBeUndefined();
    expect(
      afterDelete.occurrences.find((o) => o.occurrence_date === "2026-11-16")
    ).toBeDefined();
  });

  it("produces V2 empathetic daily summaries and 5-10 / 15-30 / 30-60 min rest suggestions", async () => {
    const goodSummary = await buildDailySummary({
      date: "2026-11-23",
      metrics: {
        date: "2026-11-23",
        total_tasks: 4,
        completed_tasks: 4,
        incomplete_tasks: 0,
        on_time_completions: 4,
        delayed_completions: 0,
        progress_percent: 100,
      },
      isRestDay: false,
      caregiverName: "คุณเมย์",
      careRecipientName: "คุณสมใจ",
      forceFallback: true,
    });
    expect(goodSummary.summaryInput.used_fallback).toBe(true);
    expect(goodSummary.summaryInput.encouraging_message).toContain(
      "วันนี้คุณจัดการงานได้ดีมากเลยนะ เก่งมาก!"
    );

    const delayedSummary = await buildDailySummary({
      date: "2026-11-23",
      metrics: {
        date: "2026-11-23",
        total_tasks: 4,
        completed_tasks: 3,
        incomplete_tasks: 1,
        on_time_completions: 2,
        delayed_completions: 1,
        progress_percent: 75,
      },
      isRestDay: false,
      caregiverName: "คุณเมย์",
      careRecipientName: "คุณสมใจ",
      forceFallback: true,
    });
    expect(delayedSummary.summaryInput.encouraging_message).toContain(
      "วันนี้อาจมีบางอย่างไม่เป็นไปตามแผน"
    );

    // Rest gap tiers: 10 min gap (08:30-08:40), 20 min gap (09:00-09:20), 45 min gap (10:00-10:45)
    const makeOcc = (time: string, dur: number): DailyTaskOccurrence => ({
      id: `occ-${time}`,
      user_id: "u1",
      template_id: "t1",
      weekly_schedule_id: "w1",
      occurrence_date: "2026-11-23",
      day_of_week: 1,
      title: "งานทดสอบ",
      description: "",
      scheduled_time: time,
      scheduled_at: `2026-11-23T${time}:00+07:00`,
      duration_minutes: dur,
      priority: "medium",
      is_fixed_time: false,
      is_medically_prescribed: false,
      status: "incomplete",
      completed_at: null,
      is_delayed: false,
      is_locked: false,
      can_edit_occurrence: false,
      can_edit_future_template: false,
      depends_on_occurrence_ids: [],
      next_dependent_occurrence_ids: [],
      evidence: [],
      created_at: "2026-11-23T00:00:00Z",
      updated_at: "2026-11-23T00:00:00Z",
    });

    const occs = [
      makeOcc("07:00", 90), // ends 08:30 -> 10 min gap before 08:40
      makeOcc("08:40", 20), // ends 09:00 -> 20 min gap before 09:20
      makeOcc("09:20", 40), // ends 10:00 -> 45 min gap before 10:45
      makeOcc("10:45", 60),
    ];

    const gaps = findScheduleGaps(occs);
    expect(gaps.some((g) => g.duration_minutes === 10)).toBe(true);
    expect(gaps.some((g) => g.duration_minutes === 20)).toBe(true);
    expect(gaps.some((g) => g.duration_minutes === 45)).toBe(true);

    const restRes = await buildRestSuggestions({
      date: "2026-11-23",
      occurrences: occs,
      careRecipient: {
        display_name: "คุณสมใจ",
        mobility_level: "homebound",
        requires_supervision: true,
      },
      forceFallback: true,
    });
    expect(restRes.suggestions.some((s) => s.activity_title.includes("5-10 นาที"))).toBe(true);
    expect(restRes.suggestions.some((s) => s.activity_title.includes("15-30 นาที"))).toBe(true);
    expect(restRes.suggestions.some((s) => s.activity_title.includes("30-60 นาที"))).toBe(true);
    for (const s of restRes.suggestions) {
      expect(s.supervision_safety_note.length).toBeGreaterThan(15);
    }
  });
});
