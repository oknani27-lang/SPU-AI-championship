"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { DailySummaryCard } from "@/components/care/DailySummaryCard";
import { RestSuggestionsPanel } from "@/components/care/RestSuggestionsPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, formatThaiDate, getBangkokToday } from "@/lib/utils";

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

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header + Date Selector */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-[#66736B]">{formatThaiDate(selectedDate)}</p>
          <h1 className="mt-0.5 text-2xl font-bold text-[#17241D]">สรุปผลประจำวัน</h1>
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

      <DailySummaryCard date={selectedDate} />

      <RestSuggestionsPanel date={selectedDate} />
    </div>
  );
}
