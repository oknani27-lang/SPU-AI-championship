"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  cn,
  formatThaiDate,
  getBangkokToday,
  getWeekDates,
  getWeekMonday,
} from "@/lib/utils";
import type { DayOfWeek } from "@/types/careplan";

export interface SevenDaySelectorProps {
  selectedDate: string; // "YYYY-MM-DD"
  onSelectDate: (date: string) => void;
  restDays?: DayOfWeek[];
  showWeekToggle?: boolean;
  className?: string;
}

export function SevenDaySelector({
  selectedDate,
  onSelectDate,
  restDays = [],
  showWeekToggle = true,
  className,
}: SevenDaySelectorProps) {
  const today = React.useMemo(() => getBangkokToday(), []);
  const thisWeekMonday = React.useMemo(() => getWeekMonday(today), [today]);
  const nextWeekMonday = React.useMemo(
    () => addDays(thisWeekMonday, 7),
    [thisWeekMonday]
  );

  const activeMonday = React.useMemo(
    () => getWeekMonday(selectedDate),
    [selectedDate]
  );
  const weekDays = React.useMemo(
    () => getWeekDates(activeMonday),
    [activeMonday]
  );
  const weekEnd = weekDays[6]?.date ?? activeMonday;

  const isThisWeek = activeMonday === thisWeekMonday;
  const isNextWeek = activeMonday === nextWeekMonday;

  const shiftWeek = (deltaWeeks: number) => {
    onSelectDate(addDays(selectedDate, deltaWeeks * 7));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextDate = addDays(weekDays[idx].date, 1);
      onSelectDate(nextDate);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevDate = addDays(weekDays[idx].date, -1);
      onSelectDate(prevDate);
    } else if (e.key === "Home") {
      e.preventDefault();
      onSelectDate(weekDays[0].date);
    } else if (e.key === "End") {
      e.preventDefault();
      onSelectDate(weekDays[6].date);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-3 sm:p-4 space-y-3",
        className
      )}
    >
      {showWeekToggle && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => shiftWeek(-1)}
              aria-label="สัปดาห์ก่อนหน้า"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E3E9E3] bg-[#FFFFFF] text-[#17241D] hover:bg-[#F4F7F4]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => shiftWeek(1)}
              aria-label="สัปดาห์ถัดไป"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E3E9E3] bg-[#FFFFFF] text-[#17241D] hover:bg-[#F4F7F4]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="ml-1 text-sm font-medium text-[#17241D]">
              {formatThaiDate(activeMonday, { includeWeekday: false })} –{" "}
              {formatThaiDate(weekEnd, { includeWeekday: false })}
            </span>
          </div>

          <div className="inline-flex items-center rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => onSelectDate(today)}
              className={cn(
                "rounded px-2.5 py-1 font-medium transition-colors",
                isThisWeek
                  ? "bg-[#256B4A] text-white"
                  : "text-[#66736B] hover:text-[#17241D]"
              )}
            >
              สัปดาห์นี้
            </button>
            <button
              type="button"
              onClick={() => onSelectDate(addDays(today, 7))}
              className={cn(
                "rounded px-2.5 py-1 font-medium transition-colors",
                isNextWeek
                  ? "bg-[#256B4A] text-white"
                  : "text-[#66736B] hover:text-[#17241D]"
              )}
            >
              สัปดาห์ถัดไป (ซ้ำ 7 วัน)
            </button>
          </div>
        </div>
      )}

      {/* 7-day strip */}
      <div
        role="tablist"
        aria-label="เลือกวันในสัปดาห์"
        className="grid grid-cols-7 gap-1.5 sm:gap-2"
      >
        {weekDays.map((day, idx) => {
          const isSelected = day.date === selectedDate;
          const isToday = day.date === today;
          const isRest = restDays.includes(day.dayOfWeek);

          return (
            <button
              key={day.date}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={`${day.fullThai} ที่ ${day.dayNumber}${isRest ? " วันพัก" : ""}`}
              onClick={() => onSelectDate(day.date)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className={cn(
                "flex flex-col items-center justify-center rounded-md border py-2 px-1 transition-colors",
                isSelected
                  ? "border-[#256B4A] bg-[#256B4A] text-white"
                  : isRest
                    ? "border-[#E3E9E3] bg-[#FAFBF9] text-[#66736B] hover:border-[#C5DEC9]"
                    : "border-[#E3E9E3] bg-[#FFFFFF] text-[#17241D] hover:bg-[#EAF3EC]/60"
              )}
            >
              <span
                className={cn(
                  "text-xs font-medium",
                  isSelected ? "text-white/90" : "text-[#66736B]"
                )}
              >
                {day.shortThai}
              </span>
              <span className="mt-0.5 text-base sm:text-lg font-semibold leading-tight tabular-nums">
                {day.dayNumber}
              </span>
              <span className="mt-1 h-4 flex items-center justify-center">
                {isRest ? (
                  <span
                    className={cn(
                      "rounded px-1 text-[10px] font-medium leading-tight",
                      isSelected
                        ? "bg-white/20 text-white"
                        : "bg-[#FDF6F0] text-[#B86A32]"
                    )}
                  >
                    พัก
                  </span>
                ) : isToday ? (
                  <span
                    className={cn(
                      "text-[10px] font-medium leading-tight",
                      isSelected ? "text-white/90" : "text-[#256B4A]"
                    )}
                  >
                    วันนี้
                  </span>
                ) : (
                  <span className="h-1 w-1 rounded-full bg-transparent" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
