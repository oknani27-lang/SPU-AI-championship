import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  ALL_DAYS,
  THAI_DAY_NAMES,
  type CompletionEvidence,
  type DayOfWeek,
  type DailySummaryRecord,
  type TaskHistoryEntry,
  type TaskPriority,
  type TaskStatus,
} from "@/types/careplan";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const THAI_MONTHS_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
] as const;

export const THAI_MONTHS_FULL = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

/**
 * Returns today's date string "YYYY-MM-DD" in Thailand timezone (Asia/Bangkok).
 */
export function getBangkokToday(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

/**
 * Returns current time "HH:mm" in Thailand timezone (Asia/Bangkok).
 */
export function getBangkokNowTime(): string {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(new Date());
}

/**
 * Builds an ISO-8601 string representing YYYY-MM-DD and HH:mm in Asia/Bangkok (+07:00).
 */
export function buildBangkokIso(dateStr: string, timeHHmm: string): string {
  const normalizedTime = timeHHmm.length === 5 ? `${timeHHmm}:00` : timeHHmm;
  return `${dateStr}T${normalizedTime}+07:00`;
}

/**
 * Parses a "YYYY-MM-DD" date into a UTC-noon Date so local TZ never shifts the calendar day.
 */
export function parseIsoDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1, 12, 0, 0));
}

export function formatIsoDateUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr: string, days: number): string {
  const dt = parseIsoDate(dateStr);
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatIsoDateUtc(dt);
}

/**
 * Returns DayOfWeek (1 = Monday ... 7 = Sunday) for a "YYYY-MM-DD" string.
 */
export function getDayOfWeek(dateStr: string): DayOfWeek {
  const dt = parseIsoDate(dateStr);
  const jsDay = dt.getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  return (jsDay === 0 ? 7 : jsDay) as DayOfWeek;
}

/**
 * Returns Monday "YYYY-MM-DD" of the ISO week containing dateStr.
 */
export function getWeekMonday(dateStr: string): string {
  const dow = getDayOfWeek(dateStr);
  return addDays(dateStr, -(dow - 1));
}

export interface WeekDayInfo {
  date: string;
  dayOfWeek: DayOfWeek;
  dayNumber: number;
  shortThai: string;
  fullThai: string;
}

export function getWeekDates(mondayStr: string): WeekDayInfo[] {
  return ALL_DAYS.map((dow, idx) => {
    const date = addDays(mondayStr, idx);
    const dayNumber = Number(date.split("-")[2]);
    return {
      date,
      dayOfWeek: dow,
      dayNumber,
      shortThai: THAI_DAY_NAMES[dow].short,
      fullThai: THAI_DAY_NAMES[dow].full,
    };
  });
}

/**
 * Formats "YYYY-MM-DD" to readable Thai Buddhist Era date, e.g. "วันจันทร์ที่ 23 พ.ย. 2569".
 */
export function formatThaiDate(
  dateStr: string,
  options?: { includeWeekday?: boolean; fullMonth?: boolean }
): string {
  const includeWeekday = options?.includeWeekday ?? true;
  const fullMonth = options?.fullMonth ?? false;
  const dt = parseIsoDate(dateStr);
  const day = dt.getUTCDate();
  const monthIdx = dt.getUTCMonth();
  const beYear = dt.getUTCFullYear() + 543;
  const monthLabel = fullMonth
    ? THAI_MONTHS_FULL[monthIdx]
    : THAI_MONTHS_SHORT[monthIdx];

  if (!includeWeekday) {
    return `${day} ${monthLabel} ${beYear}`;
  }
  const dow = getDayOfWeek(dateStr);
  return `${THAI_DAY_NAMES[dow].full}ที่ ${day} ${monthLabel} ${beYear}`;
}

/**
 * Formats an ISO timestamp into Bangkok time, e.g. "08:05 น.".
 */
export function formatThaiTime(isoString: string | null | undefined): string {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "-";
  const formatted = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${formatted} น.`;
}

/**
 * Formats an ISO timestamp into Bangkok date + time, e.g. "23 พ.ย. 2569 เวลา 08:05 น.".
 */
export function formatThaiDateTime(isoString: string | null | undefined): string {
  if (!isoString) return "-";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "-";
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return `${formatThaiDate(datePart, { includeWeekday: false })} เวลา ${formatThaiTime(isoString)}`;
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "ไม่ระบุระยะเวลา";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hrs === 0) return `${mins} นาที`;
  if (mins === 0) return `${hrs} ชม.`;
  return `${hrs} ชม. ${mins} นาที`;
}

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; badgeVariant: "neutral" | "sage" | "primary" | "warning" }
> = {
  low: { label: "ทั่วไป", badgeVariant: "neutral" },
  medium: { label: "ปานกลาง", badgeVariant: "sage" },
  high: { label: "สำคัญ", badgeVariant: "primary" },
  medical_critical: { label: "สำคัญทางการแพทย์", badgeVariant: "warning" },
};

export const STATUS_META: Record<
  TaskStatus,
  { label: string; shortLabel: string }
> = {
  incomplete: { label: "ยังไม่เสร็จ", shortLabel: "รอดำเนินการ" },
  completed: { label: "เสร็จสิ้นและล็อกแล้ว", shortLabel: "เสร็จสิ้น" },
};

export const MOBILITY_LABELS: Record<
  "independent" | "homebound" | "bedbound",
  string
> = {
  independent: "ช่วยเหลือตัวเองได้บางส่วน / เดินได้",
  homebound: "ติดบ้าน (ต้องการผู้ดูแลใกล้ชิด)",
  bedbound: "ติดเตียง (ต้องดูแลและเฝ้าระวังตลอดเวลา)",
};

export const TONE_LABELS: Record<DailySummaryRecord["tone_category"], string> = {
  on_time_praise: "ดูแลได้ตรงเวลา",
  delayed_empathy: "ให้กำลังใจแม้ล่าช้า",
  incomplete_support: "ค่อยๆ ทำต่ออย่างใจเย็น",
  rest_day: "วันพักของตาราง",
};

export const HISTORY_EVENT_LABELS: Record<TaskHistoryEntry["event_type"], string> = {
  occurrence_created: "สร้างรายการดูแลประจำวัน",
  photo_uploaded: "อัปโหลดภาพถ่ายยืนยัน",
  completed_confirmed: "ยืนยันทำเสร็จสิ้นและล็อกบันทึกถาวร",
  reminder_sent: "ส่งการแจ้งเตือนงานดูแล",
  dependent_notified: "แจ้งเตือนงานถัดไปที่ต่อเนื่อง",
  future_template_updated: "อัปเดตเทมเพลตสำหรับสัปดาห์ถัดไป",
};

export function getEvidenceUrl(evidence: CompletionEvidence): string {
  return evidence.preview_url || `/api/evidence/${evidence.id}`;
}

export function createTempId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getNextOccurrenceDateForWeekday(
  dayOfWeek: DayOfWeek,
  fromDate: string = getBangkokToday()
): string {
  const currentDow = getDayOfWeek(fromDate);
  let diff = dayOfWeek - currentDow;
  if (diff <= 0) {
    diff += 7;
  }
  return addDays(fromDate, diff);
}
