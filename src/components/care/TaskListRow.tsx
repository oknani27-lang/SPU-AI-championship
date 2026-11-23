"use client";

import * as React from "react";
import Link from "next/link";
import {
  Camera,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Lock,
  Stethoscope,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatDuration, PRIORITY_META } from "@/lib/utils";
import type { DailyTaskOccurrence } from "@/types/careplan";

export interface TaskListRowProps {
  occurrence: DailyTaskOccurrence;
  selected?: boolean;
  onSelect?: (occurrence: DailyTaskOccurrence) => void;
  showDetailLink?: boolean;
}

export function TaskListRow({
  occurrence,
  selected = false,
  onSelect,
  showDetailLink = true,
}: TaskListRowProps) {
  const isCompleted = occurrence.status === "completed";
  const priorityMeta = PRIORITY_META[occurrence.priority];

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onSelect) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(occurrence);
    }
  };

  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect ? () => onSelect(occurrence) : undefined}
      onKeyDown={handleRowKeyDown}
      aria-pressed={onSelect ? selected : undefined}
      className={cn(
        "group flex items-start gap-3 px-4 py-3.5 transition-colors border-b border-[#E3E9E3] last:border-b-0",
        onSelect && "cursor-pointer",
        selected
          ? "bg-[#EAF3EC]/70"
          : isCompleted
            ? "bg-[#FAFBF9]/80 hover:bg-[#F2F6F3]"
            : "bg-[#FFFFFF] hover:bg-[#FAFBF9]"
      )}
    >
      {/* Status icon */}
      <div className="pt-0.5 shrink-0" aria-hidden="true">
        {isCompleted ? (
          <CheckCircle2 className="h-5 w-5 text-[#256B4A]" />
        ) : (
          <Circle className="h-5 w-5 text-[#A7B5AC] group-hover:text-[#256B4A]" />
        )}
      </div>

      {/* Scheduled Time */}
      <div className="w-14 shrink-0 pt-0.5">
        <span
          className={cn(
            "font-semibold tabular-nums text-[15px]",
            isCompleted ? "text-[#66736B]" : "text-[#17241D]"
          )}
        >
          {occurrence.scheduled_time}
        </span>
      </div>

      {/* Main Content */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p
            className={cn(
              "text-[16px] font-medium leading-snug break-words",
              isCompleted
                ? "line-through text-[#66736B]"
                : "text-[#17241D]"
            )}
          >
            {occurrence.title}
          </p>

          {occurrence.is_medically_prescribed && (
            <Badge variant="warning">
              <Stethoscope className="h-3 w-3" />
              สำคัญทางการแพทย์
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#66736B]">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatDuration(occurrence.duration_minutes)}
          </span>

          {!occurrence.is_medically_prescribed && occurrence.priority !== "medium" && (
            <Badge variant={priorityMeta.badgeVariant} className="text-[11px] py-0">
              {priorityMeta.label}
            </Badge>
          )}

          {occurrence.evidence.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[#256B4A] font-medium">
              <Camera className="h-3.5 w-3.5" />
              แนบรูปแล้ว {occurrence.evidence.length} รูป
            </span>
          )}

          {isCompleted ? (
            <span className="inline-flex items-center gap-1 text-[#256B4A] font-medium">
              <Lock className="h-3 w-3" />
              เสร็จสิ้นและล็อกแล้ว
              {occurrence.is_delayed ? " (ล่าช้า)" : " (ตรงเวลา)"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[#66736B]">
              <Lock className="h-3 w-3" />
              ยังไม่เสร็จ · ห้ามแก้ไขระหว่างดำเนินการ
            </span>
          )}
        </div>
      </div>

      {/* Right Action / Status */}
      <div className="flex items-center gap-2 shrink-0 pt-0.5">
        <Badge
          variant={isCompleted ? "locked" : "neutral"}
          className="hidden sm:inline-flex"
        >
          {isCompleted ? "เสร็จสิ้น" : "ยังไม่เสร็จ"}
        </Badge>

        {showDetailLink && (
          <Link
            href={`/tasks/${occurrence.id}`}
            onClick={(e) => e.stopPropagation()}
            aria-label={`ดูรายละเอียดงาน ${occurrence.title}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#66736B] hover:bg-[#EAF3EC] hover:text-[#256B4A]"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
