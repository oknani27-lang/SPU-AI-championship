"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarPlus,
  CalendarRange,
  CheckCircle2,
  Clock,
  Lock,
  Plus,
  Share2,
  Stethoscope,
  Sun,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useSession } from "@/components/care/SessionContext";
import { SevenDaySelector } from "@/components/care/SevenDaySelector";
import { TaskListRow } from "@/components/care/TaskListRow";
import { PhotoProofUploader } from "@/components/care/PhotoProofUploader";
import { TextToTaskComposer } from "@/components/care/TextToTaskComposer";
import { AiScheduleReviewModal } from "@/components/care/AiScheduleReviewModal";
import { DailySummaryCard } from "@/components/care/DailySummaryCard";
import { RestSuggestionsPanel } from "@/components/care/RestSuggestionsPanel";
import { ShareScheduleDialog } from "@/components/share/ShareScheduleDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { getOccurrencesByDate } from "@/lib/api-client";
import {
  formatDuration,
  formatThaiDate,
  getBangkokToday,
  getDayOfWeek,
} from "@/lib/utils";
import type {
  DailyTaskOccurrence,
  DayOfWeek,
  DraftTaskInput,
} from "@/types/careplan";

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardContent />
    </AppShell>
  );
}

function DashboardContent() {
  const { session, demoVersion } = useSession();
  const [selectedDate, setSelectedDate] = React.useState(() =>
    getBangkokToday()
  );

  const [occurrences, setOccurrences] = React.useState<DailyTaskOccurrence[]>(
    []
  );
  const [isRestDay, setIsRestDay] = React.useState(false);
  const [nextTask, setNextTask] = React.useState<DailyTaskOccurrence | null>(
    null
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [nextDependentBanner, setNextDependentBanner] =
    React.useState<DailyTaskOccurrence | null>(null);
  const [refreshSignal, setRefreshSignal] = React.useState(0);

  // Quick Add & Share Dialogs
  const [showQuickText, setShowQuickText] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [aiModalState, setAiModalState] = React.useState<{
    open: boolean;
    dayOfWeek: DayOfWeek;
    drafts: DraftTaskInput[];
  }>({
    open: false,
    dayOfWeek: getDayOfWeek(getBangkokToday()),
    drafts: [],
  });

  const loadDay = React.useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOccurrencesByDate(date);
      const sorted = [...(res.occurrences || [])].sort((a, b) =>
        a.scheduled_time.localeCompare(b.scheduled_time)
      );
      setOccurrences(sorted);
      setIsRestDay(Boolean(res.is_rest_day));
      setNextTask(res.next_task ?? null);

      setSelectedId((prev) => {
        if (prev && sorted.some((o) => o.id === prev)) return prev;
        const firstIncomplete = sorted.find((o) => o.status === "incomplete");
        return firstIncomplete?.id ?? sorted[0]?.id ?? null;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถโหลดรายการดูแลได้"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    setNextDependentBanner(null);
    void loadDay(selectedDate);
  }, [selectedDate, demoVersion, loadDay]);

  const selectedOccurrence = React.useMemo(
    () => occurrences.find((o) => o.id === selectedId) ?? null,
    [occurrences, selectedId]
  );

  const completedCount = occurrences.filter(
    (o) => o.status === "completed"
  ).length;
  const totalCount = occurrences.length;
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const restDays = session?.weekly_schedule?.rest_days ?? [];
  const caregiverName = session?.user?.full_name || "ผู้ดูแล";
  const recipientName = session?.care_recipient?.display_name || "ผู้รับการดูแล";

  return (
    <div className="space-y-5">
      {/* Greeting Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-[#66736B]">
            {formatThaiDate(selectedDate)}
          </p>
          <h1 className="text-2xl font-bold text-[#17241D] leading-snug mt-0.5">
            สวัสดีคุณ{caregiverName} — แผนดูแล{recipientName}
          </h1>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowQuickText((prev) => !prev)}
          >
            <Plus className="h-4 w-4" />
            เพิ่มงานจากข้อความ
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShareOpen(true)}
          >
            <Share2 className="h-4 w-4" />
            แชร์ตาราง (LINE / ลิงก์ / PNG)
          </Button>

          <Link
            href="/schedule"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#256B4A] bg-[#256B4A] px-3 text-sm font-medium text-white hover:bg-[#1E583C] transition-colors"
          >
            <CalendarRange className="h-4 w-4" />
            จัดการตารางสัปดาห์
          </Link>
        </div>
      </div>

      {/* 7-Day Selector */}
      <SevenDaySelector
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        restDays={restDays}
      />

      {/* Quick Typed Text-to-Task Panel (Collapsible) */}
      {showQuickText && (
        <div className="no-print">
          <TextToTaskComposer
            compact
            defaultDayOfWeek={getDayOfWeek(selectedDate)}
            onSendToAiSchedule={(dayOfWeek, drafts) => {
              setAiModalState({ open: true, dayOfWeek, drafts });
            }}
            onSavedDirectly={() => {
              setShowQuickText(false);
              void loadDay(selectedDate);
              setRefreshSignal((s) => s + 1);
            }}
          />
        </div>
      )}

      {/* Next Dependent Task Notification Banner */}
      {nextDependentBanner && (
        <Alert variant="success" title="งานถัดไปที่ต่อเนื่องพร้อมเริ่มดำเนินการแล้ว">
          <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
            <p className="text-sm text-[#17241D]">
              <strong>
                {nextDependentBanner.scheduled_time} น. —{" "}
                {nextDependentBanner.title}
              </strong>{" "}
              ({formatDuration(nextDependentBanner.duration_minutes)})
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => setSelectedId(nextDependentBanner.id)}
              >
                เปิดดูงานนี้
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
              <Link
                href={`/tasks/${nextDependentBanner.id}`}
                className="text-xs font-medium text-[#256B4A] underline"
              >
                หน้าเต็ม
              </Link>
            </div>
          </div>
        </Alert>
      )}

      {/* Main Dominant 2-Column Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT (Visually Dominant): Task List */}
        <section className="lg:col-span-7 space-y-4">
          <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] overflow-hidden print-card">
            {/* Task List Header + Compact Progress Bar */}
            <div className="border-b border-[#E3E9E3] px-4 py-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-[17px] font-semibold text-[#17241D]">
                    รายการดูแลประจำวัน
                  </h2>
                  {!isRestDay && (
                    <Badge variant={completedCount === totalCount && totalCount > 0 ? "sage" : "neutral"}>
                      {completedCount}/{totalCount} เสร็จแล้ว
                    </Badge>
                  )}
                </div>

                {nextTask && !isRestDay && (
                  <span className="text-xs text-[#256B4A] font-medium inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    งานถัดไป: {nextTask.scheduled_time} น.
                  </span>
                )}
              </div>

              {!isRestDay && totalCount > 0 && (
                <div className="space-y-1">
                  <div
                    className="h-1.5 w-full rounded-full bg-[#EAF3EC] overflow-hidden"
                    role="progressbar"
                    aria-valuenow={progressPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full bg-[#256B4A] transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Body States: Error / Loading / Rest Day / Empty / Task List */}
            {error ? (
              <div className="p-4">
                <Alert variant="error" title="โหลดรายการไม่สำเร็จ">
                  <p>{error}</p>
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void loadDay(selectedDate)}
                    >
                      ลองโหลดใหม่
                    </Button>
                  </div>
                </Alert>
              </div>
            ) : loading ? (
              <div className="divide-y divide-[#E3E9E3]">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="px-4 py-4 flex items-center gap-3">
                    <div className="h-5 w-5 rounded-full bg-[#EAF3EC] animate-pulse" />
                    <div className="h-4 w-12 rounded bg-[#F0F4F1] animate-pulse" />
                    <div className="h-4 flex-1 rounded bg-[#F0F4F1] animate-pulse" />
                  </div>
                ))}
              </div>
            ) : isRestDay ? (
              <div className="p-6 text-center space-y-3">
                <div className="mx-auto h-11 w-11 rounded-md bg-[#FDF6F0] text-[#B86A32] flex items-center justify-center">
                  <Sun className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-[#17241D]">
                    วันนี้ถูกตั้งเป็นวันพักของตาราง
                  </h3>
                  <p className="text-sm text-[#66736B] max-w-md mx-auto">
                    วันพักหมายถึงไม่มีรายการนัดหมายในแอปสำหรับวันนี้
                    แต่จะไม่ยกเลิกการดูแลที่จำเป็นทางการแพทย์โดยอัตโนมัติ
                  </p>
                </div>
                <div className="pt-1">
                  <Link
                    href="/schedule"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-3.5 text-sm font-medium text-[#17241D] hover:bg-[#F4F7F4]"
                  >
                    ปรับการตั้งค่าวันพักที่หน้าตารางสัปดาห์
                  </Link>
                </div>
              </div>
            ) : occurrences.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <CalendarPlus className="h-8 w-8 mx-auto text-[#66736B]" />
                <div className="space-y-1">
                  <h3 className="text-base font-semibold text-[#17241D]">
                    ยังไม่มีรายการดูแลสำหรับวันนี้
                  </h3>
                  <p className="text-sm text-[#66736B]">
                    คุณสามารถพิมพ์ข้อความเพื่อเพิ่มงานอย่างรวดเร็ว หรือให้ AI ช่วยจัดตารางรายสัปดาห์ได้
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setShowQuickText(true)}
                  >
                    <Plus className="h-4 w-4" />
                    พิมพ์เพิ่มงานทันที
                  </Button>
                  <Link
                    href="/schedule"
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#256B4A] bg-[#256B4A] px-3 text-sm font-medium text-white hover:bg-[#1E583C]"
                  >
                    ไปที่หน้าจัดตารางสัปดาห์
                  </Link>
                </div>
              </div>
            ) : (
              <div role="list" aria-label="รายการงานดูแลประจำวัน">
                {occurrences.map((occ) => (
                  <TaskListRow
                    key={occ.id}
                    occurrence={occ}
                    selected={occ.id === selectedId}
                    onSelect={(item) => setSelectedId(item.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Rest Suggestions below task list on desktop for spacious scanning */}
          <div className="no-print">
            <RestSuggestionsPanel
              date={selectedDate}
              refreshSignal={refreshSignal}
            />
          </div>
        </section>

        {/* RIGHT: Selected Task Inspector + Daily Summary */}
        <aside className="lg:col-span-5 space-y-4">
          {/* Selected Task Details Panel */}
          {selectedOccurrence && !isRestDay && (
            <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-[#256B4A] tabular-nums">
                      {selectedOccurrence.scheduled_time} น.
                    </span>
                    <span className="text-xs text-[#66736B]">
                      · {formatDuration(selectedOccurrence.duration_minutes)}
                    </span>
                    {selectedOccurrence.is_medically_prescribed && (
                      <Badge variant="warning">
                        <Stethoscope className="h-3 w-3" />
                        สำคัญทางการแพทย์
                      </Badge>
                    )}
                  </div>
                  <h2 className="text-lg font-bold text-[#17241D] leading-snug">
                    {selectedOccurrence.title}
                  </h2>
                </div>

                <Link
                  href={`/tasks/${selectedOccurrence.id}`}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md border border-[#E3E9E3] bg-[#FAFBF9] px-2.5 py-1.5 text-xs font-medium text-[#17241D] hover:bg-[#EAF3EC] hover:text-[#256B4A]"
                >
                  รายละเอียดเต็ม
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {selectedOccurrence.description && (
                <p className="text-sm text-[#66736B] leading-relaxed rounded-md bg-[#FAFBF9] border border-[#E3E9E3] px-3 py-2">
                  {selectedOccurrence.description}
                </p>
              )}

              {/* Active No-Edit Rule Reminder */}
              {selectedOccurrence.status === "incomplete" ? (
                <p className="text-xs text-[#66736B] flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-[#66736B] shrink-0" />
                  งานที่กำลังดำเนินอยู่ไม่สามารถแก้ไขหรือลบได้
                  หากต้องการปรับเวลาสำหรับสัปดาห์ถัดไป กรุณายืนยันงานนี้ให้เสร็จสิ้นก่อน
                </p>
              ) : (
                <p className="text-xs text-[#256B4A] flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  ยืนยันเสร็จสิ้นแล้ว — สามารถเข้าไปแก้ไขเทมเพลตสำหรับสัปดาห์ถัดไปได้ในหน้า{" "}
                  <Link
                    href={`/tasks/${selectedOccurrence.id}`}
                    className="underline"
                  >
                    รายละเอียดงาน
                  </Link>
                </p>
              )}

              {/* Photo Proof + Confirm Completion */}
              <PhotoProofUploader
                occurrence={selectedOccurrence}
                onUpdated={({ occurrence, nextDependent }) => {
                  setOccurrences((prev) =>
                    prev.map((item) =>
                      item.id === occurrence.id ? occurrence : item
                    )
                  );
                  if (nextDependent) {
                    setNextDependentBanner(nextDependent);
                  }
                  setRefreshSignal((s) => s + 1);
                }}
              />
            </div>
          )}

          {/* Compact Daily Summary */}
          <div className="no-print">
            <DailySummaryCard
              date={selectedDate}
              compact
              refreshSignal={refreshSignal}
            />
          </div>
        </aside>
      </div>

      {/* AI Schedule Review Modal (when launched from Quick Text-to-Task) */}
      <AiScheduleReviewModal
        open={aiModalState.open}
        onClose={() =>
          setAiModalState((prev) => ({ ...prev, open: false }))
        }
        dayOfWeek={aiModalState.dayOfWeek}
        draftTasks={aiModalState.drafts}
        onApproved={() => {
          setShowQuickText(false);
          void loadDay(selectedDate);
          setRefreshSignal((s) => s + 1);
        }}
      />

      {/* Family Share Dialog */}
      <ShareScheduleDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        defaultDate={selectedDate}
        defaultScope="week"
        careRecipientName={recipientName}
      />
    </div>
  );
}
