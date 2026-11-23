"use client";

import * as React from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  FileBarChart2,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { DailySummaryCard } from "@/components/care/DailySummaryCard";
import { RestSuggestionsPanel } from "@/components/care/RestSuggestionsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, formatThaiDate, getBangkokToday } from "@/lib/utils";
import type { DailySummaryMetrics } from "@/types/careplan";

export default function SummaryPage() {
  return (
    <AppShell>
      <SummaryContent />
    </AppShell>
  );
}

function SummaryContent() {
  const today = React.useMemo(() => getBangkokToday(), []);
  const [selectedDate, setSelectedDate] = React.useState(today);
  const [metrics, setMetrics] = React.useState<DailySummaryMetrics | null>(
    null
  );

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header + Date Selector */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#17241D] flex items-center gap-2">
            <FileBarChart2 className="h-6 w-6 text-[#256B4A]" />
            สรุปผลประจำวันและคำแนะนำการพักผ่อน
          </h1>
          <p className="text-sm text-[#66736B] mt-0.5">
            ติดตามภาพรวมการดูแลจากข้อมูลที่ยืนยันจริง พร้อมข้อความให้กำลังใจและช่วงเวลาพักที่เหมาะสม
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="icon"
            variant="outline"
            aria-label="วันก่อนหน้า"
            onClick={() => setSelectedDate((d) => addDays(d, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="relative">
            <Input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                if (e.target.value) setSelectedDate(e.target.value);
              }}
              aria-label="เลือกวันที่สำหรับดูสรุปประจำวัน"
              className="w-40 h-9"
            />
          </div>
          <Button
            size="icon"
            variant="outline"
            aria-label="วันถัดไป"
            onClick={() => setSelectedDate((d) => addDays(d, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {selectedDate !== today && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSelectedDate(today)}
            >
              วันนี้
            </Button>
          )}
        </div>
      </div>

      {/* Selected Date Banner */}
      <div className="inline-flex items-center gap-2 rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-3 py-1.5 text-sm font-medium text-[#17241D]">
        <Calendar className="h-4 w-4 text-[#256B4A]" />
        {formatThaiDate(selectedDate)}
      </div>

      {/* Verified Metric Highlight Strip */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-3.5">
            <p className="text-xs text-[#66736B]">งานทั้งหมด</p>
            <p className="text-2xl font-bold text-[#17241D] tabular-nums mt-1">
              {metrics.total_tasks}
            </p>
          </div>
          <div className="rounded-lg border border-[#CFE3D4] bg-[#EAF3EC]/55 p-3.5">
            <p className="text-xs text-[#1E583C]">ยืนยันเสร็จแล้ว</p>
            <p className="text-2xl font-bold text-[#256B4A] tabular-nums mt-1">
              {metrics.completed_tasks}
            </p>
          </div>
          <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-3.5">
            <p className="text-xs text-[#66736B]">ยังไม่เสร็จ</p>
            <p className="text-2xl font-bold text-[#17241D] tabular-nums mt-1">
              {metrics.incomplete_tasks}
            </p>
          </div>
          <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-3.5">
            <p className="text-xs text-[#66736B]">เสร็จตรงเวลา</p>
            <p className="text-2xl font-bold text-[#256B4A] tabular-nums mt-1">
              {metrics.on_time_completions}
            </p>
          </div>
          <div className="rounded-lg border border-[#EBCBB2] bg-[#FDF6F0] p-3.5">
            <p className="text-xs text-[#B86A32]">เสร็จล่าช้า</p>
            <p className="text-2xl font-bold text-[#B86A32] tabular-nums mt-1">
              {metrics.delayed_completions}
            </p>
          </div>
        </div>
      )}

      {/* Full Daily Summary Card */}
      <DailySummaryCard date={selectedDate} onMetricsLoaded={setMetrics} />

      {/* Rest Suggestions Panel */}
      <RestSuggestionsPanel date={selectedDate} />
    </div>
  );
}
