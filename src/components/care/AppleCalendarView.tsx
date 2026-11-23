"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarPlus,
  CheckCircle2,
  Clock,
  ExternalLink,
  Lock,
  Repeat,
  Stethoscope,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  cn,
  formatDuration,
  formatThaiDate,
  getBangkokNowTime,
  getBangkokToday,
  PRIORITY_META,
} from "@/lib/utils";
import {
  ALL_DAYS,
  THAI_DAY_NAMES,
  type DailyTaskOccurrence,
  type DayOfWeek,
} from "@/types/careplan";

const START_HOUR = 6; // 06:00
const END_HOUR = 22; // 22:00
const HOUR_HEIGHT_PX = 58; // crisp Apple Calendar vertical density
const HOURS = Array.from(
  { length: END_HOUR - START_HOUR + 1 },
  (_, i) => START_HOUR + i
);

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => Number.parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return START_HOUR * 60;
  return h * 60 + m;
}

function formatEndTime(startHhmm: string, durationMinutes: number): string {
  const total = Math.min(23 * 60 + 59, timeToMinutes(startHhmm) + durationMinutes);
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export interface AppleCalendarDayColumn {
  day_of_week: DayOfWeek;
  date: string;
  is_rest_day: boolean;
  occurrences: DailyTaskOccurrence[];
}

export interface AppleCalendarViewProps {
  days: AppleCalendarDayColumn[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  weekStartDate: string;
}

export function AppleCalendarView({
  days,
  selectedDate,
  onSelectDate,
  weekStartDate,
}: AppleCalendarViewProps) {
  const [activeEvent, setActiveEvent] =
    React.useState<DailyTaskOccurrence | null>(null);
  const [nowMinutes, setNowMinutes] = React.useState(() =>
    timeToMinutes(getBangkokNowTime())
  );
  const todayStr = getBangkokToday();

  React.useEffect(() => {
    const id = window.setInterval(() => {
      setNowMinutes(timeToMinutes(getBangkokNowTime()));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  React.useEffect(() => {
    if (!activeEvent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveEvent(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeEvent]);

  const dayByDow = React.useMemo(() => {
    const map = new Map<DayOfWeek, AppleCalendarDayColumn>();
    for (const d of days) map.set(d.day_of_week, d);
    return map;
  }, [days]);

  const orderedDays: AppleCalendarDayColumn[] = React.useMemo(
    () =>
      ALL_DAYS.map(
        (dow) =>
          dayByDow.get(dow) ?? {
            day_of_week: dow,
            date: selectedDate,
            is_rest_day: false,
            occurrences: [],
          }
      ),
    [dayByDow, selectedDate]
  );

  const activeMobileDay =
    orderedDays.find((d) => d.date === selectedDate) ?? orderedDays[0];

  const totalHeightPx = (END_HOUR - START_HOUR) * HOUR_HEIGHT_PX;
  const nowOffsetPx =
    ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT_PX;
  const showNowLine =
    nowMinutes >= START_HOUR * 60 && nowMinutes <= END_HOUR * 60;

  const renderEventBlock = (occ: DailyTaskOccurrence) => {
    const startMin = Math.max(
      START_HOUR * 60,
      Math.min(END_HOUR * 60 - 15, timeToMinutes(occ.scheduled_time))
    );
    const topPx = ((startMin - START_HOUR * 60) / 60) * HOUR_HEIGHT_PX;
    const rawHeightPx = (Math.max(25, occ.duration_minutes) / 60) * HOUR_HEIGHT_PX;
    const heightPx = Math.max(36, Math.min(totalHeightPx - topPx, rawHeightPx));
    const isSelected = activeEvent?.id === occ.id;

    return (
      <button
        key={occ.id}
        type="button"
        onClick={() => setActiveEvent(occ)}
        style={{ top: `${topPx}px`, height: `${heightPx}px` }}
        aria-label={`${occ.scheduled_time} ${occ.title}`}
        className={cn(
          "absolute inset-x-1 rounded-md border text-left px-2 py-1 overflow-hidden transition-colors focus-visible:outline-2 focus-visible:outline-[#256B4A]",
          occ.status === "completed"
            ? "bg-[#EAF3EC] border-[#256B4A]/35 text-[#17241D] border-l-[3px] border-l-[#256B4A]"
            : occ.is_medically_prescribed
              ? "bg-[#FDF6F0] border-[#B86A32]/40 text-[#17241D] border-l-[3px] border-l-[#B86A32]"
              : "bg-[#FFFFFF] border-[#E3E9E3] text-[#17241D] border-l-[3px] border-l-[#256B4A] hover:bg-[#FAFBF9]",
          isSelected && "ring-2 ring-[#256B4A]"
        )}
      >
        <div className="flex items-center justify-between gap-1 text-[11px] font-semibold leading-tight">
          <span
            className={cn(
              occ.is_medically_prescribed && occ.status !== "completed"
                ? "text-[#B86A32]"
                : "text-[#256B4A]"
            )}
          >
            {occ.scheduled_time}
          </span>
          {occ.status === "completed" ? (
            <CheckCircle2 className="h-3 w-3 text-[#256B4A] shrink-0" />
          ) : occ.is_medically_prescribed ? (
            <Stethoscope className="h-3 w-3 text-[#B86A32] shrink-0" />
          ) : null}
        </div>
        <p className="text-xs font-medium leading-snug truncate mt-0.5">
          {occ.title}
        </p>
        {heightPx >= 54 && (
          <p className="text-[11px] text-[#66736B] truncate">
            {formatDuration(occ.duration_minutes)}
          </p>
        )}
      </button>
    );
  };

  return (
    <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] overflow-hidden">
      {/* Apple Calendar Style Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E3E9E3] bg-[#FAFBF9] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-[#17241D]">
            ปฏิทินกิจกรรมรายสัปดาห์ (Apple Calendar View)
          </h2>
          <p className="text-xs text-[#66736B]">
            คลิกที่กิจกรรมเพื่อดูรายละเอียด หรือส่งออกไฟล์ .ics เข้า Apple Calendar / Google Calendar (วนซ้ำทุก 7 วัน)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/calendar/ics?scope=week&date=${encodeURIComponent(weekStartDate)}`}
            download
            className="inline-flex items-center gap-1.5 rounded-md border border-[#256B4A] bg-[#256B4A] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1E583C] transition-colors"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            เพิ่มทั้งสัปดาห์ลง Apple Calendar (.ics)
          </a>
        </div>
      </div>

      {/* Desktop / Tablet 7-Column Apple Calendar Time Grid */}
      <div className="hidden md:block overflow-x-auto">
        <div className="min-w-[780px]">
          {/* Sticky Day Columns Header */}
          <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b border-[#E3E9E3] bg-[#FFFFFF]">
            <div className="px-2 py-2.5 text-[11px] font-medium text-[#66736B] text-right border-r border-[#E3E9E3]">
              GMT+7
            </div>
            {orderedDays.map((col) => {
              const isToday = col.date === todayStr;
              const isSelected = col.date === selectedDate;
              const dayNum = Number.parseInt(col.date.split("-")[2] ?? "1", 10);
              return (
                <button
                  key={col.day_of_week}
                  type="button"
                  onClick={() => onSelectDate(col.date)}
                  className={cn(
                    "px-2 py-2 text-center border-r last:border-r-0 border-[#E3E9E3] transition-colors",
                    isSelected ? "bg-[#EAF3EC]/60" : "hover:bg-[#FAFBF9]"
                  )}
                >
                  <div className="text-xs font-medium text-[#66736B]">
                    {THAI_DAY_NAMES[col.day_of_week].short}
                  </div>
                  <div className="mt-1 flex items-center justify-center">
                    <span
                      className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                        isToday
                          ? "bg-[#256B4A] text-white"
                          : isSelected
                            ? "bg-[#EAF3EC] text-[#256B4A]"
                            : "text-[#17241D]"
                      )}
                    >
                      {dayNum}
                    </span>
                  </div>
                  {col.is_rest_day && (
                    <div className="mt-1 text-[10px] font-medium text-[#B86A32]">
                      วันพักผ่อน
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Scrollable 06:00 - 22:00 Grid Body */}
          <div className="max-h-[560px] overflow-y-auto">
            <div
              className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] relative"
              style={{ height: `${totalHeightPx}px` }}
            >
              {/* Time Gutter (06:00 – 22:00) */}
              <div className="relative border-r border-[#E3E9E3] bg-[#FAFBF9]">
                {HOURS.map((hour, idx) => (
                  <div
                    key={hour}
                    style={{
                      top:
                        idx === HOURS.length - 1
                          ? `${totalHeightPx - 16}px`
                          : `${idx * HOUR_HEIGHT_PX}px`,
                    }}
                    className={cn(
                      "absolute inset-x-0 pr-2 text-right text-[11px] text-[#66736B]",
                      idx === 0 ? "pt-0.5" : idx === HOURS.length - 1 ? "" : "-mt-2"
                    )}
                  >
                    {`${String(hour).padStart(2, "0")}:00`}
                  </div>
                ))}
              </div>

              {/* 7 Day Columns */}
              {orderedDays.map((col) => (
                <div
                  key={col.day_of_week}
                  className={cn(
                    "relative border-r last:border-r-0 border-[#E3E9E3]",
                    col.is_rest_day ? "bg-[#FAFBF9]" : "bg-[#FFFFFF]"
                  )}
                >
                  {/* Hour horizontal guide lines */}
                  {HOURS.slice(0, -1).map((hour, idx) => (
                    <div
                      key={hour}
                      style={{
                        top: `${idx * HOUR_HEIGHT_PX}px`,
                        height: `${HOUR_HEIGHT_PX}px`,
                      }}
                      className="absolute inset-x-0 border-b border-[#E3E9E3]/70 pointer-events-none"
                    />
                  ))}

                  {/* Rest Day Overlay Note */}
                  {col.is_rest_day && (
                    <div className="absolute inset-x-1.5 top-3 rounded-md border border-dashed border-[#B86A32]/40 bg-[#FDF6F0] px-2 py-2 text-center text-[11px] text-[#B86A32]">
                      วันพักผ่อน
                      <div className="mt-0.5 text-[10px] text-[#66736B]">
                        ไม่ยกเลิกยาจำเป็น
                      </div>
                    </div>
                  )}

                  {/* Current Thailand Time Line on Today */}
                  {col.date === todayStr && showNowLine && (
                    <div
                      style={{ top: `${nowOffsetPx}px` }}
                      className="absolute inset-x-0 z-10 flex items-center pointer-events-none"
                    >
                      <span className="h-2 w-2 rounded-full bg-[#B86A32] -ml-1" />
                      <div className="h-[1.5px] flex-1 bg-[#B86A32]" />
                    </div>
                  )}

                  {/* Event Blocks */}
                  {!col.is_rest_day && col.occurrences.map(renderEventBlock)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Single-Day Apple Calendar Time Grid */}
      <div className="md:hidden">
        <div className="flex items-center justify-between border-b border-[#E3E9E3] bg-[#FFFFFF] px-3 py-2">
          <span className="text-sm font-semibold text-[#17241D]">
            {formatThaiDate(activeMobileDay.date)}
          </span>
          {activeMobileDay.is_rest_day ? (
            <Badge variant="warning">วันพักผ่อน</Badge>
          ) : (
            <span className="text-xs text-[#66736B]">
              {activeMobileDay.occurrences.length} กิจกรรม
            </span>
          )}
        </div>

        <div className="max-h-[460px] overflow-y-auto">
          <div
            className="grid grid-cols-[54px_1fr] relative"
            style={{ height: `${totalHeightPx}px` }}
          >
            <div className="relative border-r border-[#E3E9E3] bg-[#FAFBF9]">
              {HOURS.map((hour, idx) => (
                <div
                  key={hour}
                  style={{
                    top:
                      idx === HOURS.length - 1
                        ? `${totalHeightPx - 16}px`
                        : `${idx * HOUR_HEIGHT_PX}px`,
                  }}
                  className={cn(
                    "absolute inset-x-0 pr-1.5 text-right text-[11px] text-[#66736B]",
                    idx === 0 ? "pt-0.5" : idx === HOURS.length - 1 ? "" : "-mt-2"
                  )}
                >
                  {`${String(hour).padStart(2, "0")}:00`}
                </div>
              ))}
            </div>
            <div className="relative bg-[#FFFFFF]">
              {HOURS.slice(0, -1).map((hour, idx) => (
                <div
                  key={hour}
                  style={{
                    top: `${idx * HOUR_HEIGHT_PX}px`,
                    height: `${HOUR_HEIGHT_PX}px`,
                  }}
                  className="absolute inset-x-0 border-b border-[#E3E9E3]/70 pointer-events-none"
                />
              ))}
              {activeMobileDay.date === todayStr && showNowLine && (
                <div
                  style={{ top: `${nowOffsetPx}px` }}
                  className="absolute inset-x-0 z-10 flex items-center pointer-events-none"
                >
                  <span className="h-2 w-2 rounded-full bg-[#B86A32] -ml-1" />
                  <div className="h-[1.5px] flex-1 bg-[#B86A32]" />
                </div>
              )}
              {activeMobileDay.is_rest_day ? (
                <div className="m-3 rounded-md border border-dashed border-[#B86A32]/40 bg-[#FDF6F0] p-3 text-xs text-[#B86A32]">
                  วันนี้กำหนดเป็นวันพักผ่อน (ไม่ยกเลิกการดูแลทางการแพทย์ที่จำเป็น)
                </div>
              ) : (
                activeMobileDay.occurrences.map(renderEventBlock)
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Apple Calendar-Style Event Inspector Drawer/Card */}
      {activeEvent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="รายละเอียดกิจกรรมในปฏิทิน"
          className="border-t border-[#E3E9E3] bg-[#FAFBF9] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-[#17241D]">
                  {activeEvent.title}
                </h3>
                {activeEvent.status === "completed" ? (
                  <Badge variant="locked">
                    <Lock className="h-3 w-3 mr-1" />
                    เสร็จสิ้นและล็อกแล้ว
                  </Badge>
                ) : (
                  <Badge variant="neutral">ยังไม่เสร็จ</Badge>
                )}
                {activeEvent.is_medically_prescribed && (
                  <Badge variant="warning">สำคัญทางการแพทย์</Badge>
                )}
                <Badge variant="neutral">
                  {PRIORITY_META[activeEvent.priority].label}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#66736B]">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-[#256B4A]" />
                  {formatThaiDate(activeEvent.occurrence_date)} ·{" "}
                  {activeEvent.scheduled_time} –{" "}
                  {formatEndTime(
                    activeEvent.scheduled_time,
                    activeEvent.duration_minutes
                  )}{" "}
                  น. ({formatDuration(activeEvent.duration_minutes)})
                </span>
                <span className="inline-flex items-center gap-1">
                  <Repeat className="h-3.5 w-3.5 text-[#256B4A]" />
                  วนซ้ำทุก{THAI_DAY_NAMES[activeEvent.day_of_week].full}
                </span>
              </div>

              {activeEvent.description && (
                <p className="text-sm text-[#17241D] pt-1">
                  {activeEvent.description}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setActiveEvent(null)}
              aria-label="ปิดรายละเอียดกิจกรรม"
              className="rounded-md p-1 text-[#66736B] hover:bg-[#E3E9E3]/50 hover:text-[#17241D]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href={`/tasks/${activeEvent.id}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#256B4A] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1E583C]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {activeEvent.status === "completed"
                ? "ดูหลักฐานและประวัติ"
                : "เปิดเพื่อแนบรูปและยืนยันเสร็จสิ้น"}
            </Link>
            <a
              href={`/api/calendar/ics?occurrenceId=${encodeURIComponent(activeEvent.id)}&recurring=1`}
              download
              className="inline-flex items-center gap-1.5 rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-3 py-1.5 text-sm font-medium text-[#17241D] hover:bg-[#EAF3EC]"
            >
              <CalendarPlus className="h-3.5 w-3.5 text-[#256B4A]" />
              เพิ่มลง Apple Calendar (.ics)
            </a>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveEvent(null)}
            >
              ปิด
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
