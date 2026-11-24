"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/care/SessionContext";
import { disablePushNotifications, pushApi } from "@/lib/push/client";

export function PushNotificationControl() {
  const { session } = useSession();
  const [busy, setBusy] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => {
    let active = true;
    setEnabled(false); setMessage("");
    if (session?.mode !== "supabase" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistration("/").then(r => r?.pushManager.getSubscription()).then(s => { if (active) setEnabled(Boolean(s)); }).catch(() => {});
    return () => { active = false; };
  }, [session?.mode, session?.user?.id]);
  async function toggle() {
    setBusy(true); setMessage("");
    try {
      if (enabled) { await disablePushNotifications(); setEnabled(false); setMessage("ปิดแจ้งเตือนบนอุปกรณ์นี้แล้ว"); return; }
      if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("อุปกรณ์นี้ไม่รองรับ Push กรุณาใช้เบราว์เซอร์ที่รองรับผ่าน HTTPS (บน iPhone ให้เพิ่มเว็บที่หน้าจอโฮม)");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("ยังไม่ได้อนุญาตการแจ้งเตือน กรุณาตรวจสอบการตั้งค่าเว็บไซต์ของเบราว์เซอร์");
      const config = await pushApi("/api/push/config");
      if (!config.configured) throw new Error(config.reason || "ยังไม่ได้ตั้งค่า Push ฝั่งเซิร์ฟเวอร์");
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const raw = atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(config.publicKey.length / 4) * 4, "="));
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(raw, c => c.charCodeAt(0)) });
      await pushApi("/api/push/subscriptions", "POST", { subscription: subscription.toJSON() });
      setEnabled(true); setMessage("เปิด Push บนอุปกรณ์นี้แล้ว · การส่งต้องมี worker ทำงานบนเซิร์ฟเวอร์");
    } catch (e) { setMessage(e instanceof Error ? e.message : "เปิดแจ้งเตือนไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2"><p className="text-sm text-[#66736B]">แจ้งเตือนกิจกรรมปฏิทินแม้ปิดแท็บ เมื่ออุปกรณ์รองรับและมีบริการส่งทำงาน</p><Button variant="outline" size="sm" loading={busy} disabled={session?.mode !== "supabase"} onClick={() => void toggle()}>{enabled ? "ปิด Push บนอุปกรณ์นี้" : "เปิด Push บนอุปกรณ์นี้"}</Button><p className="text-xs text-[#66736B]" role="status">{session?.mode === "demo" ? "โหมดสาธิตไม่ลงทะเบียนอุปกรณ์หรือส่ง Push จริง" : message}</p></div>;
}
