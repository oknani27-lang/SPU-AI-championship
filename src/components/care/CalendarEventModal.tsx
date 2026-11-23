"use client";

import * as React from "react";
import { Calendar, Repeat, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/alert";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/lib/api-client";
import type {
  CalendarEventOccurrence,
  CalendarEventRecord,
  CalendarEventRecurrence,
} from "@/types/careplan";

export const RECURRENCE_LABELS: Record<CalendarEventRecurrence, string> = {
  never: "ไม่ทำซ้ำ",
  daily: "ทุกวัน",
  weekly: "ทุกสัปดาห์",
  monthly: "ทุกเดือน",
};

export interface CalendarEventModalProps {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  editingOccurrence?: CalendarEventOccurrence | null;
  editingRecord?: CalendarEventRecord | null;
  onSaved: () => void;
}

export function CalendarEventModal({
  open,
  onClose,
  defaultDate,
  editingOccurrence,
  editingRecord,
  onSaved,
}: CalendarEventModalProps) {
  const isEditing = Boolean(editingRecord);
  const isRecurring = Boolean(
    editingRecord && editingRecord.recurrence !== "never"
  );

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [startDate, setStartDate] = React.useState(defaultDate);
  const [endDate, setEndDate] = React.useState(defaultDate);
  const [isAllDay, setIsAllDay] = React.useState(false);
  const [startTime, setStartTime] = React.useState("09:00");
  const [endTime, setEndTime] = React.useState("10:00");
  const [recurrence, setRecurrence] =
    React.useState<CalendarEventRecurrence>("never");
  const [reminderMinutes, setReminderMinutes] = React.useState<string>("15");
  const [editScope, setEditScope] = React.useState<"single" | "future" | "all">(
    "all"
  );

  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);

    if (editingRecord) {
      setTitle(editingRecord.title);
      setDescription(editingRecord.description || "");
      setStartDate(
        editingOccurrence?.occurrence_date ?? editingRecord.start_date
      );
      setEndDate(editingOccurrence?.end_date ?? editingRecord.end_date);
      setIsAllDay(editingRecord.is_all_day);
      setStartTime(editingRecord.is_all_day ? "09:00" : editingRecord.start_time);
      setEndTime(editingRecord.is_all_day ? "10:00" : editingRecord.end_time);
      setRecurrence(editingRecord.recurrence);
      setReminderMinutes(
        editingRecord.reminder_minutes === null
          ? "none"
          : String(editingRecord.reminder_minutes)
      );
      setEditScope(
        editingRecord.recurrence !== "never" && editingOccurrence
          ? "single"
          : "all"
      );
    } else {
      setTitle("");
      setDescription("");
      setStartDate(defaultDate);
      setEndDate(defaultDate);
      setIsAllDay(false);
      setStartTime("09:00");
      setEndTime("10:00");
      setRecurrence("never");
      setReminderMinutes("15");
      setEditScope("all");
    }
  }, [open, defaultDate, editingRecord, editingOccurrence]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError("กรุณาระบุชื่อกิจกรรม");
      return;
    }
    if (endDate < startDate) {
      setError("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มต้น");
      return;
    }
    if (!isAllDay && startDate === endDate && endTime < startTime) {
      setError("เวลาสิ้นสุดต้องไม่น้อยกว่าเวลาเริ่มต้น");
      return;
    }

    setSaving(true);
    setError(null);
    const parsedReminder =
      reminderMinutes === "none" ? null : Number(reminderMinutes);

    try {
      if (editingRecord) {
        await updateCalendarEvent(editingRecord.id, {
          title: trimmed,
          description: description.trim(),
          start_date: startDate,
          end_date: endDate,
          is_all_day: isAllDay,
          start_time: isAllDay ? "00:00" : startTime,
          end_time: isAllDay ? "23:59" : endTime,
          recurrence: editScope === "single" ? "never" : recurrence,
          reminder_minutes: parsedReminder,
          edit_scope: isRecurring ? editScope : "all",
          occurrence_date:
            editingOccurrence?.occurrence_date ?? editingRecord.start_date,
        });
      } else {
        await createCalendarEvent({
          title: trimmed,
          description: description.trim(),
          start_date: startDate,
          end_date: endDate,
          is_all_day: isAllDay,
          start_time: isAllDay ? "00:00" : startTime,
          end_time: isAllDay ? "23:59" : endTime,
          recurrence,
          reminder_minutes: parsedReminder,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถบันทึกกิจกรรมได้"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (scope: "single" | "all") => {
    if (!editingRecord) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteCalendarEvent(editingRecord.id, {
        scope,
        occurrenceDate: editingOccurrence?.occurrence_date,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถลบกิจกรรมได้"
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEditing ? "แก้ไขกิจกรรมในปฏิทิน" : "สร้างกิจกรรมใหม่ในปฏิทิน"}
      description="เพิ่มนัดหมายพบแพทย์ กิจกรรมครอบครัว หรือบันทึกวันสำคัญร่วมกับตารางดูแลประจำวัน"
      maxWidthClass="max-w-lg"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {isEditing && (
              <>
                {isRecurring && editingOccurrence && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    loading={deleting}
                    onClick={() => void handleDelete("single")}
                    className="text-[#A8383B] border-[#E8C5C6] hover:bg-[#FDF2F2]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    ลบเฉพาะรอบนี้
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={deleting}
                  onClick={() => void handleDelete("all")}
                  className="text-[#A8383B] border-[#E8C5C6] hover:bg-[#FDF2F2]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isRecurring ? "ลบทั้งชุด" : "ลบกิจกรรม"}
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={saving || deleting}
            >
              ยกเลิก
            </Button>
            <Button
              type="submit"
              form="calendar-event-form"
              variant="primary"
              loading={saving}
              disabled={deleting}
            >
              <Calendar className="h-4 w-4" />
              {isEditing ? "บันทึกการแก้ไข" : "บันทึกกิจกรรม"}
            </Button>
          </div>
        </div>
      }
    >
      <form
        id="calendar-event-form"
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        {error && <Alert variant="error">{error}</Alert>}

        <div>
          <label
            htmlFor="cal-ev-title"
            className="block text-sm font-medium text-[#17241D] mb-1"
          >
            ชื่อกิจกรรม *
          </label>
          <Input
            id="cal-ev-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="เช่น นัดพบแพทย์ตรวจติดตาม หรือเยี่ยมญาติ"
            required
          />
        </div>

        <div>
          <label
            htmlFor="cal-ev-desc"
            className="block text-sm font-medium text-[#17241D] mb-1"
          >
            รายละเอียดเพิ่มเติม
          </label>
          <Textarea
            id="cal-ev-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="สถานที่ เอกสารที่ต้องเตรียม หรือหมายเหตุสำหรับผู้ดูแล"
          />
        </div>

        <div className="flex items-center justify-between rounded-md border border-[#E3E9E3] bg-[#FAFBF9] px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-[#17241D]">กิจกรรมตลอดวัน</p>
            <p className="text-xs text-[#66736B]">
              เปิดใช้งานหากไม่ระบุเวลาเริ่มและสิ้นสุดเฉพาะเจาะจง
            </p>
          </div>
          <Switch
            checked={isAllDay}
            onCheckedChange={setIsAllDay}
            aria-label="กิจกรรมตลอดวัน"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="cal-ev-start-date"
              className="block text-xs font-medium text-[#66736B] mb-1"
            >
              วันที่เริ่มต้น
            </label>
            <Input
              id="cal-ev-start-date"
              type="date"
              value={startDate}
              onChange={(e) => {
                const v = e.target.value;
                setStartDate(v);
                if (endDate < v) setEndDate(v);
              }}
              required
            />
          </div>
          <div>
            <label
              htmlFor="cal-ev-end-date"
              className="block text-xs font-medium text-[#66736B] mb-1"
            >
              วันที่สิ้นสุด
            </label>
            <Input
              id="cal-ev-end-date"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
        </div>

        {!isAllDay && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="cal-ev-start-time"
                className="block text-xs font-medium text-[#66736B] mb-1"
              >
                เวลาเริ่มต้น
              </label>
              <Input
                id="cal-ev-start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="cal-ev-end-time"
                className="block text-xs font-medium text-[#66736B] mb-1"
              >
                เวลาสิ้นสุด
              </label>
              <Input
                id="cal-ev-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="cal-ev-recurrence"
              className="block text-xs font-medium text-[#66736B] mb-1"
            >
              การทำซ้ำ
            </label>
            <Select
              id="cal-ev-recurrence"
              value={recurrence}
              onChange={(e) =>
                setRecurrence(e.target.value as CalendarEventRecurrence)
              }
              disabled={isRecurring && editScope === "single"}
            >
              <option value="never">ไม่ทำซ้ำ</option>
              <option value="daily">ทุกวัน</option>
              <option value="weekly">ทุกสัปดาห์</option>
              <option value="monthly">ทุกเดือน</option>
            </Select>
          </div>
          <div>
            <label
              htmlFor="cal-ev-reminder"
              className="block text-xs font-medium text-[#66736B] mb-1"
            >
              การแจ้งเตือนล่วงหน้า
            </label>
            <Select
              id="cal-ev-reminder"
              value={reminderMinutes}
              onChange={(e) => setReminderMinutes(e.target.value)}
            >
              <option value="none">ไม่แจ้งเตือน</option>
              <option value="0">ตรงเวลาเริ่มกิจกรรม</option>
              <option value="15">ล่วงหน้า 15 นาที</option>
              <option value="30">ล่วงหน้า 30 นาที</option>
              <option value="60">ล่วงหน้า 1 ชั่วโมง</option>
              <option value="1440">ล่วงหน้า 1 วัน</option>
            </Select>
          </div>
        </div>

        {/* Recurring Edit Scope Selector */}
        {isRecurring && editingOccurrence && (
          <div className="rounded-md border border-[#CFE3D4] bg-[#EAF3EC]/50 p-3 space-y-2">
            <p className="text-xs font-semibold text-[#17241D] flex items-center gap-1.5">
              <Repeat className="h-3.5 w-3.5 text-[#256B4A]" />
              ขอบเขตการแก้ไขกิจกรรมที่ทำซ้ำ
            </p>
            <div className="space-y-1.5 text-xs text-[#17241D]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="edit-scope"
                  value="single"
                  checked={editScope === "single"}
                  onChange={() => setEditScope("single")}
                  className="accent-[#256B4A]"
                />
                <span>
                  เฉพาะรอบนี้ ({editingOccurrence.occurrence_date})
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="edit-scope"
                  value="future"
                  checked={editScope === "future"}
                  onChange={() => setEditScope("future")}
                  className="accent-[#256B4A]"
                />
                <span>รอบนี้และรอบในอนาคตทั้งหมด</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="edit-scope"
                  value="all"
                  checked={editScope === "all"}
                  onChange={() => setEditScope("all")}
                  className="accent-[#256B4A]"
                />
                <span>ทั้งชุดกิจกรรมตั้งแต่เริ่มต้น</span>
              </label>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}
