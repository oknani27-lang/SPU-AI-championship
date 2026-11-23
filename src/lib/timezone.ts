import type { DayOfWeek } from "@/types/careplan";

export const THAI_TIMEZONE = "Asia/Bangkok";
export const THAI_UTC_OFFSET = "+07:00";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Returns today's date in Thailand timezone (Asia/Bangkok) as "YYYY-MM-DD".
 */
export function getThaiTodayDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: THAI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/**
 * Formats a Date into "HH:mm" in Thailand timezone (Asia/Bangkok).
 */
export function formatThaiTime(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: THAI_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  // Guard against rare "24" hour formatting in some ICU locales
  const normalizedHour = hour === "24" ? "00" : hour;
  return `${normalizedHour}:${minute}`;
}

/**
 * Returns DayOfWeek (1=Monday .. 7=Sunday) for a "YYYY-MM-DD" date in Asia/Bangkok.
 */
export function getThaiDayOfWeek(dateStr: string): DayOfWeek {
  const match = DATE_RE.exec(dateStr);
  if (!match) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Use UTC noon so calendar day never shifts across DST or timezone boundaries
  const utcDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const jsDay = utcDate.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  return (jsDay === 0 ? 7 : jsDay) as DayOfWeek;
}

/**
 * Adds a signed integer number of calendar days to "YYYY-MM-DD".
 */
export function addDays(dateStr: string, days: number): string {
  const match = DATE_RE.exec(dateStr);
  if (!match) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  const y = utcDate.getUTCFullYear();
  const m = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Given any anchorDate ("YYYY-MM-DD"), returns the full Monday..Sunday week
 * containing that date.
 */
export function getThaiWeekDates(
  anchorDate: string
): Array<{ day_of_week: DayOfWeek; date: string }> {
  const anchorDow = getThaiDayOfWeek(anchorDate); // 1..7
  const mondayDate = addDays(anchorDate, -(anchorDow - 1));
  const result: Array<{ day_of_week: DayOfWeek; date: string }> = [];
  for (let i = 0; i < 7; i++) {
    result.push({
      day_of_week: (i + 1) as DayOfWeek,
      date: addDays(mondayDate, i),
    });
  }
  return result;
}

/**
 * Builds an explicit Asia/Bangkok ISO-8601 datetime string ("YYYY-MM-DDTHH:mm:00+07:00").
 */
export function buildThaiDateTimeIso(dateStr: string, hhmm: string): string {
  if (!DATE_RE.test(dateStr)) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  if (!HHMM_RE.test(hhmm)) {
    throw new Error(`Invalid HH:mm string: ${hhmm}`);
  }
  return `${dateStr}T${hhmm}:00${THAI_UTC_OFFSET}`;
}

/**
 * Converts "HH:mm" to minutes since midnight (0..1439).
 */
export function hhmmToMinutes(hhmm: string): number {
  const match = HHMM_RE.exec(hhmm);
  if (!match) {
    throw new Error(`Invalid HH:mm string: ${hhmm}`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Converts minutes since midnight (clamped to 0..1439) to "HH:mm".
 */
export function minutesToHhmm(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Checks whether `now` (evaluated in Asia/Bangkok) falls inside quiet hours.
 * Handles both overnight ranges (e.g., 22:00 -> 06:00) and same-day ranges (e.g., 13:00 -> 15:00).
 */
export function isWithinQuietHours(
  now: Date,
  startHHMM: string,
  endHHMM: string
): boolean {
  const currentMinutes = hhmmToMinutes(formatThaiTime(now));
  const startMinutes = hhmmToMinutes(startHHMM);
  const endMinutes = hhmmToMinutes(endHHMM);

  if (startMinutes === endMinutes) {
    return false;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Overnight quiet hours (e.g. 22:00 to 06:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [, y, m, d] = DATE_RE.exec(value)!;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() + 1 === Number(m) &&
    date.getUTCDate() === Number(d)
  );
}

export function isValidHHMM(value: string): boolean {
  return HHMM_RE.test(value);
}
