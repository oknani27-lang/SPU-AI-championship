"use client";

import * as React from "react";
import {
  FileText,
  Plus,
  Send,
  Sparkles,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { approveSchedule, extractTextToTask } from "@/lib/api-client";
import { createTempId } from "@/lib/utils";
import {
  ALL_DAYS,
  THAI_DAY_NAMES,
  type DayOfWeek,
  type DraftTaskInput,
  type ProposedScheduleTask,
  type TaskPriority,
  type TextToTaskExtractedItem,
} from "@/types/careplan";

export interface TextToTaskComposerProps {
  defaultDayOfWeek: DayOfWeek;
  onSendToAiSchedule?: (dayOfWeek: DayOfWeek, drafts: DraftTaskInput[]) => void;
  onSavedDirectly?: (dayOfWeek: DayOfWeek) => void;
  compact?: boolean;
}

const SAMPLE_PROMPTS = [
  "วันจันทร์ 8 โมงเตรียมอาหารให้แม่ 9 โมงจัดยา แล้วบ่ายสองพาไปหาหมอ",
  "วันพุธ 07:30 วัดความดัน 08:30 กินข้าวเช้าและกินยาหลังอาหาร 16:00 พาเดินออกกำลังกาย 30 นาที",
];

export function TextToTaskComposer({
  defaultDayOfWeek,
  onSendToAiSchedule,
  onSavedDirectly,
  compact = false,
}: TextToTaskComposerProps) {
  const [rawText, setRawText] = React.useState("");
  const [extracting, setExtracting] = React.useState(false);
  const [savingDirect, setSavingDirect] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);

  const [items, setItems] = React.useState<TextToTaskExtractedItem[]>([]);
  const [questions, setQuestions] = React.useState<string[]>([]);
  const [providerInfo, setProviderInfo] = React.useState<{
    provider: string;
    usedFallback: boolean;
  } | null>(null);

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = rawText.trim();
    if (!trimmed) {
      setError("กรุณาพิมพ์ข้อความรายการงานที่ต้องการให้ระบบช่วยแยก");
      return;
    }

    setExtracting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await extractTextToTask({
        text: trimmed,
        default_day_of_week: defaultDayOfWeek,
      });
      setItems(res.extracted_tasks || []);
      setQuestions(res.missing_info_questions || []);
      setProviderInfo({
        provider: res.provider,
        usedFallback: res.used_fallback,
      });
      if (!res.extracted_tasks || res.extracted_tasks.length === 0) {
        setError(
          "ไม่พบรายการงานที่ชัดเจนจากข้อความ ลองระบุชื่อกิจกรรมและเวลาเพิ่มเติม เช่น 8 โมงเตรียมอาหาร"
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถแปลงข้อความเป็นรายการงานได้"
      );
    } finally {
      setExtracting(false);
    }
  };

  const updateItem = <K extends keyof TextToTaskExtractedItem>(
    tempId: string,
    key: K,
    value: TextToTaskExtractedItem[K]
  ) => {
    setItems((prev) =>
      prev.map((item) =>
        item.temp_id === tempId ? { ...item, [key]: value } : item
      )
    );
  };

  const removeItem = (tempId: string) => {
    setItems((prev) => prev.filter((item) => item.temp_id !== tempId));
  };

  const addBlankItem = () => {
    setItems((prev) => [
      ...prev,
      {
        temp_id: createTempId(),
        day_of_week: defaultDayOfWeek,
        title: "",
        description: "",
        preferred_time: "09:00",
        duration_minutes: 30,
        priority: "medium",
        is_fixed_time: false,
        is_medically_prescribed: false,
      },
    ]);
  };

  const handleSendToAi = () => {
    const valid = items.filter((i) => i.title.trim().length > 0);
    if (valid.length === 0) {
      setError("กรุณาระบุชื่องานอย่างน้อย 1 รายการก่อนส่งให้ AI จัดตาราง");
      return;
    }
    const targetDay = valid[0].day_of_week;
    const drafts: DraftTaskInput[] = valid.map((item) => ({
      temp_id: item.temp_id,
      title: item.title.trim(),
      description: item.description.trim(),
      preferred_time: item.preferred_time || undefined,
      duration_minutes: item.duration_minutes,
      priority: item.priority,
      is_fixed_time: item.is_fixed_time,
      is_medically_prescribed: item.is_medically_prescribed,
    }));
    onSendToAiSchedule?.(targetDay, drafts);
  };

  const handleSaveDirectly = async () => {
    const valid = items.filter((i) => i.title.trim().length > 0);
    if (valid.length === 0) {
      setError("กรุณาระบุชื่องานอย่างน้อย 1 รายการก่อนบันทึก");
      return;
    }

    setSavingDirect(true);
    setError(null);
    setSuccessMsg(null);
    try {
      // Group by day_of_week so each weekday saves cleanly
      const byDay = new Map<DayOfWeek, ProposedScheduleTask[]>();
      for (const item of valid) {
        const list = byDay.get(item.day_of_week) ?? [];
        list.push({
          temp_id: item.temp_id,
          title: item.title.trim(),
          description: item.description.trim(),
          scheduled_time: item.preferred_time || "09:00",
          duration_minutes: Math.max(5, Number(item.duration_minutes) || 30),
          priority: item.priority,
          is_fixed_time: item.is_fixed_time,
          is_medically_prescribed: item.is_medically_prescribed,
          depends_on_temp_id: null,
          rationale: "ยืนยันและบันทึกจากข้อความที่ผู้ดูแลพิมพ์",
        });
        byDay.set(item.day_of_week, list);
      }

      let lastDay: DayOfWeek = defaultDayOfWeek;
      for (const [dow, tasks] of byDay.entries()) {
        await approveSchedule({ day_of_week: dow, tasks });
        lastDay = dow;
      }

      setSuccessMsg(`บันทึกรายการงาน ${valid.length} รายการเข้าสู่ตารางเรียบร้อยแล้ว`);
      setItems([]);
      setRawText("");
      setQuestions([]);
      onSavedDirectly?.(lastDay);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถบันทึกรายการงานได้"
      );
    } finally {
      setSavingDirect(false);
    }
  };

  return (
    <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-semibold text-[#17241D] flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#256B4A]" />
            พิมพ์ข้อความเพื่อเพิ่มงานอย่างรวดเร็ว (Text-to-Task)
          </h3>
          <p className="text-xs sm:text-sm text-[#66736B] mt-0.5">
            พิมพ์หลายงานพร้อมกันเป็นภาษาไทย ระบบจะช่วยแยกเป็นรายการงานให้ตรวจสอบและแก้ไขก่อนบันทึก
          </p>
        </div>
        <Badge variant="neutral">พิมพ์ข้อความเท่านั้น</Badge>
      </div>

      <form onSubmit={handleExtract} className="space-y-3">
        <div>
          <label htmlFor="text-to-task-input" className="sr-only">
            พิมพ์รายการงานดูแลผู้สูงอายุ
          </label>
          <Textarea
            id="text-to-task-input"
            rows={compact ? 2 : 3}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="เช่น วันจันทร์ 8 โมงเตรียมอาหารให้แม่ 9 โมงจัดยา แล้วบ่ายสองพาไปหาหมอ"
          />
        </div>

        {/* Example typed text chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[#66736B]">ตัวอย่างข้อความ:</span>
          {SAMPLE_PROMPTS.map((sample, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setRawText(sample)}
              className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] px-2.5 py-1 text-xs text-[#17241D] hover:bg-[#EAF3EC] transition-colors text-left"
            >
              ตัวอย่างที่ {idx + 1}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-end">
          <Button type="submit" variant="primary" loading={extracting}>
            <Sparkles className="h-4 w-4" />
            แยกเป็นรายการงานด้วย AI
          </Button>
        </div>
      </form>

      {error && <Alert variant="error">{error}</Alert>}
      {successMsg && <Alert variant="success">{successMsg}</Alert>}

      {/* Extracted Editable Review List */}
      {items.length > 0 && (
        <div className="space-y-3 border-t border-[#E3E9E3] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[#17241D]">
                ตรวจสอบและแก้ไขรายการที่แยกได้ ({items.length} รายการ)
              </p>
              <p className="text-xs text-[#66736B]">
                คุณสามารถปรับแก้ชื่อ วัน เวลา ระยะเวลา หรือทำเครื่องหมายงานทางการแพทย์ได้ก่อนบันทึก
              </p>
            </div>
            {providerInfo && (
              <Badge variant={providerInfo.usedFallback ? "neutral" : "sage"}>
                {providerInfo.usedFallback
                  ? "ตัวช่วยแยกข้อความอัตโนมัติ (Fallback)"
                  : `แยกข้อความโดย ${providerInfo.provider}`}
              </Badge>
            )}
          </div>

          {questions.length > 0 && (
            <Alert variant="warning" title="ข้อมูลที่อาจต้องตรวจสอบเพิ่มเติม">
              <ul className="list-disc pl-4 space-y-0.5 text-xs">
                {questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </Alert>
          )}

          <div className="space-y-2.5">
            {items.map((item) => (
              <div
                key={item.temp_id}
                className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-3 space-y-2.5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <label className="block text-xs text-[#66736B] mb-1">
                      ชื่องาน
                    </label>
                    <Input
                      value={item.title}
                      onChange={(e) =>
                        updateItem(item.temp_id, "title", e.target.value)
                      }
                      placeholder="ระบุชื่องานดูแล"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs text-[#66736B] mb-1">
                      วันในสัปดาห์
                    </label>
                    <Select
                      value={item.day_of_week}
                      onChange={(e) =>
                        updateItem(
                          item.temp_id,
                          "day_of_week",
                          Number(e.target.value) as DayOfWeek
                        )
                      }
                    >
                      {ALL_DAYS.map((d) => (
                        <option key={d} value={d}>
                          {THAI_DAY_NAMES[d].full}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-[#66736B] mb-1">
                      เวลา
                    </label>
                    <Input
                      type="time"
                      value={item.preferred_time || "09:00"}
                      onChange={(e) =>
                        updateItem(item.temp_id, "preferred_time", e.target.value)
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
                      value={item.duration_minutes}
                      onChange={(e) =>
                        updateItem(
                          item.temp_id,
                          "duration_minutes",
                          Number(e.target.value) || 30
                        )
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <select
                      aria-label="ระดับความสำคัญ"
                      value={item.priority}
                      onChange={(e) =>
                        updateItem(
                          item.temp_id,
                          "priority",
                          e.target.value as TaskPriority
                        )
                      }
                      className="h-8 rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-2 text-xs text-[#17241D]"
                    >
                      <option value="low">ความสำคัญ: ทั่วไป</option>
                      <option value="medium">ความสำคัญ: ปานกลาง</option>
                      <option value="high">ความสำคัญ: สำคัญ</option>
                      <option value="medical_critical">
                        ความสำคัญ: สำคัญทางการแพทย์
                      </option>
                    </select>

                    <label className="inline-flex items-center gap-1.5 text-[#17241D] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.is_medically_prescribed}
                        onChange={(e) =>
                          updateItem(
                            item.temp_id,
                            "is_medically_prescribed",
                            e.target.checked
                          )
                        }
                        className="rounded border-[#E3E9E3] accent-[#256B4A]"
                      />
                      <Stethoscope className="h-3.5 w-3.5 text-[#B86A32]" />
                      แพทย์กำหนดเวลา
                    </label>

                    <label className="inline-flex items-center gap-1.5 text-[#17241D] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={item.is_fixed_time}
                        onChange={(e) =>
                          updateItem(
                            item.temp_id,
                            "is_fixed_time",
                            e.target.checked
                          )
                        }
                        className="rounded border-[#E3E9E3] accent-[#256B4A]"
                      />
                      เวลาคงที่
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => removeItem(item.temp_id)}
                    className="inline-flex items-center gap-1 text-xs text-[#66736B] hover:text-[#B86A32]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    ลบรายการ
                  </button>
                </div>

                {item.assumption_note && (
                  <p className="text-xs text-[#66736B]">
                    หมายเหตุการแยกข้อความ: {item.assumption_note}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={addBlankItem}>
              <Plus className="h-3.5 w-3.5" />
              เพิ่มแถวงาน
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              {onSendToAiSchedule && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleSendToAi}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  ส่งไปให้ AI จัดเรียงตาราง
                </Button>
              )}
              <Button
                size="sm"
                variant="primary"
                loading={savingDirect}
                onClick={handleSaveDirectly}
              >
                <Send className="h-3.5 w-3.5" />
                อนุมัติและบันทึกเข้าตาราง
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
