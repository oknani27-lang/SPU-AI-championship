import type {
  DailyTaskOccurrence,
  DayOfWeek,
  RecurringTaskTemplate,
  SharedSchedulePayload,
} from "@/types/careplan";
import { THAI_DAY_NAMES } from "@/types/careplan";
import { addDays, hhmmToMinutes, minutesToHhmm } from "@/lib/timezone";

const ICS_BYDAY: Record<DayOfWeek, string> = {
  1: "MO",
  2: "TU",
  3: "WE",
  4: "TH",
  5: "FR",
  6: "SA",
  7: "SU",
};

function escapeIcsText(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string): string {
  // RFC 5545 recommends folding lines longer than 75 octets using CRLF + space
  if (Buffer.byteLength(line, "utf8") <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    const candidate = current + ch;
    const limit = parts.length === 0 ? 75 : 74;
    if (Buffer.byteLength(candidate, "utf8") > limit) {
      parts.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts.join("\r\n ");
}

function formatUtcStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}T` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}Z`
  );
}

function formatLocalDateTime(dateStr: string, hhmm: string): string {
  const cleanDate = dateStr.replace(/-/g, "");
  const [h, m] = hhmm.split(":");
  return `${cleanDate}T${h.padStart(2, "0")}${m.padStart(2, "0")}00`;
}

function computeEndDateAndTime(
  dateStr: string,
  startHhmm: string,
  durationMinutes: number
): { endDate: string; endHhmm: string } {
  const startTotal = hhmmToMinutes(startHhmm);
  const safeDuration = Math.max(5, durationMinutes);
  const endTotal = startTotal + safeDuration;
  if (endTotal >= 24 * 60) {
    const overflowDays = Math.floor(endTotal / (24 * 60));
    const remMinutes = endTotal % (24 * 60);
    return {
      endDate: addDays(dateStr, overflowDays),
      endHhmm: minutesToHhmm(remMinutes),
    };
  }
  return {
    endDate: dateStr,
    endHhmm: minutesToHhmm(endTotal),
  };
}

function buildVTimezoneBangkok(): string[] {
  return [
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Bangkok",
    "X-LIC-LOCATION:Asia/Bangkok",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0700",
    "TZOFFSETTO:+0700",
    "TZNAME:+07",
    "DTSTART:19700101T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

interface IcsEventInput {
  uid: string;
  summary: string;
  description: string;
  date: string; // YYYY-MM-DD (Asia/Bangkok)
  startHhmm: string;
  durationMinutes: number;
  dayOfWeek: DayOfWeek;
  recurringWeekly: boolean;
  isMedicallyPrescribed: boolean;
  reminderMinutesBefore?: number;
}

function buildVEventLines(ev: IcsEventInput, dtStamp: string): string[] {
  const dtStart = formatLocalDateTime(ev.date, ev.startHhmm);
  const { endDate, endHhmm } = computeEndDateAndTime(
    ev.date,
    ev.startHhmm,
    ev.durationMinutes
  );
  const dtEnd = formatLocalDateTime(endDate, endHhmm);
  const titlePrefix = ev.isMedicallyPrescribed ? "[สำคัญทางการแพทย์] " : "";
  const summary = `${titlePrefix}${ev.summary}`;
  const categories = ev.isMedicallyPrescribed
    ? "CarePlan,MedicalCare"
    : "CarePlan,HomeCare";
  const reminderMin = ev.reminderMinutesBefore ?? 15;

  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(ev.uid)}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=Asia/Bangkok:${dtStart}`,
    `DTEND;TZID=Asia/Bangkok:${dtEnd}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(ev.description)}`,
    `CATEGORIES:${categories}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
  ];

  if (ev.recurringWeekly) {
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${ICS_BYDAY[ev.dayOfWeek]}`);
  }

  if (reminderMin > 0) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER:-PT${reminderMin}M`,
      `DESCRIPTION:${escapeIcsText(`ใกล้ถึงเวลา: ${summary}`)}`,
      "END:VALARM"
    );
  }

  lines.push("END:VEVENT");
  return lines;
}

