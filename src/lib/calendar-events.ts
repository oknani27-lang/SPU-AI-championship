import type {
  CalendarEventOccurrence,
  CalendarEventRecord,
  CalendarEventRecurrence,
  CreateCalendarEventInput,
} from "@/types/careplan";
import { ValidationError } from "@/lib/errors";
import { addDays, isValidDateString, isValidHHMM } from "@/lib/timezone";

export const VALID_RECURRENCES = new Set<CalendarEventRecurrence>([
  "never",
  "daily",
  "weekly",
  "monthly",
]);

export interface NormalizedCalendarEventFields {
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  recurrence: CalendarEventRecurrence;
  until_date: string | null;
  reminder_minutes: number | null;
}

export function normalizeCalendarEventInput(
  input: CreateCalendarEventInput
): NormalizedCalendarEventFields {
  const title = (input.title ?? "").trim();
  if (!title) {
    throw new ValidationError("กรุณาระบุชื่อกิจกรรม");
  }
  if (title.length > 200) {
    throw new ValidationError("ชื่อกิจกรรมต้องไม่เกิน 200 ตัวอักษร");
  }

  const description = (input.description ?? "").trim().slice(0, 1000);

  if (!isValidDateString(input.start_date)) {
    throw new ValidationError("รูปแบบวันที่เริ่มต้นไม่ถูกต้อง (YYYY-MM-DD)");
  }
  const endDate = input.end_date ?? input.start_date;
  if (!isValidDateString(endDate)) {
    throw new ValidationError("รูปแบบวันที่สิ้นสุดไม่ถูกต้อง (YYYY-MM-DD)");
  }
  if (endDate < input.start_date) {
    throw new ValidationError("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น");
  }

  const isAllDay = Boolean(input.is_all_day);
  const startTime = isAllDay ? "00:00" : (input.start_time ?? "09:00");
  const endTime = isAllDay ? "23:59" : (input.end_time ?? "10:00");

  if (!isAllDay) {
    if (!isValidHHMM(startTime) || !isValidHHMM(endTime)) {
      throw new ValidationError("รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น HH:mm)");
    }
    if (input.start_date === endDate && endTime < startTime) {
      throw new ValidationError("เวลาสิ้นสุดต้องไม่น้อยกว่าเวลาเริ่มต้น");
    }
  }

  const recurrence: CalendarEventRecurrence = input.recurrence ?? "never";
  if (!VALID_RECURRENCES.has(recurrence)) {
    throw new ValidationError("รูปแบบการทำซ้ำไม่ถูกต้อง");
  }

  let untilDate: string | null = input.until_date ?? null;
  if (untilDate !== null && untilDate !== "") {
    if (!isValidDateString(untilDate)) {
      throw new ValidationError("รูปแบบวันที่สิ้นสุดการทำซ้ำไม่ถูกต้อง");
    }
    if (untilDate < input.start_date) {
      throw new ValidationError("วันที่สิ้นสุดการทำซ้ำต้องไม่น้อยกว่าวันที่เริ่มต้น");
    }
  } else {
    untilDate = null;
  }

  let reminderMinutes: number | null =
    input.reminder_minutes === undefined ? 15 : input.reminder_minutes;
  if (reminderMinutes !== null) {
    const rounded = Math.round(reminderMinutes);
    if (!Number.isFinite(rounded) || rounded < 0 || rounded > 10080) {
      throw new ValidationError("เวลาแจ้งเตือนล่วงหน้าต้องอยู่ระหว่าง 0 ถึง 10,080 นาที");
    }
    reminderMinutes = rounded;
  }

  return {
    title,
    description,
    start_date: input.start_date,
    end_date: endDate,
    start_time: startTime,
    end_time: endTime,
    is_all_day: isAllDay,
    recurrence,
    until_date: untilDate,
    reminder_minutes: reminderMinutes,
  };
}

export function diffCalendarDays(startStr: string, endStr: string): number {
  return diffDays(startStr, endStr);
}

function dateToUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function diffDays(startStr: string, endStr: string): number {
  return Math.round((dateToUtcMs(endStr) - dateToUtcMs(startStr)) / 86_400_000);
}

