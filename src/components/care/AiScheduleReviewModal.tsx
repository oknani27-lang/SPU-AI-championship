"use client";

import * as React from "react";
import {
  CheckCircle2,
  Clock,
  GitBranch,
  Loader2,
  ShieldAlert,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { approveSchedule, generateAiSchedule } from "@/lib/api-client";
import { scheduleProblem } from "@/lib/ai/schedule-validation";
import { formatDuration, PRIORITY_META } from "@/lib/utils";
import {
  THAI_DAY_NAMES,
  type AiScheduleProposalResponse,
  type DayOfWeek,
  type DraftTaskInput,
  type ProposedScheduleTask,
} from "@/types/careplan";

export interface AiScheduleReviewModalProps {
  open: boolean;
  onClose: () => void;
  dayOfWeek: DayOfWeek;
  draftTasks: DraftTaskInput[];
  effectiveFromDate?: string;
  onApproved: () => void;
}

export function AiScheduleReviewModal({
  open,
  onClose,
  dayOfWeek,
  draftTasks,
  effectiveFromDate,
  onApproved,
}: AiScheduleReviewModalProps) {
  const [loading, setLoading] = React.useState(false);
  const [approving, setApproving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [proposal, setProposal] =
    React.useState<AiScheduleProposalResponse | null>(null);
  const [editableTasks, setEditableTasks] = React.useState<
    ProposedScheduleTask[]
  >([]);
  const proposalGeneration = React.useRef(0);
  const savingLock = React.useRef(false);
  const validationProblem = editableTasks.length ? scheduleProblem(editableTasks) : null;

  const runProposal = React.useCallback(async () => {
    if (draftTasks.length === 0) return;
    const current = ++proposalGeneration.current;
    setLoading(true);
    setError(null);
    setProposal(null);
    setEditableTasks([]);
    try {
      const res = await generateAiSchedule({
        day_of_week: dayOfWeek,
        tasks: draftTasks,
      });
      if (current !== proposalGeneration.current) return;
      setProposal(res);
      setEditableTasks(res.proposed_tasks || []);
    } catch (err) {
      if (current !== proposalGeneration.current) return;
      setError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถสร้างข้อเสนอตารางเวลาได้"
      );
    } finally {
      if (current === proposalGeneration.current) setLoading(false);
    }
  }, [dayOfWeek, draftTasks]);

  React.useEffect(() => {
    const activeGeneration = proposalGeneration;
    if (open) {
      void runProposal();
    }
    return () => { activeGeneration.current++; };
  }, [open, runProposal]);

  const updateTaskField = <K extends keyof ProposedScheduleTask>(
    tempId: string,
    key: K,
    value: ProposedScheduleTask[K]
  ) => {
    setEditableTasks((prev) =>
      prev.map((t) => (t.temp_id === tempId ? { ...t, [key]: value } : t))
    );
  };

  const handleApprove = async () => {
    if (editableTasks.length === 0 || savingLock.current || loading) return;
    if (validationProblem) { setError(validationProblem); return; }
    savingLock.current = true;
    setApproving(true);
    setError(null);
    try {
      await approveSchedule({
        day_of_week: dayOfWeek,
        effective_from_date: effectiveFromDate,
        tasks: editableTasks,
      });
      onApproved();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถบันทึกตารางที่อนุมัติได้"
      );
    } finally {
      setApproving(false);
      savingLock.current = false;
    }
  };

  const getTitleByTempId = (tempId: string | null) => {
    if (!tempId) return null;
    return editableTasks.find((t) => t.temp_id === tempId)?.title ?? null;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`ข้อเสนอตารางเวลาโดย AI — ${THAI_DAY_NAMES[dayOfWeek].full}`}
      description="กรุณาตรวจสอบเวลา เหตุผล และข้อสมมติฐานให้เรียบร้อยก่อนกดอนุมัติและบันทึก"
      maxWidthClass="max-w-3xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={approving}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            loading={approving}
            disabled={loading || editableTasks.length === 0 || Boolean(validationProblem)}
            onClick={handleApprove}
          >
            <CheckCircle2 className="h-4 w-4" />
            อนุมัติและบันทึกตาราง ({editableTasks.length} งาน)
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Medical Safety Notice */}
        <Alert variant="warning" title="ข้อควรระวังด้านความปลอดภัยทางการแพทย์">
          <div className="space-y-1 text-xs sm:text-sm">
            <p>
              AI ไม่ปรับเวลาของงานที่แพทย์กำหนดโดยอัตโนมัติ
              และไม่ให้คำแนะนำด้านการวินิจฉัยหรือปรับขนาดยา
            </p>
            {proposal?.medical_safety_note && (
              <p className="text-[#7A441D]">{proposal.medical_safety_note}</p>
            )}
          </div>
        </Alert>

        {loading && (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-[#256B4A]" />
            <div>
              <p className="font-medium text-[#17241D]">
                กำลังจัดเรียงตารางเวลาที่เหมาะสมและไม่ทับซ้อน...
              </p>
              <p className="text-xs text-[#66736B] mt-0.5">
                กำลังตรวจสอบงานที่แพทย์กำหนด ลำดับก่อน-หลัง และช่วงเวลาพัก
              </p>
            </div>
          </div>
        )}

        {error && (
          <Alert variant="error" title="เกิดข้อผิดพลาด">
            <p>{error}</p>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={() => void runProposal()}>
                ลองสร้างข้อเสนอใหม่
              </Button>
            </div>
          </Alert>
        )}

        {!loading && validationProblem && <Alert variant="warning">{validationProblem}</Alert>}
        {!loading && proposal && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-[#17241D] font-medium">
                {proposal.summary_note ||
                  "ตารางที่แนะนำเรียงตามลำดับเวลา (คุณสามารถปรับเวลาได้ก่อนกดอนุมัติ)"}
              </p>
              <Badge variant={proposal.used_fallback ? "warning" : "sage"}>
                <Sparkles className="h-3 w-3" />
                {proposal.used_fallback
                  ? "ใช้ระบบสำรอง · AI ไม่พร้อม"
                  : `สร้างข้อเสนอโดย ${proposal.provider}`}
              </Badge>
            </div>

            {/* Assumptions & Missing Info */}
            {(proposal.assumptions.length > 0 ||
              proposal.missing_info_questions.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {proposal.assumptions.length > 0 && (
                  <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-3 space-y-1">
                    <p className="text-xs font-semibold text-[#17241D]">
                      ข้อสมมติฐานที่ใช้จัดตาราง
                    </p>
                    <ul className="list-disc pl-4 space-y-0.5 text-xs text-[#66736B]">
                      {proposal.assumptions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {proposal.missing_info_questions.length > 0 && (
                  <div className="rounded-md border border-[#EBCBB2] bg-[#FDF6F0] p-3 space-y-1">
                    <p className="text-xs font-semibold text-[#B86A32] flex items-center gap-1">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      คำถามเพื่อความชัดเจนเพิ่มเติม
                    </p>
                    <ul className="list-disc pl-4 space-y-0.5 text-xs text-[#7A441D]">
                      {proposal.missing_info_questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Proposed Tasks Chronological List */}
            <div className="rounded-md border border-[#E3E9E3] divide-y divide-[#E3E9E3]">
              {editableTasks.map((task) => {
                const depTitle = getTitleByTempId(task.depends_on_temp_id);
                const priorityMeta = PRIORITY_META[task.priority];

                return (
                  <div key={task.temp_id} className="p-3.5 bg-[#FFFFFF] space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <Input
                          type="time"
                          value={task.scheduled_time}
                          onChange={(e) =>
                            updateTaskField(
                              task.temp_id,
                              "scheduled_time",
                              e.target.value
                            )
                          }
                          aria-label={`เวลาสำหรับ ${task.title}`}
                          className="w-28 h-9 text-sm font-semibold tabular-nums"
                        />
                        <div className="min-w-0 flex-1">
                          <Input
                            value={task.title}
                            onChange={(e) =>
                              updateTaskField(
                                task.temp_id,
                                "title",
                                e.target.value
                              )
                            }
                            aria-label="ชื่องาน"
                            className="h-9 text-sm font-medium"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={priorityMeta.badgeVariant}>
                          {priorityMeta.label}
                        </Badge>
                        {task.is_medically_prescribed && (
                          <Badge variant="warning">
                            <Stethoscope className="h-3 w-3" />
                            แพทย์กำหนด
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#66736B] pl-1">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDuration(task.duration_minutes)}
                      </span>
                      {depTitle && (
                        <span className="inline-flex items-center gap-1 text-[#256B4A]">
                          <GitBranch className="h-3.5 w-3.5" />
                          ทำต่อจาก: {depTitle}
                        </span>
                      )}
                    </div>

                    {task.rationale && (
                      <p className="rounded bg-[#FAFBF9] border border-[#E3E9E3] px-2.5 py-1.5 text-xs text-[#17241D]">
                        <span className="font-medium text-[#256B4A]">
                          เหตุผลการจัดเวลา:{" "}
                        </span>
                        {task.rationale}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
