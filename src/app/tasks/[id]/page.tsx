"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  History,
  Lock,
  Stethoscope,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PhotoProofUploader } from "@/components/care/PhotoProofUploader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  getOccurrenceDetail,
  updateTemplateForFuture,
} from "@/lib/api-client";
import {
  formatDuration,
  formatThaiDate,
  formatThaiDateTime,
  getNextOccurrenceDateForWeekday,
  HISTORY_EVENT_LABELS,
  PRIORITY_META,
} from "@/lib/utils";
import type {
  DailyTaskOccurrence,
  TaskHistoryEntry,
  TaskPriority,
} from "@/types/careplan";

export default function TaskDetailsPage() {
  return (
    <AppShell>
      <TaskDetailsContent />
    </AppShell>
  );
}

function TaskDetailsContent() {
  const params = useParams<{ id: string }>();
  const occurrenceId = params?.id;

  const [occurrence, setOccurrence] =
    React.useState<DailyTaskOccurrence | null>(null);
  const [history, setHistory] = React.useState<TaskHistoryEntry[]>([]);
  const [nextDependent, setNextDependent] =
    React.useState<DailyTaskOccurrence | null>(null);

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Future-week template edit state
  const [futureTitle, setFutureTitle] = React.useState("");
  const [futureTime, setFutureTime] = React.useState("09:00");
  const [futureDuration, setFutureDuration] = React.useState(30);
  const [futurePriority, setFuturePriority] =
    React.useState<TaskPriority>("medium");
  const [futureDescription, setFutureDescription] = React.useState("");
  const [futureEffectiveDate, setFutureEffectiveDate] = React.useState("");
  const [savingFuture, setSavingFuture] = React.useState(false);
  const [futureError, setFutureError] = React.useState<string | null>(null);
  const [futureSuccess, setFutureSuccess] = React.useState<string | null>(null);

  const loadDetail = React.useCallback(async () => {
    if (!occurrenceId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getOccurrenceDetail(occurrenceId);
      setOccurrence(res.occurrence);
      setHistory(res.history || []);
      setNextDependent(res.next_dependent ?? null);

      // Initialize future template form from current occurrence
      setFutureTitle(res.occurrence.title);
      setFutureTime(res.occurrence.scheduled_time);
      setFutureDuration(res.occurrence.duration_minutes);
      setFuturePriority(res.occurrence.priority);
      setFutureDescription(res.occurrence.description || "");
      setFutureEffectiveDate(
        getNextOccurrenceDateForWeekday(
          res.occurrence.day_of_week,
          res.occurrence.occurrence_date
        )
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถโหลดรายละเอียดงานได้"
      );
    } finally {
      setLoading(false);
    }
  }, [occurrenceId]);

  React.useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleSaveFutureTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!occurrence) return;
    setSavingFuture(true);
    setFutureError(null);
    setFutureSuccess(null);
    try {
      const res = await updateTemplateForFuture(occurrence.template_id, {
        title: futureTitle.trim(),
        description: futureDescription.trim(),
        scheduled_time: futureTime,
        duration_minutes: Math.max(5, Number(futureDuration) || 30),
        priority: futurePriority,
        effective_from_date: futureEffectiveDate || undefined,
      });
      setFutureSuccess(
        res.message ||
          `บันทึกการแก้ไขเทมเพลตสำหรับสัปดาห์ถัดไป (เริ่มมีผล ${formatThaiDate(
            futureEffectiveDate,
            { includeWeekday: false }
          )}) เรียบร้อยแล้ว โดยประวัติงานนี้ยังคงเดิม`
      );
      await loadDetail();
    } catch (err) {
      setFutureError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถแก้ไขเทมเพลตสำหรับสัปดาห์ถัดไปได้"
      );
    } finally {
      setSavingFuture(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 rounded bg-[#EAF3EC] animate-pulse" />
        <div className="h-44 rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] animate-pulse" />
      </div>
    );
  }

  if (error || !occurrence) {
    return (
      <div className="space-y-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#256B4A] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับไปหน้าแดชบอร์ด
        </Link>
        <Alert variant="error" title="ไม่พบข้อมูลงานดูแล">
          {error || "ไม่พบรายการงานที่ระบุ"}
        </Alert>
      </div>
    );
  }

  const isCompleted = occurrence.status === "completed" || occurrence.is_locked;
  const priorityMeta = PRIORITY_META[occurrence.priority];

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#256B4A] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          กลับไปรายการดูแลประจำวัน
        </Link>
        <Badge variant={isCompleted ? "locked" : "neutral"}>
          {isCompleted ? "เสร็จสิ้นและล็อกแล้ว" : "ยังไม่เสร็จ"}
        </Badge>
      </div>

      {/* Main Task Header Card */}
      <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-5 space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={priorityMeta.badgeVariant}>
              {priorityMeta.label}
            </Badge>
            {occurrence.is_medically_prescribed && (
              <Badge variant="warning">
                <Stethoscope className="h-3 w-3" />
                สำคัญทางการแพทย์ (AI ไม่ขยับเวลาอัตโนมัติ)
              </Badge>
            )}
            {occurrence.is_fixed_time && (
              <Badge variant="neutral">เวลาคงที่</Badge>
            )}
          </div>

          <h1 className="text-2xl font-bold text-[#17241D] leading-snug">
            {occurrence.title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#66736B]">
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-[#256B4A]" />
              {formatThaiDate(occurrence.occurrence_date)}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium text-[#17241D]">
              <Clock className="h-4 w-4 text-[#256B4A]" />
              เวลา {occurrence.scheduled_time} น. (
              {formatDuration(occurrence.duration_minutes)})
            </span>
          </div>
        </div>

        {occurrence.description && (
          <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] px-3.5 py-2.5 text-sm text-[#17241D]">
            <p className="text-xs font-medium text-[#66736B] mb-0.5">
              รายละเอียดการดูแล
            </p>
            <p className="leading-relaxed">{occurrence.description}</p>
          </div>
        )}

        {/* Strict Rule Banner */}
        {isCompleted ? (
          <Alert variant="success" title="บันทึกนี้เสร็จสิ้นและถูกล็อกถาวรแล้ว (Immutable)">
            <p className="text-xs sm:text-sm">
              ยืนยันเมื่อ {formatThaiDateTime(occurrence.completed_at)} · สถานะ:{" "}
              <strong>
                {occurrence.is_delayed ? "เสร็จล่าช้ากว่ากำหนด" : "เสร็จตรงเวลา"}
              </strong>{" "}
              — ข้อมูลและภาพถ่ายยืนยันของรอบนี้ไม่สามารถแก้ไขหรือลบย้อนหลังได้
            </p>
          </Alert>
        ) : (
          <Alert
            variant="warning"
            title="งานที่กำลังดำเนินอยู่ไม่สามารถแก้ไขหรือลบได้"
          >
            <p className="text-xs sm:text-sm">
              เพื่อความโปร่งใสและความต่อเนื่องของแผนดูแล ระบบไม่อนุญาตให้แก้ไขหรือลบรายการที่ยังไม่เสร็จในรอบวันนี้
              กรุณาแนบภาพถ่ายยืนยันและกดเสร็จสิ้นก่อน จากนั้นคุณจึงจะสามารถแก้ไขเทมเพลตสำหรับสัปดาห์ถัดไปได้
            </p>
          </Alert>
        )}
      </section>

      {/* Photo Proof Uploader & Confirm Completion */}
      <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-5 space-y-3">
        <h2 className="text-lg font-semibold text-[#17241D]">
          หลักฐานภาพถ่ายและการยืนยันเสร็จสิ้น
        </h2>
        <PhotoProofUploader
          occurrence={occurrence}
          onUpdated={({ occurrence: updated, nextDependent: nextDep }) => {
            setOccurrence(updated);
            if (nextDep) setNextDependent(nextDep);
            void loadDetail();
          }}
        />
      </section>

      {/* Next Dependent Task Card */}
      {nextDependent && (
        <section className="rounded-lg border border-[#CFE3D4] bg-[#EAF3EC]/60 p-5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-[#256B4A]">
                {isCompleted
                  ? "งานถัดไปที่พร้อมเริ่มดำเนินการทันที"
                  : "งานต่อเนื่องถัดไป (ทำหลังจากงานนี้เสร็จ)"}
              </p>
              <h2 className="text-base font-bold text-[#17241D] mt-0.5">
                {nextDependent.scheduled_time} น. — {nextDependent.title}
              </h2>
              <p className="text-xs text-[#66736B]">
                ระยะเวลาประมาณ {formatDuration(nextDependent.duration_minutes)}
              </p>
            </div>
            <Link
              href={`/tasks/${nextDependent.id}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#256B4A] px-3.5 text-sm font-medium text-white hover:bg-[#1E583C]"
            >
              เปิดดูงานถัดไป
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      )}

      {/* Future-Week Template Editor (Unlocked ONLY once current occurrence is completed) */}
      <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[#17241D] flex items-center gap-2">
              <Edit3 className="h-4 w-4 text-[#256B4A]" />
              แก้ไขเทมเพลตสำหรับสัปดาห์ถัดไป (Future-Week Edit)
            </h2>
            <p className="text-xs sm:text-sm text-[#66736B] mt-0.5">
              การปรับเปลี่ยนเวลา ชื่องาน หรือรายละเอียดจะมีผลเฉพาะรอบในอนาคตเท่านั้น ไม่กระทบประวัติการดูแลที่บันทึกไว้แล้ว
            </p>
          </div>
          <Badge variant={occurrence.can_edit_future_template ? "sage" : "neutral"}>
            {occurrence.can_edit_future_template ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                ปลดล็อกแล้ว
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" />
                ล็อกอยู่
              </>
            )}
          </Badge>
        </div>

        {!occurrence.can_edit_future_template ? (
          <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-4 text-sm text-[#66736B] flex items-start gap-2.5">
            <Lock className="h-4 w-4 text-[#B86A32] mt-0.5 shrink-0" />
            <p>
              ส่วนแก้ไขสำหรับสัปดาห์ถัดไปจะปลดล็อกอัตโนมัติเมื่อคุณแนบภาพถ่ายและกด{" "}
              <strong className="text-[#17241D]">“ยืนยันทำเสร็จสิ้น”</strong>{" "}
              สำหรับงานรอบนี้เรียบร้อยแล้ว
            </p>
          </div>
        ) : (
          <form onSubmit={handleSaveFutureTemplate} className="space-y-3.5">
            {futureError && <Alert variant="error">{futureError}</Alert>}
            {futureSuccess && <Alert variant="success">{futureSuccess}</Alert>}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-6">
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  ชื่องานสำหรับสัปดาห์ถัดไป
                </label>
                <Input
                  value={futureTitle}
                  onChange={(e) => setFutureTitle(e.target.value)}
                  required
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  เวลาใหม่
                </label>
                <Input
                  type="time"
                  value={futureTime}
                  onChange={(e) => setFutureTime(e.target.value)}
                  required
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  ระยะเวลา (นาที)
                </label>
                <Input
                  type="number"
                  min={5}
                  max={360}
                  value={futureDuration}
                  onChange={(e) =>
                    setFutureDuration(Number(e.target.value) || 30)
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-6">
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  ระดับความสำคัญ
                </label>
                <Select
                  value={futurePriority}
                  onChange={(e) =>
                    setFuturePriority(e.target.value as TaskPriority)
                  }
                >
                  <option value="low">ทั่วไป</option>
                  <option value="medium">ปานกลาง</option>
                  <option value="high">สำคัญ</option>
                  <option value="medical_critical">สำคัญทางการแพทย์</option>
                </Select>
              </div>

              <div className="sm:col-span-6">
                <label className="block text-xs font-medium text-[#66736B] mb-1">
                  เริ่มมีผลตั้งแต่วันที่
                </label>
                <Input
                  type="date"
                  value={futureEffectiveDate}
                  onChange={(e) => setFutureEffectiveDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#66736B] mb-1">
                รายละเอียดเพิ่มเติม
              </label>
              <Textarea
                rows={2}
                value={futureDescription}
                onChange={(e) => setFutureDescription(e.target.value)}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={savingFuture}>
                บันทึกการเปลี่ยนแปลงสำหรับสัปดาห์ถัดไป
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Read-Only Event History Timeline */}
      <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-5 space-y-3.5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#17241D] flex items-center gap-2">
            <History className="h-4 w-4 text-[#256B4A]" />
            ประวัติเหตุการณ์ของงานนี้ (อ่านอย่างเดียว)
          </h2>
          <Badge variant="neutral">{history.length} รายการ</Badge>
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-[#66736B]">ยังไม่มีประวัติเหตุการณ์</p>
        ) : (
          <ol className="relative border-l border-[#E3E9E3] ml-2 space-y-3.5 pl-5">
            {history.map((ev) => (
              <li key={ev.id} className="relative">
                <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#256B4A] bg-[#FFFFFF]" />
                <p className="text-sm font-medium text-[#17241D]">
                  {HISTORY_EVENT_LABELS[ev.event_type] || ev.event_type}
                </p>
                <p className="text-xs text-[#66736B]">
                  {formatThaiDateTime(ev.created_at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
