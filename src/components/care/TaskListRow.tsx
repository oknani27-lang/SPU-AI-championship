"use client";

import Link from "next/link";
import { CheckCircle2, ChevronRight, Circle, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DailyTaskOccurrence } from "@/types/careplan";

// Row: [Status Icon] [Time] [Task Name] [Status] [Arrow] — opens the task page (photo proof lives there)
export function TaskListRow({ occurrence }: { occurrence: DailyTaskOccurrence }) {
  const done = occurrence.status === "completed";

  return (
    <Link
      href={`/tasks/${occurrence.id}`}
      role="listitem"
      aria-label={`${occurrence.scheduled_time} ${occurrence.title} — ${done ? "เสร็จแล้ว" : "ยังไม่เสร็จ"}`}
      className="group flex items-center gap-3 px-4 py-3.5 border-b border-[#E3E9E3] last:border-b-0 hover:bg-[#FAFBF9] transition-colors"
    >
      {done ? (
        <CheckCircle2 className="h-5 w-5 shrink-0 text-[#256B4A]" aria-hidden="true" />
      ) : (
        <Circle className="h-5 w-5 shrink-0 text-[#A7B5AC] group-hover:text-[#256B4A]" aria-hidden="true" />
      )}

      <span
        className={cn(
          "w-12 shrink-0 text-[15px] font-semibold tabular-nums",
          done ? "text-[#66736B]" : "text-[#17241D]"
        )}
      >
        {occurrence.scheduled_time}
      </span>

      <span className="min-w-0 flex-1 flex items-center gap-1.5">
        <span
          className={cn(
            "truncate text-[15px] sm:text-base",
            done ? "text-[#66736B] line-through" : "text-[#17241D] font-medium"
          )}
        >
          {occurrence.title}
        </span>
        {occurrence.is_medically_prescribed && (
          <Stethoscope
            className="h-3.5 w-3.5 shrink-0 text-[#B86A32]"
            aria-label="สำคัญทางการแพทย์"
          />
        )}
      </span>

      <span
        className={cn(
          "hidden sm:inline text-xs font-medium shrink-0",
          done ? "text-[#256B4A]" : "text-[#66736B]"
        )}
      >
        {done ? (occurrence.is_delayed ? "เสร็จ (ล่าช้า)" : "เสร็จแล้ว") : "รอทำ"}
      </span>

      <ChevronRight className="h-4 w-4 shrink-0 text-[#A7B5AC] group-hover:text-[#256B4A]" aria-hidden="true" />
    </Link>
  );
}
