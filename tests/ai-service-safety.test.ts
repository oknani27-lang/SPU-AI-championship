import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDailySummary, buildRestSuggestions, parseTextToTasks, proposeDailySchedule } from "@/lib/ai/service";
import { DEFAULT_SUPERVISION_SAFETY_NOTE } from "@/lib/ai/service";

const fixture = (data: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }] }), { status: 200 });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
function task(id: string) { return { temp_id: id, title: "จัดหนังสือ", description: "", scheduled_time: "09:00", duration_minutes: 20, priority: "low", is_fixed_time: false, is_medically_prescribed: false, depends_on_temp_id: null, rationale: "ช่วงเช้า" }; }
function schedule(tasks: unknown[]) { return { proposed_tasks: tasks, assumptions: [], missing_info_questions: [], summary_note: "ตารางทดสอบ" }; }
function mock(data: unknown) { vi.stubEnv("GEMINI_API_KEY", "test-only-key"); vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fixture(data)); }
const recipient = { display_name: "ตัวอย่าง", mobility_level: "independent" as const, requires_supervision: true };
const restItem = (start = "10:00", end = "10:30", duration = 30) => ({ gap_start: start, gap_end: end, duration_minutes: duration, activity_title: "อ่านหนังสือ", description: "นั่งอ่านหนังสือใกล้ห้องดูแล", supervision_safety_note: "ไม่ต้องมีผู้ดูแลในช่วงนี้เลย" });

describe("AI result safety and honest fallback", () => {
  it.each(["extra", "duplicate"])("rejects %s schedule task IDs rather than accepting fabricated records", async kind => {
    mock(schedule(kind === "extra" ? [task("one"), task("invented")] : [task("one"), task("one")]));
    const result = await proposeDailySchedule({ day_of_week: 2, tasks: [{ temp_id: "one", title: "จัดหนังสือ", duration_minutes: 20 }] });
    expect(result.response.used_fallback).toBe(true);
    expect(result.failure_reason).toBe("ai_output_validation_failed");
    expect(result.response.proposed_tasks.map(item => item.temp_id)).toEqual(["one"]);
  });
  it("preserves supplied medical title, description, time and duration", async () => {
    mock(schedule([{ ...task("med"), title: "เปลี่ยนรายการยา", description: "คำสั่งที่เพิ่มเอง", scheduled_time: "11:00", duration_minutes: 60 }]));
    const result = await proposeDailySchedule({ day_of_week: 2, tasks: [{ temp_id: "med", title: "งานตามแพทย์กำหนด", description: "ตามเอกสารเดิม", preferred_time: "08:00", duration_minutes: 15, is_medically_prescribed: true }] });
    expect(result.response.used_fallback).toBe(false);
    expect(result.response.proposed_tasks[0]).toMatchObject({ title: "งานตามแพทย์กำหนด", description: "ตามเอกสารเดิม", scheduled_time: "08:00", duration_minutes: 15, is_fixed_time: true, is_medically_prescribed: true, priority: "medical_critical" });
  });
  it("rejects generated dependency timing before its predecessor finishes", async () => {
    mock(schedule([{ ...task("one"), scheduled_time: "10:00" }, { ...task("two"), scheduled_time: "09:00", depends_on_temp_id: "one" }]));
    const result = await proposeDailySchedule({ day_of_week: 2, tasks: [{ temp_id: "one", title: "งานแรก", duration_minutes: 20 }, { temp_id: "two", title: "งานต่อมา", duration_minutes: 20, depends_on_temp_id: "one" }] });
    expect(result.response.used_fallback).toBe(true);
  });
  it.each([
    [restItem("09:50", "10:20", 30)],
    [restItem("10:00", "10:30", 60)],
    [restItem("10:00", "10:30", 30), restItem("10:10", "10:30", 20)],
  ])("rejects rest windows outside gaps, mismatched duration and mutually overlapping suggestions", async (...suggestions) => {
    mock({ suggestions });
    const result = await buildRestSuggestions({ date: "2026-11-24", occurrences: [], careRecipient: recipient });
    expect(result.telemetry.used_fallback).toBe(true);
    expect(result.failure_reason).toBe("ai_output_validation_failed");
  });
  it("retains a computed gap and uses the trusted supervision note", async () => {
    mock({ suggestions: [restItem()] });
    const result = await buildRestSuggestions({ date: "2026-11-24", occurrences: [], careRecipient: recipient });
    expect(result.telemetry.used_fallback).toBe(false);
    expect(result.suggestions[0].supervision_safety_note).toBe(DEFAULT_SUPERVISION_SAFETY_NOTE);
  });
  it("rejects out-of-home activities when the recipient requires supervision", async () => {
    mock({ suggestions: [{ ...restItem(), activity_title: "ออกจากบ้านไปเที่ยว", description: "ปล่อยผู้สูงอายุอยู่คนเดียว" }] });
    const result = await buildRestSuggestions({ date: "2026-11-24", occurrences: [], careRecipient: recipient });
    expect(result.telemetry.used_fallback).toBe(true);
  });
  it("returns sanitized failure reason separately from telemetry on fallback", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-only-key");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("unavailable", { status: 429 }));
    const result = await parseTextToTasks({ text: "วันอังคาร 9 โมงรดน้ำต้นไม้", default_day_of_week: 2 });
    expect(result.response.used_fallback).toBe(true);
    expect(result.failure_reason).toBe("gemini_http_429");
    expect(result.telemetry).not.toHaveProperty("failure_reason");
    const daily = await buildDailySummary({ date: "2026-11-24", metrics: { date: "2026-11-24", total_tasks: 0, completed_tasks: 0, incomplete_tasks: 0, on_time_completions: 0, delayed_completions: 0, progress_percent: 0 }, isRestDay: false, caregiverName: "ผู้ดูแล", careRecipientName: "ตัวอย่าง" });
    expect(daily.failure_reason).toBe("gemini_http_429");
  });
});
