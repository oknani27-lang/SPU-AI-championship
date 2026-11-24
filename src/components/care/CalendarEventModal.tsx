"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
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
  defaultEventType?: "general" | "doctor";
  editingOccurrence?: CalendarEventOccurrence | null;
  editingRecord?: CalendarEventRecord | null;
  onSaved: () => void;
}

export function CalendarEventModal({
  open,
  onClose,
  defaultDate,
  defaultEventType = "general",
  editingOccurrence,
  editingRecord,
  onSaved,
}: CalendarEventModalProps) {
  const router = useRouter();
  const isEditing = Boolean(editingRecord);
  const isRecurring = Boolean(
    editingRecord && editingRecord.recurrence !== "never"
  );

  const [title, setTitle] = React.useState("");
  const [eventType, setEventType] = React.useState<"general" | "doctor">("general");
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
      setEventType(editingRecord.event_type ?? "general");
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
      setEventType(defaultEventType);
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
  }, [open, defaultDate, defaultEventType, editingRecord, editingOccurrence]);

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
    if (!isAllDay && startDate === endDate && endTime <= startTime) {
      setError("เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น");
      return;
    }

    setSaving(true);
    setError(null);
    const parsedReminder =
      reminderMinutes === "none" ? null : Number(reminderMinutes);

    try {
      let saved: CalendarEventRecord;
      if (editingRecord) {
        const result = await updateCalendarEvent(editingRecord.id, {
          event_type: eventType,
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
        saved = result.split_event ?? result.event;
      } else {
        const result = await createCalendarEvent({
          event_type: eventType,
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
        saved = result.event;
      }
      onSaved();
      onClose();
      if (eventType === "doctor") router.push(`/doctor?${new URLSearchParams({ event: saved.id, date: startDate })}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถบันทึกกิจกรรมได้"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (scope: "single" | "future" | "all") => {
    if (!editingRecord || !window.confirm(scope === "all" ? "ลบกิจกรรมนี้ทั้งชุด?" : scope === "future" ? "ลบรอบนี้และรอบในอนาคตทั้งหมด?" : "ลบเฉพาะกิจกรรมรอบนี้?")) return;
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
    <Dialog open={open} onClose={() => { if (!saving && !deleting) onClose(); }} title={isEditing ? "แก้ไขกิจกรรม" : "เพิ่มกิจกรรม"} maxWidthClass="max-w-lg"
      footer={<div className="flex w-full items-center justify-between gap-3">
        {isEditing ? <details className="relative text-sm"><summary className="cursor-pointer text-[#A8383B]">ลบกิจกรรม</summary><div className="absolute bottom-8 left-0 w-48 rounded-lg border border-[#E3E9E3] bg-white p-2 shadow-lg space-y-1">
          {isRecurring && editingOccurrence && <><Button type="button" variant="ghost" size="sm" disabled={saving || deleting} onClick={() => void handleDelete("single")}>เฉพาะครั้งนี้</Button><Button type="button" variant="ghost" size="sm" disabled={saving || deleting} onClick={() => void handleDelete("future")}>ครั้งนี้และอนาคต</Button></>}
          <Button type="button" variant="ghost" size="sm" disabled={saving || deleting} onClick={() => void handleDelete("all")}><Trash2 className="h-3.5 w-3.5" />{isRecurring ? "ลบทั้งหมด" : "ลบกิจกรรม"}</Button>
        </div></details> : <span />}
        <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={saving || deleting}>ยกเลิก</Button><Button type="submit" form="calendar-event-form" loading={saving} disabled={deleting}>บันทึก</Button></div>
      </div>}>
      <form id="calendar-event-form" onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        <div><label htmlFor="cal-ev-title" className="block text-sm font-medium mb-1">ชื่อกิจกรรม</label><Input id="cal-ev-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="นัดหมายหรือสิ่งที่ต้องทำ" required maxLength={200} /></div>
        <div><label htmlFor="cal-ev-type" className="block text-sm font-medium mb-1">ประเภท</label><Select id="cal-ev-type" value={eventType} onChange={e => setEventType(e.target.value as "general" | "doctor")}><option value="general">กิจกรรมทั่วไป</option><option value="doctor">นัดพบแพทย์</option></Select></div>
        {eventType === "doctor" && <Link className="inline-block text-sm text-[#256B4A] hover:underline" href={editingRecord ? '/doctor?' + new URLSearchParams({ event: editingRecord.id, date: editingOccurrence?.occurrence_date ?? editingRecord.start_date }) : "/doctor?tab=hospitals"}>โรงพยาบาลและช่องทางติดต่อ ↗</Link>}
        <div className="flex items-center justify-between"><span className="text-sm">ทั้งวัน</span><Switch checked={isAllDay} onCheckedChange={setIsAllDay} aria-label="กิจกรรมตลอดวัน" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label htmlFor="cal-ev-start-date" className="block text-xs text-[#66736B] mb-1">วันเริ่ม</label><Input id="cal-ev-start-date" type="date" value={startDate} onChange={e => { const v = e.target.value; setStartDate(v); if (endDate < v) setEndDate(v); }} required /></div>
          <div><label htmlFor="cal-ev-end-date" className="block text-xs text-[#66736B] mb-1">วันสิ้นสุด</label><Input id="cal-ev-end-date" type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} required /></div>
          {!isAllDay && <><div><label htmlFor="cal-ev-start-time" className="block text-xs text-[#66736B] mb-1">เวลาเริ่ม</label><Input id="cal-ev-start-time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required /></div><div><label htmlFor="cal-ev-end-time" className="block text-xs text-[#66736B] mb-1">เวลาสิ้นสุด</label><Input id="cal-ev-end-time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required /></div></>}
        </div>
        {isRecurring && editingOccurrence && <div><label htmlFor="cal-ev-scope" className="block text-sm font-medium mb-1">แก้ไข</label><Select id="cal-ev-scope" value={editScope} onChange={e => setEditScope(e.target.value as "single" | "future" | "all")}><option value="single">เฉพาะครั้งนี้</option><option value="future">ครั้งนี้และอนาคต</option><option value="all">ทั้งชุด</option></Select></div>}
        <details key={open ? editingRecord?.id || "new" : "closed"} open={isRecurring || undefined} className="border-t border-[#E3E9E3] pt-3">
          <summary className="cursor-pointer text-sm text-[#256B4A]">ตัวเลือกเพิ่มเติม</summary>
          <div className="space-y-4 pt-4">
            <div><label htmlFor="cal-ev-desc" className="block text-sm mb-1">รายละเอียด</label><Textarea id="cal-ev-desc" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="สถานที่หรือหมายเหตุ" maxLength={1000} /></div>
            <div className="grid grid-cols-2 gap-3"><div><label htmlFor="cal-ev-recurrence" className="block text-xs text-[#66736B] mb-1">ทำซ้ำ</label><Select id="cal-ev-recurrence" value={recurrence} onChange={e => setRecurrence(e.target.value as CalendarEventRecurrence)} disabled={isRecurring && editScope === "single"}>{Object.entries(RECURRENCE_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
            <div><label htmlFor="cal-ev-reminder" className="block text-xs text-[#66736B] mb-1">เตือนล่วงหน้า</label><Select id="cal-ev-reminder" value={reminderMinutes} onChange={e => setReminderMinutes(e.target.value)}><option value="none">ไม่เตือน</option><option value="0">เมื่อถึงเวลา</option><option value="5">5 นาที</option><option value="15">15 นาที</option><option value="30">30 นาที</option><option value="60">1 ชั่วโมง</option><option value="1440">1 วัน</option></Select></div></div>
          </div>
        </details>
      </form>
    </Dialog>
  );
}
