"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarRange,
  CheckCircle2,
  Clock,
  Edit3,
  Lock,
  Plus,
  Share2,
  Sparkles,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useSession } from "@/components/care/SessionContext";
import { SevenDaySelector } from "@/components/care/SevenDaySelector";
import { TextToTaskComposer } from "@/components/care/TextToTaskComposer";
import { AiScheduleReviewModal } from "@/components/care/AiScheduleReviewModal";
import { ShareScheduleDialog } from "@/components/share/ShareScheduleDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import {
  getOccurrencesByDate,
  getSchedule,
  updateRestDay,
  updateTemplateForFuture,
} from "@/lib/api-client";
import {
  createTempId,
  formatDuration,
  formatThaiDate,
  getBangkokToday,
  getDayOfWeek,
  getNextOccurrenceDateForWeekday,
  PRIORITY_META,
} from "@/lib/utils";
import {
  THAI_DAY_NAMES,
  type DailyTaskOccurrence,
  type DayOfWeek,
  type DraftTaskInput,
  type RecurringTaskTemplate,
  type TaskPriority,
  type WeeklyScheduleTemplate,
} from "@/types/careplan";

export default function WeeklySchedulePage() {
  return (
    <AppShell>
      <WeeklyScheduleContent />
    </AppShell>
  );
}

