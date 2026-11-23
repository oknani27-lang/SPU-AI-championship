"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  generateDailySummary,
  getDailySummary,
  getOccurrencesByDate,
} from "@/lib/api-client";
import { formatThaiDate, PRIORITY_META, TONE_LABELS } from "@/lib/utils";
import type {
  DailySummaryMetrics,
  DailySummaryRecord,
  DailyTaskOccurrence,
} from "@/types/careplan";

export interface DailySummaryCardProps {
  date: string;
  compact?: boolean;
  refreshSignal?: number;
  onMetricsLoaded?: (metrics: DailySummaryMetrics) => void;
}

export function DailySummaryCard({
  date,
  compact = false,
  refreshSignal = 0,
  onMetricsLoaded,
}: DailySummaryCardProps) {
  const [summary, setSummary] = React.useState<DailySummaryRecord | null>(null);
  const [metrics, setMetrics] = React.useState<DailySummaryMetrics | null>(
    null
  );
  const [incompleteTasks, setIncompleteTasks] = React.useState<
    DailyTaskOccurrence[]
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadSummary = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, occRes] = await Promise.all([
        getDailySummary(date),
        getOccurrencesByDate(date),
      ]);
      setSummary(res.summary);
      setMetrics(res.metrics);
      setIncompleteTasks(
        (occRes.occurrences || []).filter((o) => o.status !== "completed")
      );
      onMetricsLoaded?.(res.metrics);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถโหลดสรุปประจำวันได้"
      );
    } finally {
      setLoading(false);
    }
  }, [date, onMetricsLoaded]);

  React.useEffect(() => {
    void loadSummary();
  }, [loadSummary, refreshSignal]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateDailySummary(date);
      setSummary(res.summary);
      setMetrics(res.summary.metrics);
      onMetricsLoaded?.(res.summary.metrics);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถสร้างสรุปประจำวันได้"
      );
    } finally {
      setGenerating(false);
    }
  };

  const activeMetrics = summary?.metrics ?? metrics;

  return (
    <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-semibold text-[#17241D] flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#256B4A]" />
            สรุปผลและกำลังใจประจำวัน
          </h3>
          <p className="text-xs text-[#66736B] mt-0.5">
            {formatThaiDate(date)}
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          loading={generating}
          onClick={handleGenerate}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {summary ? "สร้างข้อความใหม่" : "สร้างสรุปด้วย AI"}
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {loading && !activeMetrics ? (
        <div className="space-y-2.5 py-2">
          <div className="h-2.5 w-full rounded bg-[#EAF3EC] animate-pulse" />
          <div className="h-14 w-full rounded bg-[#FAFBF9] animate-pulse" />
        </div>
      ) : activeMetrics ? (
        <>
          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#66736B]">
                ความคืบหน้าที่ยืนยันแล้ว ({activeMetrics.completed_tasks}/
                {activeMetrics.total_tasks} งาน)
              </span>
              <span className="font-semibold text-[#256B4A] tabular-nums">
                {activeMetrics.progress_percent}%
              </span>
            </div>
            <div
              className="h-2 w-full rounded-full bg-[#EAF3EC] overflow-hidden"
              role="progressbar"
              aria-valuenow={activeMetrics.progress_percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-[#256B4A] transition-all duration-300"
                style={{ width: `${activeMetrics.progress_percent}%` }}
              />
            </div>
          </div>

          {/* Metrics Grid */}
          <div
            className={
              compact
                ? "grid grid-cols-3 gap-2 text-center"
                : "grid grid-cols-2 sm:grid-cols-5 gap-2 text-center"
            }
          >
            <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-2">
              <p className="text-[11px] text-[#66736B]">ทั้งหมด</p>
              <p className="text-base font-bold text-[#17241D] tabular-nums">
                {activeMetrics.total_tasks}
              </p>
            </div>
            <div className="rounded-md border border-[#CFE3D4] bg-[#EAF3EC]/60 p-2">
              <p className="text-[11px] text-[#1E583C]">เสร็จแล้ว</p>
              <p className="text-base font-bold text-[#256B4A] tabular-nums">
                {activeMetrics.completed_tasks}
              </p>
            </div>
            <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-2">
              <p className="text-[11px] text-[#66736B]">ยังไม่เสร็จ</p>
              <p className="text-base font-bold text-[#17241D] tabular-nums">
                {activeMetrics.incomplete_tasks}
              </p>
            </div>
            {!compact && (
              <>
                <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-2">
                  <p className="text-[11px] text-[#66736B]">ตรงเวลา</p>
                  <p className="text-base font-bold text-[#256B4A] tabular-nums">
                    {activeMetrics.on_time_completions}
                  </p>
                </div>
                <div className="rounded-md border border-[#EBCBB2] bg-[#FDF6F0] p-2">
                  <p className="text-[11px] text-[#B86A32]">ล่าช้า</p>
                  <p className="text-base font-bold text-[#B86A32] tabular-nums">
                    {activeMetrics.delayed_completions}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Encouraging Message */}
          {summary ? (
            <div className="rounded-md border border-[#CFE3D4] bg-[#EAF3EC]/55 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="sage">
                  <CheckCircle2 className="h-3 w-3" />
                  {TONE_LABELS[summary.tone_category]}
                </Badge>
                <span className="text-[11px] text-[#66736B]">
                  {summary.used_fallback
                    ? "โหมดสาธิต (Demo Mode — ไม่ได้เรียก Gemini API)"
                    : `สรุปโดย ${summary.ai_provider}`}
                </span>
              </div>
              <p
                className={`text-[15px] text-[#17241D] leading-relaxed ${expanded ? "" : "line-clamp-3"}`}
              >
                {summary.encouraging_message}
              </p>
              {summary.encouraging_message.length > 140 && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                  className="text-xs font-medium text-[#256B4A] hover:underline"
                >
                  {expanded ? "ย่อข้อความ" : "อ่านต่อ"}
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-3.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[#66736B]">
                ยังไม่ได้สร้างข้อความสรุปประจำวันสำหรับวันนี้
              </p>
              <Button
                size="sm"
                variant="secondary"
                loading={generating}
                onClick={handleGenerate}
              >
                สร้างสรุปประจำวัน
              </Button>
            </div>
          )}

          {/* Unfinished Tasks Highlight (if any) */}
          {!compact && incompleteTasks.length > 0 && (
            <div className="rounded-md border border-[#EBCBB2] bg-[#FDF6F0]/60 p-3.5 space-y-2">
              <p className="text-xs font-semibold text-[#7A441D] flex items-center gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 text-[#B86A32]" />
                รายการที่ยังไม่เสร็จในวันนี้ ({incompleteTasks.length} รายการ)
              </p>
              <div className="space-y-1.5">
                {incompleteTasks.map((task) => (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#EBCBB2]/70 bg-[#FFFFFF] px-3 py-2 text-xs hover:border-[#B86A32] transition-colors"
                  >
                    <span className="font-medium text-[#17241D]">
                      <span className="font-bold text-[#256B4A] tabular-nums mr-2">
                        {task.scheduled_time} น.
                      </span>
                      {task.title}
                    </span>
                    <Badge variant={PRIORITY_META[task.priority].badgeVariant}>
                      {PRIORITY_META[task.priority].label}
                    </Badge>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-[#66736B] flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[#256B4A] shrink-0" />
            ตัวเลขมาจากงานที่ยืนยันจริง — AI แก้ไขตัวเลขไม่ได้
          </p>
        </>
      ) : null}
    </section>
  );
}