function daysInMonth(year: number, month1To12: number): number {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

function addMonthsClamped(baseDateStr: string, monthsToAdd: number): string {
  const [y, m, d] = baseDateStr.split("-").map(Number);
  const totalMonths = (m - 1) + monthsToAdd;
  const targetYear = y + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12 + 1;
  const clampedDay = Math.min(d, daysInMonth(targetYear, targetMonth));
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/**
 * Expands recurring and single calendar events into concrete occurrences
 * overlapping [rangeStart, rangeEnd] (inclusive, YYYY-MM-DD in Asia/Bangkok).
 */
export function expandCalendarEventsForRange(
  events: CalendarEventRecord[],
  rangeStart: string,
  rangeEnd: string
): CalendarEventOccurrence[] {
  if (rangeEnd < rangeStart) return [];
  const results: CalendarEventOccurrence[] = [];

  for (const ev of events) {
    const spanDays = Math.max(0, diffDays(ev.start_date, ev.end_date));
    const excluded = new Set(ev.excluded_dates || []);
    const effectiveEnd =
      ev.until_date && ev.until_date < rangeEnd ? ev.until_date : rangeEnd;

    if (ev.start_date > effectiveEnd) continue;

    const pushIfOverlaps = (occStart: string, isRecurringInstance: boolean) => {
      if (excluded.has(occStart)) return;
      if (ev.until_date && occStart > ev.until_date) return;
      const occEnd = spanDays > 0 ? addDays(occStart, spanDays) : occStart;
      if (occEnd < rangeStart || occStart > rangeEnd) return;

      results.push({
        occurrence_key: `${ev.id}:${occStart}`,
        event_id: ev.id,
        occurrence_date: occStart,
        end_date: occEnd,
        title: ev.title,
        description: ev.description,
        start_time: ev.is_all_day ? "00:00" : ev.start_time,
        end_time: ev.is_all_day ? "23:59" : ev.end_time,
        is_all_day: ev.is_all_day,
        recurrence: ev.recurrence,
        reminder_minutes: ev.reminder_minutes,
        is_recurring_instance: isRecurringInstance,
      });
    };

    if (ev.recurrence === "never") {
      pushIfOverlaps(ev.start_date, false);
      continue;
    }

    if (ev.recurrence === "daily") {
      const startOffset = Math.max(0, diffDays(ev.start_date, rangeStart) - spanDays);
      let cursor = addDays(ev.start_date, startOffset);
      let guard = 0;
      while (cursor <= effectiveEnd && guard < 400) {
        pushIfOverlaps(cursor, true);
        cursor = addDays(cursor, 1);
        guard++;
      }
      continue;
    }

    if (ev.recurrence === "weekly") {
      const delta = Math.max(0, diffDays(ev.start_date, rangeStart) - spanDays);
      const startWeeks = Math.floor(delta / 7);
      let cursor = addDays(ev.start_date, startWeeks * 7);
      let guard = 0;
      while (cursor <= effectiveEnd && guard < 120) {
        pushIfOverlaps(cursor, true);
        cursor = addDays(cursor, 7);
        guard++;
      }
      continue;
    }

    if (ev.recurrence === "monthly") {
      const [sy, sm] = ev.start_date.split("-").map(Number);
      const [ry, rm] = rangeStart.split("-").map(Number);
      let monthOffset = Math.max(0, (ry - sy) * 12 + (rm - sm) - 1);
      let guard = 0;
      while (guard < 36) {
        const candidate = addMonthsClamped(ev.start_date, monthOffset);
        if (candidate > effectiveEnd) break;
        pushIfOverlaps(candidate, true);
        monthOffset++;
        guard++;
      }
    }
  }

  return results.sort((a, b) => {
    if (a.occurrence_date !== b.occurrence_date) {
      return a.occurrence_date.localeCompare(b.occurrence_date);
    }
    if (a.is_all_day !== b.is_all_day) return a.is_all_day ? -1 : 1;
    return a.start_time.localeCompare(b.start_time);
  });
}
