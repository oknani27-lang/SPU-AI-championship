"use client";

import * as React from "react";
import {
  Bell,
  Check,
  Copy,
  Link2,
  Save,
  Settings,
  ShieldAlert,
  Trash2,
  User,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useSession } from "@/components/care/SessionContext";
import { PushNotificationControl } from "@/components/care/PushNotificationControl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  getSettings,
  getShareLinks,
  revokeShareLink,
  submitDeletionRequest,
  updateSettings,
} from "@/lib/api-client";
import {
  formatThaiDate,
  formatThaiDateTime,
  MOBILITY_LABELS,
} from "@/lib/utils";
import type { CareRecipientProfile, ShareLinkRecord } from "@/types/careplan";

export default function SettingsPage() {
  return (
    <AppShell>
      <SettingsContent />
    </AppShell>
  );
}

function SettingsContent() {
  const { refreshSession, demoVersion } = useSession();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);

  // Caregiver profile
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [timezone, setTimezone] = React.useState("Asia/Bangkok");

  // Care recipient profile
  const [recipientName, setRecipientName] = React.useState("");
  const [recipientAge, setRecipientAge] = React.useState("");
  const [mobilityLevel, setMobilityLevel] =
    React.useState<CareRecipientProfile["mobility_level"]>("homebound");
  const [requiresSupervision, setRequiresSupervision] = React.useState(true);
  const [careNotes, setCareNotes] = React.useState("");

  // Reminder preferences
  const [remindersEnabled, setRemindersEnabled] = React.useState(true);
  const [repeatInterval, setRepeatInterval] = React.useState(15);
  const [quietEnabled, setQuietEnabled] = React.useState(true);
  const [quietStart, setQuietStart] = React.useState("22:00");
  const [quietEnd, setQuietEnd] = React.useState("06:00");
  const [browserGranted, setBrowserGranted] = React.useState(false);
  const [browserPermissionState, setBrowserPermissionState] =
    React.useState<string>("unsupported");

  // Share links
  const [shareLinks, setShareLinks] = React.useState<ShareLinkRecord[]>([]);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  // Privacy deletion request
  const [deleteReason, setDeleteReason] = React.useState("");
  const [deleteConfirmEmail, setDeleteConfirmEmail] = React.useState("");
  const [submittingDelete, setSubmittingDelete] = React.useState(false);
  const [deleteFeedback, setDeleteFeedback] = React.useState<string | null>(
    null
  );
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsRes, shareRes] = await Promise.all([
        getSettings(),
        getShareLinks(),
      ]);

      setFullName(settingsRes.profile.full_name || "");
      setEmail(settingsRes.profile.email || "");
      setTimezone(settingsRes.profile.timezone || "Asia/Bangkok");

      setRecipientName(settingsRes.care_recipient.display_name || "");
      setRecipientAge(
        settingsRes.care_recipient.age_years !== null
          ? String(settingsRes.care_recipient.age_years)
          : ""
      );
      setMobilityLevel(settingsRes.care_recipient.mobility_level || "homebound");
      setRequiresSupervision(
        Boolean(settingsRes.care_recipient.requires_supervision)
      );
      setCareNotes(settingsRes.care_recipient.care_notes || "");

      setRemindersEnabled(
        Boolean(settingsRes.reminder_preference.reminders_enabled)
      );
      setRepeatInterval(
        settingsRes.reminder_preference.repeat_interval_minutes || 15
      );
      setQuietEnabled(
        Boolean(settingsRes.reminder_preference.quiet_hours_enabled)
      );
      setQuietStart(
        settingsRes.reminder_preference.quiet_hours_start || "22:00"
      );
      setQuietEnd(settingsRes.reminder_preference.quiet_hours_end || "06:00");
      setBrowserGranted(
        Boolean(settingsRes.reminder_preference.browser_notifications_granted)
      );

      setShareLinks(shareRes.links || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถโหลดข้อมูลการตั้งค่าได้"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setBrowserPermissionState(Notification.permission);
    }
    void loadAll();
  }, [demoVersion, loadAll]);

  const handleRequestBrowserPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setBrowserPermissionState("unsupported");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setBrowserPermissionState(result);
      const granted = result === "granted";
      setBrowserGranted(granted);
      await updateSettings({
        reminder_preference: {
          browser_notifications_granted: granted,
        },
      });
      await refreshSession();
      if (granted) {
        setSuccessMsg("อนุญาตการแจ้งเตือนบนเบราว์เซอร์เรียบร้อยแล้ว");
      }
    } catch {
      setError("ไม่สามารถขออนุญาตการแจ้งเตือนบนเบราว์เซอร์ได้");
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const parsedAge = recipientAge.trim() ? Number(recipientAge) : null;
      await updateSettings({
        profile: {
          full_name: fullName.trim(),
          timezone,
        },
        care_recipient: {
          display_name: recipientName.trim(),
          age_years:
            parsedAge !== null && Number.isFinite(parsedAge) ? parsedAge : null,
          mobility_level: mobilityLevel,
          requires_supervision: requiresSupervision,
          care_notes: careNotes.trim(),
        },
        reminder_preference: {
          reminders_enabled: remindersEnabled,
          repeat_interval_minutes: repeatInterval,
          quiet_hours_enabled: quietEnabled,
          quiet_hours_start: quietStart,
          quiet_hours_end: quietEnd,
          browser_notifications_granted:
            browserPermissionState === "granted" || browserGranted,
        },
      });
      await refreshSession();
      setSuccessMsg("บันทึกการตั้งค่าทั้งหมดเรียบร้อยแล้ว");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถบันทึกการตั้งค่าได้"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeLink = async (id: string) => {
    setRevokingId(id);
    setError(null);
    try {
      await revokeShareLink(id);
      setShareLinks((prev) =>
        prev.map((l) =>
          l.id === id ? { ...l, revoked_at: new Date().toISOString() } : l
        )
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถยกเลิกลิงก์แชร์ได้"
      );
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopyShareUrl = async (token: string, id: string) => {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/share/${token}`
        : `/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleDeletionRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingDelete(true);
    setDeleteError(null);
    setDeleteFeedback(null);
    try {
      const res = await submitDeletionRequest({
        reason: deleteReason.trim(),
        confirm_email: deleteConfirmEmail.trim(),
      });
      setDeleteFeedback(
        `${res.message} (รหัสคำขอ: ${res.request_id})`
      );
      setDeleteReason("");
      setDeleteConfirmEmail("");
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถส่งคำขอลบข้อมูลส่วนบุคคลได้"
      );
    } finally {
      setSubmittingDelete(false);
    }
  };

  const permissionLabel: Record<string, { text: string; variant: "sage" | "warning" | "neutral" }> = {
    granted: { text: "อนุญาตแล้ว", variant: "sage" },
    denied: { text: "ถูกปฏิเสธในเบราว์เซอร์", variant: "warning" },
    default: { text: "ยังไม่ได้ขออนุญาต", variant: "neutral" },
    unsupported: { text: "เบราว์เซอร์ไม่รองรับ", variant: "neutral" },
  };

  const permBadge =
    permissionLabel[browserPermissionState] ?? permissionLabel.default;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-[#17241D] flex items-center gap-2">
          <Settings className="h-6 w-6 text-[#256B4A]" />
          ตั้งค่าบัญชี การแจ้งเตือน และความเป็นส่วนตัว
        </h1>
        <p className="text-sm text-[#66736B] mt-0.5">
          จัดการข้อมูลผู้ดูแล ผู้รับการดูแล ระบบแจ้งเตือน ลิงก์แชร์ และสิทธิ์ข้อมูลส่วนบุคคล
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {successMsg && <Alert variant="success">{successMsg}</Alert>}

      {loading ? (
        <div className="space-y-4">
          <div className="h-48 rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] animate-pulse" />
          <div className="h-48 rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] animate-pulse" />
        </div>
      ) : (
        <form onSubmit={handleSaveSettings} className="space-y-5">
          {/* 1. Caregiver & Care Recipient Profile */}
          <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-5 space-y-4">
            <h2 className="text-lg font-semibold text-[#17241D] flex items-center gap-2">
              <User className="h-4 w-4 text-[#256B4A]" />
              ข้อมูลผู้ดูแลและผู้รับการดูแล
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  ชื่อผู้ดูแล
                </label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  อีเมลบัญชี
                </label>
                <Input value={email} disabled />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  ชื่อผู้รับการดูแล (เช่น คุณแม่ / คุณพ่อ)
                </label>
                <Input
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  อายุผู้รับการดูแล (ปี)
                </label>
                <Input
                  type="number"
                  min={50}
                  max={120}
                  value={recipientAge}
                  onChange={(e) => setRecipientAge(e.target.value)}
                  placeholder="เช่น 74"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  ระดับการเคลื่อนไหว
                </label>
                <Select
                  value={mobilityLevel}
                  onChange={(e) =>
                    setMobilityLevel(
                      e.target.value as CareRecipientProfile["mobility_level"]
                    )
                  }
                >
                  {(
                    Object.keys(MOBILITY_LABELS) as Array<
                      CareRecipientProfile["mobility_level"]
                    >
                  ).map((key) => (
                    <option key={key} value={key}>
                      {MOBILITY_LABELS[key]}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  เขตเวลา (Timezone)
                </label>
                <Select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  <option value="Asia/Bangkok">
                    ประเทศไทย — Asia/Bangkok (UTC+7)
                  </option>
                </Select>
              </div>
            </div>

            <Switch
              checked={requiresSupervision}
              onCheckedChange={setRequiresSupervision}
              label="ผู้รับการดูแลต้องมีผู้ดูแลใกล้ชิด / เฝ้าระวังตลอดเวลา"
              description="ใช้เพื่อแสดงคำเตือนความปลอดภัยในคำแนะนำช่วงพักผ่อนของผู้ดูแล"
            />

            <div>
              <label className="block text-xs font-medium text-[#66736B] mb-1">
                บันทึกการดูแลส่วนตัว (ซ่อนเป็นค่าเริ่มต้นเมื่อแชร์ตาราง)
              </label>
              <Textarea
                rows={3}
                value={careNotes}
                onChange={(e) => setCareNotes(e.target.value)}
                placeholder="เช่น แพ้ยาบางชนิด ชอบดื่มน้ำอุ่นก่อนนอน"
              />
            </div>
          </section>

          {/* 2. Smart Reminders & Browser Notification Permission */}
          <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-5 space-y-4">
            <h2 className="text-lg font-semibold text-[#17241D] flex items-center gap-2">
              <Bell className="h-4 w-4 text-[#256B4A]" />
              การแจ้งเตือนอัจฉริยะ (Smart Reminders)
            </h2>

            {/* Browser Notification Permission Box */}
            <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#17241D]">
                    สถานะการแจ้งเตือนบนเบราว์เซอร์:
                  </span>
                  <Badge variant={permBadge.variant}>{permBadge.text}</Badge>
                </div>

                {browserPermissionState !== "granted" &&
                  browserPermissionState !== "unsupported" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleRequestBrowserPermission}
                    >
                      <Bell className="h-3.5 w-3.5" />
                      ขออนุญาตแจ้งเตือนบนเบราว์เซอร์
                    </Button>
                  )}
              </div>
              <p className="text-xs text-[#66736B] leading-relaxed">
                การแจ้งเตือนบนเบราว์เซอร์ต้องได้รับอนุญาตจากคุณ
                การอนุญาตอย่างเดียวรองรับการแจ้งเตือนเมื่อเปิดเว็บ ส่วนกิจกรรมปฏิทินเมื่อปิดเว็บต้องเปิด Push ด้านล่างและตั้งค่า worker
              </p>
            </div>

            <PushNotificationControl />
            <Switch
              checked={remindersEnabled}
              onCheckedChange={setRemindersEnabled}
              label="เปิดใช้งานการแจ้งเตือนงานดูแล"
              description="แจ้งเตือนเมื่อถึงเวลาเริ่มงาน และแจ้งเตือนซ้ำอัตโนมัติจนกว่างานจะถูกยืนยันเสร็จสิ้น"
            />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  ความถี่ในการเตือนซ้ำ (หากยังไม่เสร็จ)
                </label>
                <Select
                  value={String(repeatInterval)}
                  onChange={(e) => setRepeatInterval(Number(e.target.value))}
                >
                  <option value="5">ทุก 5 นาที</option>
                  <option value="10">ทุก 10 นาที</option>
                  <option value="15">ทุก 15 นาที (ค่าเริ่มต้น)</option>
                  <option value="30">ทุก 30 นาที</option>
                  <option value="60">ทุก 60 นาที</option>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  เริ่มช่วงงดรบกวน (Quiet Hours)
                </label>
                <Input
                  type="time"
                  value={quietStart}
                  onChange={(e) => setQuietStart(e.target.value)}
                  disabled={!quietEnabled}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  สิ้นสุดช่วงงดรบกวน
                </label>
                <Input
                  type="time"
                  value={quietEnd}
                  onChange={(e) => setQuietEnd(e.target.value)}
                  disabled={!quietEnabled}
                />
              </div>
            </div>

            <Switch
              checked={quietEnabled}
              onCheckedChange={setQuietEnabled}
              label="เปิดใช้งานช่วงเวลางดรบกวน (Quiet Hours)"
              description="ระงับการแจ้งเตือนซ้ำในช่วงเวลานอนพัก ยกเว้นรายการที่ผู้ใช้เปิดดูเอง"
            />

            <div className="flex justify-end pt-2">
              <Button type="submit" variant="primary" loading={saving}>
                <Save className="h-4 w-4" />
                บันทึกการตั้งค่า
              </Button>
            </div>
          </section>
        </form>
      )}

      {/* 3. Active Share Links Management */}
      <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-5 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[#17241D] flex items-center gap-2">
              <Link2 className="h-4 w-4 text-[#256B4A]" />
              จัดการลิงก์แชร์ตารางให้ครอบครัว
            </h2>
            <p className="text-xs text-[#66736B]">
              ตรวจสอบวันหมดอายุและยกเลิกลิงก์แชร์ได้ทุกเมื่อเพื่อความปลอดภัยของข้อมูล
            </p>
          </div>
          <Badge variant="neutral">{shareLinks.length} รายการ</Badge>
        </div>

        {shareLinks.length === 0 ? (
          <p className="text-sm text-[#66736B]">ยังไม่มีประวัติการสร้างลิงก์แชร์</p>
        ) : (
          <>
            {/* Mobile Stacked Cards (No Horizontal Scroll Clipping) */}
            <div className="sm:hidden space-y-2.5">
              {shareLinks.map((link) => {
                const isRevoked = Boolean(link.revoked_at);
                const isExpired =
                  link.expires_at &&
                  new Date(link.expires_at).getTime() < Date.now();
                return (
                  <div
                    key={link.id}
                    className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-3 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="sage">
                          {link.scope === "week" ? "รายสัปดาห์" : "รายวัน"}
                        </Badge>
                        <span className="text-xs font-medium text-[#17241D]">
                          {formatThaiDate(link.target_date, {
                            includeWeekday: false,
                          })}
                        </span>
                      </div>
                      {isRevoked ? (
                        <Badge variant="neutral">ยกเลิกแล้ว</Badge>
                      ) : isExpired ? (
                        <Badge variant="warning">หมดอายุแล้ว</Badge>
                      ) : (
                        <Badge variant="sage">เปิดใช้งาน</Badge>
                      )}
                    </div>
                    <div className="text-xs text-[#66736B] space-y-0.5">
                      <p>
                        บันทึกส่วนตัว:{" "}
                        {link.include_private_notes ? "รวมไว้" : "ซ่อนไว้"}
                      </p>
                      {!isRevoked && !isExpired && (
                        <p>
                          หมดอายุ:{" "}
                          {link.expires_at
                            ? formatThaiDateTime(link.expires_at)
                            : "ไม่มีกำหนด"}
                        </p>
                      )}
                    </div>
                    {!isRevoked && !isExpired && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void handleCopyShareUrl(link.token, link.id)
                          }
                          className="h-8 px-2.5 text-xs flex-1"
                        >
                          {copiedId === link.id ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          {copiedId === link.id ? "คัดลอกแล้ว" : "คัดลอก"}
                        </Button>
                        <Button
                          size="sm"
                          variant="warning"
                          loading={revokingId === link.id}
                          onClick={() => void handleRevokeLink(link.id)}
                          className="h-8 px-2.5 text-xs flex-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          ยกเลิกลิงก์
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop / Tablet Table */}
            <div className="hidden sm:block overflow-x-auto rounded-md border border-[#E3E9E3]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#FAFBF9] border-b border-[#E3E9E3] text-xs text-[#66736B]">
                <tr>
                  <th className="px-3.5 py-2.5 font-medium">ขอบเขต / วันที่</th>
                  <th className="px-3.5 py-2.5 font-medium">บันทึกส่วนตัว</th>
                  <th className="px-3.5 py-2.5 font-medium">สถานะ / หมดอายุ</th>
                  <th className="px-3.5 py-2.5 font-medium text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3E9E3]">
                {shareLinks.map((link) => {
                  const isRevoked = Boolean(link.revoked_at);
                  const isExpired =
                    link.expires_at &&
                    new Date(link.expires_at).getTime() < Date.now();
                  return (
                    <tr key={link.id} className="bg-[#FFFFFF]">
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="sage">
                            {link.scope === "week" ? "รายสัปดาห์" : "รายวัน"}
                          </Badge>
                          <span className="text-xs font-medium text-[#17241D]">
                            {formatThaiDate(link.target_date, {
                              includeWeekday: false,
                            })}
                          </span>
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 text-xs text-[#66736B]">
                        {link.include_private_notes ? "รวมไว้" : "ซ่อนไว้"}
                      </td>
                      <td className="px-3.5 py-2.5 text-xs">
                        {isRevoked ? (
                          <Badge variant="neutral">ยกเลิกแล้ว</Badge>
                        ) : isExpired ? (
                          <Badge variant="warning">หมดอายุแล้ว</Badge>
                        ) : (
                          <span className="text-[#17241D]">
                            {link.expires_at
                              ? formatThaiDateTime(link.expires_at)
                              : "ไม่มีกำหนด"}
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        {!isRevoked && !isExpired ? (
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void handleCopyShareUrl(link.token, link.id)
                              }
                              className="h-7 px-2 text-xs"
                            >
                              {copiedId === link.id ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              {copiedId === link.id ? "คัดลอกแล้ว" : "คัดลอก"}
                            </Button>
                            <Button
                              size="sm"
                              variant="warning"
                              loading={revokingId === link.id}
                              onClick={() => void handleRevokeLink(link.id)}
                              className="h-7 px-2 text-xs"
                            >
                              <Trash2 className="h-3 w-3" />
                              ยกเลิกลิงก์
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-[#66736B]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>

      {/* 4. Privacy & Personal Data Deletion Request */}
      <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[#17241D] flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#B86A32]" />
            ความเป็นส่วนตัวและคำขอลบข้อมูลส่วนบุคคล (PDPA / Privacy)
          </h2>
          <p className="text-xs sm:text-sm text-[#66736B] mt-1 leading-relaxed">
            คุณสามารถยื่นคำขอลบข้อมูลส่วนบุคคลตามสิทธิ์ด้านความเป็นส่วนตัวได้ที่นี่
            อย่างไรก็ตาม{" "}
            <strong className="text-[#17241D]">
              ช่องทางนี้ไม่ใช่การแก้ไขหรือลบหลักฐานการดูแลย้อนหลังตามปกติ
            </strong>{" "}
            ระบบจะบันทึกคำขอเพื่อดำเนินการตามขั้นตอนคุ้มครองข้อมูลส่วนบุคคล
          </p>
        </div>

        {deleteError && <Alert variant="error">{deleteError}</Alert>}
        {deleteFeedback && <Alert variant="success">{deleteFeedback}</Alert>}

        <form onSubmit={handleDeletionRequest} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#66736B] mb-1">
                ยืนยันอีเมลบัญชีของคุณ
              </label>
              <Input
                type="email"
                value={deleteConfirmEmail}
                onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                placeholder={email || "example@email.com"}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#66736B] mb-1">
                เหตุผลในการขอลบข้อมูลส่วนบุคคล
              </label>
              <Input
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="เช่น ขอลบบัญชีและข้อมูลส่วนบุคคลทั้งหมด"
                required
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              variant="warning"
              loading={submittingDelete}
            >
              ส่งคำขอลบข้อมูลส่วนบุคคล
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