function WeeklyScheduleContent() {
  const { session, refreshSession, demoVersion } = useSession();
  const [selectedDate, setSelectedDate] = React.useState(() =>
    getBangkokToday()
  );
  const selectedDayOfWeek: DayOfWeek = getDayOfWeek(selectedDate);

  const [weeklySchedule, setWeeklySchedule] =
    React.useState<WeeklyScheduleTemplate | null>(null);
  const [templates, setTemplates] = React.useState<RecurringTaskTemplate[]>([]);
  const [dayOccurrences, setDayOccurrences] = React.useState<
    DailyTaskOccurrence[]
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<string | null>(null);

  // Rest day state
  const [togglingRest, setTogglingRest] = React.useState(false);

  // Draft tasks queue for AI Schedule Generator
  const [drafts, setDrafts] = React.useState<DraftTaskInput[]>([]);
  const [manualTitle, setManualTitle] = React.useState("");
  const [manualDesc, setManualDesc] = React.useState("");
  const [manualTime, setManualTime] = React.useState("09:00");
  const [manualDuration, setManualDuration] = React.useState(30);
  const [manualPriority, setManualPriority] =
    React.useState<TaskPriority>("medium");
  const [manualFixed, setManualFixed] = React.useState(false);
  const [manualMedical, setManualMedical] = React.useState(false);
  const [manualDependsOn, setManualDependsOn] = React.useState<string>("");

  // AI review modal state
  const [aiModalOpen, setAiModalOpen] = React.useState(false);
  const [aiModalDay, setAiModalDay] = React.useState<DayOfWeek>(
    selectedDayOfWeek
  );
  const [aiModalTasks, setAiModalTasks] = React.useState<DraftTaskInput[]>([]);

  // Share dialog
  const [shareOpen, setShareOpen] = React.useState(false);

  // Future-week template inline editor
  const [editingTemplateId, setEditingTemplateId] = React.useState<
    string | null
  >(null);
  const [editForm, setEditForm] = React.useState({
    title: "",
    description: "",
    scheduled_time: "09:00",
    duration_minutes: 30,
    priority: "medium" as TaskPriority,
    effective_from_date: "",
  });
  const [savingEdit, setSavingEdit] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  const loadData = React.useCallback(async (date: string) => {
    setLoading(true);
    setError(null);
    try {
      const [schedRes, occRes] = await Promise.all([
        getSchedule(),
        getOccurrencesByDate(date),
      ]);
      setWeeklySchedule(schedRes.weekly_schedule);
      setTemplates(schedRes.templates || []);
      setDayOccurrences(occRes.occurrences || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถโหลดตารางสัปดาห์ได้"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadData(selectedDate);
  }, [selectedDate, demoVersion, loadData]);

  const restDays = weeklySchedule?.rest_days ?? session?.weekly_schedule?.rest_days ?? [];
  const isCurrentDayRest = restDays.includes(selectedDayOfWeek);

  const templatesForDay = React.useMemo(
    () =>
      templates
        .filter((t) => t.is_active && t.day_of_week === selectedDayOfWeek)
        .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)),
    [templates, selectedDayOfWeek]
  );

  const occurrenceByTemplateId = React.useMemo(() => {
    const map = new Map<string, DailyTaskOccurrence>();
    for (const occ of dayOccurrences) {
      map.set(occ.template_id, occ);
    }
    return map;
  }, [dayOccurrences]);

  const handleToggleRestDay = async (checked: boolean) => {
    setTogglingRest(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await updateRestDay({
        day_of_week: selectedDayOfWeek,
        is_rest_day: checked,
      });
      setWeeklySchedule(res.weekly_schedule);
      setFeedback(
        checked
          ? `ตั้งค่า${THAI_DAY_NAMES[selectedDayOfWeek].full}เป็นวันพักแล้ว — ${res.medical_disclaimer}`
          : `ยกเลิกวันพักสำหรับ${THAI_DAY_NAMES[selectedDayOfWeek].full}แล้ว`
      );
      await Promise.all([loadData(selectedDate), refreshSession()]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถอัปเดตวันพักได้"
      );
    } finally {
      setTogglingRest(false);
    }
  };

  const handleAddManualDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTitle.trim()) return;
    const newDraft: DraftTaskInput = {
      temp_id: createTempId(),
      title: manualTitle.trim(),
      description: manualDesc.trim() || undefined,
      preferred_time: manualTime || undefined,
      duration_minutes: Math.max(5, Number(manualDuration) || 30),
      priority: manualMedical ? "medical_critical" : manualPriority,
      is_fixed_time: manualFixed || manualMedical,
      is_medically_prescribed: manualMedical,
      depends_on_temp_id: manualDependsOn || null,
    };
    setDrafts((prev) => [...prev, newDraft]);
    setManualTitle("");
    setManualDesc("");
    setManualDependsOn("");
    setManualMedical(false);
    setManualFixed(false);
  };

  const openAiModalWithDrafts = (
    dayOfWeek: DayOfWeek,
    incomingDrafts: DraftTaskInput[]
  ) => {
    setAiModalDay(dayOfWeek);
    setAiModalTasks(incomingDrafts);
    setAiModalOpen(true);
  };

  const handleOpenAiForCurrentDay = () => {
    // Combine existing templates for this day + new drafts so AI avoids overlap
    const combined: DraftTaskInput[] = [
      ...templatesForDay.map((t) => ({
        temp_id: t.id,
        title: t.title,
        description: t.description,
        preferred_time: t.scheduled_time,
        duration_minutes: t.duration_minutes,
        priority: t.priority,
        is_fixed_time: t.is_fixed_time,
        is_medically_prescribed: t.is_medically_prescribed,
      })),
      ...drafts,
    ];
    if (combined.length === 0) {
      setError("กรุณาเพิ่มงานร่างอย่างน้อย 1 รายการก่อนให้ AI ช่วยจัดตาราง");
      return;
    }
    openAiModalWithDrafts(selectedDayOfWeek, combined);
  };

  const startEditTemplate = (tpl: RecurringTaskTemplate) => {
    setEditError(null);
    setEditingTemplateId(tpl.id);
    setEditForm({
      title: tpl.title,
      description: tpl.description,
      scheduled_time: tpl.scheduled_time,
      duration_minutes: tpl.duration_minutes,
      priority: tpl.priority,
      effective_from_date: getNextOccurrenceDateForWeekday(tpl.day_of_week),
    });
  };

  const handleSaveFutureTemplate = async (templateId: string) => {
    setSavingEdit(true);
    setEditError(null);
    setFeedback(null);
    try {
      const res = await updateTemplateForFuture(templateId, {
        title: editForm.title.trim(),
        description: editForm.description.trim(),
        scheduled_time: editForm.scheduled_time,
        duration_minutes: Math.max(5, Number(editForm.duration_minutes) || 30),
        priority: editForm.priority,
        effective_from_date: editForm.effective_from_date || undefined,
      });
      setEditingTemplateId(null);
      setFeedback(
        res.message ||
          "บันทึกการแก้ไขสำหรับสัปดาห์ถัดไปเรียบร้อยแล้ว (ประวัติในอดีตยังคงเดิม)"
      );
      await loadData(selectedDate);
    } catch (err) {
      setEditError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถแก้ไขเทมเพลตได้ (อาจมีงานวันนี้ที่ยังไม่เสร็จสิ้น)"
      );
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#17241D] flex items-center gap-2">
            <CalendarRange className="h-6 w-6 text-[#256B4A]" />
            ตารางดูแลรายสัปดาห์ (ซ้ำทุก 7 วัน)
          </h1>
          <p className="text-sm text-[#66736B] mt-0.5">
            จัดการงานดูแลสำหรับวันจันทร์–วันอาทิตย์ ระบบจะสร้างรายการประจำวันให้อัตโนมัติทุกสัปดาห์
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShareOpen(true)}
        >
          <Share2 className="h-4 w-4" />
          แชร์ตารางสัปดาห์ให้ครอบครัว
        </Button>
      </div>

      {/* 7-Day Selector */}
      <SevenDaySelector
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
        restDays={restDays}
      />

      {error && <Alert variant="error">{error}</Alert>}
      {feedback && <Alert variant="success">{feedback}</Alert>}

      {/* Rest Day Toggle Card */}
      <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-4 space-y-3">
        <Switch
          checked={isCurrentDayRest}
          disabled={togglingRest}
          onCheckedChange={handleToggleRestDay}
          label={`ตั้งค่า${THAI_DAY_NAMES[selectedDayOfWeek].full}เป็นวันพัก (Rest Day)`}
          description="วันพักหมายถึงไม่มีรายการนัดหมายในแอปสำหรับวันนี้ แต่จะไม่ยกเลิกการดูแลที่จำเป็นทางการแพทย์โดยอัตโนมัติ"
        />
        {isCurrentDayRest && (
          <Alert variant="warning">
            วันพักสำหรับ{THAI_DAY_NAMES[selectedDayOfWeek].full}เปิดใช้งานอยู่ —
            หากผู้รับการดูแลยังต้องรับประทานยาหรือการดูแลทางการแพทย์ตามคำสั่งแพทย์
            กรุณาปฏิบัติตามแผนของแพทย์ต่อไป
          </Alert>
        )}
      </div>

      {/* Text-to-Task Composer (Typed Text Only) */}
      <TextToTaskComposer
        defaultDayOfWeek={selectedDayOfWeek}
        onSendToAiSchedule={(dayOfWeek, extractedDrafts) => {
          openAiModalWithDrafts(dayOfWeek, extractedDrafts);
        }}
        onSavedDirectly={() => {
          setFeedback("บันทึกรายการงานเข้าตารางเรียบร้อยแล้ว");
          void loadData(selectedDate);
        }}
      />

      {/* Manual Quick-Add + Draft Queue + AI Schedule Generator */}
      <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-[17px] font-semibold text-[#17241D]">
              เพิ่มงานด้วยตนเองและให้ AI จัดตารางเวลา ({THAI_DAY_NAMES[selectedDayOfWeek].full})
            </h2>
            <p className="text-xs sm:text-sm text-[#66736B]">
              เพิ่มรายการร่างด้านล่าง แล้วกด “ให้ AI ช่วยจัดตารางเวลา” เพื่อตรวจสอบและอนุมัติก่อนบันทึก
            </p>
          </div>
          <Button
            variant="primary"
            onClick={handleOpenAiForCurrentDay}
            disabled={drafts.length === 0 && templatesForDay.length === 0}
          >
            <Sparkles className="h-4 w-4" />
            ให้ AI ช่วยจัดตารางเวลา
          </Button>
        </div>

        <form
          onSubmit={handleAddManualDraft}
          className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-3.5 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <div className="sm:col-span-5">
              <label className="block text-xs text-[#66736B] mb-1">
                ชื่องานดูแล *
              </label>
              <Input
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="เช่น จัดยาความดันหลังอาหารเช้า"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs text-[#66736B] mb-1">
                เวลาที่ต้องการ
              </label>
              <Input
                type="time"
                value={manualTime}
                onChange={(e) => setManualTime(e.target.value)}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs text-[#66736B] mb-1">
                ระยะเวลา (นาที)
              </label>
              <Input
                type="number"
                min={5}
                max={360}
                value={manualDuration}
                onChange={(e) => setManualDuration(Number(e.target.value) || 30)}
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs text-[#66736B] mb-1">
                ความสำคัญ
              </label>
              <Select
                value={manualPriority}
                onChange={(e) =>
                  setManualPriority(e.target.value as TaskPriority)
                }
              >
                <option value="low">ทั่วไป</option>
                <option value="medium">ปานกลาง</option>
                <option value="high">สำคัญ</option>
                <option value="medical_critical">สำคัญทางการแพทย์</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
            <div className="sm:col-span-6">
              <label className="block text-xs text-[#66736B] mb-1">
                รายละเอียดเพิ่มเติม (ไม่บังคับ)
              </label>
              <Input
                value={manualDesc}
                onChange={(e) => setManualDesc(e.target.value)}
                placeholder="เช่น เตรียมน้ำอุ่นและบันทึกค่าความดัน"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="block text-xs text-[#66736B] mb-1">
                ต้องทำต่อจากงาน (Dependency)
              </label>
              <Select
                value={manualDependsOn}
                onChange={(e) => setManualDependsOn(e.target.value)}
              >
                <option value="">ไม่มีงานก่อนหน้า</option>
                {templatesForDay.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.scheduled_time} — {t.title}
                  </option>
                ))}
                {drafts.map((d) => (
                  <option key={d.temp_id} value={d.temp_id}>
                    (ร่าง) {d.preferred_time || "--:--"} — {d.title}
                  </option>
                ))}
              </Select>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary" className="w-full">
                <Plus className="h-4 w-4" />
                เพิ่มลงร่าง
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs text-[#17241D]">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={manualMedical}
                onChange={(e) => setManualMedical(e.target.checked)}
                className="accent-[#256B4A]"
              />
              <Stethoscope className="h-3.5 w-3.5 text-[#B86A32]" />
              เป็นงานที่แพทย์กำหนดเวลา (AI จะไม่ขยับเวลาอัตโนมัติ)
            </label>

            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={manualFixed}
                onChange={(e) => setManualFixed(e.target.checked)}
                className="accent-[#256B4A]"
              />
              ล็อกเวลาคงที่
            </label>
          </div>
        </form>

        {/* Drafts Queue */}
        {drafts.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-[#17241D]">
                รายการร่างที่รอจัดตาราง ({drafts.length} รายการ)
              </p>
              <Button
                size="sm"
                variant="primary"
                onClick={handleOpenAiForCurrentDay}
              >
                <Sparkles className="h-3.5 w-3.5" />
                ให้ AI ช่วยจัดตารางและตรวจสอบก่อนบันทึก
              </Button>
            </div>
            <div className="divide-y divide-[#E3E9E3] rounded-md border border-[#E3E9E3]">
              {drafts.map((d) => (
                <div
                  key={d.temp_id}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm bg-[#FFFFFF]"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-semibold text-[#256B4A] tabular-nums">
                      {d.preferred_time || "ยืดหยุ่น"}
                    </span>
                    <span className="font-medium text-[#17241D] truncate">
                      {d.title}
                    </span>
                    <span className="text-xs text-[#66736B]">
                      ({formatDuration(d.duration_minutes || 30)})
                    </span>
                    {d.is_medically_prescribed && (
                      <Badge variant="warning">แพทย์กำหนด</Badge>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDrafts((prev) =>
                        prev.filter((item) => item.temp_id !== d.temp_id)
                      )
                    }
                    className="text-[#66736B] hover:text-[#B86A32] p-1"
                    aria-label="ลบรายการร่าง"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Saved Recurring Templates for Selected Weekday + Future-Week Editor */}
      <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] overflow-hidden">
        <div className="border-b border-[#E3E9E3] px-4 py-3.5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[17px] font-semibold text-[#17241D]">
              เทมเพลตประจำ{THAI_DAY_NAMES[selectedDayOfWeek].full} (ซ้ำทุกสัปดาห์)
            </h2>
            <p className="text-xs text-[#66736B]">
              อ้างอิงสถานะของวันที่ {formatThaiDate(selectedDate, { includeWeekday: false })} ·
              การแก้ไขเทมเพลตจะเปิดให้ทำได้เมื่อรอบงานปัจจุบันเสร็จสิ้นแล้วเท่านั้น เพื่อคงความโปร่งใสของประวัติ
            </p>
          </div>
          <Badge variant="sage">{templatesForDay.length} งานประจำ</Badge>
        </div>

        {loading ? (
          <div className="p-6 text-center text-sm text-[#66736B]">
            กำลังโหลดเทมเพลตตารางสัปดาห์...
          </div>
        ) : templatesForDay.length === 0 ? (
          <div className="p-6 text-center text-sm text-[#66736B]">
            ยังไม่มีงานประจำสำหรับ{THAI_DAY_NAMES[selectedDayOfWeek].full}
          </div>
        ) : (
          <div className="divide-y divide-[#E3E9E3]">
            {templatesForDay.map((tpl) => {
              const occ = occurrenceByTemplateId.get(tpl.id);
              const isLockedBecauseActiveIncomplete =
                occ ? !occ.can_edit_future_template : false;
              const isEditing = editingTemplateId === tpl.id;
              const priorityMeta = PRIORITY_META[tpl.priority];

              return (
                <div key={tpl.id} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[#256B4A] tabular-nums text-[15px]">
                          {tpl.scheduled_time} น.
                        </span>
                        <span className="font-semibold text-[#17241D] text-[16px]">
                          {tpl.title}
                        </span>
                        <Badge variant={priorityMeta.badgeVariant}>
                          {priorityMeta.label}
                        </Badge>
                        {tpl.is_medically_prescribed && (
                          <Badge variant="warning">
                            <Stethoscope className="h-3 w-3" />
                            แพทย์กำหนด
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#66736B]">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formatDuration(tpl.duration_minutes)}
                        </span>
                        <span>เวอร์ชัน {tpl.version}</span>
                        <span>
                          มีผลตั้งแต่{" "}
                          {formatThaiDate(tpl.effective_from_date, {
                            includeWeekday: false,
                          })}
                        </span>
                        {occ && (
                          <Link
                            href={`/tasks/${occ.id}`}
                            className="inline-flex items-center gap-1 font-medium text-[#256B4A] hover:underline"
                          >
                            {occ.status === "completed" ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                รอบวันที่เลือกเสร็จสิ้นแล้ว
                              </>
                            ) : (
                              <>
                                <Lock className="h-3 w-3" />
                                รอบวันที่เลือกยังไม่เสร็จ (ไปยืนยัน)
                              </>
                            )}
                          </Link>
                        )}
                      </div>

                      {tpl.description && (
                        <p className="text-xs sm:text-sm text-[#66736B]">
                          {tpl.description}
                        </p>
                      )}
                    </div>

                    <div className="shrink-0">
                      {isLockedBecauseActiveIncomplete ? (
                        <div className="inline-flex items-center gap-1.5 rounded-md border border-[#E3E9E3] bg-[#FAFBF9] px-2.5 py-1.5 text-xs text-[#66736B]">
                          <Lock className="h-3.5 w-3.5 text-[#B86A32]" />
                          ล็อกจนกว่างานรอบนี้จะเสร็จสิ้น
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant={isEditing ? "ghost" : "outline"}
                          onClick={() =>
                            isEditing
                              ? setEditingTemplateId(null)
                              : startEditTemplate(tpl)
                          }
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          {isEditing ? "ปิดฟอร์ม" : "แก้ไขสำหรับสัปดาห์ถัดไป"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Future-Week Template Inline Edit Form */}
                  {isEditing && (
                    <div className="rounded-md border border-[#CFE3D4] bg-[#EAF3EC]/35 p-3.5 space-y-3">
                      <p className="text-xs font-medium text-[#1E583C]">
                        การแก้ไขนี้จะมีผลเฉพาะรอบสัปดาห์ถัดไปเป็นต้นไป (ประวัติที่เสร็จสิ้นแล้วจะไม่ถูกเปลี่ยนแปลง)
                      </p>

                      {editError && <Alert variant="error">{editError}</Alert>}

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                        <div className="sm:col-span-5">
                          <label className="block text-xs text-[#66736B] mb-1">
                            ชื่องาน
                          </label>
                          <Input
                            value={editForm.title}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                title: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-[#66736B] mb-1">
                            เวลาใหม่
                          </label>
                          <Input
                            type="time"
                            value={editForm.scheduled_time}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                scheduled_time: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs text-[#66736B] mb-1">
                            นาที
                          </label>
                          <Input
                            type="number"
                            min={5}
                            max={360}
                            value={editForm.duration_minutes}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                duration_minutes: Number(e.target.value) || 30,
                              }))
                            }
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <label className="block text-xs text-[#66736B] mb-1">
                            มีผลตั้งแต่วันที่
                          </label>
                          <Input
                            type="date"
                            value={editForm.effective_from_date}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                effective_from_date: e.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingTemplateId(null)}
                        >
                          ยกเลิก
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          loading={savingEdit}
                          onClick={() => void handleSaveFutureTemplate(tpl.id)}
                        >
                          บันทึกสำหรับสัปดาห์ถัดไป
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* AI Schedule Review Modal */}
      <AiScheduleReviewModal
        open={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        dayOfWeek={aiModalDay}
        draftTasks={aiModalTasks}
        onApproved={() => {
          setDrafts([]);
          setFeedback(
            `อนุมัติและบันทึกตารางสำหรับ${THAI_DAY_NAMES[aiModalDay].full}เรียบร้อยแล้ว`
          );
          void loadData(selectedDate);
        }}
      />

      {/* Share Schedule Dialog */}
      <ShareScheduleDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        defaultDate={selectedDate}
        defaultScope="week"
        careRecipientName={
          session?.care_recipient?.display_name || "ผู้รับการดูแล"
        }
      />
    </div>
  );
}
