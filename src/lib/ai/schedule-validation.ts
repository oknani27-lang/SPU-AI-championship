import type { ProposedScheduleTask } from "@/types/careplan";
import { hhmmToMinutes } from "@/lib/timezone";

/** Validate the complete proposal after restoring immutable input times. */
export function scheduleProblem(tasks: ProposedScheduleTask[]): string | null {
  const byId = new Map(tasks.map(task => [task.temp_id, task]));
  if (byId.size !== tasks.length) return "รหัสงานซ้ำ กรุณาจัดตารางใหม่";
  const ordered = [...tasks].sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
  const window = tasks.map(task => task.description).join("\n").match(/เริ่มดูแล[^\n]*?(\d{2}:\d{2})\s*ถึง\s*(\d{2}:\d{2})/);
  for (let index = 0; index < ordered.length; index++) {
    const task = ordered[index];
    const start = hhmmToMinutes(task.scheduled_time);
    if (window && (start < hhmmToMinutes(window[1]) || start + task.duration_minutes > hhmmToMinutes(window[2]))) return `งาน ${task.title} อยู่นอกช่วงดูแล กรุณาปรับเวลา`;
    if (start + task.duration_minutes > 1440) return `งาน ${task.title} สิ้นสุดเกินวัน กรุณาปรับเวลา`;
    if (index && hhmmToMinutes(ordered[index - 1].scheduled_time) + ordered[index - 1].duration_minutes > start) return `เวลา ${task.title} ทับกับงานก่อนหน้า กรุณาปรับเวลา`;
    if (task.depends_on_temp_id) {
      const parent = byId.get(task.depends_on_temp_id);
      if (!parent || parent.temp_id === task.temp_id || hhmmToMinutes(parent.scheduled_time) + parent.duration_minutes > start) return `ลำดับงาน ${task.title} ไม่ถูกต้อง กรุณาตรวจงานก่อนหน้า`;
    }
  }
  return null;
}
