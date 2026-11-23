import type { NotificationDeliveryLog } from "@/types/careplan";
import type { CarePlanStore } from "@/lib/store/types";
import { getThaiTodayDate, isWithinQuietHours } from "@/lib/timezone";

export interface ProcessRemindersOptions {
  now?: Date;
  date?: string;
  channel?: "in_app" | "browser_push" | "cron_queue";
}

export interface ProcessRemindersResult {
  delivered: NotificationDeliveryLog[];
  skipped_reason?: string;
}

export async function processRemindersForUser(
  store: CarePlanStore,
  userId: string,
  options: ProcessRemindersOptions = {}
): Promise<ProcessRemindersResult> {
  const now = options.now ?? new Date();
  const targetDate = options.date ?? getThaiTodayDate(now);
  const channel = options.channel ?? "in_app";

  const { preference } = await store.getReminders(userId);
  if (!preference.reminders_enabled) {
    return {
      delivered: [],
      skipped_reason: "ระบบแจ้งเตือนถูกปิดไว้ในการตั้งค่าของผู้ดูแล",
    };
  }

  const daySchedule = await store.getOccurrencesForDate(userId, targetDate);
  if (daySchedule.is_rest_day) {
    return {
      delivered: [],
      skipped_reason:
        "วันนี้เป็นวันพักผ่อน ระบบจึงงดส่งแจ้งเตือนงานในแอป (ไม่ถือเป็นการงดยาหรือการดูแลทางการแพทย์ที่จำเป็น)",
    };
  }

  const incompleteTasks = daySchedule.occurrences.filter(
    (occ) => occ.status === "incomplete"
  );

  if (
    preference.quiet_hours_enabled &&
    isWithinQuietHours(
      now,
      preference.quiet_hours_start,
      preference.quiet_hours_end
    )
  ) {
    const dueMedicalCount = incompleteTasks.filter(
      (occ) =>
        (occ.is_medically_prescribed || occ.priority === "medical_critical") &&
        Date.parse(occ.scheduled_at) <= now.getTime()
    ).length;

    const medicalNote =
      dueMedicalCount > 0
        ? ` (หมายเหตุ: มีงานทางการแพทย์ค้างอยู่ ${dueMedicalCount} รายการ กรุณาตรวจสอบตามคำสั่งแพทย์)`
        : "";

    return {
      delivered: [],
      skipped_reason: `อยู่ในช่วงเวลางดรบกวน (${preference.quiet_hours_start}–${preference.quiet_hours_end} น.)${medicalNote}`,
    };
  }

  const intervalMinutes = Math.max(5, preference.repeat_interval_minutes || 15);
  const delivered: NotificationDeliveryLog[] = [];

  for (const occ of incompleteTasks) {
    const scheduledMs = Date.parse(occ.scheduled_at);
    if (Number.isNaN(scheduledMs) || now.getTime() < scheduledMs) {
      continue;
    }

    const medicalNotice = occ.is_medically_prescribed
      ? " (งานตามเวลาที่แพทย์กำหนด กรุณาปฏิบัติตามคำสั่งแพทย์และไม่เลื่อนเวลาเอง)"
      : "";

    // 1. Start-time reminder (deduplicated per occurrence)
    const startNotif = await store.createNotificationIfAbsent(userId, {
      occurrence_id: occ.id,
      notification_type: "start_reminder",
      dedup_key: `start:${occ.id}`,
      title: `ถึงเวลา: ${occ.title}`,
      body: `กำหนดเวลา ${occ.scheduled_time} น. (${occ.duration_minutes} นาที)${medicalNotice}`,
      channel,
    });
    if (startNotif) {
      delivered.push(startNotif);
    }

    // 2. Repeat reminder every `repeat_interval_minutes` while still incomplete
    const elapsedMinutes = Math.floor((now.getTime() - scheduledMs) / 60_000);
    if (elapsedMinutes >= intervalMinutes) {
      const slotIndex = Math.floor(elapsedMinutes / intervalMinutes);
      const repeatNotif = await store.createNotificationIfAbsent(userId, {
        occurrence_id: occ.id,
        notification_type: "repeat_reminder",
        dedup_key: `repeat:${occ.id}:${slotIndex}`,
        title: `เตือนซ้ำ (${elapsedMinutes} นาที): ${occ.title}`,
        body: `รายการ "${occ.title}" เวลา ${occ.scheduled_time} น. ยังไม่ได้ยืนยันเสร็จสิ้น (แนบรูปหลักฐานแล้วกดยืนยันเพื่อหยุดการเตือน)${medicalNotice}`,
        channel,
      });
      if (repeatNotif) {
        delivered.push(repeatNotif);
      }
    }
  }

  return { delivered };
}
