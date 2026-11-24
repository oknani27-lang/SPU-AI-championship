import { randomUUID } from "node:crypto";
import { sendNotification as webPushSend } from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEventRecord, ReminderPreference } from "@/types/careplan";
import { expandCalendarEventsForRange } from "@/lib/calendar-events";
import { addDays, buildThaiDateTimeIso, getThaiTodayDate, isWithinQuietHours } from "@/lib/timezone";
import { pushAdmin, pushConfig, validPushEndpoint } from "@/lib/push/server";

interface Subscription { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }
interface WorkerOptions { db?: SupabaseClient; now?: Date; send?: typeof webPushSend }
async function rows<T>(db: SupabaseClient, table: string): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from(table).select("*").order("id").range(offset, offset + 499);
    if (error) throw new Error(`Unable to read ${table}`);
    result.push(...(data || []) as T[]); if (!data || data.length < 500) return result;
  }
}
export async function runPushWorker({ db: providedDb, now = new Date(), send = webPushSend }: WorkerOptions = {}) {
  if (process.env.CAREPLAN_DEMO_MODE === "true") return { sent: 0, failed: 0 };
  if (!pushConfig().configured) throw new Error("Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT");
  const db = providedDb || pushAdmin();
  const subscriptions = await rows<Subscription>(db, "careplan_push_subscriptions");
  const result = { sent: 0, failed: 0 };
  if (!subscriptions.length) return result;
  const [events, preferences] = await Promise.all([rows<CalendarEventRecord>(db, "careplan_calendar_events"), rows<ReminderPreference>(db, "careplan_reminder_preferences")]);
  const today = getThaiTodayDate(now);
  for (const subscription of subscriptions) {
    if (!validPushEndpoint(subscription.endpoint)) continue;
    const preference = preferences.find(p => p.user_id === subscription.user_id);
    if (!preference?.reminders_enabled || (preference.quiet_hours_enabled && isWithinQuietHours(now, preference.quiet_hours_start, preference.quiet_hours_end))) continue;
    const occurrences = expandCalendarEventsForRange(events.filter(e => e.user_id === subscription.user_id), addDays(today, -1), addDays(today, 8));
    for (const occurrence of occurrences) {
      if (occurrence.reminder_minutes === null) continue;
      const start = Date.parse(buildThaiDateTimeIso(occurrence.occurrence_date, occurrence.is_all_day ? "00:00" : occurrence.start_time));
      for (const minutes of Array.from(new Set([0, occurrence.reminder_minutes]))) {
        const due = start - minutes * 60000;
        if (due > now.getTime() || due <= now.getTime() - 10 * 60000) continue;
        const lease = randomUUID();
        const { data, error } = await db.rpc("careplan_claim_push", { p_subscription_id: subscription.id, p_event_id: occurrence.event_id, p_occurrence_date: occurrence.occurrence_date, p_kind: String(minutes), p_due_at: new Date(due).toISOString(), p_lease_token: lease });
        if (error) throw new Error("Unable to claim calendar push");
        if (!data?.length) continue;
        const id = data[0].id;
        try {
          await send({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: "CarePlan · " + occurrence.title, body: minutes ? `กิจกรรมจะเริ่มใน ${minutes} นาที` : "ถึงเวลากิจกรรมแล้ว", tag: `${occurrence.occurrence_key}:${minutes}`, eventId: occurrence.event_id, date: occurrence.occurrence_date }), { vapidDetails: { publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY!, subject: process.env.VAPID_SUBJECT! }, TTL: 300, urgency: "high", timeout: 10000 });
          const saved = await db.from("careplan_push_deliveries").update({ status: "sent", sent_at: now.toISOString() }).eq("id", id).eq("lease_token", lease);
          if (saved.error) throw new Error("Unable to record push delivery");
          result.sent++;
        } catch (e) {
          result.failed++;
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await db.from("careplan_push_subscriptions").delete().eq("id", subscription.id);
          else await db.from("careplan_push_deliveries").update({ status: status && [400, 401, 403].includes(status) ? "failed" : "pending", next_attempt_at: new Date(now.getTime() + 60000).toISOString() }).eq("id", id).eq("lease_token", lease);
        }
      }
    }
  }
  return result;
}
