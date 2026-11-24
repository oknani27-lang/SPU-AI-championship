import { createClient } from "@supabase/supabase-js";
import { AppError, ForbiddenError, ValidationError } from "@/lib/errors";
import { getServerEnv } from "@/lib/env";

export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const configured = Boolean(publicKey && process.env.VAPID_PRIVATE_KEY?.trim() && process.env.VAPID_SUBJECT?.trim());
  return { configured, publicKey: configured ? publicKey : null };
}
export function pushAdmin() {
  const env = getServerEnv();
  if (!env.supabaseUrl || !env.supabaseSecretKey) throw new AppError("ยังไม่ได้ตั้งค่า Supabase สำหรับ Push", 503, "PUSH_UNAVAILABLE");
  return createClient(env.supabaseUrl, env.supabaseSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function assertPushOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ForbiddenError("ไม่อนุญาตคำขอจากเว็บไซต์อื่น");
}
export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value), h = url.hostname;
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash && (h === "fcm.googleapis.com" || h === "updates.push.services.mozilla.com" || h.endsWith(".push.services.mozilla.com") || h === "web.push.apple.com" || h.endsWith(".notify.windows.com"));
  } catch { return false; }
}
export function validateSubscription(value: unknown) {
  const s = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const key = (v: unknown, size: number): v is string => typeof v === "string" && /^[A-Za-z0-9_-]+={0,2}$/.test(v) && Buffer.from(v, "base64url").length === size;
  if (!s || !validPushEndpoint(s.endpoint) || !key(s.keys?.p256dh, 65) || Buffer.from(s.keys.p256dh, "base64url")[0] !== 4 || !key(s.keys?.auth, 16)) throw new ValidationError("ข้อมูลอุปกรณ์แจ้งเตือนไม่ถูกต้อง");
  return { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth };
}
