import { describe, expect, it, vi, afterEach } from "vitest";
import { assertPushOrigin, validPushEndpoint, validateSubscription } from "@/lib/push/server";
import { runPushWorker } from "@/lib/push/worker";
import type { SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import vm from "node:vm";

afterEach(() => vi.unstubAllEnvs());
describe("calendar Web Push", () => {
  it("rejects SSRF endpoints, ports, credentials and malformed encryption keys", () => {
    for (const endpoint of ["https://127.0.0.1/a", "http://fcm.googleapis.com/a", "https://fcm.googleapis.com.evil.test/a", "https://user@fcm.googleapis.com/a", "https://fcm.googleapis.com:444/a"]) expect(validPushEndpoint(endpoint)).toBe(false);
    expect(validPushEndpoint("https://fcm.googleapis.com/send/test")).toBe(true);
    expect(() => validateSubscription({ endpoint: "https://fcm.googleapis.com/send/test", keys: { p256dh: "short", auth: "short" } })).toThrow();
  });
  it("accepts exact encryption key shapes and rejects cross-origin mutations", () => {
    const subscription = { endpoint: "https://fcm.googleapis.com/send/test", keys: { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } };
    expect(validateSubscription(subscription).endpoint).toBe(subscription.endpoint);
    expect(() => assertPushOrigin(new Request("https://app.test/api/push/subscriptions", { headers: { origin: "https://evil.test" } }))).toThrow();
    expect(() => assertPushOrigin(new Request("https://app.test/api/push/subscriptions", { headers: { origin: "https://app.test" } }))).not.toThrow();
  });
  it("sends server-side with no open page, isolates owners and suppresses claimed duplicates", async () => {
    vi.stubEnv("CAREPLAN_DEMO_MODE", "false");
    vi.stubEnv("VAPID_PUBLIC_KEY", "public"); vi.stubEnv("VAPID_PRIVATE_KEY", "private"); vi.stubEnv("VAPID_SUBJECT", "mailto:team@example.test");
    const now = new Date("2026-11-24T03:00:00Z"), send = vi.fn().mockResolvedValue({});
    const claims = new Set<string>(), changes: unknown[] = [];
    const records: Record<string, unknown[]> = {
      careplan_push_subscriptions: [{ id: "sub", user_id: "owner", endpoint: "https://fcm.googleapis.com/send/test", p256dh: "public", auth: "auth" }, { id: "other", user_id: "other", endpoint: "https://fcm.googleapis.com/send/other", p256dh: "public", auth: "auth" }],
      careplan_reminder_preferences: [{ user_id: "owner", reminders_enabled: true, quiet_hours_enabled: false }, { user_id: "other", reminders_enabled: true, quiet_hours_enabled: false }],
      careplan_calendar_events: [{ id: "event", user_id: "owner", title: "Appointment", description: "", start_date: "2026-11-24", end_date: "2026-11-24", start_time: "10:00", end_time: "11:00", is_all_day: false, recurrence: "never", until_date: null, excluded_dates: [], reminder_minutes: 15 }],
    };
    const db = {
      from(table: string) {
        const q = { select: () => q, order: () => q, range: async () => ({ data: records[table] || [], error: null }), update: (data: unknown) => { changes.push(data); return q; }, eq: () => q, then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve), delete: () => q };
        return q;
      },
      rpc: async (_: string, input: Record<string, unknown>) => {
        const key = [input.p_subscription_id, input.p_event_id, input.p_occurrence_date, input.p_kind].join(":");
        if (claims.has(key)) return { data: [], error: null }; claims.add(key); return { data: [{ id: "delivery" }], error: null };
      },
    } as unknown as SupabaseClient;
    expect(await runPushWorker({ db, now, send })).toEqual({ sent: 1, failed: 0 });
    expect(await runPushWorker({ db, now, send })).toEqual({ sent: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0][1]); expect(payload.eventId).toBe("event"); expect(payload.date).toBe("2026-11-24");
    expect(changes).toContainEqual({ status: "sent", sent_at: now.toISOString() });
    send.mockClear(); records.careplan_reminder_preferences[0] = { user_id: "owner", reminders_enabled: false };
    expect(await runPushWorker({ db, now: new Date("2026-11-24T02:45:00Z"), send })).toEqual({ sent: 0, failed: 0 }); expect(send).not.toHaveBeenCalled();
    records.careplan_reminder_preferences[0] = { user_id: "owner", reminders_enabled: true, quiet_hours_enabled: true, quiet_hours_start: "09:00", quiet_hours_end: "11:00" };
    expect(await runPushWorker({ db, now: new Date("2026-11-24T02:45:00Z"), send })).toEqual({ sent: 0, failed: 0 });
    records.careplan_reminder_preferences[0] = { user_id: "owner", reminders_enabled: true, quiet_hours_enabled: false };
    send.mockRejectedValueOnce({ statusCode: 503 });
    expect(await runPushWorker({ db, now: new Date("2026-11-24T02:45:00Z"), send })).toEqual({ sent: 0, failed: 1 });
    expect(changes).toContainEqual({ status: "pending", next_attempt_at: "2026-11-24T02:46:00.000Z" });
  });
  it("never reads live database or sends push in forced Demo mode", async () => {
    vi.stubEnv("CAREPLAN_DEMO_MODE", "true");
    const db = { from: vi.fn(() => { throw new Error("Must not read Live"); }) } as unknown as SupabaseClient;
    const send = vi.fn();
    expect(await runPushWorker({ db, send })).toEqual({ sent: 0, failed: 0 });
    expect(db.from).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it("service worker displays a stable notification and opens the correct occurrence", async () => {
    const listeners: Record<string, (event: unknown) => void> = {}, show = vi.fn().mockResolvedValue(undefined), navigate = vi.fn().mockResolvedValue(undefined), focus = vi.fn().mockResolvedValue(undefined), openWindow = vi.fn();
    const self = { addEventListener: (name: string, handler: (event: unknown) => void) => { listeners[name] = handler; }, location: { origin: "https://app.test" }, registration: { showNotification: show }, clients: { matchAll: async () => [{ url: "https://app.test/calendar", navigate, focus }], openWindow } };
    vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), { self, URL, URLSearchParams });
    let pending = Promise.resolve();
    listeners.push({ data: { json: () => ({ title: "Doctor", eventId: "event-1", date: "2026-11-24", tag: "stable" }) }, waitUntil: (value: Promise<void>) => { pending = value; } });
    await pending;
    expect(show.mock.calls[0][1].tag).toBe("stable");
    listeners.notificationclick({ notification: { data: show.mock.calls[0][1].data, close: vi.fn() }, waitUntil: (value: Promise<void>) => { pending = value; } });
    await pending;
    expect(navigate).toHaveBeenCalledWith("https://app.test/calendar?event=event-1&date=2026-11-24"); expect(focus).toHaveBeenCalledOnce();
    listeners.notificationclick({ notification: { data: { url: "https://evil.test" }, close: vi.fn() }, waitUntil: vi.fn() });
    expect(navigate).toHaveBeenCalledTimes(1); expect(openWindow).not.toHaveBeenCalled();
  });
});
