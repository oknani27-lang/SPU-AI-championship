"use client";

import * as React from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Link2,
  MessageCircle,
  Printer,
  Share2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  createShareLink,
  getPublicSharedSchedule,
  getShareLinks,
  revokeShareLink,
} from "@/lib/api-client";
import { formatDuration, formatThaiDate, formatThaiDateTime } from "@/lib/utils";
import {
  THAI_DAY_NAMES,
  type SharedSchedulePayload,
  type ShareLinkRecord,
} from "@/types/careplan";

export interface ShareScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  defaultDate: string; // "YYYY-MM-DD"
  defaultScope?: "day" | "week";
  careRecipientName?: string;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function renderSchedulePng(payload: SharedSchedulePayload): string {
  const scale = 2;
  const width = 920;
  const padding = 44;
  const contentWidth = width - padding * 2;
  const fontFamily = '"LINE Seed Sans TH", "Sarabun", sans-serif';

  // Calculate dynamic canvas height
  let estimatedHeight = 200;
  for (const day of payload.days) {
    estimatedHeight += 54;
    if (day.is_rest_day) {
      estimatedHeight += 46;
    } else if (day.tasks.length === 0) {
      estimatedHeight += 42;
    } else {
      for (const task of day.tasks) {
        estimatedHeight += task.notes && payload.include_private_notes ? 62 : 44;
      }
    }
    estimatedHeight += 18;
  }
  estimatedHeight += 76;
  const height = Math.max(480, estimatedHeight);

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("เบราว์เซอร์ไม่รองรับการสร้างภาพ PNG");
  }
  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = "#FAFBF9";
  ctx.fillRect(0, 0, width, height);

  // Header Card
  drawRoundedRect(ctx, padding, 32, contentWidth, 114, 10);
  ctx.fillStyle = "#256B4A";
  ctx.fill();

  ctx.fillStyle = "#EAF3EC";
  ctx.font = `600 14px ${fontFamily}`;
  ctx.fillText("CAREPLAN · ตารางดูแลผู้สูงอายุสำหรับครอบครัว", padding + 24, 62);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 26px ${fontFamily}`;
  const heading =
    payload.scope === "week"
      ? `แผนดูแลรายสัปดาห์ — ${payload.care_recipient_label}`
      : `แผนดูแลประจำวัน — ${payload.care_recipient_label}`;
  ctx.fillText(heading, padding + 24, 96);

  ctx.fillStyle = "#EAF3EC";
  ctx.font = `400 15px ${fontFamily}`;
  const subtitle =
    payload.scope === "week"
      ? `สัปดาห์ของ ${formatThaiDate(payload.target_date, { includeWeekday: false })} · เขตเวลาประเทศไทย (Asia/Bangkok)`
      : `${formatThaiDate(payload.target_date)} · เขตเวลาประเทศไทย (Asia/Bangkok)`;
  ctx.fillText(subtitle, padding + 24, 124);

  let y = 166;

  for (const day of payload.days) {
    const dayHeader = `${THAI_DAY_NAMES[day.day_of_week].full}ที่ ${formatThaiDate(
      day.date,
      { includeWeekday: false }
    )}`;

    // Calculate card height for this day
    let blockHeight = 50;
    if (day.is_rest_day) {
      blockHeight += 42;
    } else if (day.tasks.length === 0) {
      blockHeight += 38;
    } else {
      for (const t of day.tasks) {
        blockHeight += t.notes && payload.include_private_notes ? 58 : 42;
      }
    }
    blockHeight += 12;

    drawRoundedRect(ctx, padding, y, contentWidth, blockHeight, 8);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.strokeStyle = "#E3E9E3";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Day Header Band
    drawRoundedRect(ctx, padding, y, contentWidth, 42, 8);
    ctx.fillStyle = day.is_rest_day ? "#FDF6F0" : "#EAF3EC";
    ctx.fill();
    // Square bottom corners of header band
    ctx.fillRect(padding, y + 32, contentWidth, 10);

    ctx.fillStyle = day.is_rest_day ? "#B86A32" : "#1E583C";
    ctx.font = `700 16px ${fontFamily}`;
    ctx.fillText(dayHeader, padding + 18, y + 27);

    if (day.is_rest_day) {
      ctx.font = `600 13px ${fontFamily}`;
      ctx.fillText("วันพักของตาราง", width - padding - 115, y + 26);
    }

    let rowY = y + 66;
    if (day.is_rest_day) {
      ctx.fillStyle = "#66736B";
      ctx.font = `400 14px ${fontFamily}`;
      ctx.fillText(
        "ไม่มีรายการนัดหมายในแอปสำหรับวันนี้ (ไม่ยกเลิกการดูแลที่จำเป็นทางการแพทย์โดยอัตโนมัติ)",
        padding + 18,
        rowY
      );
    } else if (day.tasks.length === 0) {
      ctx.fillStyle = "#66736B";
      ctx.font = `400 14px ${fontFamily}`;
      ctx.fillText("ยังไม่มีรายการงานในวันนี้", padding + 18, rowY);
    } else {
      day.tasks.forEach((task, idx) => {
        if (idx > 0) {
          ctx.beginPath();
          ctx.moveTo(padding + 18, rowY - 22);
          ctx.lineTo(width - padding - 18, rowY - 22);
          ctx.strokeStyle = "#EEF2EE";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Scheduled time
        ctx.fillStyle = "#256B4A";
        ctx.font = `700 16px ${fontFamily}`;
        ctx.fillText(task.scheduled_time, padding + 18, rowY);

        // Title
        ctx.fillStyle = "#17241D";
        ctx.font = `600 16px ${fontFamily}`;
        const truncatedTitle =
          task.title.length > 48 ? `${task.title.slice(0, 48)}…` : task.title;
        ctx.fillText(truncatedTitle, padding + 92, rowY);

        // Medical badge or duration on right
        const durationText = formatDuration(task.duration_minutes);
        ctx.fillStyle = "#66736B";
        ctx.font = `400 13px ${fontFamily}`;
        const durWidth = ctx.measureText(durationText).width;
        ctx.fillText(durationText, width - padding - 18 - durWidth, rowY);

        if (task.is_medically_prescribed) {
          const medLabel = "สำคัญทางการแพทย์";
          ctx.font = `600 12px ${fontFamily}`;
          const medW = ctx.measureText(medLabel).width + 16;
          const medX = width - padding - 28 - durWidth - medW;
          drawRoundedRect(ctx, medX, rowY - 15, medW, 20, 4);
          ctx.fillStyle = "#FDF6F0";
          ctx.fill();
          ctx.strokeStyle = "#EBCBB2";
          ctx.stroke();
          ctx.fillStyle = "#B86A32";
          ctx.fillText(medLabel, medX + 8, rowY - 1);
        }

        if (task.notes && payload.include_private_notes) {
          ctx.fillStyle = "#66736B";
          ctx.font = `400 13px ${fontFamily}`;
          const noteText =
            task.notes.length > 68 ? `${task.notes.slice(0, 68)}…` : task.notes;
          ctx.fillText(`หมายเหตุ: ${noteText}`, padding + 92, rowY + 20);
          rowY += 58;
        } else {
          rowY += 42;
        }
      });
    }

    y += blockHeight + 16;
  }

  // Footer
  ctx.fillStyle = "#66736B";
  ctx.font = `400 12px ${fontFamily}`;
  ctx.fillText(
    payload.include_private_notes
      ? "สร้างจาก CarePlan · รวมบันทึกส่วนตัวตามที่ผู้ดูแลเลือก"
      : "สร้างจาก CarePlan · ซ่อนบันทึกส่วนตัวเพื่อความเป็นส่วนตัวของครอบครัว",
    padding,
    height - 26
  );

  return canvas.toDataURL("image/png");
}

export function ShareScheduleDialog({
  open,
  onClose,
  defaultDate,
  defaultScope = "week",
  careRecipientName = "ผู้รับการดูแล",
}: ShareScheduleDialogProps) {
  const [scope, setScope] = React.useState<"day" | "week">(defaultScope);
  const [includePrivateNotes, setIncludePrivateNotes] = React.useState(false);
  const [expiresInDays, setExpiresInDays] = React.useState<string>("7");

  const [creating, setCreating] = React.useState(false);
  const [exportingPng, setExportingPng] = React.useState(false);
  const [links, setLinks] = React.useState<ShareLinkRecord[]>([]);
  const [loadingLinks, setLoadingLinks] = React.useState(false);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);

  const [latestLink, setLatestLink] = React.useState<{
    link: ShareLinkRecord;
    fullUrl: string;
  } | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [canNativeShare, setCanNativeShare] = React.useState(false);

  React.useEffect(() => {
    setCanNativeShare(
      typeof navigator !== "undefined" && typeof navigator.share === "function"
    );
  }, []);

  React.useEffect(() => {
    if (open) {
      setScope(defaultScope);
      setIncludePrivateNotes(false);
      setError(null);
      void loadExistingLinks();
    }
  }, [open, defaultScope]);

  const toAbsoluteUrl = (sharePathOrUrl: string, token: string): string => {
    if (typeof window === "undefined") return sharePathOrUrl;
    return `${window.location.origin}/share/${token}`;
  };

  const loadExistingLinks = async () => {
    setLoadingLinks(true);
    try {
      const res = await getShareLinks();
      setLinks(res.links || []);
    } catch {
      // ignore initial list failure
    } finally {
      setLoadingLinks(false);
    }
  };

  const handleCreateLink = async () => {
    setCreating(true);
    setError(null);
    try {
      const expiryVal =
        expiresInDays === "never" ? null : Number(expiresInDays);
      const res = await createShareLink({
        scope,
        target_date: defaultDate,
        include_private_notes: includePrivateNotes,
        expires_in_days: expiryVal,
      });
      const fullUrl = toAbsoluteUrl(res.share_url, res.link.token);
      setLatestLink({ link: res.link, fullUrl });
      await loadExistingLinks();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถสร้างลิงก์สำหรับแชร์ได้"
      );
    } finally {
      setCreating(false);
    }
  };

  const ensureShareLink = async (): Promise<{
    link: ShareLinkRecord;
    fullUrl: string;
  }> => {
    if (
      latestLink &&
      !latestLink.link.revoked_at &&
      latestLink.link.scope === scope &&
      latestLink.link.include_private_notes === includePrivateNotes
    ) {
      return latestLink;
    }
    const expiryVal =
      expiresInDays === "never" ? null : Number(expiresInDays);
    const res = await createShareLink({
      scope,
      target_date: defaultDate,
      include_private_notes: includePrivateNotes,
      expires_in_days: expiryVal,
    });
    const fullUrl = toAbsoluteUrl(res.share_url, res.link.token);
    const created = { link: res.link, fullUrl };
    setLatestLink(created);
    await loadExistingLinks();
    return created;
  };

  const handleCopy = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("ไม่สามารถคัดลอกอัตโนมัติได้ กรุณาคัดลอกลิงก์จากช่องด้านบน");
    }
  };

  const handleLineShare = async () => {
    setError(null);
    try {
      const target = await ensureShareLink();
      const scopeText =
        scope === "week" ? "ตารางดูแลรายสัปดาห์ (7 วัน)" : "ตารางดูแลประจำวัน";
      const text = `CarePlan: ${scopeText}ของ${careRecipientName} (${formatThaiDate(
        defaultDate,
        { includeWeekday: false }
      )}) ดูรายละเอียดได้ที่ลิงก์นี้:`;
      const lineUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(
        target.fullUrl
      )}&text=${encodeURIComponent(text)}`;
      window.open(lineUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถเปิดการแชร์ไป LINE ได้"
      );
    }
  };

  const handleDownloadPng = async () => {
    setExportingPng(true);
    setError(null);
    try {
      const target = await ensureShareLink();
      const payload = await getPublicSharedSchedule(target.link.token);
      if (typeof document !== "undefined" && document.fonts) {
        await document.fonts.ready;
      }
      const dataUrl = renderSchedulePng(payload);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `careplan-${payload.scope}-${payload.target_date}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถส่งออกรูปภาพ PNG ได้ กรุณาลองใหม่อีกครั้ง"
      );
    } finally {
      setExportingPng(false);
    }
  };

  const handlePrintPdf = async () => {
    setError(null);
    try {
      const target = await ensureShareLink();
      window.open(`${target.fullUrl}?print=1`, "_blank", "noopener,noreferrer");
    } catch {
      window.print();
    }
  };

  const handleNativeShare = async () => {
    setError(null);
    try {
      const target = await ensureShareLink();
      await navigator.share({
        title: `ตารางดูแล${careRecipientName} — CarePlan`,
        text: `แผนดูแล${careRecipientName} (${
          scope === "week" ? "รายสัปดาห์" : "รายวัน"
        })`,
        url: target.fullUrl,
      });
    } catch {
      // User cancelled native share sheet
    }
  };

  const handleRevoke = async (id: string) => {
    setRevokingId(id);
    setError(null);
    try {
      await revokeShareLink(id);
      if (latestLink?.link.id === id) {
        setLatestLink(null);
      }
      await loadExistingLinks();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถยกเลิกลิงก์แชร์ได้"
      );
    } finally {
      setRevokingId(null);
    }
  };

  const activeLinks = links.filter((l) => !l.revoked_at);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="แชร์ตารางดูแลให้ครอบครัว"
      description="ส่งตารางผ่าน LINE, ลิงก์ดูผ่านเว็บ (ไม่ต้องล็อกอิน), รูปภาพ PNG หรือพิมพ์เป็น PDF"
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-5">
        {error && <Alert variant="error">{error}</Alert>}

        {/* Scope & Privacy Options */}
        <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#66736B] mb-1.5">
                ขอบเขตตารางที่ต้องการแชร์
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setScope("day")}
                  className={
                    scope === "day"
                      ? "h-10 rounded-md border border-[#256B4A] bg-[#256B4A] text-white text-sm font-medium"
                      : "h-10 rounded-md border border-[#E3E9E3] bg-[#FFFFFF] text-[#17241D] text-sm font-medium hover:bg-[#EAF3EC]/60"
                  }
                >
                  รายวัน
                </button>
                <button
                  type="button"
                  onClick={() => setScope("week")}
                  className={
                    scope === "week"
                      ? "h-10 rounded-md border border-[#256B4A] bg-[#256B4A] text-white text-sm font-medium"
                      : "h-10 rounded-md border border-[#E3E9E3] bg-[#FFFFFF] text-[#17241D] text-sm font-medium hover:bg-[#EAF3EC]/60"
                  }
                >
                  รายสัปดาห์ (7 วัน)
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="share-expiry-select"
                className="block text-xs font-medium text-[#66736B] mb-1.5"
              >
                อายุของลิงก์แชร์
              </label>
              <Select
                id="share-expiry-select"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
              >
                <option value="1">หมดอายุใน 24 ชั่วโมง</option>
                <option value="7">หมดอายุใน 7 วัน (แนะนำ)</option>
                <option value="30">หมดอายุใน 30 วัน</option>
                <option value="never">ไม่มีกำหนด (ยกเลิกเองได้ทุกเมื่อ)</option>
              </Select>
            </div>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer rounded-md border border-[#E3E9E3] bg-[#FFFFFF] p-3">
            <input
              type="checkbox"
              checked={includePrivateNotes}
              onChange={(e) => setIncludePrivateNotes(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#256B4A]"
            />
            <div className="space-y-0.5 text-sm">
              <span className="font-medium text-[#17241D] flex items-center gap-1.5">
                รวมบันทึกส่วนตัว (Include private notes)
              </span>
              <p className="text-xs text-[#66736B]">
                ค่าเริ่มต้นจะซ่อนรายละเอียด/บันทึกส่วนตัวทั้งหมดเพื่อความเป็นส่วนตัว
                และไม่เปิดเผยหลักฐานภาพถ่ายในลิงก์สาธารณะ
              </p>
            </div>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              loading={creating}
              onClick={handleCreateLink}
            >
              <Link2 className="h-4 w-4" />
              สร้างลิงก์สำหรับแชร์
            </Button>
          </div>
        </div>

        {/* Latest Created Link Box */}
        {latestLink && (
          <div className="rounded-md border border-[#CFE3D4] bg-[#EAF3EC]/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[#17241D] flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-[#256B4A]" />
                ลิงก์พร้อมแชร์แล้ว (ดูได้โดยไม่ต้องล็อกอิน)
              </p>
              <Badge variant="sage">
                {latestLink.link.scope === "week" ? "รายสัปดาห์" : "รายวัน"}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={latestLink.fullUrl}
                aria-label="ลิงก์แชร์ตาราง"
                className="flex-1 h-9 rounded-md border border-[#CFE3D4] bg-[#FFFFFF] px-3 text-xs sm:text-sm text-[#17241D]"
              />
              <Button
                size="sm"
                variant="primary"
                onClick={() =>
                  void handleCopy(latestLink.fullUrl, latestLink.link.id)
                }
              >
                {copiedId === latestLink.link.id ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    คัดลอกแล้ว
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    คัดลอกลิงก์
                  </>
                )}
              </Button>
              <a
                href={latestLink.fullUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E3E9E3] bg-[#FFFFFF] text-[#17241D] hover:bg-[#F4F7F4]"
                title="เปิดดูหน้าแชร์"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        )}

        {/* Quick Export & LINE Share Actions */}
        <div className="space-y-2">
          <p className="text-sm font-semibold text-[#17241D]">
            ช่องทางการส่งต่อและส่งออกไฟล์
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button
              variant="primary"
              onClick={handleLineShare}
              className="justify-start"
            >
              <MessageCircle className="h-4 w-4" />
              แชร์ไปที่ LINE (กลุ่มครอบครัว)
            </Button>

            <Button
              variant="secondary"
              loading={exportingPng}
              onClick={handleDownloadPng}
              className="justify-start"
            >
              <Download className="h-4 w-4" />
              บันทึกรูปภาพตาราง (PNG)
            </Button>

            <Button
              variant="outline"
              onClick={handlePrintPdf}
              className="justify-start"
            >
              <Printer className="h-4 w-4" />
              พิมพ์ / บันทึกเป็น PDF
            </Button>

            <a
              href={`/api/calendar/ics?scope=${scope}&date=${encodeURIComponent(defaultDate)}&includeNotes=${includePrivateNotes ? "1" : "0"}`}
              download
              className="inline-flex h-10 items-center justify-start gap-2 rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-4 text-sm font-medium text-[#17241D] hover:bg-[#EAF3EC] transition-colors"
            >
              <Download className="h-4 w-4 text-[#256B4A]" />
              ส่งออก Apple Calendar (.ics)
            </a>

            {canNativeShare && (
              <Button
                variant="outline"
                onClick={handleNativeShare}
                className="justify-start"
              >
                <Share2 className="h-4 w-4" />
                แชร์ผ่านแอปในอุปกรณ์นี้
              </Button>
            )}
          </div>
        </div>

        {/* Active Links List with Revoke */}
        <div className="space-y-2 border-t border-[#E3E9E3] pt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#17241D]">
              ลิงก์แชร์ที่ยังเปิดใช้งาน ({activeLinks.length})
            </p>
            {loadingLinks && (
              <span className="text-xs text-[#66736B]">กำลังอัปเดต...</span>
            )}
          </div>

          {activeLinks.length === 0 ? (
            <p className="text-xs text-[#66736B]">
              ยังไม่มีลิงก์ที่เปิดใช้งานอยู่
            </p>
          ) : (
            <div className="divide-y divide-[#E3E9E3] rounded-md border border-[#E3E9E3]">
              {activeLinks.slice(0, 5).map((item) => {
                const url = toAbsoluteUrl(`/share/${item.token}`, item.token);
                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs bg-[#FFFFFF]"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="sage">
                          {item.scope === "week" ? "รายสัปดาห์" : "รายวัน"}
                        </Badge>
                        <span className="font-medium text-[#17241D]">
                          {formatThaiDate(item.target_date, {
                            includeWeekday: false,
                          })}
                        </span>
                        <span className="text-[#66736B]">
                          ·{" "}
                          {item.include_private_notes
                            ? "รวมบันทึกส่วนตัว"
                            : "ซ่อนบันทึกส่วนตัว"}
                        </span>
                      </div>
                      <p className="text-[11px] text-[#66736B]">
                        {item.expires_at
                          ? `หมดอายุ: ${formatThaiDateTime(item.expires_at)}`
                          : "ไม่มีวันหมดอายุ"}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleCopy(url, item.id)}
                        className="h-7 px-2 text-xs"
                      >
                        {copiedId === item.id ? "คัดลอกแล้ว" : "คัดลอก"}
                      </Button>
                      <Button
                        size="sm"
                        variant="warning"
                        loading={revokingId === item.id}
                        onClick={() => void handleRevoke(item.id)}
                        className="h-7 px-2 text-xs"
                      >
                        <Trash2 className="h-3 w-3" />
                        ยกเลิกลิงก์
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
