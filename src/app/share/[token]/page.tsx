"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  CalendarCheck2,
  Clock,
  MessageCircle,
  Printer,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ApiError, getPublicSharedSchedule } from "@/lib/api-client";
import {
  formatDuration,
  formatThaiDate,
  formatThaiDateTime,
  PRIORITY_META,
} from "@/lib/utils";
import {
  THAI_DAY_NAMES,
  type SharedSchedulePayload,
} from "@/types/careplan";

export default function PublicSharePage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen bg-[#FAFBF9] flex items-center justify-center p-6">
          <p className="text-sm text-[#66736B]">กำลังโหลดตารางดูแล...</p>
        </div>
      }
    >
      <PublicShareContent />
    </React.Suspense>
  );
}

function PublicShareContent() {
  const params = useParams<{ token: string }>();
  const searchParams = useSearchParams();
  const token = params?.token;

  const [payload, setPayload] = React.useState<SharedSchedulePayload | null>(
    null
  );
  const [loading, setLoading] = React.useState(true);
  const [errorStatus, setErrorStatus] = React.useState<number | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setErrorStatus(null);
    setErrorMessage(null);

    getPublicSharedSchedule(token)
      .then((data) => {
        if (!active) return;
        setPayload(data);
        if (searchParams?.get("print") === "1") {
          window.setTimeout(() => window.print(), 450);
        }
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError) {
          setErrorStatus(err.status);
          setErrorMessage(err.message);
        } else {
          setErrorMessage("ไม่สามารถเปิดดูตารางที่แชร์ได้");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [token, searchParams]);

  const handleLineShare = () => {
    if (typeof window === "undefined" || !payload) return;
    const url = window.location.href;
    const text = `CarePlan: แผนดูแล${payload.care_recipient_label} (${
      payload.scope === "week" ? "รายสัปดาห์ 7 วัน" : "รายวัน"
    })`;
    window.open(
      `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(
        url
      )}&text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFBF9] py-10 px-4">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="h-28 rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] animate-pulse" />
          <div className="h-44 rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] animate-pulse" />
        </div>
      </div>
    );
  }

  if (errorMessage || !payload) {
    const isGone = errorStatus === 410;
    return (
      <div className="min-h-screen bg-[#FAFBF9] flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-6 sm:p-8 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-md bg-[#FDF6F0] text-[#B86A32] flex items-center justify-center">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-bold text-[#17241D]">
              {isGone
                ? "ลิงก์แชร์นี้หมดอายุหรือถูกยกเลิกแล้ว"
                : "ไม่พบลิงก์ตารางดูแลนี้"}
            </h1>
            <p className="text-sm text-[#66736B] leading-relaxed">
              {errorMessage ||
                "กรุณาขอลิงก์แชร์ใหม่จากผู้ดูแลในครอบครัว"}
            </p>
          </div>
          <div className="pt-1">
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-4 text-sm font-medium text-[#17241D] hover:bg-[#F4F7F4]"
            >
              กลับไปหน้าหลัก CarePlan
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFBF9] py-6 sm:py-8 px-4">
      <div className="mx-auto max-w-3xl space-y-5">
        {/* Top Bar (No-print actions) */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-[#256B4A]">
            <span className="h-7 w-7 rounded-md bg-[#256B4A] text-white flex items-center justify-center">
              <CalendarCheck2 className="h-4 w-4" />
            </span>
            CarePlan · ตารางดูแลสำหรับครอบครัว
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={handleLineShare}>
              <MessageCircle className="h-4 w-4" />
              แชร์ต่อใน LINE
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" />
              พิมพ์ / บันทึก PDF
            </Button>
          </div>
        </div>

        {/* Public Schedule Header Card */}
        <header className="rounded-lg border border-[#CFE3D4] bg-[#256B4A] text-white p-5 sm:p-6 space-y-2 print-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center rounded bg-white/15 px-2.5 py-0.5 text-xs font-medium">
              {payload.scope === "week"
                ? "ตารางดูแลรายสัปดาห์ (7 วัน)"
                : "ตารางดูแลประจำวัน"}
            </span>
            <span className="text-xs text-[#EAF3EC]">
              เขตเวลาประเทศไทย ({payload.timezone || "Asia/Bangkok"})
            </span>
          </div>

          <h1 className="text-2xl font-bold leading-snug">
            แผนดูแล{payload.care_recipient_label}
          </h1>

          <p className="text-sm text-[#EAF3EC]">
            {payload.schedule_title} · ข้อมูล ณ{" "}
            {formatThaiDate(payload.target_date)}
          </p>

          {payload.expires_at && (
            <p className="text-xs text-[#EAF3EC]/90">
              ลิงก์นี้ใช้งานได้ถึง {formatThaiDateTime(payload.expires_at)}
            </p>
          )}
        </header>

        {/* Privacy Notice */}
        <Alert variant="sage">
          <span className="inline-flex items-center gap-1.5 text-xs sm:text-sm">
            <ShieldCheck className="h-4 w-4 text-[#256B4A] shrink-0" />
            {payload.include_private_notes
              ? "ผู้ดูแลอนุญาตให้แสดงบันทึกประกอบในลิงก์นี้ (ภาพถ่ายหลักฐานยังคงถูกเก็บเป็นความลับ)"
              : "มุมมองสำหรับครอบครัวนี้ซ่อนบันทึกส่วนตัวและภาพถ่ายหลักฐานเพื่อความเป็นส่วนตัว"}
          </span>
        </Alert>

        {/* Days List */}
        <div className="space-y-4">
          {payload.days.map((day) => (
            <section
              key={day.date}
              className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] overflow-hidden print-card"
            >
              <div
                className={
                  day.is_rest_day
                    ? "px-4 py-3 border-b border-[#EBCBB2] bg-[#FDF6F0] flex items-center justify-between"
                    : "px-4 py-3 border-b border-[#E3E9E3] bg-[#EAF3EC]/70 flex items-center justify-between"
                }
              >
                <h2
                  className={
                    day.is_rest_day
                      ? "font-semibold text-[#B86A32] text-base"
                      : "font-semibold text-[#1E583C] text-base"
                  }
                >
                  {THAI_DAY_NAMES[day.day_of_week].full}ที่{" "}
                  {formatThaiDate(day.date, { includeWeekday: false })}
                </h2>
                {day.is_rest_day ? (
                  <Badge variant="warning">วันพักของตาราง</Badge>
                ) : (
                  <span className="text-xs text-[#66736B]">
                    {day.tasks.length} รายการ
                  </span>
                )}
              </div>

              {day.is_rest_day ? (
                <div className="px-4 py-4 flex items-start gap-2.5 text-sm text-[#66736B]">
                  <Sun className="h-4 w-4 text-[#B86A32] mt-0.5 shrink-0" />
                  <p>
                    วันนี้เป็นวันพักในตารางแอป ไม่มีรายการนัดหมายในแอป
                    (แต่ไม่ยกเลิกการดูแลที่จำเป็นทางการแพทย์ตามคำสั่งแพทย์โดยอัตโนมัติ)
                  </p>
                </div>
              ) : day.tasks.length === 0 ? (
                <p className="px-4 py-4 text-sm text-[#66736B]">
                  ไม่มีรายการดูแลในวันนี้
                </p>
              ) : (
                <ul className="divide-y divide-[#E3E9E3]">
                  {day.tasks.map((task, idx) => {
                    const pMeta = PRIORITY_META[task.priority];
                    return (
                      <li
                        key={`${day.date}-${idx}`}
                        className="px-4 py-3 flex items-start gap-3"
                      >
                        <span className="w-14 shrink-0 font-bold text-[#256B4A] tabular-nums text-[15px] pt-0.5">
                          {task.scheduled_time}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-[#17241D] text-[15px]">
                              {task.title}
                            </p>
                            {task.is_medically_prescribed && (
                              <Badge variant="warning">
                                <Stethoscope className="h-3 w-3" />
                                สำคัญทางการแพทย์
                              </Badge>
                            )}
                            {!task.is_medically_prescribed &&
                              task.priority === "high" && (
                                <Badge variant={pMeta.badgeVariant}>
                                  {pMeta.label}
                                </Badge>
                              )}
                          </div>

                          <p className="text-xs text-[#66736B] inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            ระยะเวลาประมาณ {formatDuration(task.duration_minutes)}
                          </p>

                          {payload.include_private_notes && task.notes && (
                            <p className="text-xs sm:text-sm text-[#66736B] rounded bg-[#FAFBF9] border border-[#E3E9E3] px-2.5 py-1.5 mt-1">
                              {task.notes}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>

        {/* Footer */}
        <footer className="text-center text-xs text-[#66736B] pt-2 pb-6">
          แสดงผลแบบอ่านอย่างเดียวผ่าน CarePlan — AI Weekly Care Scheduler
        </footer>
      </div>
    </div>
  );
}