function wrapCalendar(calendarName: string, eventBlocks: string[][]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CarePlan//AI Weekly Care Scheduler//TH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    "X-WR-TIMEZONE:Asia/Bangkok",
    ...buildVTimezoneBangkok(),
  ];

  for (const block of eventBlocks) {
    lines.push(...block);
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export function buildSingleOccurrenceIcs(params: {
  occurrence: DailyTaskOccurrence;
  careRecipientLabel: string;
  includePrivateNotes?: boolean;
  reminderMinutesBefore?: number;
  recurringWeekly?: boolean;
  now?: Date;
}): string {
  const { occurrence, careRecipientLabel } = params;
  const dtStamp = formatUtcStamp(params.now ?? new Date());
  const dayLabel = THAI_DAY_NAMES[occurrence.day_of_week].full;
  const descParts = [
    `ผู้รับการดูแล: ${careRecipientLabel}`,
    `วันประจำสัปดาห์: ${dayLabel}`,
    `ระยะเวลาโดยประมาณ: ${occurrence.duration_minutes} นาที`,
  ];
  if (occurrence.is_medically_prescribed) {
    descParts.push(
      "หมายเหตุความปลอดภัย: งานที่สำคัญทางการแพทย์ กรุณาปฏิบัติตามคำแนะนำแพทย์อย่างเคร่งครัด"
    );
  }
  if (params.includePrivateNotes && occurrence.description.trim()) {
    descParts.push(`รายละเอียด: ${occurrence.description.trim()}`);
  }

  const block = buildVEventLines(
    {
      uid: `careplan-occ-${occurrence.id}@careplan.local`,
      summary: occurrence.title,
      description: descParts.join("\n"),
      date: occurrence.occurrence_date,
      startHhmm: occurrence.scheduled_time,
      durationMinutes: occurrence.duration_minutes,
      dayOfWeek: occurrence.day_of_week,
      recurringWeekly: Boolean(params.recurringWeekly),
      isMedicallyPrescribed: occurrence.is_medically_prescribed,
      reminderMinutesBefore: params.reminderMinutesBefore ?? 15,
    },
    dtStamp
  );

  return wrapCalendar(`CarePlan — ${careRecipientLabel}`, [block]);
}

export function buildSharedScheduleIcs(params: {
  payload: SharedSchedulePayload;
  reminderMinutesBefore?: number;
  now?: Date;
}): string {
  const { payload } = params;
  const dtStamp = formatUtcStamp(params.now ?? new Date());
  const blocks: string[][] = [];

  for (const day of payload.days) {
    if (day.is_rest_day) continue;
    day.tasks.forEach((task, idx) => {
      const descParts = [
        `แผนดูแล: ${payload.schedule_title}`,
        `ผู้รับการดูแล: ${payload.care_recipient_label}`,
        `วันประจำสัปดาห์: ${THAI_DAY_NAMES[day.day_of_week].full}`,
        `ระยะเวลาโดยประมาณ: ${task.duration_minutes} นาที`,
      ];
      if (task.is_medically_prescribed) {
        descParts.push(
          "งานสำคัญทางการแพทย์ — ห้ามยกเลิกโดยไม่ปรึกษาแพทย์"
        );
      }
      if (payload.include_private_notes && task.notes) {
        descParts.push(`หมายเหตุ: ${task.notes}`);
      }

      blocks.push(
        buildVEventLines(
          {
            uid: `careplan-share-${payload.token}-${day.date}-${idx}@careplan.local`,
            summary: task.title,
            description: descParts.join("\n"),
            date: day.date,
            startHhmm: task.scheduled_time,
            durationMinutes: task.duration_minutes,
            dayOfWeek: day.day_of_week,
            recurringWeekly: payload.scope === "week",
            isMedicallyPrescribed: task.is_medically_prescribed,
            reminderMinutesBefore: params.reminderMinutesBefore ?? 15,
          },
          dtStamp
        )
      );
    });
  }

  return wrapCalendar(
    `CarePlan (${payload.scope === "week" ? "รายสัปดาห์" : "รายวัน"}) — ${payload.care_recipient_label}`,
    blocks
  );
}

export function buildWeeklyTemplatesIcs(params: {
  templates: RecurringTaskTemplate[];
  weekDates: Array<{ day_of_week: DayOfWeek; date: string }>;
  restDays: DayOfWeek[];
  careRecipientLabel: string;
  scheduleTitle: string;
  includePrivateNotes?: boolean;
  reminderMinutesBefore?: number;
  now?: Date;
}): string {
  const dtStamp = formatUtcStamp(params.now ?? new Date());
  const restSet = new Set<DayOfWeek>(params.restDays);
  const dateByDay = new Map<DayOfWeek, string>(
    params.weekDates.map((d) => [d.day_of_week, d.date])
  );
  const blocks: string[][] = [];

  for (const tpl of params.templates) {
    if (!tpl.is_active) continue;
    if (restSet.has(tpl.day_of_week)) continue;
    const date = dateByDay.get(tpl.day_of_week);
    if (!date) continue;
    if (tpl.effective_from_date > date) continue;
    if (tpl.effective_until_date && tpl.effective_until_date < date) continue;

    const descParts = [
      `แผนดูแล: ${params.scheduleTitle}`,
      `ผู้รับการดูแล: ${params.careRecipientLabel}`,
      `วนซ้ำทุก${THAI_DAY_NAMES[tpl.day_of_week].full}`,
      `ระยะเวลาโดยประมาณ: ${tpl.duration_minutes} นาที`,
    ];
    if (tpl.is_medically_prescribed) {
      descParts.push(
        "งานสำคัญทางการแพทย์ — โปรดปฏิบัติตามกำหนดเวลาแพทย์อย่างเคร่งครัด"
      );
    }
    if (params.includePrivateNotes && tpl.description.trim()) {
      descParts.push(`รายละเอียด: ${tpl.description.trim()}`);
    }

    blocks.push(
      buildVEventLines(
        {
          uid: `careplan-tpl-${tpl.id}@careplan.local`,
          summary: tpl.title,
          description: descParts.join("\n"),
          date,
          startHhmm: tpl.scheduled_time,
          durationMinutes: tpl.duration_minutes,
          dayOfWeek: tpl.day_of_week,
          recurringWeekly: true,
          isMedicallyPrescribed: tpl.is_medically_prescribed,
          reminderMinutesBefore: params.reminderMinutesBefore ?? 15,
        },
        dtStamp
      )
    );
  }

  return wrapCalendar(`CarePlan — ${params.careRecipientLabel}`, blocks);
}
