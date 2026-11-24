import { describe, it, expect } from "vitest";
import { parseThaiTextDeterministically, proposeDailySchedule } from "@/lib/ai/service";
import { readFileSync } from "node:fs";
import { scheduleProblem } from "@/lib/ai/schedule-validation";
import { textToTaskGeminiOutputSchema } from "@/lib/ai/schemas";
import type { ProposedScheduleTask } from "@/types/careplan";

describe("task extraction regressions", () => {
  it("handles the complete reported daily routine without overlaps or evening overflow", async () => {
    const extracted = parseThaiTextDeterministically(readFileSync("scripts/fixtures/daily-tasks.txt", "utf8"), 1);
    expect(extracted.extracted_tasks).toHaveLength(14);
    const result = await proposeDailySchedule({ day_of_week: extracted.extracted_tasks[0].day_of_week, tasks: extracted.extracted_tasks.map(task => ({ ...task, preferred_time: task.preferred_time ?? undefined })), forceFallback: true });
    expect(scheduleProblem(result.response.proposed_tasks)).toBeNull();
    expect(result.response.proposed_tasks.find(task => task.title === "เว้นช่วงพัก")).toMatchObject({ scheduled_time: "13:00", duration_minutes: 60 });
    const washing = result.response.proposed_tasks.find(task => /ซักเสื้อผ้า/.test(task.title))!;
    expect(result.response.proposed_tasks.find(task => /ตากผ้า/.test(task.title))?.depends_on_temp_id).toBe(washing.temp_id);
    expect(result.response.proposed_tasks.filter(task => /พักผู้ดูแล/.test(task.title))).toHaveLength(2);
  });
  it("keeps the task before its time and reads explicit duration", () => {
    const result = parseThaiTextDeterministically("ช่วยคุณยายรับประทานอาหารเวลา 08:00 น. ใช้เวลา 30 นาที", 3);
    expect(result.extracted_tasks).toHaveLength(1);
    expect(result.extracted_tasks[0]).toMatchObject({ title: "ช่วยคุณยายรับประทานอาหาร", preferred_time: "08:00", duration_minutes: 30, is_medically_prescribed: false });
  });
  it("does not turn a care-window header into a task or classify คุณยาย as medicine", () => {
    const result = parseThaiTextDeterministically("พรุ่งนี้เริ่มดูแลคุณยายเวลา 07:00 ถึง 18:00 น.\nซักเสื้อผ้า 40 นาที", 3);
    expect(result.extracted_tasks).toHaveLength(1);
    expect(result.extracted_tasks[0].duration_minutes).toBe(40);
    expect(result.missing_info_questions).toHaveLength(0);
  });
  it("rejects duplicate IDs and dependency cycles", () => {
    const item = { temp_id: "a", day_of_week: 3, title: "ซักผ้า", preferred_time: null, depends_on_temp_id: "b" };
    expect(textToTaskGeminiOutputSchema.safeParse({ extracted_tasks: [item, { ...item }] }).success).toBe(false);
    expect(textToTaskGeminiOutputSchema.safeParse({ extracted_tasks: [item, { ...item, temp_id: "b", depends_on_temp_id: "a" }] }).success).toBe(false);
  });
  it("rejects overlapping, overnight and reversed dependencies but allows adjacent tasks", () => {
    const a: ProposedScheduleTask = { temp_id: "a", title: "ซักผ้า", description: "", scheduled_time: "09:00", duration_minutes: 40, priority: "medium", is_fixed_time: false, is_medically_prescribed: false, depends_on_temp_id: null, rationale: "" };
    const b = { ...a, temp_id: "b", title: "ตากผ้า", scheduled_time: "09:40", depends_on_temp_id: "a" };
    expect(scheduleProblem([a, b])).toBeNull();
    expect(scheduleProblem([a, { ...b, scheduled_time: "09:20" }])).toBeTruthy();
    expect(scheduleProblem([{ ...a, scheduled_time: "23:40" }])).toBeTruthy();
    expect(scheduleProblem([{ ...a, depends_on_temp_id: "b" }, { ...b, depends_on_temp_id: null }])).toBeTruthy();
  });
});
