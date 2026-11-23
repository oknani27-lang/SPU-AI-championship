"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarPlus, Plus, Share2, Sun } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useSession } from "@/components/care/SessionContext";
import { TaskListRow } from "@/components/care/TaskListRow";
import { TextToTaskComposer } from "@/components/care/TextToTaskComposer";
import { AiScheduleReviewModal } from "@/components/care/AiScheduleReviewModal";
import { ShareScheduleDialog } from "@/components/share/ShareScheduleDialog";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { getOccurrencesByDate } from "@/lib/api-client";
import { formatThaiDate, getBangkokToday, getDayOfWeek } from "@/lib/utils";
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
  const today = React.useMemo(() => getBangkokToday(), []);

  const [occurrences, setOccurrences] = React.useState<DailyTaskOccurrence[]>([]);
  const [isRestDay, setIsRestDay] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [showComposer, setShowComposer] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [aiModal, setAiModal] = React.useState<{
    open: boolean;
    dayOfWeek: DayOfWeek;
    drafts: DraftTaskInput[];
  }>({ open: false, dayOfWeek: getDayOfWeek(today), drafts: [] });

  const loadToday = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getOccurrencesByDate(today);
      setOccurrences(
        [...(res.occurrences || [])].sort((a, b) =>
          a.scheduled_time.localeCompare(b.scheduled_time)
        )
      );
      setIsRestDay(Boolean(res.is_rest_day));
    } catch (err) {
      setError(err instanceof Error ? err.message : "ไม่สามารถโหลดรายการวันนี้ได้");
    } finally {
      setLoading(false);
    }
  }, [today]);

  React.useEffect(() => {
    void loadToday();
  }, [loadToday, demoVersion]);

  const total = occurrences.length;
  const done = occurrences.filter((o) => o.status === "completed").length;
  const remaining = total - done;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const recipientName = session?.care_recipient?.display_name || "ผู้รับการดูแล";

  const afterSave = () => {
    setShowComposer(false);
    void loadToday();
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header: date, headline, 2 primary actions */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-[#66736B]">{formatThaiDate(today)}</p>
          <h1 className="mt-0.5 text-2xl sm:text-[28px] font-bold leading-tight text-[#17241D]">
            {loading
              ? "กำลังโหลด…"
              : isRestDay
                ? "วันนี้เป็นวันพัก"
                : `วันนี้มี ${total} งาน`}
          </h1>
        </div>
        <div className="no-print flex items-center gap-2">
          <Button variant="outline" onClick={() => setShareOpen(true)}>
            <Share2 className="h-4 w-4" />
            แชร์ตาราง
          </Button>
          <Button
            variant="primary"
            aria-expanded={showComposer}
            onClick={() => setShowComposer((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            เพิ่มงาน
          </Button>
        </div>
      </header>

      {/* Progress */}
      {!loading && !error && !isRestDay && total > 0 && (
        <section aria-label="ความคืบหน้าวันนี้" className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#17241D]">
              {remaining === 0 ? (
                <span className="font-medium text-[#256B4A]">ครบทุกงานแล้ว</span>
              ) : (
                <>
                  เหลืออีก <strong className="text-[#B86A32]">{remaining}</strong> งาน
                </>
              )}
            </span>
            <span className="tabular-nums text-[#66736B]">
              {done}/{total} · {percent}%
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-[#EAF3EC]"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-[#256B4A] transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
        </section>
      )}

      {/* Add task (text-to-task) */}
      {showComposer && (
        <div className="no-print">
          <TextToTaskComposer
            compact
            defaultDayOfWeek={getDayOfWeek(today)}
            onSendToAiSchedule={(dayOfWeek, drafts) =>
              setAiModal({ open: true, dayOfWeek, drafts })
            }
            onSavedDirectly={afterSave}
          />
        </div>
      )}

      {/* Task list */}
      <section
        aria-label="รายการงานวันนี้"
        className="overflow-hidden rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] print-card"
      >
        {error ? (
          <div className="p-4">
            <Alert variant="error" title="โหลดรายการไม่สำเร็จ">
              <p>{error}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void loadToday()}
              >
                ลองใหม่
              </Button>
            </Alert>
          </div>
        ) : loading ? (
          <div className="divide-y divide-[#E3E9E3]">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-4">
                <div className="h-5 w-5 animate-pulse rounded-full bg-[#EAF3EC]" />
                <div className="h-4 w-12 animate-pulse rounded bg-[#F0F4F1]" />
                <div className="h-4 flex-1 animate-pulse rounded bg-[#F0F4F1]" />
              </div>
            ))}
          </div>
        ) : isRestDay ? (
          <div className="space-y-2 p-8 text-center">
            <Sun className="mx-auto h-7 w-7 text-[#B86A32]" aria-hidden="true" />
            <p className="font-medium text-[#17241D]">ไม่มีงานในตารางวันนี้</p>
            <p className="text-sm text-[#66736B]">
              ยาหรือการดูแลตามคำสั่งแพทย์ยังต้องทำตามปกติ
            </p>
            <Link
              href="/schedule"
              className="inline-block pt-1 text-sm font-medium text-[#256B4A] hover:underline"
            >
              ตั้งค่าวันพัก
            </Link>
          </div>
        ) : total === 0 ? (
          <div className="space-y-2 p-8 text-center">
            <CalendarPlus className="mx-auto h-7 w-7 text-[#66736B]" aria-hidden="true" />
            <p className="font-medium text-[#17241D]">ยังไม่มีงานวันนี้</p>
            <div className="flex justify-center gap-2 pt-1">
              <Button size="sm" variant="primary" onClick={() => setShowComposer(true)}>
                <Plus className="h-4 w-4" />
                เพิ่มงาน
              </Button>
              <Link
                href="/schedule"
                className="inline-flex h-8 items-center rounded-md border border-[#E3E9E3] px-3 text-sm font-medium text-[#17241D] hover:bg-[#F4F7F4]"
              >
                ไปที่ตาราง 7 วัน
              </Link>
            </div>
          </div>
        ) : (
          <div role="list">
            {occurrences.map((occ) => (
              <TaskListRow key={occ.id} occurrence={occ} />
            ))}
          </div>
        )}
      </section>

      <AiScheduleReviewModal
        open={aiModal.open}
        onClose={() => setAiModal((prev) => ({ ...prev, open: false }))}
        dayOfWeek={aiModal.dayOfWeek}
        draftTasks={aiModal.drafts}
        onApproved={afterSave}
      />

      <ShareScheduleDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        defaultDate={today}
        defaultScope="week"
        careRecipientName={recipientName}
      />
    </div>
  );
}
